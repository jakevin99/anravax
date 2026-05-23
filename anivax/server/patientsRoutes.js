/**
 * Patient registry and demographics (SQLite).
 */

import { all, get, run } from "./db.js";
import {
  allocatePatientId,
  isPatientId,
} from "./services/entityIds.js";
import { requireAuth } from "./middleware/auth.js";
import {
  ACTIVE_PATIENT_WHERE,
  listRecyclePatients,
  permanentlyDeleteRecycledPatient,
  PATIENT_RECYCLE_RETENTION_DAYS,
  restorePatient,
  softDeletePatient,
} from "./services/patientRecycle.js";
import { excludeScheduleAnchorPatient } from "./services/scheduleAnchor.js";
import {
  findPatientByIdentity,
  listPatientsByIdentity,
} from "./services/patientIdentity.js";

const staffRead = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_READ" });
const staffWrite = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_WRITE" });
const usersWrite = requireAuth({ actorKinds: ["staff"], authority: "USERS_WRITE" });
const patientOnly = requireAuth({ actorKinds: ["patient"] });

function normalizeSuffix(raw) {
  const s = raw != null ? String(raw).trim() : "";
  return s || "NONE";
}

function computeAgeYears(birthDateStr) {
  const d = new Date(String(birthDateStr).trim() + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/**
 * Registry name filters — aligned with Records page search:
 * - Last name only (Records bar or new-consultation LAST NAME alone): partial match on
 *   last, first, middle, or registration number (OR).
 * - Multiple name fields: each non-empty field must match its column (AND).
 */
function appendPatientRegistryNameFilters(where, params, { lastName, firstName, middleName }) {
  const last = lastName ? String(lastName).trim() : "";
  const first = firstName ? String(firstName).trim() : "";
  const middle = middleName ? String(middleName).trim() : "";

  if (last && !first && !middle) {
    const like = `%${last.toLowerCase()}%`;
    where.push(
      `(lower(p.last_name) LIKE ? OR lower(p.first_name) LIKE ? OR lower(COALESCE(p.middle_name, '')) LIKE ? OR lower(COALESCE(p.registration_no, '')) LIKE ?)`,
    );
    params.push(like, like, like, like);
    return;
  }

  if (last) {
    where.push("lower(p.last_name) LIKE ?");
    params.push(`%${last.toLowerCase()}%`);
  }
  if (first) {
    where.push("lower(p.first_name) LIKE ?");
    params.push(`%${first.toLowerCase()}%`);
  }
  if (middle) {
    where.push("lower(COALESCE(p.middle_name, '')) LIKE ?");
    params.push(`%${middle.toLowerCase()}%`);
  }
}

/** @param {string | undefined} sortParam */
function patientRegistryOrderBy(sortParam) {
  const s = String(sortParam ?? "").trim().toLowerCase();
  switch (s) {
    case "recent":
    case "registered_desc":
      return `ORDER BY datetime(COALESCE(p.registered_at, p.created_at, p.updated_at)) DESC, p.last_name ASC, p.first_name ASC`;
    case "registered_asc":
      return `ORDER BY datetime(COALESCE(p.registered_at, p.created_at, p.updated_at)) ASC, p.last_name ASC, p.first_name ASC`;
    case "name_desc":
    case "last_name_desc":
      return `ORDER BY p.last_name DESC, p.first_name DESC`;
    case "registration_asc":
      return `ORDER BY COALESCE(p.registration_no, '') ASC, p.last_name ASC, p.first_name ASC`;
    case "registration_desc":
      return `ORDER BY COALESCE(p.registration_no, '') DESC, p.last_name ASC, p.first_name ASC`;
    case "name":
    case "last_name_asc":
    default:
      return `ORDER BY p.last_name ASC, p.first_name ASC`;
  }
}

/**
 * @param {import("express").Express} app
 * @param {string} API_PREFIX e.g. "/api/v1"
 */
export function mountPatientRoutes(app, API_PREFIX) {
  const base = `${API_PREFIX}/patients`;

  /** Recycle bin collection (register before /:patientId routes). */
  app.get(`${base}/recycle`, usersWrite, async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
      const q = req.query.q ? String(req.query.q).trim() : "";
      const data = await listRecyclePatients({ page, pageSize, q });
      res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/recycle/:patientId`, usersWrite, async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId ?? "").trim();
      if (!patientId) {
        res.status(400).json({ error: "Patient id is required." });
        return;
      }
      const deleted = await permanentlyDeleteRecycledPatient(patientId);
      if (!deleted) {
        res.status(404).json({ error: "Patient not found." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      if (error?.code === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error?.code === "NOT_IN_RECYCLE") {
        res.status(409).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  /**
   * Identity lookup for create-profile duplicate prevention.
   * GET /api/v1/patients/matches?first_name=&last_name=&birth_date=&exclude_patient_id=
   */
  app.get(`${base}/matches`, staffRead, async (req, res, next) => {
    try {
      const firstName = req.query.first_name ? String(req.query.first_name).trim() : "";
      const lastName = req.query.last_name ? String(req.query.last_name).trim() : "";
      const birthDate = req.query.birth_date ? String(req.query.birth_date).trim() : "";
      const excludePatientId = req.query.exclude_patient_id
        ? String(req.query.exclude_patient_id).trim()
        : "";

      if (!firstName || !lastName || !birthDate) {
        res.status(400).json({
          error: "Query parameters 'first_name', 'last_name', and 'birth_date' are required.",
        });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        res.status(400).json({ error: "Query 'birth_date' must be YYYY-MM-DD." });
        return;
      }

      const rows = await listPatientsByIdentity({
        firstName,
        lastName,
        birthDate,
        excludePatientId: excludePatientId || null,
      });

      res.status(200).json({
        data: {
          matches: rows.map((row) => mapPatientRow(row)),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /** Create-profile payload for Retrieve record (register before /patients list routes). */
  const loadPatientCreateRecord = async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId ?? "").trim();
      if (!patientId) {
        res.status(400).json({ error: "Patient id is required." });
        return;
      }
      const row = await get(`SELECT * FROM patients WHERE id = ?`, [patientId]);
      if (!row) {
        res.status(404).json({ error: "Patient not found." });
        return;
      }
      res.status(200).json({
        data: {
          patientId: row.id,
          record: buildCreateRecordFromRow(row),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  app.get(`${base}/:patientId/record`, staffRead, loadPatientCreateRecord);
  app.get(`${API_PREFIX}/patient-records/:patientId`, staffRead, loadPatientCreateRecord);

  /** Paginated consultation list for the records History action. */
  app.get(`${base}/:patientId/consultation-history`, staffRead, async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId ?? "").trim();
      if (!patientId) {
        res.status(400).json({ error: "Patient id is required." });
        return;
      }
      const patientRow = await get(`SELECT * FROM patients WHERE id = ?`, [patientId]);
      if (!patientRow) {
        res.status(404).json({ error: "Patient not found." });
        return;
      }

      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 8));
      const offset = (page - 1) * pageSize;

      const countRow = await get(
        `SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ?`,
        [patientId],
      );
      const totalItems = countRow?.n ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const rows = await all(
        `
        SELECT
          a.id AS a_id,
          a.scheduled_at,
          a.status,
          u.id AS u_id,
          u.first_name AS u_first_name,
          u.last_name AS u_last_name,
          r.name AS role_name
        FROM appointments a
        JOIN users u ON u.id = a.attendant_user_id
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE a.patient_id = ?
        ORDER BY datetime(a.scheduled_at) DESC
        LIMIT ? OFFSET ?
      `,
        [patientId, pageSize, offset],
      );

      const items = rows.map((r) => ({
        appointmentId: r.a_id,
        scheduledAt: r.scheduled_at,
        consultationStatus:
          String(r.status ?? "").trim().toUpperCase() === "COMPLETED" ? "COMPLETED" : "INCOMPLETE",
        attendant: {
          id: `user-${r.u_id}`,
          firstName: r.u_first_name,
          lastName: r.u_last_name,
          credential: mapStaffRoleCredential(r.role_name),
        },
      }));

      res.status(200).json({
        data: {
          patient: mapPatientRow(patientRow),
          items,
          page,
          pageSize,
          totalItems,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Paginated registry: one row per patient with the latest appointment id for RETRIEVE.
   */
  app.get(`${API_PREFIX}/patient-registry`, staffRead, async (req, res, next) => {
    try {
      const patientId = req.query.patient_id ? String(req.query.patient_id).trim() : "";
      const lastName = req.query.last_name ? String(req.query.last_name).trim() : "";
      const firstName = req.query.first_name ? String(req.query.first_name).trim() : "";
      const middleName = req.query.middle_name ? String(req.query.middle_name).trim() : "";
      const date = req.query.date ? String(req.query.date).trim() : "";
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 8));
      const offset = (page - 1) * pageSize;

      const where = [ACTIVE_PATIENT_WHERE.replace(/deleted_at/g, "p.deleted_at")];
      const params = [];
      excludeScheduleAnchorPatient(where, params);
      if (patientId) {
        where.push("p.id = ?");
        params.push(patientId);
      }
      appendPatientRegistryNameFilters(where, params, { lastName, firstName, middleName });
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        where.push("p.registered_at = ?");
        params.push(date);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const filterClause = whereSql;

      const sort = patientRegistryOrderBy(req.query.sort);

      const countRow = await get(
        `
        SELECT COUNT(*) AS n
        FROM patients p
        ${filterClause}
      `,
        params,
      );
      const totalItems = countRow?.n ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const rows = await all(
        `
        SELECT
          p.id AS p_id,
          p.first_name AS p_first_name,
          p.middle_name AS p_middle_name,
          p.last_name AS p_last_name,
          p.suffix AS p_suffix,
          p.birth_date AS p_birth_date,
          p.sex AS p_sex,
          p.age_years AS p_age_years,
          p.address AS p_address,
          p.contact_number AS p_contact_number,
          p.blood_type AS p_blood_type,
          p.registration_no AS p_registration_no,
          p.registered_at AS p_registered_at,
          p.profile_json AS p_profile_json,
          (
            SELECT a2.id FROM appointments a2
            WHERE a2.patient_id = p.id
            ORDER BY datetime(a2.scheduled_at) DESC
            LIMIT 1
          ) AS appointment_id
        FROM patients p
        ${filterClause}
        ${sort}
        LIMIT ? OFFSET ?
      `,
        [...params, pageSize, offset],
      );

      const items = rows.map((r) => {
        const row = {
          id: r.p_id,
          first_name: r.p_first_name,
          middle_name: r.p_middle_name,
          last_name: r.p_last_name,
          suffix: r.p_suffix,
          birth_date: r.p_birth_date,
          sex: r.p_sex,
          age_years: r.p_age_years,
          address: r.p_address,
          contact_number: r.p_contact_number,
          blood_type: r.p_blood_type,
          registration_no: r.p_registration_no,
          registered_at: r.p_registered_at,
          profile_json: r.p_profile_json,
        };
        return {
          patient: {
            id: r.p_id,
            firstName: r.p_first_name,
            middleName: r.p_middle_name || undefined,
            lastName: r.p_last_name,
            suffix: r.p_suffix,
            birthDate: r.p_birth_date,
            sex: r.p_sex,
            ageYears: r.p_age_years,
            address: r.p_address,
            contactNumber: r.p_contact_number,
            bloodType: r.p_blood_type,
            registrationNo: r.p_registration_no,
            registeredAt: r.p_registered_at,
          },
          appointmentId: r.appointment_id,
          createRecord: buildCreateRecordFromRow(row),
        };
      });

      res.status(200).json({
        data: {
          items,
          page,
          pageSize,
          totalItems,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /** Admin / list: all patients with optional name or id search. */
  app.get(base, staffRead, async (req, res, next) => {
    try {
      const q = req.query.q ? String(req.query.q).trim().toLowerCase() : "";
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50));
      const offset = (page - 1) * pageSize;

      const where = [ACTIVE_PATIENT_WHERE.replace(/deleted_at/g, "p.deleted_at")];
      const params = [];
      excludeScheduleAnchorPatient(where, params);
      if (q) {
        where.push(
          `(lower(p.id) LIKE ? OR lower(p.last_name) LIKE ? OR lower(p.first_name) LIKE ? OR lower(COALESCE(p.middle_name,'')) LIKE ?)`,
        );
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;

      const countRow = await get(
        `SELECT COUNT(*) AS n FROM patients p ${whereSql}`,
        params,
      );
      const totalItems = countRow?.n ?? 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      const rows = await all(
        `
        SELECT
          p.id,
          p.first_name,
          p.middle_name,
          p.last_name,
          p.suffix,
          p.birth_date,
          p.sex,
          p.age_years,
          p.registered_at,
          p.created_at
        FROM patients p
        ${whereSql}
        ORDER BY datetime(COALESCE(p.created_at, p.registered_at)) DESC
        LIMIT ? OFFSET ?
      `,
        [...params, pageSize, offset],
      );

      res.status(200).json({
        data: {
          items: rows,
          page,
          pageSize,
          totalItems,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(base, staffWrite, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const firstName = body.firstName != null ? String(body.firstName).trim() : "";
      const lastName = body.lastName != null ? String(body.lastName).trim() : "";
      const birthDate = body.birthDate != null ? String(body.birthDate).trim() : "";
      const sexRaw = body.sex != null ? String(body.sex).trim().toUpperCase() : "";
      const sex = sexRaw === "M" || sexRaw === "MALE" ? "M" : "F";
      if (!firstName || !lastName || !birthDate) {
        res.status(400).json({ error: "Fields 'firstName', 'lastName', and 'birthDate' are required." });
        return;
      }

      const duplicate = await findPatientByIdentity({ firstName, lastName, birthDate });
      if (duplicate) {
        res.status(409).json({
          error: "A patient with this name and date of birth already exists.",
          data: {
            existingPatientId: duplicate.id,
            patient: mapPatientRow(duplicate),
          },
        });
        return;
      }

      let patientId =
        body.id && String(body.id).trim() ? String(body.id).trim() : null;
      if (patientId && !isPatientId(patientId)) {
        res.status(400).json({
          error: "Patient id must match p_ followed by 12 alphanumeric characters.",
        });
        return;
      }
      if (!patientId) {
        patientId = await allocatePatientId(get);
      }
      const middleName =
        body.middleName != null && String(body.middleName).trim()
          ? String(body.middleName).trim()
          : null;
      const suffix = normalizeSuffix(body.suffix);
      const ageYears =
        body.ageYears != null && Number.isFinite(Number(body.ageYears))
          ? Math.trunc(Number(body.ageYears))
          : computeAgeYears(birthDate) ?? 0;
      const address = body.address != null ? String(body.address).trim() || null : null;
      const contactNumber =
        body.contactNumber != null ? String(body.contactNumber).trim() || null : null;
      const bloodType = body.bloodType != null ? String(body.bloodType).trim() || null : null;
      const registrationNo =
        body.registrationNo != null ? String(body.registrationNo).trim() || null : null;
      const registeredAt =
        body.registeredAt != null && /^\d{4}-\d{2}-\d{2}$/.test(String(body.registeredAt).trim())
          ? String(body.registeredAt).trim()
          : new Date().toISOString().slice(0, 10);

      await run(
        `
        INSERT INTO patients (
          id, first_name, middle_name, last_name, suffix, birth_date, sex, age_years,
          address, contact_number, blood_type, registration_no, registered_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          patientId,
          firstName,
          middleName,
          lastName,
          suffix,
          birthDate,
          sex,
          ageYears,
          address,
          contactNumber,
          bloodType,
          registrationNo,
          registeredAt,
        ],
      );

      const profileJson = serializeProfileJson(body.profile);
      if (profileJson) {
        await run(`UPDATE patients SET profile_json = ?, updated_at = datetime('now') WHERE id = ?`, [
          profileJson,
          patientId,
        ]);
      }

      const created = await get(`SELECT * FROM patients WHERE id = ?`, [patientId]);
      res.status(201).json({ data: mapPatientRow(created) });
    } catch (error) {
      next(error);
    }
  });

  app.put(`${base}/:patientId`, staffWrite, async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId ?? "").trim();
      if (!patientId) {
        res.status(400).json({ error: "Patient id is required." });
        return;
      }
      const existing = await get(`SELECT * FROM patients WHERE id = ?`, [patientId]);
      if (!existing) {
        res.status(404).json({ error: "Patient not found." });
        return;
      }

      const body = req.body ?? {};
      const firstName =
        body.firstName != null ? String(body.firstName).trim() : existing.first_name;
      const lastName = body.lastName != null ? String(body.lastName).trim() : existing.last_name;
      const birthDate =
        body.birthDate != null ? String(body.birthDate).trim() : existing.birth_date;
      const sexRaw = body.sex != null ? String(body.sex).trim().toUpperCase() : existing.sex;
      const sex = sexRaw === "M" || sexRaw === "MALE" ? "M" : "F";
      if (!firstName || !lastName || !birthDate) {
        res.status(400).json({ error: "Fields 'firstName', 'lastName', and 'birthDate' are required." });
        return;
      }

      const identityConflict = await findPatientByIdentity({
        firstName,
        lastName,
        birthDate,
        excludePatientId: patientId,
      });
      if (identityConflict) {
        res.status(409).json({
          error: "Another patient already has this name and date of birth.",
          data: {
            existingPatientId: identityConflict.id,
            patient: mapPatientRow(identityConflict),
          },
        });
        return;
      }

      const middleName =
        body.middleName != null
          ? body.middleName && String(body.middleName).trim()
            ? String(body.middleName).trim()
            : null
          : existing.middle_name;
      const suffix = body.suffix != null ? normalizeSuffix(body.suffix) : existing.suffix;
      const ageYears =
        body.ageYears != null && Number.isFinite(Number(body.ageYears))
          ? Math.trunc(Number(body.ageYears))
          : computeAgeYears(birthDate) ?? existing.age_years;
      const address =
        body.address != null ? String(body.address).trim() || null : existing.address;
      const contactNumber =
        body.contactNumber != null
          ? String(body.contactNumber).trim() || null
          : existing.contact_number;
      const bloodType =
        body.bloodType != null ? String(body.bloodType).trim() || null : existing.blood_type;
      const registrationNo =
        body.registrationNo != null
          ? String(body.registrationNo).trim() || null
          : existing.registration_no;

      const profileJson =
        body.profile != null
          ? serializeProfileJson(mergeProfileForSave(existing.profile_json, body.profile))
          : existing.profile_json;

      await run(
        `
        UPDATE patients SET
          first_name = ?,
          middle_name = ?,
          last_name = ?,
          suffix = ?,
          birth_date = ?,
          sex = ?,
          age_years = ?,
          address = ?,
          contact_number = ?,
          blood_type = ?,
          registration_no = ?,
          profile_json = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `,
        [
          firstName,
          middleName,
          lastName,
          suffix,
          birthDate,
          sex,
          ageYears,
          address,
          contactNumber,
          bloodType,
          registrationNo,
          profileJson,
          patientId,
        ],
      );

      const updated = await get(`SELECT * FROM patients WHERE id = ?`, [patientId]);
      res.status(200).json({ data: mapPatientRow(updated) });
    } catch (error) {
      next(error);
    }
  });

  /** Move patient to recycle bin (soft delete; permanent purge after retention period). */
  app.delete(`${base}/:patientId`, usersWrite, async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId ?? "").trim();
      if (!patientId) {
        res.status(400).json({ error: "Patient id is required." });
        return;
      }
      const recycled = await softDeletePatient(patientId);
      res.status(200).json({ data: recycled });
    } catch (error) {
      if (error?.code === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error?.code === "ALREADY_RECYCLED") {
        res.status(409).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post(`${base}/:patientId/restore`, usersWrite, async (req, res, next) => {
    try {
      const patientId = String(req.params.patientId ?? "").trim();
      if (!patientId) {
        res.status(400).json({ error: "Patient id is required." });
        return;
      }
      const row = await restorePatient(patientId);
      res.status(200).json({ data: mapPatientRow(row) });
    } catch (error) {
      if (error?.code === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error?.code === "NOT_IN_RECYCLE") {
        res.status(409).json({ error: error.message });
        return;
      }
      next(error);
    }
  });
}

const DEFAULT_PH_ADDRESS = {
  regionCode: "0300000000",
  region: "Region III",
  provinceCode: "0300800000",
  province: "Bataan",
  municipalityCode: "0300808000",
  city: "Morong",
  barangayCode: "0300808005",
  barangay: "Sabang",
  zip: "",
};

function emptyUploadsRecord() {
  return {
    idType: "",
    files: [],
  };
}

function uploadSideHasData(side) {
  return Boolean(side && (String(side.fileName ?? "").trim() || side.fileId));
}

function normalizeUploadsToFiles(raw) {
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw.files)) {
    return raw.files
      .filter((f) => uploadSideHasData(f))
      .map((f) => ({
        fileName: f.fileName ?? "",
        fileId: f.fileId ?? null,
      }));
  }
  const files = [];
  if (uploadSideHasData(raw.front)) {
    files.push({
      fileName: raw.front.fileName ?? "",
      fileId: raw.front.fileId ?? null,
    });
  }
  if (uploadSideHasData(raw.back)) {
    files.push({
      fileName: raw.back.fileName ?? "",
      fileId: raw.back.fileId ?? null,
    });
  }
  if (files.length === 0 && (raw.fileName || raw.fileId)) {
    files.push({
      fileName: raw.fileName ?? "",
      fileId: raw.fileId ?? null,
    });
  }
  return files;
}

