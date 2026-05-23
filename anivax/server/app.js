import express from "express";
import cors from "cors";
import { all, get, initDb, run } from "./db.js";
import { mountAppointmentRoutes } from "./appointmentsRoutes.js";
import { mountScheduleSlotsRoutes } from "./scheduleSlotsRoutes.js";
import { mountPatientRoutes } from "./patientsRoutes.js";
import { mountOcrRoutes } from "./ocrRoutes.js";
import { mountDoseRoutes } from "./dosesRoutes.js";
import { mountQueueTicketsRoutes } from "./queueTicketsRoutes.js";
import { mountInventoryRoutes } from "./inventoryRoutes.js";
import { mountPatientAuthRoutes } from "./patientAuthRoutes.js";
import { mountFilesRoutes } from "./filesRoutes.js";
import { mountNotificationsRoutes } from "./notificationsRoutes.js";
import { mountDashboardRoutes } from "./dashboardRoutes.js";
import { hashPassword, verifyPassword, isLegacyHash } from "./services/passwords.js";
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeAllForActor,
  revokeRefreshToken,
  signAccessToken,
} from "./services/tokens.js";
import { requireAuth } from "./middleware/auth.js";
import { auditMiddleware } from "./middleware/audit.js";
import {
  allocateUserPublicId,
  resolveUserDbId,
} from "./services/entityIds.js";

const API_PREFIX = "/api/v1";

const staffOnly = requireAuth({ actorKinds: ["staff"] });
const usersRead = requireAuth({ actorKinds: ["staff"], authority: "USERS_READ" });
const usersWrite = requireAuth({ actorKinds: ["staff"], authority: "USERS_WRITE" });
const schedulesRead = requireAuth({
  actorKinds: ["staff"],
  authority: "SCHEDULES_READ",
});
const schedulesWrite = requireAuth({
  actorKinds: ["staff"],
  authority: "SCHEDULES_WRITE",
});

async function getAdminRoleId() {
  const adminRole = await get("SELECT id FROM roles WHERE name = ?", ["ADMIN"]);
  return adminRole?.id ?? null;
}

async function buildStaffSession(userRow) {
  const { token: accessToken, expiresInSeconds } = signAccessToken({
    actorId: userRow.id,
    actorKind: "staff",
    role: userRow.role_name,
  });
  const { refreshToken, expiresAt } = await issueRefreshToken({
    actorKind: "staff",
    actorId: userRow.id,
  });
  const authorities = await all(
    `
    SELECT a.code
    FROM users u
    JOIN role_authorities ra ON ra.role_id = u.role_id
    JOIN authorities a ON a.id = ra.authority_id
    WHERE u.id = ?
  `,
    [userRow.id],
  );
  return {
    accessToken,
    expiresInSeconds,
    refreshToken,
    refreshExpiresAt: expiresAt,
    user: {
      id: userRow.id,
      username: userRow.username,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      role: userRow.role_name,
      authorities: authorities.map((a) => a.code),
    },
  };
}

