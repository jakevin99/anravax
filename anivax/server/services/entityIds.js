/**
 * System-standard entity identifiers.
 *
 * Staff users: `u_` + 6 alphanumeric (e.g. u_a1B2c3)
 * Patients:    `p_` + 12 alphanumeric (e.g. p_x9Y8z7W6v5U4)
 */

import crypto from "node:crypto";

const ALPHANUM =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export const USER_PUBLIC_ID_RE = /^u_[A-Za-z0-9]{6}$/;
export const PATIENT_ID_RE = /^p_[A-Za-z0-9]{12}$/;

function randomAlphanumeric(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHANUM[bytes[i] % ALPHANUM.length];
  }
  return out;
}

export function generateUserPublicId() {
  return `u_${randomAlphanumeric(6)}`;
}

export function generatePatientId() {
  return `p_${randomAlphanumeric(12)}`;
}

export function isUserPublicId(value) {
  return USER_PUBLIC_ID_RE.test(String(value ?? "").trim());
}

export function isPatientId(value) {
  return PATIENT_ID_RE.test(String(value ?? "").trim());
}

export async function allocateUserPublicId(get) {
  for (let attempt = 0; attempt < 48; attempt++) {
    const id = generateUserPublicId();
    const existing = await get(`SELECT id FROM users WHERE public_id = ?`, [id]);
    if (!existing) return id;
  }
  throw new Error("Could not allocate a unique user id.");
}

export async function allocatePatientId(get) {
  for (let attempt = 0; attempt < 48; attempt++) {
    const id = generatePatientId();
    const existing = await get(`SELECT id FROM patients WHERE id = ?`, [id]);
    if (!existing) return id;
  }
  throw new Error("Could not allocate a unique patient id.");
}

/** Resolve API path param to numeric `users.id` (supports legacy integer or `u_xxxxxx`). */
export async function resolveUserDbId(get, param) {
  const raw = String(param ?? "").trim();
  if (!raw) return null;
  if (isUserPublicId(raw)) {
    const row = await get(`SELECT id FROM users WHERE public_id = ?`, [raw]);
    return row?.id ?? null;
  }
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  return null;
}
