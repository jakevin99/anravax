/**
 * Patient OTP-based authentication.
 *
 *   POST /api/v1/auth/patient/otp/request   { phone }                     -> { sentTo, expiresInSeconds }
 *   POST /api/v1/auth/patient/otp/verify    { phone, otp, profile? }      -> tokens
 *
 *   GET  /api/v1/patients/me                                              -> patient
 *   PATCH /api/v1/patients/me               { ...partial }                -> patient
 *   POST /api/v1/patients/me/exposure-intake                              -> { appointmentId }
 *
 * Phones are normalized to E.164 with the +63 country code for the
 * Philippines: 09171234567 -> +639171234567.
 */

import crypto from "node:crypto";
import rateLimit from "express-rate-limit";

import { all, get, run } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { hashPassword, verifyPassword } from "./services/passwords.js";
import { issueRefreshToken, signAccessToken } from "./services/tokens.js";
import { sendSms } from "./services/sms.js";
import { allocatePatientId, isPatientId } from "./services/entityIds.js";

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;

const patientOnly = requireAuth({ actorKinds: ["patient"] });

function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("63")) return `+${digits}`;
  if (digits.startsWith("0")) return `+63${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `+63${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function generateOtp() {
  // 6-digit numeric, zero-padded.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

async function ensurePatientForPhone(phoneE164, profile = {}) {
  const existing = await get(
    `
    SELECT p.id, p.first_name, p.last_name
    FROM patient_credentials pc
    JOIN patients p ON p.id = pc.patient_id
    WHERE pc.phone_e164 = ?
  `,
    [phoneE164],
  );
  if (existing) return existing;

  let patientId =
    typeof profile.patientId === "string" && profile.patientId.trim()
      ? profile.patientId.trim()
      : null;
  if (patientId && !isPatientId(patientId)) {
    patientId = null;
  }
  if (!patientId) {
    patientId = await allocatePatientId(get);
  }
  const firstName =
    typeof profile.firstName === "string" && profile.firstName.trim()
      ? profile.firstName.trim()
      : "Patient";
  const lastName =
    typeof profile.lastName === "string" && profile.lastName.trim()
      ? profile.lastName.trim()
      : "Mobile";
  const birthDate =
    typeof profile.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)
      ? profile.birthDate
      : "1970-01-01";
  const sex = String(profile.sex ?? "F").toUpperCase().startsWith("M") ? "M" : "F";

  await run("BEGIN TRANSACTION");
  try {
    await run(
      `
      INSERT INTO patients (
        id, first_name, last_name, birth_date, sex, age_years, contact_number, registered_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, date('now'))
    `,
      [
        patientId,
        firstName,
        lastName,
        birthDate,
        sex,
        Math.max(0, new Date().getFullYear() - Number(birthDate.slice(0, 4))),
        phoneE164,
      ],
    );
    await run(
      `
      INSERT INTO patient_credentials (patient_id, phone_e164)
      VALUES (?, ?)
    `,
      [patientId, phoneE164],
    );
    await run("COMMIT");
  } catch (txError) {
    await run("ROLLBACK");
    throw txError;
  }

  return { id: patientId, first_name: firstName, last_name: lastName };
}

const OTP_REQUEST_LIMIT_PER_HOUR =
  Number.parseInt(process.env.OTP_REQUEST_LIMIT_PER_HOUR ?? "", 10) || 5;
const OTP_VERIFY_LIMIT_PER_HOUR =
  Number.parseInt(process.env.OTP_VERIFY_LIMIT_PER_HOUR ?? "", 10) || 30;

const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: OTP_REQUEST_LIMIT_PER_HOUR,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many OTP requests. Try again later." },
});
const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: OTP_VERIFY_LIMIT_PER_HOUR,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many OTP verification attempts. Try again later." },
});

