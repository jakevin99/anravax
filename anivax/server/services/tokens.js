/**
 * JWT access token + opaque refresh token issuance, verification, and rotation.
 *
 * Access token (JWT, HS256):
 *   payload = { sub, kind: "staff" | "patient", role?, ver }
 *   ttl     = 15 minutes (override with JWT_ACCESS_TTL_SECONDS)
 *
 * Refresh token:
 *   Random 256-bit base64url string, hashed (SHA-256) and stored in
 *   `refresh_tokens`. Rotated on every refresh.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { all, get, run } from "../db.js";

const DEFAULT_ACCESS_TTL_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

function getJwtSecret() {
  const secret = (process.env.JWT_SECRET ?? "").trim();
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Add it to anivax/.env (any 32+ char random string).",
    );
  }
  return secret;
}

function accessTtlSeconds() {
  const v = Number.parseInt(process.env.JWT_ACCESS_TTL_SECONDS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_ACCESS_TTL_SECONDS;
}

function refreshTtlSeconds() {
  const v = Number.parseInt(process.env.JWT_REFRESH_TTL_SECONDS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_REFRESH_TTL_SECONDS;
}

function hashRefresh(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

export function signAccessToken({ actorId, actorKind, role, version = 1 }) {
  const ttl = accessTtlSeconds();
  const token = jwt.sign(
    {
      sub: String(actorId),
      kind: actorKind,
      role: role ?? null,
      ver: version,
    },
    getJwtSecret(),
    { algorithm: "HS256", expiresIn: ttl },
  );
  return { token, expiresInSeconds: ttl };
}

export function verifyAccessToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
    if (!decoded || typeof decoded !== "object") return null;
    if (!decoded.sub || !decoded.kind) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function issueRefreshToken({ actorKind, actorId }) {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = hashRefresh(raw);
  const ttl = refreshTtlSeconds();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);
  await run(
    `
    INSERT INTO refresh_tokens (
      actor_kind, actor_id, token_hash, issued_at, expires_at
    ) VALUES (?, ?, ?, ?, ?)
  `,
    [
      String(actorKind),
      String(actorId),
      hash,
      issuedAt.toISOString(),
      expiresAt.toISOString(),
    ],
  );
  return { refreshToken: raw, expiresAt: expiresAt.toISOString() };
}

export async function consumeRefreshToken(rawToken) {
  if (!rawToken) return null;
  const hash = hashRefresh(rawToken);
  const row = await get(
    `
    SELECT id, actor_kind, actor_id, expires_at, revoked_at
    FROM refresh_tokens
    WHERE token_hash = ?
  `,
    [hash],
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }
  await run(
    `UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`,
    [row.id],
  );
  return { actorKind: row.actor_kind, actorId: row.actor_id };
}

export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return false;
  const hash = hashRefresh(rawToken);
  const result = await run(
    `
    UPDATE refresh_tokens
    SET revoked_at = datetime('now')
    WHERE token_hash = ? AND revoked_at IS NULL
  `,
    [hash],
  );
  return Boolean(result.changes);
}

export async function revokeAllForActor({ actorKind, actorId }) {
  await run(
    `
    UPDATE refresh_tokens
    SET revoked_at = datetime('now')
    WHERE actor_kind = ? AND actor_id = ? AND revoked_at IS NULL
  `,
    [String(actorKind), String(actorId)],
  );
}

/**
 * Periodically prune obviously-dead rows.
 * Safe to call often; runs O(rows-affected) deletes.
 */
export async function pruneExpiredRefreshTokens() {
  await run(
    `
    DELETE FROM refresh_tokens
    WHERE expires_at < datetime('now', '-7 days')
       OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))
  `,
  );
}

/** Unused export kept for symmetry / future debugging. */
export { hashRefresh };

/** Inspect every refresh row for an actor (for diagnostics only). */
export async function listRefreshTokensFor(actorKind, actorId) {
  return all(
    `
    SELECT id, issued_at, expires_at, revoked_at
    FROM refresh_tokens
    WHERE actor_kind = ? AND actor_id = ?
    ORDER BY id DESC
  `,
    [String(actorKind), String(actorId)],
  );
}
