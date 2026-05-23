/**
 * Password hashing helpers.
 *
 * Uses Node's built-in `scrypt` (no native compile required).
 *
 * Hash envelope:
 *   "scrypt$N$r$p$<saltB64>$<derivedKeyB64>"
 *
 * The legacy verify function recognizes 64-char lowercase hex (raw SHA-256
 * from the original `app.js` implementation) so existing seeded accounts
 * can still log in once and be lazily upgraded to scrypt on success.
 */

import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_BYTES = 16;

const LEGACY_SHA256_RE = /^[a-f0-9]{64}$/i;

export async function hashPassword(rawPassword) {
  const password = String(rawPassword ?? "");
  if (!password) {
    throw new Error("Password cannot be empty.");
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    Buffer.from(derived).toString("base64"),
  ].join("$");
}

export async function verifyPassword(rawPassword, storedHash) {
  if (!rawPassword || !storedHash) return false;
  const password = String(rawPassword);

  if (LEGACY_SHA256_RE.test(storedHash)) {
    const candidate = crypto.createHash("sha256").update(password).digest("hex");
    return timingSafeStringEq(candidate, storedHash.toLowerCase());
  }

  const parts = String(storedHash).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  let derived;
  try {
    derived = await scryptAsync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/** True when the hash format is recognised but is the legacy SHA-256 form. */
export function isLegacyHash(storedHash) {
  return Boolean(storedHash) && LEGACY_SHA256_RE.test(String(storedHash));
}

function timingSafeStringEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
