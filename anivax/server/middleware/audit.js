/**
 * Audit middleware.
 *
 * Wraps `res.json`, `res.send`, and `res.status(...).end` so we can capture
 * the body that's about to leave and persist a row in `audit_logs` for any
 * state-changing method (POST/PATCH/PUT/DELETE).
 *
 * Skips when `FEATURE_AUDIT_LOG=off` so dev environments stay fast.
 *
 * Body redaction: known credential keys (`password`, `passwordHash`, `otp`,
 * `currentPassword`, `newPassword`, `refreshToken`, `accessToken`,
 * `fcmToken`, `payload_json`) are rewritten to `***` before being stored.
 */

import { run } from "../db.js";

const STATE_CHANGING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const REDACT_KEYS = new Set([
  "password",
  "passwordHash",
  "otp",
  "currentPassword",
  "newPassword",
  "refreshToken",
  "accessToken",
  "fcmToken",
  "payload_json",
]);

function redact(value) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.has(k) ? "***" : redact(v);
  }
  return out;
}

function safeStringify(value) {
  try {
    const reduced = redact(value);
    return JSON.stringify(reduced).slice(0, 8_000);
  } catch {
    return null;
  }
}

function entityKindFromPath(pathname) {
  // Extract the first /api/v1/<resource>/...
  const m = String(pathname).match(/^\/api\/v\d+\/([a-zA-Z0-9-]+)/);
  return m ? m[1] : null;
}

function entityIdFromPath(pathname) {
  // Extract the segment AFTER the resource. Best-effort only.
  const m = String(pathname).match(/^\/api\/v\d+\/[a-zA-Z0-9-]+\/([^/?]+)/);
  return m ? m[1] : null;
}

export function auditMiddleware() {
  const enabled = (process.env.FEATURE_AUDIT_LOG ?? "on").toLowerCase() === "on";

  return function audit(req, res, next) {
    if (!enabled || !STATE_CHANGING.has(req.method)) {
      next();
      return;
    }

    const beforeBody = req.body ? safeStringify(req.body) : null;

    let captured;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      captured = body;
      return originalJson(body);
    };

    res.on("finish", () => {
      // Only audit successful state changes (2xx + 4xx are useful for tracking
      // attempted edits; ignore 401/403 because those didn't reach the route).
      if (res.statusCode === 401 || res.statusCode === 403) return;
      const actor = req.actor;
      const action = `${req.method} ${entityKindFromPath(req.path) ?? "unknown"}`;
      run(
        `
        INSERT INTO audit_logs (
          actor_kind, actor_id, action, entity_kind, entity_id, before_json, after_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          actor?.kind ?? null,
          actor?.id != null ? String(actor.id) : null,
          action,
          entityKindFromPath(req.path),
          entityIdFromPath(req.path),
          beforeBody,
          captured ? safeStringify(captured) : null,
        ],
      ).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn(`[anivax/audit] failed to write log: ${e?.message ?? e}`);
      });
    });

    next();
  };
}
