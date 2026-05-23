/**
 * Fills every patient row with complete create-profile data:
 * PERSONAL INFORMATION, UPLOADS, and PARENT/GUARDIAN.
 *
 * Usage: npm run api:seed-profiles
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, get, run } from "../db.js";
import {
  COMPLETE_PATIENT_SEEDS,
  profileToPatientRow,
} from "../seedPatientProfiles.js";

const FILES_DIR = path.resolve(
  process.cwd(),
  process.env.FILES_DIR ?? "server/data/uploads",
);
const DEMO_ID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function sanitizeFileName(name) {
  return String(name ?? "valid-id.png")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-80);
}

async function ensureIdFileForPatient(patientId, fileName) {
  if (!fileName?.trim()) return null;

  const safeName = sanitizeFileName(fileName);
  const existingRows = await all(
    `
    SELECT id, path FROM files
    WHERE owner_patient_id = ? AND kind = 'ID_CARD'
  `,
    [patientId],
  );
  const match = existingRows.find((r) => String(r.path).includes(safeName));
  if (match?.id) return match.id;

  const sha256 = crypto.createHash("sha256").update(DEMO_ID_PNG).digest("hex");
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dir = path.join(FILES_DIR, yyyy, mm);
  fs.mkdirSync(dir, { recursive: true });

  const insertResult = await run(
    `
    INSERT INTO files (
      owner_patient_id, kind, mime, bytes, sha256, path, uploaded_by_actor
    ) VALUES (?, 'ID_CARD', 'image/png', ?, ?, '', 'seed:profiles')
  `,
    [patientId, DEMO_ID_PNG.length, sha256],
  );
  const fileId = insertResult.id;
  const onDisk = path.join(dir, `${fileId}-${safeName}`);
  fs.writeFileSync(onDisk, DEMO_ID_PNG);
  await run(`UPDATE files SET path = ? WHERE id = ?`, [
    path.relative(FILES_DIR, onDisk).replace(/\\/g, "/"),
    fileId,
  ]);
  return fileId;
}

async function linkIdFilesToProfile(patientId, profile, { frontId, backId }) {
  profile.uploads.front.fileId = frontId;
  profile.uploads.back.fileId = backId;
  await run(
    `UPDATE patients SET profile_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(profile), patientId],
  );
}

async function upsertPatient(seed) {
  const row = profileToPatientRow(seed.id, seed.profile);
  const existing = await get(`SELECT id FROM patients WHERE id = ?`, [seed.id]);

  if (existing) {
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
        registered_at = COALESCE(registered_at, ?),
        profile_json = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `,
      [
        row.first_name,
        row.middle_name,
        row.last_name,
        row.suffix,
        row.birth_date,
        row.sex,
        row.age_years,
        row.address,
        row.contact_number,
        row.blood_type,
        row.registration_no,
        seed.registeredAt,
        row.profile_json,
        seed.id,
      ],
    );
    return "updated";
  }

  await run(
    `
    INSERT INTO patients (
      id, first_name, middle_name, last_name, suffix, birth_date, sex, age_years,
      address, contact_number, blood_type, registration_no, registered_at, profile_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      row.id,
      row.first_name,
      row.middle_name,
      row.last_name,
      row.suffix,
      row.birth_date,
      row.sex,
      row.age_years,
      row.address,
      row.contact_number,
      row.blood_type,
      row.registration_no,
      seed.registeredAt,
      row.profile_json,
    ],
  );
  return "inserted";
}

async function ensureAppointment(patientId) {
  const appt = await get(
    `SELECT id FROM appointments WHERE patient_id = ? LIMIT 1`,
    [patientId],
  );
  if (appt) return;

  const staff = await get(
  `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'ADMIN' AND u.is_active = 1 LIMIT 1`,
  );
  if (!staff) {
    // eslint-disable-next-line no-console
    console.warn(`[seed] No staff user — skip appointment for ${patientId}`);
    return;
  }

  const appointmentId = `apt_seed_${patientId}`;
  const scheduledAt = `${new Date().toISOString().slice(0, 10)}T09:00:00.000Z`;
  await run(
    `
    INSERT INTO appointments (
      id, patient_id, attendant_user_id, scheduled_at, category, status, tab, slot_used, slot_total
    )
    VALUES (?, ?, ?, ?, 1, 'SCHEDULED', 'QUEUE', 1, 10)
  `,
    [appointmentId, patientId, staff.id, scheduledAt],
  );
}

/** Today’s REQUESTS-tab rows (Schedule Today preview on /queue). */
async function ensureRequestsAppointment(patientId, hour, category) {
  const appt = await get(`SELECT id FROM appointments WHERE id = ?`, [
    `apt_req_${patientId}`,
  ]);
  if (appt) return;

  const staff = await get(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'ADMIN' AND u.is_active = 1 LIMIT 1`,
  );
  if (!staff) return;

  const today = new Date().toISOString().slice(0, 10);
  const scheduledAt = `${today}T${String(hour).padStart(2, "0")}:00:00.000Z`;
  await run(
    `
    INSERT INTO appointments (
      id, patient_id, attendant_user_id, scheduled_at, category, status, tab, slot_used, slot_total
    )
    VALUES (?, ?, ?, ?, ?, 'SCHEDULED', 'REQUESTS', 4, 10)
  `,
    [`apt_req_${patientId}`, patientId, staff.id, scheduledAt, category],
  );
}

async function main() {
  const results = [];
  const requestSlots = [
    { hour: 8, category: 2 },
    { hour: 10, category: 1 },
    { hour: 13, category: 3 },
  ];
  for (let i = 0; i < COMPLETE_PATIENT_SEEDS.length; i++) {
    const seed = COMPLETE_PATIENT_SEEDS[i];
    const action = await upsertPatient(seed);
    const frontId = await ensureIdFileForPatient(seed.id, seed.profile.uploads.front.fileName);
    const backId = await ensureIdFileForPatient(seed.id, seed.profile.uploads.back.fileName);
    await linkIdFilesToProfile(seed.id, seed.profile, { frontId, backId });
    await ensureAppointment(seed.id);
    const slot = requestSlots[i];
    if (slot) await ensureRequestsAppointment(seed.id, slot.hour, slot.category);
    results.push({ id: seed.id, action, frontId, backId });
  }

  const extras = await all(`SELECT id FROM patients`);
  const seededIds = new Set(COMPLETE_PATIENT_SEEDS.map((s) => s.id));
  for (const { id } of extras) {
    if (seededIds.has(id)) continue;
    // eslint-disable-next-line no-console
    console.warn(`[seed] Patient ${id} not in seed list — add a profile in seedPatientProfiles.js`);
  }

  // eslint-disable-next-line no-console
  console.log("[anivax] Patient profiles seeded (personal info, uploads + file, parent/guardian):");
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(
      `  - ${r.id}: ${r.action} (ID front #${r.frontId ?? "—"}, back #${r.backId ?? "—"})`,
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
