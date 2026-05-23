/**
 * Patient identity match: same first name, last name, and date of birth (active patients only).
 */

import { all, get } from "../db.js";
import { ACTIVE_PATIENT_WHERE } from "./patientRecycle.js";
import { excludeScheduleAnchorPatient } from "./scheduleAnchor.js";

export function normalizeIdentityName(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * @param {{ firstName: string, lastName: string, birthDate: string, excludePatientId?: string | null }} params
 * @returns {Promise<import("../db.js").Row | null>}
 */
export async function findPatientByIdentity(params) {
  const first = normalizeIdentityName(params.firstName);
  const last = normalizeIdentityName(params.lastName);
  const birth = String(params.birthDate ?? "").trim();
  if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
    return null;
  }

  const where = [
    ACTIVE_PATIENT_WHERE.replace(/deleted_at/g, "p.deleted_at"),
    "lower(trim(p.first_name)) = ?",
    "lower(trim(p.last_name)) = ?",
    "p.birth_date = ?",
  ];
  const sqlParams = [first, last, birth];
  excludeScheduleAnchorPatient(where, sqlParams, "p");

  const excludeId = params.excludePatientId
    ? String(params.excludePatientId).trim()
    : "";
  if (excludeId) {
    where.push("p.id <> ?");
    sqlParams.push(excludeId);
  }

  return get(
    `
    SELECT p.*
    FROM patients p
    WHERE ${where.join(" AND ")}
    LIMIT 1
  `,
    sqlParams,
  );
}

/**
 * @param {{ firstName: string, lastName: string, birthDate: string, excludePatientId?: string | null }} params
 */
export async function listPatientsByIdentity(params) {
  const first = normalizeIdentityName(params.firstName);
  const last = normalizeIdentityName(params.lastName);
  const birth = String(params.birthDate ?? "").trim();
  if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
    return [];
  }

  const where = [
    ACTIVE_PATIENT_WHERE.replace(/deleted_at/g, "p.deleted_at"),
    "lower(trim(p.first_name)) = ?",
    "lower(trim(p.last_name)) = ?",
    "p.birth_date = ?",
  ];
  const sqlParams = [first, last, birth];
  excludeScheduleAnchorPatient(where, sqlParams, "p");

  const excludeId = params.excludePatientId
    ? String(params.excludePatientId).trim()
    : "";
  if (excludeId) {
    where.push("p.id <> ?");
    sqlParams.push(excludeId);
  }

  return all(
    `
    SELECT p.*
    FROM patients p
    WHERE ${where.join(" AND ")}
    ORDER BY datetime(COALESCE(p.registered_at, p.created_at)) DESC
    LIMIT 5
  `,
    sqlParams,
  );
}
