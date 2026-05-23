/**
 * Patient recycle bin — soft delete, restore, and delayed permanent purge.
 *
 * Retention: 30 days after move to recycle (configurable via PATIENT_RECYCLE_RETENTION_DAYS).
 */

import { all, get, run } from "../db.js";
import { deletePatientRecord } from "./deletePatient.js";

export const PATIENT_RECYCLE_RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.PATIENT_RECYCLE_RETENTION_DAYS ?? "", 10) || 30,
);

/** SQL fragment for active (non-recycled) patients. */
export const ACTIVE_PATIENT_WHERE = "(deleted_at IS NULL OR trim(deleted_at) = '')";

function mapRecycleRow(row) {
  const purgeMs = Date.parse(String(row.purge_after).replace(" ", "T") + "Z");
  const nowMs = Date.now();
  const daysUntilPurge = Number.isFinite(purgeMs)
    ? Math.max(0, Math.ceil((purgeMs - nowMs) / (24 * 60 * 60 * 1000)))
    : 0;
  return {
    id: row.id,
    firstName: row.first_name,
    middleName: row.middle_name || undefined,
    lastName: row.last_name,
    birthDate: row.birth_date,
    sex: row.sex,
    ageYears: row.age_years,
    registeredAt: row.registered_at,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    purgeAfter: row.purge_after,
    daysUntilPurge,
  };
}

/**
 * Move patient to recycle bin (hidden from registry; data retained).
 * @returns {Promise<object|null>} recycle metadata
 */
export async function softDeletePatient(patientId) {
  const id = String(patientId).trim();
  if (!id) {
    throw Object.assign(new Error("Patient id is required."), { code: "INVALID_ID" });
  }

  const patient = await get(
    `SELECT id, deleted_at FROM patients WHERE id = ?`,
    [id],
  );
  if (!patient) {
    throw Object.assign(new Error("Patient not found."), { code: "NOT_FOUND" });
  }
  if (patient.deleted_at) {
    throw Object.assign(new Error("Patient is already in the recycle bin."), {
      code: "ALREADY_RECYCLED",
    });
  }

  await run(
    `
    UPDATE patients
    SET
      deleted_at = datetime('now'),
      purge_after = datetime('now', ?),
      updated_at = datetime('now')
    WHERE id = ? AND ${ACTIVE_PATIENT_WHERE}
  `,
    [`+${PATIENT_RECYCLE_RETENTION_DAYS} days`, id],
  );

  const row = await get(
    `SELECT id, deleted_at, purge_after FROM patients WHERE id = ?`,
    [id],
  );
  if (!row?.deleted_at) {
    throw Object.assign(new Error("Patient not found."), { code: "NOT_FOUND" });
  }
  return {
    id: row.id,
    deletedAt: row.deleted_at,
    purgeAfter: row.purge_after,
    retentionDays: PATIENT_RECYCLE_RETENTION_DAYS,
  };
}

/** Restore patient from recycle bin to active registry. */
export async function restorePatient(patientId) {
  const id = String(patientId).trim();
  const patient = await get(`SELECT id, deleted_at FROM patients WHERE id = ?`, [id]);
  if (!patient) {
    throw Object.assign(new Error("Patient not found."), { code: "NOT_FOUND" });
  }
  if (!patient.deleted_at) {
    throw Object.assign(new Error("Patient is not in the recycle bin."), {
      code: "NOT_IN_RECYCLE",
    });
  }

  await run(
    `
    UPDATE patients
    SET deleted_at = NULL, purge_after = NULL, updated_at = datetime('now')
    WHERE id = ?
  `,
    [id],
  );
  return await get(`SELECT * FROM patients WHERE id = ?`, [id]);
}

export async function listRecyclePatients({
  page = 1,
  pageSize = 50,
  q = "",
} = {}) {
  const where = ["deleted_at IS NOT NULL"];
  const params = [];
  if (q) {
    where.push(
      `(lower(id) LIKE ? OR lower(last_name) LIKE ? OR lower(first_name) LIKE ? OR lower(COALESCE(middle_name,'')) LIKE ?)`,
    );
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like, like);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const countRow = await get(`SELECT COUNT(*) AS n FROM patients ${whereSql}`, params);
  const totalItems = countRow?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const offset = (page - 1) * pageSize;

  const rows = await all(
    `
    SELECT
      id, first_name, middle_name, last_name, birth_date, sex, age_years,
      registered_at, created_at, deleted_at, purge_after
    FROM patients
    ${whereSql}
    ORDER BY datetime(deleted_at) DESC
    LIMIT ? OFFSET ?
  `,
    [...params, pageSize, offset],
  );

  return {
    items: rows.map(mapRecycleRow),
    page,
    pageSize,
    totalItems,
    totalPages,
    retentionDays: PATIENT_RECYCLE_RETENTION_DAYS,
  };
}

/** Immediate permanent delete — only allowed while patient is in recycle bin. */
export async function permanentlyDeleteRecycledPatient(patientId) {
  const id = String(patientId).trim();
  const patient = await get(`SELECT id, deleted_at FROM patients WHERE id = ?`, [id]);
  if (!patient) {
    throw Object.assign(new Error("Patient not found."), { code: "NOT_FOUND" });
  }
  if (!patient.deleted_at) {
    throw Object.assign(new Error("Patient must be in the recycle bin before permanent deletion."), {
      code: "NOT_IN_RECYCLE",
    });
  }
  return deletePatientRecord(id);
}

/**
 * Hard-delete patients whose purge_after date has passed.
 * @returns {Promise<number>} count purged
 */
export async function purgeExpiredRecyclePatients() {
  const expired = await all(
    `
    SELECT id FROM patients
    WHERE deleted_at IS NOT NULL AND datetime(purge_after) <= datetime('now')
  `,
  );
  let purged = 0;
  for (const row of expired) {
    try {
      if (await deletePatientRecord(row.id)) purged += 1;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[anivax] purgeExpiredRecyclePatients failed for ${row.id}: ${error?.message ?? error}`,
      );
    }
  }
  return purged;
}
