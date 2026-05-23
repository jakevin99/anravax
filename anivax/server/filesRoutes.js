/**
 * File upload / download routes.
 *
 *   POST /api/v1/files                       (patient or staff) — multipart `file`, `kind`
 *   GET  /api/v1/files/me                    (patient) — list own files
 *   GET  /api/v1/files/:id                   (patient or staff) — auth-checked stream
 *
 * Storage: local disk under `FILES_DIR` (default `server/data/uploads`).
 * Path layout: `<yyyy>/<mm>/<id>-<sanitized name>`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";

import { all, get, run } from "./db.js";
import { requireAuth } from "./middleware/auth.js";

const FILES_DIR = path.resolve(
  process.cwd(),
  process.env.FILES_DIR ?? "server/data/uploads",
);
fs.mkdirSync(FILES_DIR, { recursive: true });

const ALLOWED_KINDS = new Set([
  "ID_CARD",
  "PROFILE_PHOTO",
  "ANIMAL_PHOTO",
  "VACCINE_CARD",
  "CONSULT_PDF",
  "OTHER",
]);

const MAX_BYTES = Number.parseInt(process.env.FILES_MAX_BYTES ?? "", 10) || 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

const anyAuth = requireAuth({ actorKinds: ["staff", "patient"] });
const patientOnly = requireAuth({ actorKinds: ["patient"] });

function sanitizeFileName(name) {
  return String(name ?? "upload")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-80);
}

function formatYyyyMm() {
  const d = new Date();
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return [String(d.getFullYear()), pad(d.getMonth() + 1)];
}

export function mountFilesRoutes(app, API_PREFIX) {
  app.post(
    `${API_PREFIX}/files`,
    anyAuth,
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (!req.file?.buffer) {
          res.status(400).json({ error: "Missing file. Send multipart 'file'." });
          return;
        }
        const kind = String(req.body?.kind ?? "OTHER").toUpperCase();
        if (!ALLOWED_KINDS.has(kind)) {
          res.status(400).json({
            error: `Invalid kind. Allowed: ${[...ALLOWED_KINDS].join(", ")}`,
          });
          return;
        }
        const ownerPatientId =
          req.actor?.kind === "patient"
            ? String(req.actor.id)
            : req.body?.ownerPatientId
              ? String(req.body.ownerPatientId)
              : null;

        const sha256 = crypto
          .createHash("sha256")
          .update(req.file.buffer)
          .digest("hex");
        const safeName = sanitizeFileName(req.file.originalname);
        const [yyyy, mm] = formatYyyyMm();
        const dir = path.join(FILES_DIR, yyyy, mm);
        fs.mkdirSync(dir, { recursive: true });

        const insertResult = await run(
          `
          INSERT INTO files (
            owner_patient_id, kind, mime, bytes, sha256, path, uploaded_by_actor
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          [
            ownerPatientId,
            kind,
            req.file.mimetype || "application/octet-stream",
            req.file.size,
            sha256,
            "", // path filled in below once we know the id
            `${req.actor?.kind ?? "unknown"}:${req.actor?.id ?? "—"}`,
          ],
        );
        const fileId = insertResult.id;
        const onDisk = path.join(dir, `${fileId}-${safeName}`);
        fs.writeFileSync(onDisk, req.file.buffer);
        await run(`UPDATE files SET path = ? WHERE id = ?`, [
          path.relative(FILES_DIR, onDisk).replace(/\\/g, "/"),
          fileId,
        ]);

        const row = await get(
          `SELECT id, owner_patient_id, kind, mime, bytes, sha256, created_at FROM files WHERE id = ?`,
          [fileId],
        );
        res.status(201).json({ data: row });
      } catch (error) {
        if (error?.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({
            error: `File too large. Max ${MAX_BYTES} bytes.`,
          });
          return;
        }
        next(error);
      }
    },
  );

  app.get(`${API_PREFIX}/files/me`, patientOnly, async (req, res, next) => {
    try {
      const rows = await all(
        `
        SELECT id, kind, mime, bytes, created_at
        FROM files
        WHERE owner_patient_id = ?
        ORDER BY id DESC
      `,
        [String(req.actor.id)],
      );
      res.status(200).json({
        data: {
          items: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            mime: r.mime,
            bytes: r.bytes,
            createdAt: r.created_at,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${API_PREFIX}/files/:id`, anyAuth, async (req, res, next) => {
    try {
      const fileId = Number(req.params.id);
      if (!Number.isInteger(fileId)) {
        res.status(400).json({ error: "Invalid file id." });
        return;
      }
      const row = await get(`SELECT * FROM files WHERE id = ?`, [fileId]);
      if (!row) {
        res.status(404).json({ error: "File not found." });
        return;
      }
      if (req.actor.kind === "patient" && row.owner_patient_id !== req.actor.id) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      const onDisk = path.join(FILES_DIR, row.path);
      if (!fs.existsSync(onDisk)) {
        res.status(410).json({ error: "File missing on disk." });
        return;
      }
      res.setHeader("Content-Type", row.mime);
      res.setHeader("Content-Length", String(row.bytes));
      fs.createReadStream(onDisk).pipe(res);
    } catch (error) {
      next(error);
    }
  });
}
