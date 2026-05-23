/**
 * Permanently remove a patient and all dependent clinical rows (admin recycle purge).
 */

import { all, get, run } from "../db.js";

/**
 * @param {string[]} appointmentIds
 */
async function deleteAppointmentDependents(appointmentIds) {
  if (appointmentIds.length === 0) return;
  const placeholders = appointmentIds.map(() => "?").join(",");
  await run(
    `DELETE FROM queue_tickets WHERE appointment_id IN (${placeholders})`,
    appointmentIds,
  );
  await run(`DELETE FROM vitals WHERE appointment_id IN (${placeholders})`, appointmentIds);
  await run(
    `DELETE FROM exposure_records WHERE appointment_id IN (${placeholders})`,
    appointmentIds,
  );
  await run(
    `DELETE FROM doctors_orders WHERE appointment_id IN (${placeholders})`,
    appointmentIds,
  );
  await run(
    `DELETE FROM vaccination_records WHERE appointment_id IN (${placeholders})`,
    appointmentIds,
  );
}

/**
 * @param {string} patientId
 * @returns {Promise<boolean>} true when a row was deleted
 */
export async function deletePatientRecord(patientId) {
  const id = String(patientId).trim();
  if (!id) {
    throw Object.assign(new Error("Patient id is required."), { code: "INVALID_ID" });
  }

  const patient = await get(`SELECT id FROM patients WHERE id = ?`, [id]);
  if (!patient) {
    throw Object.assign(new Error("Patient not found."), { code: "NOT_FOUND" });
  }

  await run("PRAGMA foreign_keys = OFF");
  try {
    const scheduleRows = await all(`SELECT id FROM pep_schedules WHERE patient_id = ?`, [id]);
    if (scheduleRows.length > 0) {
      const schedulePlaceholders = scheduleRows.map(() => "?").join(",");
      await run(
        `DELETE FROM dose_administrations WHERE schedule_id IN (${schedulePlaceholders})`,
        scheduleRows.map((r) => r.id),
      );
    }
    await run(`DELETE FROM pep_schedules WHERE patient_id = ?`, [id]);

    const appointmentRows = await all(`SELECT id FROM appointments WHERE patient_id = ?`, [id]);
    const appointmentIds = appointmentRows.map((r) => r.id);
    await deleteAppointmentDependents(appointmentIds);
    await run(`DELETE FROM appointments WHERE patient_id = ?`, [id]);

    await run(`DELETE FROM files WHERE owner_patient_id = ?`, [id]);
    await run(`DELETE FROM notifications WHERE patient_id = ?`, [id]);
    await run(`DELETE FROM device_tokens WHERE patient_id = ?`, [id]);
    await run(`DELETE FROM patient_credentials WHERE patient_id = ?`, [id]);

    const result = await run(`DELETE FROM patients WHERE id = ?`, [id]);
    return (result.changes ?? 0) > 0;
  } finally {
    await run("PRAGMA foreign_keys = ON");
  }
}