export function mountPatientAuthRoutes(app, API_PREFIX) {
  const disableOtpLimit = process.env.DISABLE_OTP_RATE_LIMIT === "1";
  const otpRequestChain = disableOtpLimit
    ? (_req, _res, next) => next()
    : otpRequestLimiter;
  const otpVerifyChain = disableOtpLimit
    ? (_req, _res, next) => next()
    : otpVerifyLimiter;

  app.post(
    `${API_PREFIX}/auth/patient/otp/request`,
    otpRequestChain,
    async (req, res, next) => {
      try {
        const phone = normalizePhone(req.body?.phone);
        if (!phone) {
          res.status(400).json({ error: "Field 'phone' is required." });
          return;
        }
        const otp = generateOtp();
        const otpHash = await hashPassword(otp);
        const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

        await run(
          `
          INSERT INTO otp_challenges (phone_e164, otp_hash, expires_at, attempts)
          VALUES (?, ?, ?, 0)
          ON CONFLICT(phone_e164) DO UPDATE SET
            otp_hash = excluded.otp_hash,
            expires_at = excluded.expires_at,
            attempts = 0
        `,
          [phone, otpHash, expiresAt],
        );

        await sendSms({
          to: phone,
          message: `Your Anivax verification code is ${otp}. It expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes.`,
        });

        res.status(200).json({
          data: {
            sentTo: phone,
            expiresInSeconds: OTP_TTL_SECONDS,
            // In dev (stub provider) returning the OTP makes integration
            // testing painless without ever exposing it in prod.
            devOtp:
              process.env.NODE_ENV !== "production" &&
              (process.env.SMS_PROVIDER ?? "stub") === "stub"
                ? otp
                : undefined,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${API_PREFIX}/auth/patient/otp/verify`,
    otpVerifyChain,
    async (req, res, next) => {
      try {
        const phone = normalizePhone(req.body?.phone);
        const otp = req.body?.otp;
        if (!phone || !otp) {
          res.status(400).json({ error: "Fields 'phone' and 'otp' are required." });
          return;
        }
        const challenge = await get(
          `SELECT * FROM otp_challenges WHERE phone_e164 = ?`,
          [phone],
        );
        if (!challenge) {
          res.status(401).json({ error: "Request a new OTP first." });
          return;
        }
        if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
          res.status(429).json({ error: "Too many failed attempts. Request a new OTP." });
          return;
        }
        if (new Date(challenge.expires_at).getTime() < Date.now()) {
          res.status(401).json({ error: "OTP expired. Request a new one." });
          return;
        }
        const ok = await verifyPassword(otp, challenge.otp_hash);
        if (!ok) {
          await run(
            `UPDATE otp_challenges SET attempts = attempts + 1 WHERE phone_e164 = ?`,
            [phone],
          );
          res.status(401).json({ error: "Invalid OTP." });
          return;
        }

        const patient = await ensurePatientForPhone(phone, req.body?.profile ?? {});

        await run(`DELETE FROM otp_challenges WHERE phone_e164 = ?`, [phone]);
        await run(
          `
          UPDATE patient_credentials
          SET last_login_at = datetime('now'), updated_at = datetime('now')
          WHERE patient_id = ?
        `,
          [patient.id],
        );

        const { token: accessToken, expiresInSeconds } = signAccessToken({
          actorId: patient.id,
          actorKind: "patient",
          role: "PATIENT",
        });
        const { refreshToken, expiresAt } = await issueRefreshToken({
          actorKind: "patient",
          actorId: patient.id,
        });

        res.status(200).json({
          data: {
            accessToken,
            expiresInSeconds,
            refreshToken,
            refreshExpiresAt: expiresAt,
            user: {
              id: patient.id,
              firstName: patient.first_name,
              lastName: patient.last_name,
              phone,
              role: "PATIENT",
            },
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*                       Patient self-service                          */
  /* ------------------------------------------------------------------ */

  app.get(`${API_PREFIX}/patients/me`, patientOnly, async (req, res, next) => {
    try {
      const row = await get(`SELECT * FROM patients WHERE id = ?`, [
        String(req.actor.id),
      ]);
      if (!row) {
        res.status(404).json({ error: "Patient profile not found." });
        return;
      }
      res.status(200).json({ data: mapPatientRow(row, req.actor.phone) });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${API_PREFIX}/patients/me`, patientOnly, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const sets = [];
      const params = [];
      const allowed = [
        ["firstName", "first_name"],
        ["middleName", "middle_name"],
        ["lastName", "last_name"],
        ["birthDate", "birth_date"],
        ["sex", "sex"],
        ["address", "address"],
        ["bloodType", "blood_type"],
      ];
      for (const [bodyKey, column] of allowed) {
        if (body[bodyKey] !== undefined) {
          sets.push(`${column} = ?`);
          params.push(body[bodyKey] == null ? null : String(body[bodyKey]));
        }
      }
      if (!sets.length) {
        res.status(400).json({ error: "No updatable fields supplied." });
        return;
      }
      sets.push("updated_at = datetime('now')");
      params.push(String(req.actor.id));
      await run(`UPDATE patients SET ${sets.join(", ")} WHERE id = ?`, params);
      const row = await get(`SELECT * FROM patients WHERE id = ?`, [
        String(req.actor.id),
      ]);
      res.status(200).json({ data: mapPatientRow(row, req.actor.phone) });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    `${API_PREFIX}/patients/me/exposure-intake`,
    patientOnly,
    async (req, res, next) => {
      try {
        const body = req.body ?? {};
        const required = [
          "chiefComplaint",
          "dateOfIncidence",
          "timeOfIncidence",
          "placeOfIncidence",
          "siteOfInjury",
          "animalType",
        ];
        const missing = required.filter((k) => !String(body[k] ?? "").trim());
        if (missing.length) {
          res.status(400).json({
            error: `Missing required fields: ${missing.join(", ")}`,
          });
          return;
        }

        const appointmentId = `a_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
        const scheduledAt = `${String(body.dateOfIncidence)}T${String(body.timeOfIncidence)}:00`;

        // Find any active staff to attach as a placeholder attendant — a
        // PROGRAM COORDINATOR or ADMIN, otherwise the first staff. Staff
        // re-assigns when they confirm the request.
        const placeholderAttendant = await get(
          `
          SELECT u.id FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE u.is_active = 1
          ORDER BY (r.name = 'PROGRAM COORDINATOR') DESC,
                   (r.name = 'ADMIN') DESC,
                   u.id ASC
          LIMIT 1
        `,
        );
        if (!placeholderAttendant) {
          res.status(503).json({ error: "No staff is available to assign this request." });
          return;
        }

        await run("BEGIN TRANSACTION");
        try {
          await run(
            `
            INSERT INTO appointments (
              id, patient_id, attendant_user_id, scheduled_at, category, status, tab
            ) VALUES (?, ?, ?, ?, 3, 'SCHEDULED', 'REQUESTS')
          `,
            [
              appointmentId,
              String(req.actor.id),
              Number(placeholderAttendant.id),
              scheduledAt,
            ],
          );
          await run(
            `
            INSERT INTO exposure_records (
              appointment_id, chief_complaint, date_of_incidence, time_of_incidence,
              place_of_incidence, site_of_injury, animal_type, washed_injury, animal_vaccinated,
              uploaded_file_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              appointmentId,
              String(body.chiefComplaint),
              String(body.dateOfIncidence),
              String(body.timeOfIncidence),
              String(body.placeOfIncidence),
              String(body.siteOfInjury),
              String(body.animalType),
              body.washedInjury ? 1 : 0,
              body.animalVaccinated ? 1 : 0,
              body.uploadedFileUrl ?? null,
            ],
          );
          await run("COMMIT");
        } catch (txError) {
          await run("ROLLBACK");
          throw txError;
        }

        res.status(201).json({
          data: { appointmentId, status: "PENDING_CONFIRMATION" },
        });
      } catch (error) {
        next(error);
      }
    },
  );
}

function mapPatientRow(row, phoneFromActor) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    middleName: row.middle_name || undefined,
    lastName: row.last_name,
    suffix: row.suffix,
    birthDate: row.birth_date,
    sex: row.sex,
    ageYears: row.age_years,
    address: row.address,
    contactNumber: row.contact_number ?? phoneFromActor ?? null,
    bloodType: row.blood_type,
    registrationNo: row.registration_no,
    registeredAt: row.registered_at,
  };
}
