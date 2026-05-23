/**
 * Notification + device-token REST routes.
 *
 *   POST   /api/v1/notifications/devices            (patient) body: { fcmToken, platform }
 *   DELETE /api/v1/notifications/devices/:token     (patient)
 *   GET    /api/v1/notifications                    (patient) — last 50
 *   GET    /api/v1/notifications/admin              (staff)   — debug feed
 *
 * The actual delivery happens in `services/notifications.js` (FCM + SMS
 * fallback) and is triggered by the in-process cron in `server/index.js`.
 */

import { all, get, run } from "./db.js";
import { requireAuth } from "./middleware/auth.js";

const patientOnly = requireAuth({ actorKinds: ["patient"] });
const staffRead = requireAuth({ actorKinds: ["staff"], authority: "USERS_READ" });

export function mountNotificationsRoutes(app, API_PREFIX) {
  app.post(
    `${API_PREFIX}/notifications/devices`,
    patientOnly,
    async (req, res, next) => {
      try {
        const fcmToken = String(req.body?.fcmToken ?? "").trim();
        const platform = String(req.body?.platform ?? "android").trim();
        if (!fcmToken) {
          res.status(400).json({ error: "Field 'fcmToken' is required." });
          return;
        }
        await run(
          `
          INSERT INTO device_tokens (patient_id, fcm_token, platform, last_seen_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(fcm_token) DO UPDATE SET
            patient_id = excluded.patient_id,
            platform = excluded.platform,
            last_seen_at = datetime('now')
        `,
          [String(req.actor.id), fcmToken, platform],
        );
        const row = await get(
          `SELECT id, platform, last_seen_at FROM device_tokens WHERE fcm_token = ?`,
          [fcmToken],
        );
        res.status(201).json({ data: row });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    `${API_PREFIX}/notifications/devices/:token`,
    patientOnly,
    async (req, res, next) => {
      try {
        const token = String(req.params.token);
        await run(
          `DELETE FROM device_tokens WHERE fcm_token = ? AND patient_id = ?`,
          [token, String(req.actor.id)],
        );
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(`${API_PREFIX}/notifications`, patientOnly, async (req, res, next) => {
    try {
      const rows = await all(
        `
        SELECT id, kind, payload_json, sent_at, delivered_at, error, created_at
        FROM notifications
        WHERE patient_id = ?
        ORDER BY id DESC
        LIMIT 50
      `,
        [String(req.actor.id)],
      );
      res.status(200).json({
        data: {
          items: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            payload: r.payload_json ? JSON.parse(r.payload_json) : null,
            sentAt: r.sent_at,
            deliveredAt: r.delivered_at,
            error: r.error,
            createdAt: r.created_at,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    `${API_PREFIX}/notifications/admin`,
    staffRead,
    async (_req, res, next) => {
      try {
        const rows = await all(
          `
          SELECT id, patient_id, kind, payload_json, sent_at, delivered_at, error, created_at
          FROM notifications
          ORDER BY id DESC
          LIMIT 200
        `,
        );
        res.status(200).json({ data: { items: rows } });
      } catch (error) {
        next(error);
      }
    },
  );
}
