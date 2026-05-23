/**
 * Notification dispatcher.
 *
 * `send(patientId, kind, payload, idempotencyKey?)` records a row in
 * `notifications`, then attempts delivery via FCM HTTP v1. If FCM is not
 * configured (no service-account env vars) it falls back to SMS via the
 * existing `services/sms.js` provider so the patient still gets the message.
 *
 * Idempotency: rows with the same `idempotency_key` are inserted at most
 * once thanks to the partial UNIQUE INDEX in `db.js`. Workers can call
 * `send()` repeatedly without flooding the patient.
 */

import { all, get, run } from "../db.js";
import { sendSms } from "./sms.js";

const FCM_TIMEOUT_MS = 10_000;

function fcmConfig() {
  return {
    projectId: (process.env.FCM_PROJECT_ID ?? "").trim(),
    clientEmail: (process.env.FCM_CLIENT_EMAIL ?? "").trim(),
    privateKey: (process.env.FCM_PRIVATE_KEY ?? "").trim().replace(/\\n/g, "\n"),
  };
}

let cachedFcmAccessToken = null;
let cachedFcmExpiresAt = 0;

async function getFcmAccessToken() {
  const cfg = fcmConfig();
  if (!cfg.projectId || !cfg.clientEmail || !cfg.privateKey) {
    return null;
  }
  if (cachedFcmAccessToken && cachedFcmExpiresAt - 60_000 > Date.now()) {
    return cachedFcmAccessToken;
  }
  // JWT with the Google service account, exchanged for an access token.
  // Deliberately uses the built-in `crypto` module (no external dep).
  const cryptoMod = await import("node:crypto");
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: cfg.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${enc(header)}.${enc(claim)}`;
  const signer = cryptoMod.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(cfg.privateKey).toString("base64url");
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FCM token exchange failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  cachedFcmAccessToken = json.access_token;
  cachedFcmExpiresAt = Date.now() + (Number(json.expires_in ?? 3600) - 60) * 1000;
  return cachedFcmAccessToken;
}

async function sendFcmToToken({ token, title, body, data = {} }) {
  const cfg = fcmConfig();
  if (!cfg.projectId) return { ok: false, reason: "FCM_NOT_CONFIGURED" };
  const accessToken = await getFcmAccessToken();
  if (!accessToken) return { ok: false, reason: "FCM_NOT_CONFIGURED" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FCM_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: Object.fromEntries(
              Object.entries(data).map(([k, v]) => [k, String(v)]),
            ),
          },
        }),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `FCM_HTTP_${res.status}`, details: text.slice(0, 200) };
    }
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

function defaultMessageFor(kind, payload) {
  switch (kind) {
    case "QUEUE_NEAR":
      return {
        title: "You're up next!",
        body:
          payload?.peopleAhead != null
            ? `${payload.peopleAhead} ahead — head to the clinic.`
            : "Head to the clinic.",
      };
    case "DOSE_DUE_TOMORROW":
      return {
        title: "Anti-rabies dose tomorrow",
        body:
          payload?.dueDate != null
            ? `Dose ${payload.doseNumber ?? ""} is due ${payload.dueDate}.`
            : "Your next dose is due tomorrow.",
      };
    case "DOSE_OVERDUE":
      return {
        title: "Dose overdue",
        body: "Please go to the clinic to complete your PEP series.",
      };
    case "APPOINTMENT_CONFIRMED":
      return {
        title: "Appointment confirmed",
        body: "Your exposure intake has been confirmed by clinic staff.",
      };
    default:
      return { title: "Anivax", body: "You have an update." };
  }
}

export async function send(patientId, kind, payload = {}, idempotencyKey = null) {
  let notificationId = null;
  try {
    const ins = await run(
      `
      INSERT INTO notifications (patient_id, kind, payload_json, idempotency_key)
      VALUES (?, ?, ?, ?)
    `,
      [String(patientId), String(kind), JSON.stringify(payload ?? {}), idempotencyKey],
    );
    notificationId = ins.id;
  } catch (e) {
    if (
      idempotencyKey &&
      String(e?.message ?? "").includes("UNIQUE constraint failed")
    ) {
      // Already queued — nothing to do.
      return { ok: true, deduped: true };
    }
    throw e;
  }

  const tokens = await all(
    `SELECT fcm_token FROM device_tokens WHERE patient_id = ?`,
    [String(patientId)],
  );
  const message = defaultMessageFor(kind, payload);
  let lastError = null;
  let delivered = false;

  for (const t of tokens) {
    try {
      const result = await sendFcmToToken({
        token: t.fcm_token,
        title: message.title,
        body: message.body,
        data: { kind, ...payload },
      });
      if (result.ok) {
        delivered = true;
      } else if (result.reason !== "FCM_NOT_CONFIGURED") {
        lastError = `${result.reason}: ${result.details ?? ""}`;
      }
    } catch (e) {
      lastError = e?.message ?? String(e);
    }
  }

  // SMS fallback when no FCM tokens or all attempts failed.
  if (!delivered) {
    const credential = await get(
      `SELECT phone_e164 FROM patient_credentials WHERE patient_id = ?`,
      [String(patientId)],
    );
    if (credential?.phone_e164) {
      try {
        await sendSms({
          to: credential.phone_e164,
          message: `${message.title}: ${message.body}`,
        });
        delivered = true;
      } catch (e) {
        lastError = e?.message ?? String(e);
      }
    }
  }

  await run(
    `
    UPDATE notifications
    SET sent_at = datetime('now'),
        delivered_at = CASE WHEN ? THEN datetime('now') ELSE NULL END,
        error = ?
    WHERE id = ?
  `,
    [delivered ? 1 : 0, delivered ? null : lastError, notificationId],
  );

  return { ok: delivered, error: lastError };
}

/* -------------------------------------------------------------------------- */
/*                                 Cron jobs                                  */
/* -------------------------------------------------------------------------- */

function todayIso() {
  const d = new Date();
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function tickQueueNearJob() {
  const today = todayIso();
  const candidates = await all(
    `
    SELECT
      qt.appointment_id, qt.position, qt.day_iso,
      a.patient_id,
      (
        SELECT COUNT(*) FROM queue_tickets q2
        WHERE q2.day_iso = qt.day_iso AND q2.status = 'WAITING' AND q2.position < qt.position
      ) AS pa
    FROM queue_tickets qt
    JOIN appointments a ON a.id = qt.appointment_id
    WHERE qt.day_iso = ? AND qt.status = 'WAITING'
  `,
    [today],
  );
  for (const c of candidates) {
    if ((c.pa ?? 99) <= 3) {
      const idem = `QUEUE_NEAR:${c.appointment_id}`;
      await send(
        c.patient_id,
        "QUEUE_NEAR",
        { peopleAhead: c.pa, appointmentId: c.appointment_id },
        idem,
      );
    }
  }
}

export async function tickDoseDueTomorrowJob() {
  const tomorrow = tomorrowIso();
  const rows = await all(
    `
    SELECT da.id AS dose_id, da.dose_number, da.due_date, ps.patient_id
    FROM dose_administrations da
    JOIN pep_schedules ps ON ps.id = da.schedule_id
    WHERE da.due_date = ? AND da.given_at IS NULL
  `,
    [tomorrow],
  );
  for (const r of rows) {
    const idem = `DOSE_DUE_TOMORROW:${r.dose_id}`;
    await send(
      r.patient_id,
      "DOSE_DUE_TOMORROW",
      { doseNumber: r.dose_number, dueDate: r.due_date, doseId: r.dose_id },
      idem,
    );
  }
}

export async function tickDoseOverdueJob() {
  const today = todayIso();
  const rows = await all(
    `
    SELECT da.id AS dose_id, da.dose_number, da.due_date, ps.patient_id
    FROM dose_administrations da
    JOIN pep_schedules ps ON ps.id = da.schedule_id
    WHERE da.due_date < ? AND da.given_at IS NULL
  `,
    [today],
  );
  for (const r of rows) {
    const idem = `DOSE_OVERDUE:${r.dose_id}:${today}`;
    await send(
      r.patient_id,
      "DOSE_OVERDUE",
      { doseNumber: r.dose_number, dueDate: r.due_date, doseId: r.dose_id },
      idem,
    );
  }
}
