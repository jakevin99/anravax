/**
 * Legacy system patient id used before FOLLOW-UP capacity slots allowed null patient_id.
 * Kept for migration and registry exclusion only.
 */

export const SCHEDULE_ANCHOR_PATIENT_ID = "p_anivaxslot01";

export function isScheduleAnchorPatientId(patientId) {
  return String(patientId ?? "").trim() === SCHEDULE_ANCHOR_PATIENT_ID;
}

/** SQL fragment: `p.id <> ?` with anchor id bound in params (alias must be `p`). */
export function excludeScheduleAnchorPatient(where, params, alias = "p") {
  where.push(`${alias}.id <> ?`);
  params.push(SCHEDULE_ANCHOR_PATIENT_ID);
}
