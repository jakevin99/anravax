/**
 * Repair child tables whose FK still references `appointments_old` after a failed
 * appointments table rebuild (SQLite repoints FKs on RENAME, not on CREATE).
 */

import { all, get, run } from "../db.js";

const APPOINTMENT_CHILD_TABLES = [
  "exposure_records",
  "doctors_orders",
  "vitals",
  "pep_schedules",
  "queue_tickets",
  "vaccination_records",
];

async function referencesAppointmentsOld(tableName) {
  const fks = await all(`PRAGMA foreign_key_list(${tableName})`);
  return fks.some((fk) => fk.table === "appointments_old");
}

/**
 * @returns {Promise<boolean>} true when at least one table was rebuilt
 */
export async function repairAppointmentForeignKeys() {
  const broken = [];
  for (const name of APPOINTMENT_CHILD_TABLES) {
    try {
      if (await referencesAppointmentsOld(name)) broken.push(name);
    } catch {
      /* table may not exist yet */
    }
  }
  if (broken.length === 0) return false;

  await run("PRAGMA foreign_keys = OFF");
  try {
    for (const tableName of broken) {
      const meta = await get(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [tableName],
      );
      if (!meta?.sql || !meta.sql.includes("appointments_old")) continue;

      const fixedSql = meta.sql.replace(/appointments_old/g, "appointments");
      const staging = `${tableName}_fk_repair`;
      await run(`ALTER TABLE ${tableName} RENAME TO ${staging}`);
      await run(fixedSql);
      await run(`INSERT INTO ${tableName} SELECT * FROM ${staging}`);
      await run(`DROP TABLE ${staging}`);
    }
  } finally {
    await run("PRAGMA foreign_keys = ON");
  }
  return true;
}
