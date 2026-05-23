/**
 * Dose schedule + dose administration REST routes.
 *
 *   GET    /api/v1/dose-schedules/me                         (patient)
 *   GET    /api/v1/patients/:patientId/dose-schedule         (staff)
 *   GET    /api/v1/appointments/:appointmentId/doctors-order (staff)
 *   POST   /api/v1/appointments/:appointmentId/doctors-order (staff)
 *   PATCH  /api/v1/dose-administrations/:doseId              (staff)
 *   GET    /api/v1/regimens                                  (staff)
 */

import { all, get, run } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import {
  REGIMENS,
  buildSchedule,
  doseStatus,
  isRegimenKey,
  listRegimens,
  nextDueDose,
} from "./services/pepSchedule.js";
import {
  defaultDoctorsOrderPayload,
  normalizeDoctorsOrderPayload,
  parseDoctorsOrderJson,
} from "./services/doctorsOrder.js";
const staffRead = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_READ" });
const staffWrite = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_WRITE" });
const patientOnly = requireAuth({ actorKinds: ["patient"] });

function mapDoseRow(row) {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    doseNumber: row.dose_number,
    dueDate: row.due_date,
    givenAt: row.given_at,
    vaccineLotId: row.vaccine_lot_id,
    givenByUserId: row.given_by_user_id,
    site: row.site,
    route: row.route,
    status: doseStatus({ givenAt: row.given_at, dueDate: row.due_date }),
  };
}

async function loadScheduleWithDoses(scheduleId) {
  const schedule = await get(
    `SELECT * FROM pep_schedules WHERE id = ?`,
    [scheduleId],
  );
  if (!schedule) return null;
  const doses = await all(
    `SELECT * FROM dose_administrations WHERE schedule_id = ? ORDER BY dose_number ASC`,
    [scheduleId],
  );
  const mappedDoses = doses.map(mapDoseRow);
  return {
    id: schedule.id,
    patientId: schedule.patient_id,
    exposureAppointmentId: schedule.exposure_appointment_id,
    regimen: schedule.regimen,
    regimenLabel: REGIMENS[schedule.regimen]?.label ?? schedule.regimen,
    day0Date: schedule.day0_date,
    status: schedule.status,
    createdAt: schedule.created_at,
    doses: mappedDoses,
    nextDueDose: nextDueDose(mappedDoses),
  };
}

async function loadPatientSchedules(patientId) {
  const rows = await all(
    `
    SELECT id FROM pep_schedules
    WHERE patient_id = ?
    ORDER BY day0_date DESC, id DESC
  `,
    [String(patientId)],
  );
  const schedules = [];
  for (const r of rows) {
    const s = await loadScheduleWithDoses(r.id);
    if (s) schedules.push(s);
  }
  return schedules;
}

