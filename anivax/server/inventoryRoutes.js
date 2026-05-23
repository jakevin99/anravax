/**
 * Vaccine inventory REST routes.
 *
 *   GET    /api/v1/vaccines                  (staff)
 *   GET    /api/v1/vaccine-lots              (staff)
 *   POST   /api/v1/vaccine-lots              (staff write) — receive new stock
 *   POST   /api/v1/vaccine-movements         (staff write) — manual adjustment
 *   GET    /api/v1/vaccine-lots/:lotId/movements (staff)
 *
 * The dose administration route in `dosesRoutes.js` writes its own
 * `DOSE_ADMINISTERED` movement when a dose is marked given, so this file
 * is mostly about RECEIVED stock and manual adjustments.
 */

import { all, get, run } from "./db.js";
import { requireAuth } from "./middleware/auth.js";

const staffRead = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_READ" });
const staffWrite = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_WRITE" });

const ALLOWED_REASONS = new Set([
  "RECEIVED",
  "DOSE_ADMINISTERED",
  "WASTED",
  "EXPIRED",
  "MANUAL_ADJUSTMENT",
]);

function mapVaccineRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
  };
}

function mapLotRow(row) {
  return {
    id: row.id,
    vaccineId: row.vaccine_id,
    vaccineCode: row.code,
    vaccineName: row.name,
    vaccineKind: row.kind,
    lotNo: row.lot_no,
    expiresOn: row.expires_on,
    qtyInitial: row.qty_initial,
    qtyRemaining: row.qty_remaining,
    receivedAt: row.received_at,
  };
}