export async function createApp() {
  await initDb();

  const app = express();
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors(
      allowedOrigins.length
        ? {
            origin: (origin, cb) => {
              if (!origin) return cb(null, true);
              cb(null, allowedOrigins.includes(origin));
            },
          }
        : undefined,
    ),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(auditMiddleware());

  app.get(`${API_PREFIX}/health`, async (_req, res) => {
    const checks = {
      status: "ok",
      timestamp: new Date().toISOString(),
      db: "unknown",
      ocr: process.env.MISTRAL_API_KEY?.trim()
        ? "mistral"
        : process.env.OCR_SPACE_API_KEY
          ? "configured"
          : "demo-key",
      fcm:
        process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL
          ? "configured"
          : "missing",
      sms: (process.env.SMS_PROVIDER ?? "stub").trim() || "stub",
      featurePushNotifications:
        (process.env.FEATURE_PUSH_NOTIFICATIONS ?? "off").toLowerCase() === "on",
      featurePatientAuth:
        (process.env.FEATURE_PATIENT_AUTH ?? "on").toLowerCase() === "on",
      featureAuditLog:
        (process.env.FEATURE_AUDIT_LOG ?? "on").toLowerCase() === "on",
    };
    try {
      await get("SELECT 1 AS ok");
      checks.db = "ok";
    } catch (e) {
      checks.db = `error: ${e?.message ?? "unknown"}`;
      checks.status = "degraded";
    }
    res.status(checks.status === "ok" ? 200 : 503).json(checks);
  });

  app.post(`${API_PREFIX}/auth/login`, async (req, res, next) => {
    try {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        res.status(400).json({ error: "Fields 'username' and 'password' are required." });
        return;
      }
      const user = await get(
        `
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          u.username,
          u.password_hash,
          u.role_id,
          u.is_active,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE lower(u.username) = lower(?)
      `,
        [String(username).trim()],
      );
      if (!user || !user.is_active) {
        res.status(401).json({ error: "Invalid credentials." });
        return;
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Invalid credentials." });
        return;
      }
      if (isLegacyHash(user.password_hash)) {
        const upgraded = await hashPassword(password);
        await run(
          `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
          [upgraded, user.id],
        );
      }
      const session = await buildStaffSession(user);
      res.status(200).json({ data: session });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${API_PREFIX}/auth/refresh`, async (req, res, next) => {
    try {
      const refreshToken = req.body?.refreshToken;
      if (!refreshToken || typeof refreshToken !== "string") {
        res.status(400).json({ error: "Field 'refreshToken' is required." });
        return;
      }
      const consumed = await consumeRefreshToken(refreshToken);
      if (!consumed) {
        res.status(401).json({ error: "Refresh token is invalid or expired." });
        return;
      }
      if (consumed.actorKind === "staff") {
        const user = await get(
          `
          SELECT u.id, u.first_name, u.last_name, u.username, u.is_active, r.name AS role_name
          FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE u.id = ?
        `,
          [Number(consumed.actorId)],
        );
        if (!user || !user.is_active) {
          res.status(401).json({ error: "Account is no longer active." });
          return;
        }
        const session = await buildStaffSession(user);
        res.status(200).json({ data: session });
        return;
      }
      if (consumed.actorKind === "patient") {
        const patient = await get(
          `
          SELECT p.id, p.first_name, p.last_name, pc.phone_e164
          FROM patients p
          JOIN patient_credentials pc ON pc.patient_id = p.id
          WHERE p.id = ?
        `,
          [String(consumed.actorId)],
        );
        if (!patient) {
          res.status(401).json({ error: "Patient account no longer exists." });
          return;
        }
        const { token: accessToken, expiresInSeconds } = signAccessToken({
          actorId: patient.id,
          actorKind: "patient",
          role: "PATIENT",
        });
        const { refreshToken: newRefresh, expiresAt } = await issueRefreshToken({
          actorKind: "patient",
          actorId: patient.id,
        });
        res.status(200).json({
          data: {
            accessToken,
            expiresInSeconds,
            refreshToken: newRefresh,
            refreshExpiresAt: expiresAt,
            user: {
              id: patient.id,
              firstName: patient.first_name,
              lastName: patient.last_name,
              phone: patient.phone_e164,
              role: "PATIENT",
            },
          },
        });
        return;
      }
      res.status(401).json({ error: "Unknown actor kind." });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${API_PREFIX}/auth/logout`, async (req, res, next) => {
    try {
      const refreshToken = req.body?.refreshToken;
      const everywhere = Boolean(req.body?.everywhere);
      if (refreshToken && typeof refreshToken === "string") {
        await revokeRefreshToken(refreshToken);
      }
      if (everywhere && req.actor) {
        await revokeAllForActor({
          actorKind: req.actor.kind,
          actorId: req.actor.id,
        });
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get(
    `${API_PREFIX}/me`,
    requireAuth({ actorKinds: ["staff", "patient"] }),
    async (req, res) => {
      const actor = req.actor;
      res.status(200).json({
        data: {
          kind: actor.kind,
          id: actor.id,
          firstName: actor.firstName,
          lastName: actor.lastName,
          role: actor.role,
          authorities: actor.authorities ?? [],
          phone: actor.phone ?? null,
          username: actor.username ?? null,
        },
      });
    },
  );

  app.patch(`${API_PREFIX}/auth/admin/password`, async (req, res, next) => {
    try {
      const { username, currentPassword, newPassword } = req.body ?? {};
      if (!username || !currentPassword || !newPassword) {
        res.status(400).json({
          error: "Fields 'username', 'currentPassword', and 'newPassword' are required.",
        });
        return;
      }
      if (String(newPassword).length < 6) {
        res.status(400).json({ error: "New password must be at least 6 characters." });
        return;
      }
      const user = await get(
        `
        SELECT
          u.id,
          u.username,
          u.password_hash,
          u.role_id,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE lower(u.username) = lower(?)
      `,
        [String(username).trim()],
      );
      if (!user || user.role_name !== "ADMIN") {
        res.status(403).json({ error: "Only admin can change admin password." });
        return;
      }
      const ok = await verifyPassword(currentPassword, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Current password is incorrect." });
        return;
      }
      const newHash = await hashPassword(newPassword);
      await run(
        `
        UPDATE users
        SET password_hash = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
        [newHash, user.id],
      );
      await revokeAllForActor({ actorKind: "staff", actorId: user.id });
      res.status(200).json({ data: { message: "Admin password changed successfully." } });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${API_PREFIX}/auth/admin/username`, async (req, res, next) => {
    try {
      const { username, currentPassword, newUsername } = req.body ?? {};
      if (!username || !currentPassword || !newUsername) {
        res.status(400).json({
          error: "Fields 'username', 'currentPassword', and 'newUsername' are required.",
        });
        return;
      }
      const normalizedNewUsername = String(newUsername).trim();
      if (!normalizedNewUsername) {
        res.status(400).json({ error: "New username cannot be empty." });
        return;
      }
      const user = await get(
        `
        SELECT
          u.id,
          u.username,
          u.password_hash,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE lower(u.username) = lower(?)
      `,
        [String(username).trim()],
      );
      if (!user || user.role_name !== "ADMIN") {
        res.status(403).json({ error: "Only admin can change admin username." });
        return;
      }
      const ok = await verifyPassword(currentPassword, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Current password is incorrect." });
        return;
      }
      await run(
        `
        UPDATE users
        SET username = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
        [normalizedNewUsername, user.id],
      );
      res.status(200).json({
        data: {
          message: "Admin username changed successfully.",
          username: normalizedNewUsername,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/authorities`, usersRead, async (_req, res, next) => {
    try {
      const rows = await all(`
        SELECT id, code, description, created_at, updated_at
        FROM authorities
        ORDER BY id ASC
      `);
      res.status(200).json({ data: rows });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${API_PREFIX}/authorities`, usersWrite, async (req, res, next) => {
    try {
      const { code, description = "" } = req.body ?? {};
      if (!code || typeof code !== "string") {
        res.status(400).json({ error: "Field 'code' is required." });
        return;
      }
      const normalizedCode = code.trim().toUpperCase();
      if (!normalizedCode) {
        res.status(400).json({ error: "Field 'code' cannot be empty." });
        return;
      }
      const result = await run(
        `
        INSERT INTO authorities (code, description, updated_at)
        VALUES (?, ?, datetime('now'))
      `,
        [normalizedCode, String(description ?? "")],
      );
      const created = await get(
        `
        SELECT id, code, description, created_at, updated_at
        FROM authorities
        WHERE id = ?
      `,
        [result.id],
      );
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${API_PREFIX}/authorities/:authorityId`, usersWrite, async (req, res, next) => {
    try {
      const authorityId = Number(req.params.authorityId);
      if (!Number.isInteger(authorityId)) {
        res.status(400).json({ error: "Invalid authority id." });
        return;
      }

      const current = await get("SELECT * FROM authorities WHERE id = ?", [authorityId]);
      if (!current) {
        res.status(404).json({ error: "Authority not found." });
        return;
      }

      const nextCodeRaw = req.body?.code;
      const nextDescriptionRaw = req.body?.description;
      const nextCode =
        typeof nextCodeRaw === "string" && nextCodeRaw.trim()
          ? nextCodeRaw.trim().toUpperCase()
          : current.code;
      const nextDescription =
        nextDescriptionRaw === undefined
          ? current.description
          : String(nextDescriptionRaw ?? "");

      await run(
        `
        UPDATE authorities
        SET code = ?, description = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
        [nextCode, nextDescription, authorityId],
      );

      const updated = await get(
        `
        SELECT id, code, description, created_at, updated_at
        FROM authorities
        WHERE id = ?
      `,
        [authorityId],
      );
      res.status(200).json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${API_PREFIX}/authorities/:authorityId`, usersWrite, async (req, res, next) => {
    try {
      const authorityId = Number(req.params.authorityId);
      if (!Number.isInteger(authorityId)) {
        res.status(400).json({ error: "Invalid authority id." });
        return;
      }
      const result = await run("DELETE FROM authorities WHERE id = ?", [authorityId]);
      if (!result.changes) {
        res.status(404).json({ error: "Authority not found." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/roles`, usersRead, async (_req, res, next) => {
    try {
      const rows = await all(`
        SELECT id, name, description, created_at, updated_at
        FROM roles
        ORDER BY id ASC
      `);
      res.status(200).json({ data: rows });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${API_PREFIX}/roles`, usersWrite, async (req, res, next) => {
    try {
      const { name, description = "" } = req.body ?? {};
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "Field 'name' is required." });
        return;
      }
      const normalizedName = name.trim().toUpperCase();
      const result = await run(
        `
        INSERT INTO roles (name, description, updated_at)
        VALUES (?, ?, datetime('now'))
      `,
        [normalizedName, String(description ?? "")],
      );
      const created = await get(
        `
        SELECT id, name, description, created_at, updated_at
        FROM roles
        WHERE id = ?
      `,
        [result.id],
      );
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/roles/:roleId`, usersRead, async (req, res, next) => {
    try {
      const roleId = Number(req.params.roleId);
      if (!Number.isInteger(roleId)) {
        res.status(400).json({ error: "Invalid role id." });
        return;
      }
      const role = await get(
        `
        SELECT id, name, description, created_at, updated_at
        FROM roles
        WHERE id = ?
      `,
        [roleId],
      );
      if (!role) {
        res.status(404).json({ error: "Role not found." });
        return;
      }
      res.status(200).json({ data: role });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${API_PREFIX}/roles/:roleId`, usersWrite, async (req, res, next) => {
    try {
      const roleId = Number(req.params.roleId);
      if (!Number.isInteger(roleId)) {
        res.status(400).json({ error: "Invalid role id." });
        return;
      }
      const current = await get("SELECT * FROM roles WHERE id = ?", [roleId]);
      if (!current) {
        res.status(404).json({ error: "Role not found." });
        return;
      }
      const nextNameRaw = req.body?.name;
      const nextDescriptionRaw = req.body?.description;
      const nextName =
        typeof nextNameRaw === "string" && nextNameRaw.trim()
          ? nextNameRaw.trim().toUpperCase()
          : current.name;
      const nextDescription =
        nextDescriptionRaw === undefined
          ? current.description
          : String(nextDescriptionRaw ?? "");

      await run(
        `
        UPDATE roles
        SET name = ?, description = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
        [nextName, nextDescription, roleId],
      );

      const updated = await get(
        `
        SELECT id, name, description, created_at, updated_at
        FROM roles
        WHERE id = ?
      `,
        [roleId],
      );
      res.status(200).json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${API_PREFIX}/roles/:roleId`, usersWrite, async (req, res, next) => {
    try {
      const roleId = Number(req.params.roleId);
      if (!Number.isInteger(roleId)) {
        res.status(400).json({ error: "Invalid role id." });
        return;
      }
      const result = await run("DELETE FROM roles WHERE id = ?", [roleId]);
      if (!result.changes) {
        res.status(404).json({ error: "Role not found." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/roles/:roleId/authorities`, usersRead, async (req, res, next) => {
    try {
      const roleId = Number(req.params.roleId);
      if (!Number.isInteger(roleId)) {
        res.status(400).json({ error: "Invalid role id." });
        return;
      }
      const role = await get("SELECT id, name FROM roles WHERE id = ?", [roleId]);
      if (!role) {
        res.status(404).json({ error: "Role not found." });
        return;
      }
      const authorities = await all(
        `
        SELECT a.id, a.code, a.description
        FROM role_authorities ra
        JOIN authorities a ON a.id = ra.authority_id
        WHERE ra.role_id = ?
        ORDER BY a.id ASC
      `,
        [roleId],
      );
      res.status(200).json({
        data: {
          role,
          authorities,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.put(`${API_PREFIX}/roles/:roleId/authorities`, usersWrite, async (req, res, next) => {
    try {
      const roleId = Number(req.params.roleId);
      if (!Number.isInteger(roleId)) {
        res.status(400).json({ error: "Invalid role id." });
        return;
      }
      const role = await get("SELECT id, name FROM roles WHERE id = ?", [roleId]);
      if (!role) {
        res.status(404).json({ error: "Role not found." });
        return;
      }
      const authorityIdsRaw = req.body?.authorityIds;
      if (!Array.isArray(authorityIdsRaw)) {
        res.status(400).json({ error: "Field 'authorityIds' must be an array." });
        return;
      }
      const authorityIds = authorityIdsRaw
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id));

      const placeholders = authorityIds.map(() => "?").join(",");
      if (authorityIds.length > 0) {
        const existing = await all(
          `SELECT id FROM authorities WHERE id IN (${placeholders})`,
          authorityIds,
        );
        if (existing.length !== authorityIds.length) {
          res.status(400).json({ error: "One or more authority ids do not exist." });
          return;
        }
      }

      await run("BEGIN TRANSACTION");
      try {
        await run("DELETE FROM role_authorities WHERE role_id = ?", [roleId]);
        for (const authorityId of authorityIds) {
          await run(
            `
            INSERT INTO role_authorities (role_id, authority_id)
            VALUES (?, ?)
          `,
            [roleId, authorityId],
          );
        }
        await run("COMMIT");
      } catch (txError) {
        await run("ROLLBACK");
        throw txError;
      }

      const updated = await all(
        `
        SELECT a.id, a.code, a.description
        FROM role_authorities ra
        JOIN authorities a ON a.id = ra.authority_id
        WHERE ra.role_id = ?
        ORDER BY a.id ASC
      `,
        [roleId],
      );
      res.status(200).json({
        data: {
          role,
          authorities: updated,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/users`, usersRead, async (req, res, next) => {
    try {
      const roleId = req.query.roleId ? Number(req.query.roleId) : null;
      const isActive =
        req.query.isActive === undefined
          ? null
          : req.query.isActive === "true"
            ? 1
            : req.query.isActive === "false"
              ? 0
              : null;

      const filters = [];
      const params = [];
      if (Number.isInteger(roleId)) {
        filters.push("u.role_id = ?");
        params.push(roleId);
      }
      if (isActive !== null) {
        filters.push("u.is_active = ?");
        params.push(isActive);
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const users = await all(
        `
        SELECT
          u.id,
          u.public_id,
          u.first_name,
          u.last_name,
          u.username,
          u.role_id,
          u.is_active,
          u.created_at,
          u.updated_at,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        ${where}
        ORDER BY u.public_id ASC, u.id ASC
      `,
        params,
      );
      res.status(200).json({ data: users });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${API_PREFIX}/users`, usersWrite, async (req, res, next) => {
    try {
      const {
        firstName,
        lastName,
        username,
        passwordHash = null,
        roleId,
        isActive = true,
      } = req.body ?? {};

      if (!firstName || !lastName || !username || !roleId) {
        res.status(400).json({
          error: "Fields 'firstName', 'lastName', 'username', and 'roleId' are required.",
        });
        return;
      }

      const role = await get("SELECT id, name FROM roles WHERE id = ?", [Number(roleId)]);
      if (!role) {
        res.status(400).json({ error: "Invalid role id." });
        return;
      }
      if (role.name === "ADMIN") {
        const existingAdmin = await all(
          `
          SELECT id
          FROM users
          WHERE role_id = ?
          LIMIT 1
        `,
          [role.id],
        );
        if (existingAdmin.length > 0) {
          res.status(409).json({ error: "Only one admin account is allowed." });
          return;
        }
      }

      const newPasswordHash = passwordHash ? await hashPassword(passwordHash) : null;
      const publicId = await allocateUserPublicId(get);
      const result = await run(
        `
        INSERT INTO users (
          public_id, first_name, last_name, username, password_hash, role_id, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        [
          publicId,
          String(firstName).trim(),
          String(lastName).trim(),
          String(username).trim(),
          newPasswordHash,
          Number(roleId),
          isActive ? 1 : 0,
        ],
      );

      const created = await get(
        `
        SELECT
          u.id,
          u.public_id,
          u.first_name,
          u.last_name,
          u.username,
          u.role_id,
          u.is_active,
          u.created_at,
          u.updated_at,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
      `,
        [result.id],
      );
      res.status(201).json({ data: created });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/users/:userId`, usersRead, async (req, res, next) => {
    try {
      const userId = await resolveUserDbId(get, req.params.userId);
      if (userId == null) {
        res.status(400).json({ error: "Invalid user id." });
        return;
      }
      const user = await get(
        `
        SELECT
          u.id,
          u.public_id,
          u.first_name,
          u.last_name,
          u.username,
          u.role_id,
          u.is_active,
          u.created_at,
          u.updated_at,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
      `,
        [userId],
      );
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      const authorities = await all(
        `
        SELECT a.id, a.code, a.description
        FROM users u
        JOIN role_authorities ra ON ra.role_id = u.role_id
        JOIN authorities a ON a.id = ra.authority_id
        WHERE u.id = ?
        ORDER BY a.id ASC
      `,
        [userId],
      );
      res.status(200).json({ data: { ...user, authorities } });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${API_PREFIX}/users/:userId`, usersWrite, async (req, res, next) => {
    try {
      const userId = await resolveUserDbId(get, req.params.userId);
      if (userId == null) {
        res.status(400).json({ error: "Invalid user id." });
        return;
      }
      const current = await get("SELECT * FROM users WHERE id = ?", [userId]);
      if (!current) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      const nextRoleId =
        req.body?.roleId === undefined ? current.role_id : Number(req.body.roleId);
      if (!Number.isInteger(nextRoleId)) {
        res.status(400).json({ error: "Invalid role id." });
        return;
      }
      const role = await get("SELECT id FROM roles WHERE id = ?", [nextRoleId]);
      if (!role) {
        res.status(400).json({ error: "Role not found." });
        return;
      }
      const adminRoleId = await getAdminRoleId();
      if (adminRoleId && nextRoleId === adminRoleId && current.role_id !== adminRoleId) {
        const existingAdmin = await all(
          `
          SELECT id
          FROM users
          WHERE role_id = ?
          LIMIT 1
        `,
          [adminRoleId],
        );
        if (existingAdmin.length > 0) {
          res.status(409).json({ error: "Only one admin account is allowed." });
          return;
        }
      }

      await run(
        `
        UPDATE users
        SET
          first_name = ?,
          last_name = ?,
          username = ?,
          password_hash = ?,
          role_id = ?,
          is_active = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [
          req.body?.firstName === undefined
            ? current.first_name
            : String(req.body.firstName).trim(),
          req.body?.lastName === undefined
            ? current.last_name
            : String(req.body.lastName).trim(),
          req.body?.username === undefined
            ? current.username
            : String(req.body.username).trim(),
          req.body?.passwordHash === undefined
            ? current.password_hash
            : req.body.passwordHash
              ? await hashPassword(req.body.passwordHash)
              : null,
          nextRoleId,
          req.body?.isActive === undefined ? current.is_active : req.body.isActive ? 1 : 0,
          userId,
        ],
      );

      const updated = await get(
        `
        SELECT
          u.id,
          u.public_id,
          u.first_name,
          u.last_name,
          u.username,
          u.role_id,
          u.is_active,
          u.created_at,
          u.updated_at,
          r.name AS role_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
      `,
        [userId],
      );
      res.status(200).json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${API_PREFIX}/users/:userId`, usersWrite, async (req, res, next) => {
    try {
      const userId = await resolveUserDbId(get, req.params.userId);
      if (userId == null) {
        res.status(400).json({ error: "Invalid user id." });
        return;
      }
      const adminRoleId = await getAdminRoleId();
      if (adminRoleId) {
        const targetUser = await get("SELECT role_id FROM users WHERE id = ?", [userId]);
        if (targetUser?.role_id === adminRoleId) {
          res.status(403).json({ error: "Admin account cannot be deleted." });
          return;
        }
      }
      const result = await run("DELETE FROM users WHERE id = ?", [userId]);
      if (!result.changes) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  mountPatientRoutes(app, API_PREFIX);
  mountScheduleSlotsRoutes(app, API_PREFIX);
  mountAppointmentRoutes(app, API_PREFIX);
  mountOcrRoutes(app, API_PREFIX);
  mountDoseRoutes(app, API_PREFIX);
  mountQueueTicketsRoutes(app, API_PREFIX);
  mountInventoryRoutes(app, API_PREFIX);
  mountPatientAuthRoutes(app, API_PREFIX);
  mountFilesRoutes(app, API_PREFIX);
  mountNotificationsRoutes(app, API_PREFIX);
  mountDashboardRoutes(app, API_PREFIX);

  app.use((error, req, res, _next) => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error(
        `[anivax/error] ${req.method} ${req.path}: ${error?.message ?? error}`,
      );
    }
    if (String(error?.message ?? "").includes("UNIQUE constraint failed")) {
      res.status(409).json({
        error: "Conflict: a record with the same unique value already exists.",
        details: error.message,
      });
      return;
    }
    if (String(error?.message ?? "").includes("FOREIGN KEY constraint failed")) {
      res.status(409).json({
        error: "Conflict: this record is still referenced by another resource.",
        details:
          process.env.NODE_ENV === "production" ? undefined : error?.message,
      });
      return;
    }
    res.status(500).json({
      error: "Internal server error.",
      details: process.env.NODE_ENV === "production" ? undefined : error?.message,
    });
  });

  return app;
}
