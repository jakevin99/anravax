import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import crypto from "node:crypto";

const DATA_DIR = path.resolve(process.cwd(), "server", "data");
const DB_PATH = path.join(DATA_DIR, "anivax.sqlite");

sqlite3.verbose();

function openDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return new sqlite3.Database(DB_PATH);
}

export const db = openDatabase();

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row ?? null);
    });
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });
}

export async function initDb() {
  await run("PRAGMA foreign_keys = ON;");

  await run(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS authorities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS role_authorities (
      role_id INTEGER NOT NULL,
      authority_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, authority_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (authority_id) REFERENCES authorities(id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
    );
  `);

  await migrateUsersDropEmailColumn();

  await seedDefaults();
  await migrateClinicalSchema();
  await migrateAuthSchema();
  await migrateUserPublicIds();
  await migrateInventoryAndVitalsSchema();
  await migratePepSchema();
  await migrateQueueSchema();
  await migratePatientAuthSchema();
  await migratePatientRecycleSchema();
  await migrateScheduleSlotsNullablePatient();
  const { repairAppointmentForeignKeys } = await import(
    "./services/repairAppointmentForeignKeys.js"
  );
  const repaired = await repairAppointmentForeignKeys();
  if (repaired) {
    // eslint-disable-next-line no-console
    console.log("[anivax] Repaired appointment foreign keys (appointments_old → appointments).");
  }
  await migrateNotificationsAndFilesSchema();
  await migrateAuditSchema();
  await migrateIndexes();
  await seedInventoryDefaults();
}

async function migrateUsersDropEmailColumn() {
  const tableInfo = await all("PRAGMA table_info(users)");
  const hasEmail = tableInfo.some((col) => col?.name === "email");
  if (!hasEmail) return;

  await run("BEGIN TRANSACTION");
  try {
    await run("ALTER TABLE users RENAME TO users_old");
    await run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role_id INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
      );
    `);
    await run(`
      INSERT INTO users (
        id, first_name, last_name, username, password_hash, role_id, is_active, created_at, updated_at
      )
      SELECT
        id, first_name, last_name, username, password_hash, role_id, is_active, created_at, updated_at
      FROM users_old
    `);
    await run("DROP TABLE users_old");
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

async function seedDefaults() {
  const roles = [
    {
      name: "ADMIN",
      description: "System administrator with full user management access.",
    },
    {
      name: "ENCODER",
      description: "Can view schedules and basic records.",
    },
    {
      name: "PROGRAM COORDINATOR",
      description: "Can manage schedules and assigned staff workflows.",
    },
  ];

  const authorities = [
    {
      code: "SCHEDULES_READ",
      description: "View schedules list and details.",
    },
    {
      code: "SCHEDULES_WRITE",
      description: "Create, update, and delete schedules.",
    },
    {
      code: "USERS_READ",
      description: "View user accounts and role assignments.",
    },
    {
      code: "USERS_WRITE",
      description: "Create, update, and deactivate user accounts.",
    },
  ];

  for (const role of roles) {
    await run(
      `
      INSERT INTO roles (name, description)
      VALUES (?, ?)
      ON CONFLICT(name) DO NOTHING
    `,
      [role.name, role.description],
    );
  }

  for (const authority of authorities) {
    await run(
      `
      INSERT INTO authorities (code, description)
      VALUES (?, ?)
      ON CONFLICT(code) DO NOTHING
    `,
      [authority.code, authority.description],
    );
  }

  const encoder = await get("SELECT id FROM roles WHERE name = ?", ["ENCODER"]);
  const admin = await get("SELECT id FROM roles WHERE name = ?", ["ADMIN"]);
  const programCoordinator = await get("SELECT id FROM roles WHERE name = ?", [
    "PROGRAM COORDINATOR",
  ]);
  const schedulesRead = await get("SELECT id FROM authorities WHERE code = ?", [
    "SCHEDULES_READ",
  ]);
  const schedulesWrite = await get("SELECT id FROM authorities WHERE code = ?", [
    "SCHEDULES_WRITE",
  ]);
  const usersRead = await get("SELECT id FROM authorities WHERE code = ?", ["USERS_READ"]);
  const usersWrite = await get("SELECT id FROM authorities WHERE code = ?", ["USERS_WRITE"]);

  const mappings = [
    [admin?.id, schedulesRead?.id],
    [admin?.id, schedulesWrite?.id],
    [admin?.id, usersRead?.id],
    [admin?.id, usersWrite?.id],
    [encoder?.id, schedulesRead?.id],
    [encoder?.id, schedulesWrite?.id],
    [programCoordinator?.id, schedulesRead?.id],
    [programCoordinator?.id, schedulesWrite?.id],
    [programCoordinator?.id, usersRead?.id],
    [programCoordinator?.id, usersWrite?.id],
  ].filter(([roleId, authorityId]) => roleId && authorityId);

  for (const [roleId, authorityId] of mappings) {
    await run(
      `
      INSERT INTO role_authorities (role_id, authority_id)
      VALUES (?, ?)
      ON CONFLICT(role_id, authority_id) DO NOTHING
    `,
      [roleId, authorityId],
    );
  }

  // Ensure there is exactly one default admin account available.
  if (admin?.id) {
    const adminPasswordHash = crypto.createHash("sha256").update("admin123").digest("hex");
    await run(
      `
      INSERT INTO users (
        first_name, last_name, username, password_hash, role_id, is_active, updated_at
      )
      SELECT ?, ?, ?, ?, ?, 1, datetime('now')
      WHERE NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE u.role_id = ?
      )
    `,
      [
        "System",
        "Administrator",
        "admin",
        adminPasswordHash,
        admin.id,
        admin.id,
      ],
    );
  }
}

/**
 * Clinical tables for queue, schedules, retrieve/history.
 * Data is created through the API (patients, appointments) — no demo seed rows.
 */
export async function migrateClinicalSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT DEFAULT 'NONE',
      birth_date TEXT NOT NULL,
      sex TEXT NOT NULL,
      age_years INTEGER,
      address TEXT,
      contact_number TEXT,
      blood_type TEXT,
      registration_no TEXT,
      registered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT,
      attendant_user_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      category INTEGER NOT NULL,
      status TEXT NOT NULL,
      tab TEXT NOT NULL,
      slot_used INTEGER,
      slot_total INTEGER,
      vitals_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (attendant_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS exposure_records (
      appointment_id TEXT PRIMARY KEY,
      chief_complaint TEXT,
      date_of_incidence TEXT,
      time_of_incidence TEXT,
      place_of_incidence TEXT,
      site_of_injury TEXT,
      animal_type TEXT,
      washed_injury INTEGER NOT NULL DEFAULT 0,
      animal_vaccinated INTEGER NOT NULL DEFAULT 0,
      uploaded_file_url TEXT,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS doctors_orders (
      appointment_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS vaccination_records (
      appointment_id TEXT PRIMARY KEY,
      animal_status_after_14d TEXT,
      treatment_status TEXT,
      observation_date TEXT,
      payload_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );
  `);

  const apptCols = await all("PRAGMA table_info(appointments)");
  if (!apptCols.some((c) => c?.name === "slot_used")) {
    await run("ALTER TABLE appointments ADD COLUMN slot_used INTEGER");
  }
  if (!apptCols.some((c) => c?.name === "slot_total")) {
    await run("ALTER TABLE appointments ADD COLUMN slot_total INTEGER");
  }

  const exposureCols = await all("PRAGMA table_info(exposure_records)");
  if (!exposureCols.some((c) => c?.name === "bite_type")) {
    await run("ALTER TABLE exposure_records ADD COLUMN bite_type TEXT");
  }
  if (!exposureCols.some((c) => c?.name === "stray_owned")) {
    await run("ALTER TABLE exposure_records ADD COLUMN stray_owned TEXT");
  }

  const patientCols = await all("PRAGMA table_info(patients)");
  if (!patientCols.some((c) => c?.name === "profile_json")) {
    await run("ALTER TABLE patients ADD COLUMN profile_json TEXT");
  }

}

/* -------------------------------------------------------------------------- */
/*                       Phase 1 — auth: refresh tokens                       */
/* -------------------------------------------------------------------------- */

async function migrateUserPublicIds() {
  const { allocateUserPublicId } = await import("./services/entityIds.js");
  const tableInfo = await all("PRAGMA table_info(users)");
  if (!tableInfo.some((col) => col?.name === "public_id")) {
    await run(`ALTER TABLE users ADD COLUMN public_id TEXT`);
  }
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_unique
    ON users(public_id)
    WHERE public_id IS NOT NULL AND length(trim(public_id)) > 0
  `);
  const missing = await all(
    `SELECT id FROM users WHERE public_id IS NULL OR trim(public_id) = ''`,
  );
  for (const row of missing) {
    const publicId = await allocateUserPublicId(get);
    await run(`UPDATE users SET public_id = ? WHERE id = ?`, [publicId, row.id]);
  }
}

async function migrateAuthSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS refresh_tokens_actor
    ON refresh_tokens(actor_kind, actor_id);
  `);
}

/* -------------------------------------------------------------------------- */
/*               Phase 2 — inventory + vitals (queryable tables)              */
/* -------------------------------------------------------------------------- */

async function migrateInventoryAndVitalsSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS vaccines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS vaccine_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vaccine_id INTEGER NOT NULL,
      lot_no TEXT NOT NULL,
      expires_on TEXT,
      qty_initial INTEGER NOT NULL,
      qty_remaining INTEGER NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vaccine_id) REFERENCES vaccines(id) ON DELETE RESTRICT,
      UNIQUE(vaccine_id, lot_no)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS vaccine_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_dose_id INTEGER,
      by_user_id INTEGER,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lot_id) REFERENCES vaccine_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS vitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id TEXT NOT NULL,
      pulse_rate INTEGER,
      spo2 INTEGER,
      bp_sys INTEGER,
      bp_dia INTEGER,
      temp_c REAL,
      weight_kg REAL,
      height_cm REAL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      recorded_by_user_id INTEGER,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

/* -------------------------------------------------------------------------- */
/*               Phase 2 — PEP schedules + dose administrations               */
/* -------------------------------------------------------------------------- */

async function migratePepSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS pep_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      exposure_appointment_id TEXT NOT NULL,
      regimen TEXT NOT NULL,
      day0_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (exposure_appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS dose_administrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      dose_number INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      given_at TEXT,
      vaccine_lot_id INTEGER,
      given_by_user_id INTEGER,
      site TEXT,
      route TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (schedule_id) REFERENCES pep_schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (vaccine_lot_id) REFERENCES vaccine_lots(id) ON DELETE SET NULL,
      FOREIGN KEY (given_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(schedule_id, dose_number)
    );
  `);
}

/* -------------------------------------------------------------------------- */
/*                          Phase 2 — queue tickets                           */
/* -------------------------------------------------------------------------- */

async function migrateQueueSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS queue_tickets (
      appointment_id TEXT PRIMARY KEY,
      token_code TEXT NOT NULL UNIQUE,
      day_iso TEXT NOT NULL,
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAITING',
      called_at TEXT,
      served_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS queue_day_status
    ON queue_tickets(day_iso, status, position);
  `);
}

/* -------------------------------------------------------------------------- */
/*                Phase 3 — patient credentials (mobile login)                */
/* -------------------------------------------------------------------------- */

async function migratePatientRecycleSchema() {
  let cols = await all("PRAGMA table_info(patients)");
  if (!cols.some((c) => c?.name === "deleted_at")) {
    await run(`ALTER TABLE patients ADD COLUMN deleted_at TEXT`);
    cols = await all("PRAGMA table_info(patients)");
  }
  if (!cols.some((c) => c?.name === "purge_after")) {
    await run(`ALTER TABLE patients ADD COLUMN purge_after TEXT`);
  }
  await run(`
    CREATE INDEX IF NOT EXISTS patients_recycle_purge
    ON patients(purge_after)
    WHERE deleted_at IS NOT NULL
  `);
}

/**
 * FOLLOW-UP capacity slots are not patients. Allow null patient_id and remove the
 * legacy "Schedule Slot" anchor row from the registry.
 */
async function migrateScheduleSlotsNullablePatient() {
  const { SCHEDULE_ANCHOR_PATIENT_ID } = await import("./services/scheduleAnchor.js");

  const cols = await all("PRAGMA table_info(appointments)");
  const patientCol = cols.find((c) => c?.name === "patient_id");
  const needsRebuild = patientCol?.notnull === 1;

  if (needsRebuild) {
    await run("PRAGMA foreign_keys = OFF");
    try {
      await run(`
        CREATE TABLE appointments_migrate (
          id TEXT PRIMARY KEY,
          patient_id TEXT,
          attendant_user_id INTEGER NOT NULL,
          scheduled_at TEXT NOT NULL,
          category INTEGER NOT NULL,
          status TEXT NOT NULL,
          tab TEXT NOT NULL,
          slot_used INTEGER,
          slot_total INTEGER,
          vitals_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
          FOREIGN KEY (attendant_user_id) REFERENCES users(id) ON DELETE RESTRICT
        );
      `);
      await run(
        `
        INSERT INTO appointments_migrate (
          id, patient_id, attendant_user_id, scheduled_at, category, status, tab,
          slot_used, slot_total, vitals_json, created_at, updated_at
        )
        SELECT
          id,
          CASE
            WHEN tab = 'FOLLOW-UP' AND patient_id = ? THEN NULL
            ELSE patient_id
          END,
          attendant_user_id,
          scheduled_at,
          category,
          status,
          tab,
          slot_used,
          slot_total,
          vitals_json,
          created_at,
          updated_at
        FROM appointments
      `,
        [SCHEDULE_ANCHOR_PATIENT_ID],
      );
      await run("DROP TABLE appointments");
      await run("ALTER TABLE appointments_migrate RENAME TO appointments");
    } finally {
      await run("PRAGMA foreign_keys = ON");
    }
  } else {
    await run(
      `
      UPDATE appointments
      SET patient_id = NULL
      WHERE tab = 'FOLLOW-UP' AND patient_id = ?
    `,
      [SCHEDULE_ANCHOR_PATIENT_ID],
    );
  }

  const stillReferenced = await get(
    `SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ?`,
    [SCHEDULE_ANCHOR_PATIENT_ID],
  );
  if ((stillReferenced?.n ?? 0) === 0) {
    await run(`DELETE FROM patients WHERE id = ?`, [SCHEDULE_ANCHOR_PATIENT_ID]);
  }
}

async function migratePatientAuthSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS patient_credentials (
      patient_id TEXT PRIMARY KEY,
      phone_e164 TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      otp_hash TEXT,
      otp_expires_at TEXT,
      otp_attempts INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
  `);

  // OTP challenges live in a separate table so we can issue an OTP for a
  // brand-new phone number BEFORE the patient row exists.
  await run(`
    CREATE TABLE IF NOT EXISTS otp_challenges (
      phone_e164 TEXT PRIMARY KEY,
      otp_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/* -------------------------------------------------------------------------- */
/*                Phase 5 — notifications, devices, files                     */
/* -------------------------------------------------------------------------- */

async function migrateNotificationsAndFilesSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      fcm_token TEXT NOT NULL UNIQUE,
      platform TEXT,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT,
      sent_at TEXT,
      delivered_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );
  `);
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency
    ON notifications(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_patient_id TEXT,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT,
      path TEXT NOT NULL,
      uploaded_by_actor TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_patient_id) REFERENCES patients(id) ON DELETE SET NULL
    );
  `);
}

/* -------------------------------------------------------------------------- */
/*                          Phase 6 — audit logs                              */
/* -------------------------------------------------------------------------- */

async function migrateAuditSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_kind TEXT,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_kind TEXT,
      entity_id TEXT,
      before_json TEXT,
      after_json TEXT,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS audit_entity
    ON audit_logs(entity_kind, entity_id, at DESC);
  `);
}

