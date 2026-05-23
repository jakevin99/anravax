/**
 * REST handlers for clinical appointments (queue + schedules + retrieve anchor).
 * JSON uses camelCase in `data` to align with `app/types/domain.ts`.
 */

import { all, get, run } from "./db.js";
import { buildCreateRecordFromRow } from "./patientsRoutes.js";
import { requireAuth } from "./middleware/auth.js";
import { dayIsoFromScheduledAt, issueTicket, renumberTicketsByScheduledTime } from "./services/queue.js";
import {
  defaultDoctorsOrderPayload,
  normalizeDoctorsOrderPayload,
  parseDoctorsOrderJson,
} from "./services/doctorsOrder.js";
import {
  normalizeVaccinationPayload,
  parseVaccinationPayloadJson,
  vaccinationRecordColumns,
} from "./services/vaccinationRecord.js";
import { resolveUserDbId } from "./services/entityIds.js";

const staffRead = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_READ" });
const staffWrite = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_WRITE" });

/** Patient appointments only — capacity slots live under /schedule-slots. */
const CLINICAL_APPOINTMENT_WHERE =
  "NOT (a.tab = 'FOLLOW-UP' AND a.patient_id IS NULL)";

async function issueQueueTicketIfNeeded(appointmentId, tab) {
  if (tab !== "QUEUE") return;
  try {
    await issueTicket(appointmentId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[anivax] failed to auto-issue queue ticket for ${appointmentId}: ${error?.message ?? error}`,
    );
  }
}

function parseBloodPressure(bp) {
  if (!bp || typeof bp !== "string") return [null, null];
  const m = bp.match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
  if (!m) return [null, null];
  return [Number(m[1]), Number(m[2])];
}

function mapVitalsRowToDto(row) {
  if (!row) return undefined;
  const hasBp = row.bp_sys != null && row.bp_dia != null;
  const hasAny =
    row.pulse_rate != null ||
    row.spo2 != null ||
    hasBp ||
    row.temp_c != null ||
    row.weight_kg != null ||
    row.height_cm != null;
  if (!hasAny) return undefined;
  return {
    pulseRate: row.pulse_rate ?? undefined,
    spo2: row.spo2 ?? undefined,
    bloodPressure: hasBp ? `${row.bp_sys}/${row.bp_dia}` : undefined,
    temperatureC: row.temp_c ?? undefined,
    weightKg: row.weight_kg ?? undefined,
    heightCm: row.height_cm ?? undefined,
    recordedAt: row.recorded_at ?? undefined,
  };
}

/** Latest vitals for an appointment: appointments.vitals_json, else vitals table. */
async function resolveAppointmentVitals(appointmentId, vitalsJson) {
  if (vitalsJson) {
    try {
      const parsed = JSON.parse(vitalsJson);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* fall through */
    }
  }
  const row = await get(
    `
    SELECT pulse_rate, spo2, bp_sys, bp_dia, temp_c, weight_kg, height_cm, recorded_at
    FROM vitals
    WHERE appointment_id = ?
    ORDER BY datetime(recorded_at) DESC, id DESC
    LIMIT 1
  `,
    [String(appointmentId)],
  );
  return mapVitalsRowToDto(row);
}

async function insertVitalsRow(appointmentId, vitals, actor) {
  const [sys, dia] = parseBloodPressure(vitals.bloodPressure);
  await run(
    `
    INSERT INTO vitals (
      appointment_id, pulse_rate, spo2, bp_sys, bp_dia, temp_c, weight_kg, height_cm,
      recorded_at, recorded_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
  `,
    [
      String(appointmentId),
      vitals.pulseRate ?? null,
      vitals.spo2 ?? null,
      sys,
      dia,
      vitals.temperatureC ?? null,
      vitals.weightKg ?? null,
      vitals.heightCm ?? null,
      vitals.recordedAt ?? null,
      actor?.kind === "staff" ? Number(actor.id) : null,
    ],
  );
}

/**
 * @param {import("express").Express} app
 * @param {string} API_PREFIX e.g. "/api/v1"
 */
export function mountAppointmentRoutes(app, API_PREFIX) {
  const base = `${API_PREFIX}/appointments`;

  app.get(`${base}/tab-counts`, staffRead, async (req, res, next) => {
    try {
      const date = req.query.date ? String(req.query.date).trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "Query 'date' (YYYY-MM-DD) is required." });
        return;
      }
      const queueRow = await get(
        `
        SELECT COUNT(*) AS n
        FROM appointments
        WHERE tab = 'QUEUE' AND scheduled_at LIKE ? || '%'
      `,
        [date],
      );
      const fuRow = await get(
        `
        SELECT COUNT(*) AS n
        FROM appointments
        WHERE tab = 'FOLLOW-UP' AND patient_id IS NOT NULL AND scheduled_at LIKE ? || '%'
      `,
        [date],
      );
      const reqRow = await get(
        `
        SELECT COUNT(*) AS n
        FROM appointments
        WHERE tab = 'REQUESTS' AND scheduled_at LIKE ? || '%'
      `,
        [date],
      );
      res.status(200).json({
        data: {
          QUEUE: queueRow?.n ?? 0,
          "FOLLOW-UP": fuRow?.n ?? 0,
          REQUESTS: reqRow?.n ?? 0,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /** Month is 1–12. Returns appointment counts per calendar day (YYYY-MM-DD) in that month. */
  app.get(`${base}/calendar`, staffRead, async (req, res, next) => {
    try {
      const year = Math.trunc(Number(req.query.year));
      const month = Math.trunc(Number(req.query.month));
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        res.status(400).json({ error: "Query 'year' (2000–2100) is required." });
        return;
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        res.status(400).json({ error: "Query 'month' (1–12) is required." });
        return;
      }
      const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
      const first = `${year}-${pad(month)}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const last = `${year}-${pad(month)}-${pad(lastDay)}`;

      const rows = await all(
        `
        SELECT substr(scheduled_at, 1, 10) AS d, COUNT(*) AS n
        FROM appointments a
        WHERE substr(a.scheduled_at, 1, 10) >= ? AND substr(a.scheduled_at, 1, 10) <= ?
          AND ${CLINICAL_APPOINTMENT_WHERE}
        GROUP BY substr(scheduled_at, 1, 10)
      `,
        [first, last],
      );
      const byDay = Object.fromEntries(rows.map((r) => [r.d, r.n]));
      const days = [];
      for (let day = 1; day <= lastDay; day++) {
        const iso = `${year}-${pad(month)}-${pad(day)}`;
        days.push({ date: iso, count: byDay[iso] ?? 0 });
      }
      res.status(200).json({ data: { days } });
    } catch (error) {
      next(error);
    }
  });

  app.get(base, staffRead, async (req, res, next) => {
    try {
      const tab = req.query.tab ? String(req.query.tab).trim() : "";
      const date = req.query.date ? String(req.query.date).trim() : "";
      const lastName = req.query.last_name ? String(req.query.last_name).trim() : "";
      const firstName = req.query.first_name ? String(req.query.first_name).trim() : "";
      const middleName = req.query.middle_name ? String(req.query.middle_name).trim() : "";
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 8));
      const offset = (page - 1) * pageSize;

      const where = [];
      const params = [];

      if (tab) {
        where.push("a.tab = ?");
        params.push(tab);
      }
      where.push(CLINICAL_APPOINTMENT_WHERE);
      if (tab === "FOLLOW-UP") {
        where.push("a.patient_id IS NOT NULL");
      }
      if (date) {
        if (tab === "QUEUE") {
          where.push("a.scheduled_at LIKE ? || '%'");
          params.push(date);
        } else if (tab && tab !== "QUEUE") {
          where.push("a.scheduled_at LIKE ? || '%'");
          params.push(date);
        } else if (!tab) {
          where.push("a.scheduled_at LIKE ? || '%'");
          params.push(date);
        }
      }
      if (lastName) {
        where.push("lower(p.last_name) LIKE ?");
        params.push(`%${lastName.toLowerCase()}%`);
      }
      if (firstName) {
        where.push("lower(p.first_name) LIKE ?");
        params.push(`%${firstName.toLowerCase()}%`);
      }
      if (middleName) {
        where.push("lower(COALESCE(p.middle_name, '')) LIKE ?");
        params.push(`%${middleName.toLowerCase()}%`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const countRow = await get(
        `
        SELECT COUNT(*) AS n
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        ${whereSql}
      `,
        params,
      );
      const totalItems = countRow?.n ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const rows = await all(
        `
        SELECT
          a.id AS a_id,
          a.patient_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.tab,
          a.slot_used,
          a.slot_total,
          a.vitals_json,
          p.id AS p_id,
          p.first_name AS p_first_name,
          p.middle_name AS p_middle_name,
          p.last_name AS p_last_name,
          p.suffix AS p_suffix,
          p.birth_date AS p_birth_date,
          p.sex AS p_sex,
          p.age_years AS p_age_years,
          p.address AS p_address,
          p.contact_number AS p_contact_number,
          p.blood_type AS p_blood_type,
          p.registration_no AS p_registration_no,
          p.registered_at AS p_registered_at,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name,
          d.payload_json AS do_payload_json
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = a.attendant_user_id
        LEFT JOIN doctors_orders d ON d.appointment_id = a.id
        ${whereSql}
        ORDER BY datetime(a.scheduled_at) ASC
        LIMIT ? OFFSET ?
      `,
        [...params, pageSize, offset],
      );

      const items = rows.map((r) => mapJoinedRow(r));
      res.status(200).json({
        data: {
          items,
          page,
          pageSize,
          totalItems,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/:appointmentId/history`, staffRead, async (req, res, next) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      const row = await get(
        `
        SELECT
          a.id AS a_id,
          a.scheduled_at,
          a.category,
          a.vitals_json,
          a.patient_id,
          p.first_name AS p_first_name,
          p.middle_name AS p_middle_name,
          p.last_name AS p_last_name,
          p.suffix AS p_suffix,
          p.birth_date AS p_birth_date,
          p.sex AS p_sex,
          p.age_years AS p_age_years,
          p.address AS p_address,
          p.contact_number AS p_contact_number,
          p.blood_type AS p_blood_type,
          p.registration_no AS p_registration_no,
          p.registered_at AS p_registered_at,
          p.profile_json AS p_profile_json,
          p.id AS p_id
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        WHERE a.id = ?
      `,
        [appointmentId],
      );
      if (!row) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }

      const exposure = await get(`SELECT * FROM exposure_records WHERE appointment_id = ?`, [
        appointmentId,
      ]);
      const doctorsOrderRow = await get(
        `SELECT payload_json FROM doctors_orders WHERE appointment_id = ?`,
        [appointmentId],
      );

      const patient = {
        id: row.p_id,
        firstName: row.p_first_name,
        middleName: row.p_middle_name || undefined,
        lastName: row.p_last_name,
        suffix: row.p_suffix,
        birthDate: row.p_birth_date,
        sex: row.p_sex,
        ageYears: row.p_age_years,
        address: row.p_address,
        contactNumber: row.p_contact_number,
        bloodType: row.p_blood_type,
        registrationNo: row.p_registration_no,
        registeredAt: row.p_registered_at,
      };

      const exposureOut = exposure
        ? {
            chiefComplaint: exposure.chief_complaint,
            dateOfIncidence: exposure.date_of_incidence,
            timeOfIncidence: exposure.time_of_incidence,
            placeOfIncidence: exposure.place_of_incidence,
            siteOfInjury: exposure.site_of_injury,
            animalType: exposure.animal_type,
            washedInjury: Boolean(exposure.washed_injury),
            animalVaccinated: Boolean(exposure.animal_vaccinated),
            biteType: exposure.bite_type || undefined,
            strayOwned: exposure.stray_owned || undefined,
            uploadedFileUrl: exposure.uploaded_file_url || undefined,
          }
        : {
            chiefComplaint: "—",
            dateOfIncidence: "—",
            timeOfIncidence: "—",
            placeOfIncidence: "—",
            siteOfInjury: "—",
            animalType: "—",
            washedInjury: false,
            animalVaccinated: false,
          };

      let doctorsOrder = parseDoctorsOrderJson(doctorsOrderRow?.payload_json);
      if (!doctorsOrder) {
        doctorsOrder = defaultDoctorsOrderPayload();
        await run(
          `
          INSERT INTO doctors_orders (appointment_id, payload_json)
          VALUES (?, ?)
          ON CONFLICT(appointment_id) DO NOTHING
        `,
          [appointmentId, JSON.stringify(doctorsOrder)],
        );
      }
      const doctorBiteCategory = parseBiteCategoryFromPayload(doctorsOrder);

      const vitals = await resolveAppointmentVitals(appointmentId, row.vitals_json);

      const createRecord = buildCreateRecordFromRow({
        id: row.p_id,
        first_name: row.p_first_name,
        middle_name: row.p_middle_name,
        last_name: row.p_last_name,
        suffix: row.p_suffix,
        birth_date: row.p_birth_date,
        sex: row.p_sex,
        age_years: row.p_age_years,
        address: row.p_address,
        contact_number: row.p_contact_number,
        blood_type: row.p_blood_type,
        registration_no: row.p_registration_no,
        registered_at: row.p_registered_at,
        profile_json: row.p_profile_json,
      });

      res.status(200).json({
        data: {
          appointmentId: row.a_id,
          patient,
          createRecord,
          date: String(row.scheduled_at).slice(0, 10),
          scheduledAt: String(row.scheduled_at),
          category: doctorBiteCategory ?? row.category,
          exposure: exposureOut,
          vitals,
          doctorsOrder,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  async function readVaccinationRecord(appointmentId) {
    const row = await get(
      `SELECT payload_json, animal_status_after_14d, treatment_status, observation_date, updated_at
       FROM vaccination_records WHERE appointment_id = ?`,
      [appointmentId],
    );
    const payload = parseVaccinationPayloadJson(row?.payload_json);
    return {
      payload: payload ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  }

  async function writeVaccinationRecord(appointmentId, bodyPayload) {
    const appointment = await get(`SELECT id FROM appointments WHERE id = ?`, [appointmentId]);
    if (!appointment) {
      return { status: 404, body: { error: "Appointment not found." } };
    }
    if (bodyPayload !== undefined && (typeof bodyPayload !== "object" || bodyPayload === null)) {
      return { status: 400, body: { error: "Field 'payload' must be an object." } };
    }
    const normalized = normalizeVaccinationPayload(bodyPayload ?? {});
    const cols = vaccinationRecordColumns(normalized);
    await run(
      `
      INSERT INTO vaccination_records (
        appointment_id, animal_status_after_14d, treatment_status, observation_date, payload_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(appointment_id) DO UPDATE SET
        animal_status_after_14d = excluded.animal_status_after_14d,
        treatment_status = excluded.treatment_status,
        observation_date = excluded.observation_date,
        payload_json = excluded.payload_json,
        updated_at = datetime('now')
    `,
      [
        appointmentId,
        cols.animal_status_after_14d,
        cols.treatment_status,
        cols.observation_date,
        JSON.stringify(normalized),
      ],
    );
    return {
      status: 200,
      body: {
        data: {
          savedAt: new Date().toISOString(),
          payload: normalized,
        },
      },
    };
  }

  app.get(`${base}/:appointmentId/vaccination-record`, staffRead, async (req, res, next) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      const data = await readVaccinationRecord(appointmentId);
      res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/:appointmentId/vaccination-record`, staffWrite, async (req, res, next) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      const result = await writeVaccinationRecord(appointmentId, req.body?.payload);
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  app.put(`${base}/:appointmentId/vaccination-record`, staffWrite, async (req, res, next) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      const result = await writeVaccinationRecord(appointmentId, req.body?.payload);
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/:appointmentId`, staffRead, async (req, res, next) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      const row = await get(
        `
        SELECT
          a.id AS a_id,
          a.patient_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.tab,
          a.slot_used,
          a.slot_total,
          a.vitals_json,
          p.id AS p_id,
          p.first_name AS p_first_name,
          p.middle_name AS p_middle_name,
          p.last_name AS p_last_name,
          p.suffix AS p_suffix,
          p.birth_date AS p_birth_date,
          p.sex AS p_sex,
          p.age_years AS p_age_years,
          p.address AS p_address,
          p.contact_number AS p_contact_number,
          p.blood_type AS p_blood_type,
          p.registration_no AS p_registration_no,
          p.registered_at AS p_registered_at,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = a.attendant_user_id
        WHERE a.id = ?
      `,
        [appointmentId],
      );
      if (!row) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      res.status(200).json({ data: mapJoinedRow(row) });
    } catch (error) {
      next(error);
    }
  });

  app.post(base, staffWrite, async (req, res, next) => {
    try {
      const {
        id,
        patientId,
        attendantUserId,
        scheduledAt,
        category,
        status,
        tab,
        slotUsed,
        slotTotal,
        vitals,
        exposure,
      } = req.body ?? {};
      const tabStr = String(tab ?? "").trim();
      if (!attendantUserId || !scheduledAt || category == null || !status || !tabStr) {
        res.status(400).json({
          error:
            "Fields 'attendantUserId', 'scheduledAt', 'category', 'status', and 'tab' are required.",
        });
        return;
      }
      let resolvedPatientId =
        patientId != null && String(patientId).trim() ? String(patientId).trim() : null;
      if (tabStr === "FOLLOW-UP" && !resolvedPatientId) {
        res.status(400).json({
          error:
            "FOLLOW-UP patient visits require patientId. Use POST /api/v1/schedule-slots for capacity schedules.",
        });
        return;
      }
      if (!resolvedPatientId) {
        res.status(400).json({ error: "Field 'patientId' is required for this tab." });
        return;
      }
      const patientRow = await get(`SELECT id FROM patients WHERE id = ?`, [resolvedPatientId]);
      if (!patientRow) {
        res.status(400).json({ error: "Invalid patientId." });
        return;
      }
      const resolvedAttendantId = await resolveUserDbId(get, attendantUserId);
      if (!resolvedAttendantId) {
        res.status(400).json({ error: "Invalid attendantUserId." });
        return;
      }
      const appointmentId =
        id && String(id).trim()
          ? String(id).trim()
          : `a_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
      const vitalsJson = vitals != null ? JSON.stringify(vitals) : null;
      await run(
        `
        INSERT INTO appointments (
          id, patient_id, attendant_user_id, scheduled_at, category, status, tab, slot_used, slot_total, vitals_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          appointmentId,
          resolvedPatientId,
          resolvedAttendantId,
          String(scheduledAt),
          Number(category),
          String(status),
          String(tab),
          slotUsed != null ? Number(slotUsed) : null,
          slotTotal != null ? Number(slotTotal) : null,
          vitalsJson,
        ],
      );
      await issueQueueTicketIfNeeded(appointmentId, String(tab));
      if (vitals != null && typeof vitals === "object") {
        await insertVitalsRow(appointmentId, vitals, req.actor);
      }
      if (exposure != null && typeof exposure === "object") {
        await run(
          `
          INSERT INTO exposure_records (
            appointment_id, chief_complaint, date_of_incidence, time_of_incidence,
            place_of_incidence, site_of_injury, animal_type, washed_injury, animal_vaccinated,
            uploaded_file_url, bite_type, stray_owned
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            appointmentId,
            exposure.chiefComplaint != null ? String(exposure.chiefComplaint) : null,
            exposure.dateOfIncidence != null ? String(exposure.dateOfIncidence) : null,
            exposure.timeOfIncidence != null ? String(exposure.timeOfIncidence) : null,
            exposure.placeOfIncidence != null ? String(exposure.placeOfIncidence) : null,
            exposure.siteOfInjury != null ? String(exposure.siteOfInjury) : null,
            exposure.animalType != null ? String(exposure.animalType) : null,
            exposure.washedInjury ? 1 : 0,
            exposure.animalVaccinated ? 1 : 0,
            exposure.uploadedFileUrl ?? null,
            exposure.biteType != null ? String(exposure.biteType) : null,
            exposure.strayOwned != null ? String(exposure.strayOwned) : null,
          ],
        );
      }
      const created = await get(
        `
        SELECT
          a.id AS a_id,
          a.patient_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.tab,
          a.slot_used,
          a.slot_total,
          a.vitals_json,
          p.id AS p_id,
          p.first_name AS p_first_name,
          p.middle_name AS p_middle_name,
          p.last_name AS p_last_name,
          p.suffix AS p_suffix,
          p.birth_date AS p_birth_date,
          p.sex AS p_sex,
          p.age_years AS p_age_years,
          p.address AS p_address,
          p.contact_number AS p_contact_number,
          p.blood_type AS p_blood_type,
          p.registration_no AS p_registration_no,
          p.registered_at AS p_registered_at,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = a.attendant_user_id
        WHERE a.id = ?
      `,
        [appointmentId],
      );
      res.status(201).json({ data: mapJoinedRow(created) });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${base}/:appointmentId`, staffWrite, async (req, res, next) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      const existing = await get(
        `SELECT id, tab, scheduled_at, patient_id FROM appointments WHERE id = ?`,
        [appointmentId],
      );
      if (!existing) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      const body = req.body ?? {};
      const nextTab = body.tab != null ? String(body.tab) : existing.tab;
      const nextScheduledAt =
        body.scheduledAt != null ? String(body.scheduledAt) : existing.scheduled_at;
      const existingPatientId = existing.patient_id ?? null;
      if (!existingPatientId && (nextTab === "FOLLOW-UP" || existing.tab === "FOLLOW-UP")) {
        res.status(400).json({
          error: "Capacity schedule slots must be updated via PATCH /api/v1/schedule-slots/:scheduleSlotId.",
        });
        return;
      }
      const sets = [];
      const params = [];
      if (body.scheduledAt != null) {
        sets.push("scheduled_at = ?");
        params.push(String(body.scheduledAt));
      }
      if (body.category != null) {
        sets.push("category = ?");
        params.push(Number(body.category));
      }
      if (body.status != null) {
        sets.push("status = ?");
        params.push(String(body.status));
      }
      if (body.tab != null) {
        sets.push("tab = ?");
        params.push(String(body.tab));
      }
      if (body.attendantUserId != null) {
        const attendantId = await resolveUserDbId(get, body.attendantUserId);
        if (!attendantId) {
          res.status(400).json({ error: "Invalid attendantUserId." });
          return;
        }
        sets.push("attendant_user_id = ?");
        params.push(attendantId);
      }
      if (body.slotUsed != null) {
        sets.push("slot_used = ?");
        params.push(Number(body.slotUsed));
      }
      if (body.slotTotal != null) {
        sets.push("slot_total = ?");
        params.push(Number(body.slotTotal));
      }
      if (body.patientId != null) {
        sets.push("patient_id = ?");
        params.push(String(body.patientId));
      }
      if (body.vitals != null) {
        sets.push("vitals_json = ?");
        params.push(JSON.stringify(body.vitals));
      }
      if (!sets.length) {
        res.status(400).json({ error: "No updatable fields supplied." });
        return;
      }
      sets.push("updated_at = datetime('now')");
      params.push(appointmentId);
      await run(`UPDATE appointments SET ${sets.join(", ")} WHERE id = ?`, params);
      if (body.tab != null) {
        await issueQueueTicketIfNeeded(appointmentId, String(body.tab));
      }
      if (
        body.scheduledAt != null &&
        (nextTab === "QUEUE" || existing.tab === "QUEUE")
      ) {
        try {
          await renumberTicketsByScheduledTime(dayIsoFromScheduledAt(nextScheduledAt));
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(
            `[anivax] failed to renumber queue tickets after schedule change: ${error?.message ?? error}`,
          );
        }
      }
      if (body.vitals != null && typeof body.vitals === "object") {
        await insertVitalsRow(appointmentId, body.vitals, req.actor);
      }
      const row = await get(
        `
        SELECT
          a.id AS a_id,
          a.patient_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.tab,
          a.slot_used,
          a.slot_total,
          a.vitals_json,
          p.id AS p_id,
          p.first_name AS p_first_name,
          p.middle_name AS p_middle_name,
          p.last_name AS p_last_name,
          p.suffix AS p_suffix,
          p.birth_date AS p_birth_date,
          p.sex AS p_sex,
          p.age_years AS p_age_years,
          p.address AS p_address,
          p.contact_number AS p_contact_number,
          p.blood_type AS p_blood_type,
          p.registration_no AS p_registration_no,
          p.registered_at AS p_registered_at,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        JOIN users u ON u.id = a.attendant_user_id
        WHERE a.id = ?
      `,
        [appointmentId],
      );
      res.status(200).json({ data: mapJoinedRow(row) });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/:appointmentId`, staffWrite, async (req, res, next) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      const result = await run(`DELETE FROM appointments WHERE id = ?`, [appointmentId]);
      if (!result.changes) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
}

function parseBiteCategoryFromPayload(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  const n = Number(payload.biteCategory);
  if (n >= 1 && n <= 4) return n;
  return undefined;
}

function biteCategoryFromPayloadJson(json) {
  if (!json) return undefined;
  try {
    return parseBiteCategoryFromPayload(JSON.parse(json));
  } catch {
    return undefined;
  }
}

function mapJoinedRow(r) {
  const attendantId = r.attendant_user_id;
  const biteCategory = biteCategoryFromPayloadJson(r.do_payload_json);
  const patient =
    r.p_id != null
      ? {
          id: r.p_id,
          firstName: r.p_first_name,
          middleName: r.p_middle_name || undefined,
          lastName: r.p_last_name,
          suffix: r.p_suffix,
          birthDate: r.p_birth_date,
          sex: r.p_sex,
          ageYears: r.p_age_years,
          address: r.p_address,
          contactNumber: r.p_contact_number,
          bloodType: r.p_blood_type,
          registrationNo: r.p_registration_no,
          registeredAt: r.p_registered_at,
        }
      : null;
  return {
    id: r.a_id,
    scheduledAt: r.scheduled_at,
    patient,
    attendant: {
      id: `user-${attendantId}`,
      firstName: r.u_first_name,
      lastName: r.u_last_name,
      credential: "RN",
    },
    category: r.category,
    biteCategory,
    status: r.status,
    tab: r.tab,
    slotUsed: r.slot_used ?? undefined,
    slotTotal: r.slot_total ?? undefined,
    vitals: r.vitals_json ? JSON.parse(r.vitals_json) : undefined,
  };
}