export function mountInventoryRoutes(app, API_PREFIX) {
  app.get(`${API_PREFIX}/vaccines`, staffRead, async (_req, res, next) => {
    try {
      const rows = await all(
        `SELECT id, code, name, kind FROM vaccines ORDER BY kind ASC, name ASC`,
      );
      res.status(200).json({ data: { items: rows.map(mapVaccineRow) } });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/vaccine-lots`, staffRead, async (req, res, next) => {
    try {
      const kind = req.query.kind ? String(req.query.kind).toUpperCase() : null;
      const where = [];
      const params = [];
      if (kind) {
        where.push("v.kind = ?");
        params.push(kind);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = await all(
        `
        SELECT
          l.id,
          l.vaccine_id,
          l.lot_no,
          l.expires_on,
          l.qty_initial,
          l.qty_remaining,
          l.received_at,
          v.code,
          v.name,
          v.kind
        FROM vaccine_lots l
        JOIN vaccines v ON v.id = l.vaccine_id
        ${whereSql}
        ORDER BY (l.qty_remaining > 0) DESC, l.expires_on ASC, l.id DESC
      `,
        params,
      );
      res.status(200).json({ data: { items: rows.map(mapLotRow) } });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${API_PREFIX}/vaccine-lots`, staffWrite, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const vaccineId = Number(body.vaccineId);
      const lotNo = body.lotNo != null ? String(body.lotNo).trim() : "";
      const expiresOn = body.expiresOn != null ? String(body.expiresOn).trim() : "";
      const qtyInitial = Number(body.qtyInitial);
      if (!Number.isInteger(vaccineId) || vaccineId <= 0) {
        res.status(400).json({ error: "Field 'vaccineId' is required." });
        return;
      }
      if (!lotNo) {
        res.status(400).json({ error: "Field 'lotNo' is required." });
        return;
      }
      if (!Number.isFinite(qtyInitial) || qtyInitial <= 0) {
        res.status(400).json({ error: "Field 'qtyInitial' must be a positive integer." });
        return;
      }
      if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
        res.status(400).json({ error: "Field 'expiresOn' must be YYYY-MM-DD." });
        return;
      }

      const vaccine = await get(`SELECT id FROM vaccines WHERE id = ?`, [vaccineId]);
      if (!vaccine) {
        res.status(400).json({ error: "Vaccine not found." });
        return;
      }

      await run("BEGIN TRANSACTION");
      let newId;
      try {
        const result = await run(
          `
          INSERT INTO vaccine_lots (
            vaccine_id, lot_no, expires_on, qty_initial, qty_remaining
          ) VALUES (?, ?, ?, ?, ?)
        `,
          [
            vaccineId,
            lotNo,
            expiresOn || null,
            Math.trunc(qtyInitial),
            Math.trunc(qtyInitial),
          ],
        );
        newId = result.id;
        await run(
          `
          INSERT INTO vaccine_movements (lot_id, delta, reason, by_user_id)
          VALUES (?, ?, 'RECEIVED', ?)
        `,
          [newId, Math.trunc(qtyInitial), req.actor?.id ? Number(req.actor.id) : null],
        );
        await run("COMMIT");
      } catch (txError) {
        await run("ROLLBACK");
        throw txError;
      }

      const created = await get(
        `
        SELECT l.id, l.vaccine_id, l.lot_no, l.expires_on, l.qty_initial,
               l.qty_remaining, l.received_at, v.code, v.name, v.kind
        FROM vaccine_lots l
        JOIN vaccines v ON v.id = l.vaccine_id
        WHERE l.id = ?
      `,
        [newId],
      );
      res.status(201).json({ data: mapLotRow(created) });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    `${API_PREFIX}/vaccine-movements`,
    staffWrite,
    async (req, res, next) => {
      try {
        const body = req.body ?? {};
        const lotId = Number(body.lotId);
        const delta = Number(body.delta);
        const reason = String(body.reason ?? "MANUAL_ADJUSTMENT").toUpperCase();
        if (!Number.isInteger(lotId)) {
          res.status(400).json({ error: "Field 'lotId' is required." });
          return;
        }
        if (!Number.isInteger(delta) || delta === 0) {
          res.status(400).json({ error: "Field 'delta' must be a non-zero integer." });
          return;
        }
        if (!ALLOWED_REASONS.has(reason)) {
          res.status(400).json({
            error: `Invalid reason. Allowed: ${[...ALLOWED_REASONS].join(", ")}`,
          });
          return;
        }
        const lot = await get(
          `SELECT id, qty_remaining FROM vaccine_lots WHERE id = ?`,
          [lotId],
        );
        if (!lot) {
          res.status(404).json({ error: "Lot not found." });
          return;
        }
        if (lot.qty_remaining + delta < 0) {
          res.status(409).json({
            error: "Adjustment would push remaining quantity below zero.",
          });
          return;
        }
        await run("BEGIN TRANSACTION");
        try {
          await run(
            `
            INSERT INTO vaccine_movements (lot_id, delta, reason, by_user_id)
            VALUES (?, ?, ?, ?)
          `,
            [lotId, delta, reason, req.actor?.id ? Number(req.actor.id) : null],
          );
          await run(
            `UPDATE vaccine_lots SET qty_remaining = qty_remaining + ? WHERE id = ?`,
            [delta, lotId],
          );
          await run("COMMIT");
        } catch (txError) {
          await run("ROLLBACK");
          throw txError;
        }
        const updated = await get(
          `
          SELECT l.id, l.vaccine_id, l.lot_no, l.expires_on, l.qty_initial,
                 l.qty_remaining, l.received_at, v.code, v.name, v.kind
          FROM vaccine_lots l
          JOIN vaccines v ON v.id = l.vaccine_id
          WHERE l.id = ?
        `,
          [lotId],
        );
        res.status(201).json({ data: mapLotRow(updated) });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    `${API_PREFIX}/vaccine-lots/:lotId/movements`,
    staffRead,
    async (req, res, next) => {
      try {
        const lotId = Number(req.params.lotId);
        if (!Number.isInteger(lotId)) {
          res.status(400).json({ error: "Invalid lot id." });
          return;
        }
        const rows = await all(
          `
          SELECT id, delta, reason, ref_dose_id, by_user_id, at
          FROM vaccine_movements
          WHERE lot_id = ?
          ORDER BY id DESC
        `,
          [lotId],
        );
        res.status(200).json({ data: { items: rows } });
      } catch (error) {
        next(error);
      }
    },
  );
}