function emptyPhotoRecord() {
  return { fileName: "", fileId: null };
}

function normalizePhotoFromParsed(raw) {
  if (!raw || typeof raw !== "object") {
    return emptyPhotoRecord();
  }
  return {
    fileName: raw.fileName ?? "",
    fileId: raw.fileId ?? null,
  };
}

function normalizeUploadsFromParsed(raw) {
  if (!raw || typeof raw !== "object") {
    return emptyUploadsRecord();
  }
  return {
    idType: raw.idType ?? "",
    files: normalizeUploadsToFiles(raw),
  };
}

function emptyGuardianRecord() {
  return {
    lastName: "",
    firstName: "",
    middleName: "",
    suffix: "",
    noMiddleName: false,
    birthDate: "",
    ageYears: "",
    sex: "FEMALE",
    relationship: "MOTHER",
    mobile: "",
    email: "",
    placeOfBirth: "",
    similarAddress: false,
    street: "",
    ...DEFAULT_PH_ADDRESS,
  };
}

function serializeProfileJson(profile) {
  if (profile == null) return null;
  try {
    return JSON.stringify(profile);
  } catch {
    return null;
  }
}

/** Do not let empty strings in saved JSON wipe column-backed defaults on load. */
function mergeFormFields(defaults, parsed) {
  const out = { ...defaults };
  if (!parsed || typeof parsed !== "object") return out;
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

function mergeUploadSide(existing, incoming) {
  const ex = existing && typeof existing === "object" ? existing : {};
  const inc = incoming && typeof incoming === "object" ? incoming : {};
  const fileId =
    inc.fileId != null && inc.fileId !== ""
      ? inc.fileId
      : ex.fileId != null && ex.fileId !== ""
        ? ex.fileId
        : null;
  return {
    fileName: (inc.fileName && String(inc.fileName).trim()) || ex.fileName || "",
    fileId,
  };
}

function mergeUploadsForSave(existing, incoming) {
  if (!incoming || typeof incoming !== "object") {
    const ex = existing && typeof existing === "object" ? existing : {};
    return {
      idType: ex.idType ?? "",
      files: normalizeUploadsToFiles(ex),
    };
  }
  const ex = existing && typeof existing === "object" ? existing : {};
  const idType =
    (incoming.idType && String(incoming.idType).trim()) || ex.idType || "";
  if (Array.isArray(incoming.files)) {
    return { idType, files: normalizeUploadsToFiles(incoming) };
  }
  const incomingFiles = normalizeUploadsToFiles(incoming);
  if (incomingFiles.length > 0) {
    return { idType, files: incomingFiles };
  }
  return { idType, files: normalizeUploadsToFiles(ex) };
}

function mergePhotoForSave(existing, incoming) {
  if (!incoming || typeof incoming !== "object") {
    return existing && typeof existing === "object" ? existing : emptyPhotoRecord();
  }
  const ex = existing && typeof existing === "object" ? existing : {};
  const fileId =
    incoming.fileId != null && incoming.fileId !== ""
      ? incoming.fileId
      : ex.fileId != null && ex.fileId !== ""
        ? ex.fileId
        : null;
  return {
    fileName: (incoming.fileName && String(incoming.fileName).trim()) || ex.fileName || "",
    fileId,
  };
}

function mergeProfileForSave(existingProfileJson, incomingProfile) {
  if (!incomingProfile || typeof incomingProfile !== "object") {
    return existingProfileJson;
  }
  let existing = {};
  if (existingProfileJson) {
    try {
      const parsed = JSON.parse(String(existingProfileJson));
      if (parsed && typeof parsed === "object") existing = parsed;
    } catch {
      /* ignore */
    }
  }
  return {
    form: mergeFormFields(
      { ...(existing.form ?? {}) },
      incomingProfile.form ?? {},
    ),
    guardian: {
      ...emptyGuardianRecord(),
      ...(existing.guardian ?? {}),
      ...(incomingProfile.guardian ?? {}),
    },
    uploads: mergeUploadsForSave(existing.uploads, incomingProfile.uploads),
    photo: mergePhotoForSave(existing.photo, incomingProfile.photo),
  };
}

function buildCreateRecordFromRow(row) {
  if (row.profile_json) {
    try {
      const parsed = JSON.parse(String(row.profile_json));
      if (parsed && typeof parsed === "object" && parsed.form) {
        return {
          form: mergeFormFields(defaultFormFromRow(row), parsed.form),
          guardian: { ...emptyGuardianRecord(), ...(parsed.guardian ?? {}) },
          uploads: normalizeUploadsFromParsed(parsed.uploads),
          photo: normalizePhotoFromParsed(parsed.photo),
        };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    form: defaultFormFromRow(row),
    guardian: emptyGuardianRecord(),
    uploads: emptyUploadsRecord(),
    photo: emptyPhotoRecord(),
  };
}

function defaultFormFromRow(row) {
  const suffix = row.suffix && row.suffix !== "NONE" ? row.suffix : "";
  const middle = row.middle_name ? String(row.middle_name) : "";
  return {
    philhealthNo: "",
    lastName: row.last_name ?? "",
    firstName: row.first_name ?? "",
    middleName: middle,
    suffix,
    noMiddleName: !middle,
    birthDate: row.birth_date ?? "",
    ageYears: row.age_years != null ? String(row.age_years) : "",
    sex: row.sex === "M" ? "MALE" : "FEMALE",
    civilStatus: "SINGLE",
    placeOfBirth: "",
    bloodType: row.blood_type ?? "A+",
    mobile: row.contact_number ?? "",
    email: "",
    religion: "",
    scPwdId: "",
    telephone: "",
    street: row.address ?? "",
    registrationNo: row.registration_no ?? "",
    ...DEFAULT_PH_ADDRESS,
  };
}

function mapStaffRoleCredential(roleName) {
  const r = String(roleName ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!r) return "RN";
  if (r.includes("NURSE")) return "RN";
  if (r.includes("DOCTOR") || r === "PHYSICIAN") return "MD";
  if (r === "ADMIN") return "ADMIN";
  return r.length <= 6 ? r : r.split(" ")[0];
}

function mapPatientRow(row) {
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
    contactNumber: row.contact_number,
    bloodType: row.blood_type,
    registrationNo: row.registration_no,
    registeredAt: row.registered_at,
  };
}

export { buildCreateRecordFromRow };