export function mountDoseRoutes(app, API_PREFIX) {
  app.get(`${API_PREFIX}/regimens`, staffRead, (_req, res) => {
    res.status(200).json({ data: listRegimens() });
  });

  app.get(
    `${API_PREFIX}/dose-schedules/me`,
    patientOnly,
    async (req, res, next) => {
      try {
        const schedules = await loadPatientSchedules(req.actor.id);
        res.status(200).json({ data: { items: schedules } });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    `${API_PREFIX}/patients/:patientId/dose-schedule`,
    staffRead,
    async (req, res, next) => {
      try {
        const schedules = await loadPatientSchedules(req.params.patientId);
        res.status(200).json({ data: { items: schedules } });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    `${API_PREFIX}/appointments/:appointmentId/doctors-order`,
    staffRead,
    async (req, res, next) => {
      try {
        const appointmentId = String(req.params.appointmentId);
        const row = await get(
          `SELECT payload_json FROM doctors_orders WHERE appointment_id = ?`,
          [appointmentId],
        );
        const schedules = await all(
          `
          SELECT id FROM pep_schedules
          WHERE exposure_appointment_id = ?
          ORDER BY id DESC
        `,
          [appointmentId],
        );
        const expandedSchedules = [];
        for (const s of schedules) {
          const e = await loadScheduleWithDoses(s.id);
          if (e) expandedSchedules.push(e);
        }
        let payload = parseDoctorsOrderJson(row?.payload_json);
        if (!payload) {
          payload = defaultDoctorsOrderPayload();
          await run(
            `
            INSERT INTO doctors_orders (appointment_id, payload_json)
            VALUES (?, ?)
            ON CONFLICT(appointment_id) DO NOTHING
          `,
            [appointmentId, JSON.stringify(payload)],
          );
        }
        res.status(200).json({
          data: {
            payload,
            schedules: expandedSchedules,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${API_PREFIX}/appointments/:appointmentId/doctors-order`,
    staffWrite,
    async (req, res, next) => {
      try {
        const appointmentId = String(req.params.appointmentId);
        const appointment = await get(
          `SELECT id, patient_id FROM appointments WHERE id = ?`,
          [appointmentId],
        );
        if (!appointment) {
          res.status(404).json({ error: "Appointment not found." });
          return;
        }

        const payload = req.body?.payload ?? null;
        const schedule = req.body?.schedule ?? null;

        if (payload !== null && typeof payload !== "object") {
          res.status(400).json({ error: "Field 'payload' must be an object." });
          return;
        }
        if (schedule !== null) {
          if (typeof schedule !== "object") {
            res.status(400).json({ error: "Field 'schedule' must be an object." });
            return;
          }
          if (!isRegimenKey(schedule.regimen)) {
            res.status(400).json({
              error: `Unknown regimen. Expected one of ${Object.keys(REGIMENS).join(", ")}.`,
            });
            return;
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(schedule.day0Date ?? ""))) {
            res.status(400).json({ error: "Field 'schedule.day0Date' must be YYYY-MM-DD." });
            return;
          }
        }

        await run("BEGIN TRANSACTION");
        try {
          if (payload !== null) {
            const normalized = normalizeDoctorsOrderPayload(payload);
            await run(
              `
              INSERT INTO doctors_orders (appointment_id, payload_json)
              VALUES (?, ?)
              ON CONFLICT(appointment_id) DO UPDATE SET payload_json = excluded.payload_json
            `,
              [appointmentId, JSON.stringify(normalized)],
            );
            const biteCategory = Number(normalized?.biteCategory);
            if (biteCategory >= 1 && biteCategory <= 4) {
              await run(`UPDATE appointments SET category = ? WHERE id = ?`, [
                biteCategory,
                appointmentId,
              ]);
            }
          }
          let createdSchedule = null;
          if (schedule !== null) {
            const planned = buildSchedule(schedule.regimen, schedule.day0Date);
            const insertResult = await run(
              `
              INSERT INTO pep_schedules (
                patient_id, exposure_appointment_id, regimen, day0_date, status, updated_at
              )
              VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'))
            `,
              [
                appointment.patient_id,
                appointmentId,
                schedule.regimen,
                schedule.day0Date,
              ],
            );
            for (const dose of planned) {
              await run(
                `
                INSERT INTO dose_administrations (
                  schedule_id, dose_number, due_date, route
                ) VALUES (?, ?, ?, ?)
              `,
                [insertResult.id, dose.doseNumber, dose.dueDate, dose.route],
              );
            }
            createdSchedule = await loadScheduleWithDoses(insertResult.id);
          }
          await run("COMMIT");
          res.status(200).json({
            data: {
              savedAt: new Date().toISOString(),
              schedule: createdSchedule,
            },
          });
        } catch (txError) {
          await run("ROLLBACK");
          throw txError;
        }
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    `${API_PREFIX}/dose-administrations/:doseId`,
    staffWrite,
    async (req, res, next) => {
      try {
        const doseId = Number(req.params.doseId);
        if (!Number.isInteger(doseId)) {
          res.status(400).json({ error: "Invalid dose id." });
          return;
        }
        const dose = await get(
          `SELECT * FROM dose_administrations WHERE id = ?`,
          [doseId],
        );
        if (!dose) {
          res.status(404).json({ error: "Dose not found." });
          return;
        }
        const givenAt = req.body?.givenAt;
        const vaccineLotId = req.body?.vaccineLotId;
        const site = req.body?.site;
        const route = req.body?.route;

        const sets = [];
        const params = [];
        if (givenAt !== undefined) {
          sets.push("given_at = ?");
          params.push(givenAt ? String(givenAt) : null);
        }
        if (vaccineLotId !== undefined) {
          sets.push("vaccine_lot_id = ?");
          params.push(vaccineLotId == null ? null : Number(vaccineLotId));
        }
        if (site !== undefined) {
          sets.push("site = ?");
          params.push(site == null ? null : String(site));
        }
        if (route !== undefined) {
          sets.push("route = ?");
          params.push(route == null ? null : String(route));
        }
        if (req.actor?.kind === "staff" && givenAt !== undefined && givenAt) {
          sets.push("given_by_user_id = ?");
          params.push(Number(req.actor.id));
        }
        if (!sets.length) {
          res.status(400).json({ error: "No updatable fields supplied." });
          return;
        }

        await run("BEGIN TRANSACTION");
        try {
          await run(
            `UPDATE dose_administrations SET ${sets.join(", ")} WHERE id = ?`,
            [...params, doseId],
          );

          // If the dose was just marked given AND has a lot, write a -1 movement
          // ledger entry against that lot (idempotent: only when transitioning).
          const wasGiven = Boolean(dose.given_at);
          const isGivenNow = givenAt !== undefined ? Boolean(givenAt) : wasGiven;
          const lotId =
            vaccineLotId !== undefined ? vaccineLotId : dose.vaccine_lot_id;
          if (!wasGiven && isGivenNow && lotId) {
            await run(
              `
              INSERT INTO vaccine_movements (lot_id, delta, reason, ref_dose_id, by_user_id)
              VALUES (?, -1, 'DOSE_ADMINISTERED', ?, ?)
            `,
              [Number(lotId), doseId, req.actor?.id ? Number(req.actor.id) : null],
            );
            await run(
              `UPDATE vaccine_lots SET qty_remaining = qty_remaining - 1 WHERE id = ?`,
              [Number(lotId)],
            );
          }

          await run("COMMIT");
        } catch (txError) {
          await run("ROLLBACK");
          throw txError;
        }

        const updated = await get(
          `SELECT * FROM dose_administrations WHERE id = ?`,
          [doseId],
        );
        res.status(200).json({ data: mapDoseRow(updated) });
      } catch (error) {
        next(error);
      }
    },
  );
}
