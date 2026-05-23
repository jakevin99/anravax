/**
 * REST: vaccination capacity schedule slots (no patient).
 * Persisted as appointments rows with tab FOLLOW-UP and patient_id NULL.
 */

import { all, get, run } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { resolveUserDbId } from "./services/entityIds.js";
import {
  findFollowUpScheduleConflict,
  mapScheduleSlotRow,
} from "./services/scheduleSlotShared.js";

const staffRead = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_READ" });
const staffWrite = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_WRITE" });

const CAPACITY_WHERE = "a.tab = 'FOLLOW-UP' AND a.patient_id IS NULL";

/**
 * @param {import("express").Express} app
 * @param {string} API_PREFIX
 */
export function mountScheduleSlotsRoutes(app, API_PREFIX) {
  const base = `${API_PREFIX}/schedule-slots`;

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
        WHERE ${CAPACITY_WHERE}
          AND substr(a.scheduled_at, 1, 10) >= ? AND substr(a.scheduled_at, 1, 10) <= ?
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
      const date = req.query.date ? String(req.query.date).trim() : "";
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 8));
      const offset = (page - 1) * pageSize;

      const where = [CAPACITY_WHERE];
      const params = [];
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        where.push("a.scheduled_at LIKE ? || '%'");
        params.push(date);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;

      const countRow = await get(
        `SELECT COUNT(*) AS n FROM appointments a ${whereSql}`,
        params,
      );
      const totalItems = countRow?.n ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const rows = await all(
        `
        SELECT
          a.id AS a_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.slot_used,
          a.slot_total,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name
        FROM appointments a
        JOIN users u ON u.id = a.attendant_user_id
        ${whereSql}
        ORDER BY datetime(a.scheduled_at) ASC
        LIMIT ? OFFSET ?
      `,
        [...params, pageSize, offset],
      );

      res.status(200).json({
        data: {
          items: rows.map(mapScheduleSlotRow),
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

  app.get(`${base}/:scheduleSlotId`, staffRead, async (req, res, next) => {
    try {
      const scheduleSlotId = String(req.params.scheduleSlotId ?? "").trim();
      const row = await get(
        `
        SELECT
          a.id AS a_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.slot_used,
          a.slot_total,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name
        FROM appointments a
        JOIN users u ON u.id = a.attendant_user_id
        WHERE a.id = ? AND ${CAPACITY_WHERE}
      `,
        [scheduleSlotId],
      );
      if (!row) {
        res.status(404).json({ error: "Schedule slot not found." });
        return;
      }
      res.status(200).json({ data: mapScheduleSlotRow(row) });
    } catch (error) {
      next(error);
    }
  });

  app.post(base, staffWrite, async (req, res, next) => {
    try {
      const { attendantUserId, scheduledAt, category, status, slotUsed, slotTotal } = req.body ?? {};
      if (!attendantUserId || !scheduledAt || category == null || !status) {
        res.status(400).json({
          error: "Fields 'attendantUserId', 'scheduledAt', 'category', and 'status' are required.",
        });
        return;
      }
      const slotTotalNum = slotTotal != null ? Number(slotTotal) : null;
      if (!Number.isFinite(slotTotalNum) || slotTotalNum <= 0) {
        res.status(400).json({ error: "Field 'slotTotal' must be a positive number." });
        return;
      }
      const resolvedAttendantId = await resolveUserDbId(get, attendantUserId);
      if (!resolvedAttendantId) {
        res.status(400).json({ error: "Invalid attendantUserId." });
        return;
      }
      const conflict = await findFollowUpScheduleConflict(scheduledAt);
      if (conflict) {
        res.status(409).json({
          error: "A schedule already exists for this date and time.",
        });
        return;
      }
      const scheduleSlotId = `a_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
      await run(
        `
        INSERT INTO appointments (
          id, patient_id, attendant_user_id, scheduled_at, category, status, tab, slot_used, slot_total, vitals_json
        )
        VALUES (?, NULL, ?, ?, ?, ?, 'FOLLOW-UP', ?, ?, NULL)
      `,
        [
          scheduleSlotId,
          resolvedAttendantId,
          String(scheduledAt),
          Number(category),
          String(status),
          slotUsed != null ? Number(slotUsed) : 0,
          slotTotalNum,
        ],
      );
      const created = await get(
        `
        SELECT
          a.id AS a_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.slot_used,
          a.slot_total,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name
        FROM appointments a
        JOIN users u ON u.id = a.attendant_user_id
        WHERE a.id = ?
      `,
        [scheduleSlotId],
      );
      res.status(201).json({ data: mapScheduleSlotRow(created) });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${base}/:scheduleSlotId`, staffWrite, async (req, res, next) => {
    try {
      const scheduleSlotId = String(req.params.scheduleSlotId ?? "").trim();
      const existing = await get(
        `SELECT id FROM appointments WHERE id = ? AND ${CAPACITY_WHERE}`,
        [scheduleSlotId],
      );
      if (!existing) {
        res.status(404).json({ error: "Schedule slot not found." });
        return;
      }
      const body = req.body ?? {};
      const nextScheduledAt =
        body.scheduledAt != null ? String(body.scheduledAt) : null;
      if (nextScheduledAt) {
        const conflict = await findFollowUpScheduleConflict(nextScheduledAt, scheduleSlotId);
        if (conflict) {
          res.status(409).json({
            error: "A schedule already exists for this date and time.",
          });
          return;
        }
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
        const n = Number(body.slotTotal);
        if (!Number.isFinite(n) || n <= 0) {
          res.status(400).json({ error: "Field 'slotTotal' must be a positive number." });
          return;
        }
        sets.push("slot_total = ?");
        params.push(n);
      }
      if (!sets.length) {
        res.status(400).json({ error: "No updatable fields supplied." });
        return;
      }
      sets.push("updated_at = datetime('now')");
      params.push(scheduleSlotId);
      await run(`UPDATE appointments SET ${sets.join(", ")} WHERE id = ?`, params);

      const row = await get(
        `
        SELECT
          a.id AS a_id,
          a.attendant_user_id,
          a.scheduled_at,
          a.category,
          a.status,
          a.slot_used,
          a.slot_total,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name
        FROM appointments a
        JOIN users u ON u.id = a.attendant_user_id
        WHERE a.id = ?
      `,
        [scheduleSlotId],
      );
      res.status(200).json({ data: mapScheduleSlotRow(row) });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/:scheduleSlotId`, staffWrite, async (req, res, next) => {
    try {
      const scheduleSlotId = String(req.params.scheduleSlotId ?? "").trim();
      const existing = await get(
        `SELECT id FROM appointments WHERE id = ? AND ${CAPACITY_WHERE}`,
        [scheduleSlotId],
      );
      if (!existing) {
        res.status(404).json({ error: "Schedule slot not found." });
        return;
      }
      await run(`DELETE FROM appointments WHERE id = ?`, [scheduleSlotId]);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
}