/* -------------------------------------------------------------------------- */
/*                Performance indexes from the architecture plan              */
/* -------------------------------------------------------------------------- */

async function migrateIndexes() {
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS patients_registration_no_unique
    ON patients(registration_no)
    WHERE registration_no IS NOT NULL AND length(trim(registration_no)) > 0;
  `);
  try {
    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS patients_identity_unique
      ON patients(lower(trim(first_name)), lower(trim(last_name)), birth_date)
      WHERE deleted_at IS NULL OR trim(deleted_at) = ''
    `);
  } catch (error) {
    if (!String(error?.message ?? "").includes("UNIQUE")) {
      throw error;
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[anivax] patients_identity_unique skipped — existing rows may have duplicate name + birth date.",
    );
  }
  // FOLLOW-UP capacity slots only — QUEUE/REQUESTS may share the same clock time.
  await run("DROP INDEX IF EXISTS appointments_slot_unique");
  await run("DROP INDEX IF EXISTS appointments_slot_index");
  await run("DROP INDEX IF EXISTS appointments_followup_slot_unique");
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS appointments_followup_slot_unique
    ON appointments(attendant_user_id, scheduled_at)
    WHERE tab = 'FOLLOW-UP' AND patient_id IS NULL
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS appointments_slot_index
    ON appointments(attendant_user_id, scheduled_at)
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS appointments_date_tab
    ON appointments(substr(scheduled_at, 1, 10), tab);
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS appointments_patient_time
    ON appointments(patient_id, scheduled_at DESC);
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS dose_due_open
    ON dose_administrations(due_date)
    WHERE given_at IS NULL;
  `);
}

/* -------------------------------------------------------------------------- */
/*                      Seed default vaccine catalog                          */
/* -------------------------------------------------------------------------- */

async function seedInventoryDefaults() {
  const seedVaccines = [
    { code: "PVRV", name: "Purified Vero Rabies Vaccine", kind: "RABIES_VAX" },
    { code: "PCEC", name: "Purified Chick Embryo Cell vaccine", kind: "RABIES_VAX" },
    { code: "ERIG", name: "Equine Rabies Immunoglobulin", kind: "ERIG" },
    { code: "HRIG", name: "Human Rabies Immunoglobulin", kind: "HRIG" },
    { code: "TT", name: "Tetanus Toxoid", kind: "TT" },
    { code: "ATS", name: "Anti-Tetanus Serum", kind: "ATS" },
  ];
  for (const v of seedVaccines) {
    await run(
      `
      INSERT INTO vaccines (code, name, kind, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(code) DO NOTHING
    `,
      [v.code, v.name, v.kind],
    );
  }
}
