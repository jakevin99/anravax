/**
 * Express middleware that authenticates the bearer token, then optionally
 * authorises by actor kind ("staff" | "patient") and required authority code.
 *
 * Usage:
 *   app.get("/users", requireAuth({ actorKinds: ["staff"], authority: "USERS_READ" }), handler);
 *   app.get("/queue-tickets/me", requireAuth({ actorKinds: ["patient"] }), handler);
 *
 * On success, sets:
 *   req.actor = { kind, id, role, authorities }
 */

import { all, get } from "../db.js";
import { verifyAccessToken } from "../services/tokens.js";

function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function loadStaff(actorId) {
  const id = Number(actorId);
  if (!Number.isInteger(id)) return null;
  const user = await get(
    `
    SELECT u.id, u.first_name, u.last_name, u.username, u.is_active, r.name AS role_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `,
    [id],
  );
  if (!user || !user.is_active) return null;
  const authorities = await all(
    `
    SELECT a.code
    FROM users u
    JOIN role_authorities ra ON ra.role_id = u.role_id
    JOIN authorities a ON a.id = ra.authority_id
    WHERE u.id = ?
  `,
    [id],
  );
  return {
    kind: "staff",
    id: user.id,
    role: user.role_name,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    authorities: authorities.map((a) => a.code),
  };
}

async function loadPatient(actorId) {
  const id = String(actorId);
  if (!id) return null;
  const patient = await get(
    `
    SELECT p.id, p.first_name, p.last_name, pc.phone_e164
    FROM patients p
    JOIN patient_credentials pc ON pc.patient_id = p.id
    WHERE p.id = ?
  `,
    [id],
  );
  if (!patient) return null;
  return {
    kind: "patient",
    id: patient.id,
    role: "PATIENT",
    firstName: patient.first_name,
    lastName: patient.last_name,
    phone: patient.phone_e164,
    authorities: [],
  };
}

export function requireAuth(options = {}) {
  const allowedKinds =
    Array.isArray(options.actorKinds) && options.actorKinds.length
      ? options.actorKinds
      : ["staff", "patient"];
  const requiredAuthority = options.authority || null;

  return async function authMiddleware(req, res, next) {
    try {
      const token = readBearerToken(req);
      if (!token) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      const decoded = verifyAccessToken(token);
      if (!decoded) {
        res.status(401).json({ error: "Invalid or expired token." });
        return;
      }
      const kind = String(decoded.kind);
      if (!allowedKinds.includes(kind)) {
        res.status(403).json({ error: "This actor cannot access this resource." });
        return;
      }
      let actor;
      if (kind === "staff") {
        actor = await loadStaff(decoded.sub);
      } else if (kind === "patient") {
        actor = await loadPatient(decoded.sub);
      } else {
        res.status(401).json({ error: "Unknown actor kind." });
        return;
      }
      if (!actor) {
        res.status(401).json({ error: "Account no longer exists or is inactive." });
        return;
      }
      if (requiredAuthority) {
        const hasIt =
          actor.kind === "staff" &&
          (actor.role === "ADMIN" || actor.authorities.includes(requiredAuthority));
        if (!hasIt) {
          res.status(403).json({
            error: `Missing required authority '${requiredAuthority}'.`,
          });
          return;
        }
      }
      req.actor = actor;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Convenience wrapper: optional auth — populates req.actor when a valid token is sent, else lets through. */
export function attachActorIfPresent() {
  return async function attach(req, _res, next) {
    try {
      const token = readBearerToken(req);
      if (!token) {
        next();
        return;
      }
      const decoded = verifyAccessToken(token);
      if (!decoded) {
        next();
        return;
      }
      if (decoded.kind === "staff") {
        req.actor = (await loadStaff(decoded.sub)) ?? undefined;
      } else if (decoded.kind === "patient") {
        req.actor = (await loadPatient(decoded.sub)) ?? undefined;
      }
      next();
    } catch {
      next();
    }
  };
}
