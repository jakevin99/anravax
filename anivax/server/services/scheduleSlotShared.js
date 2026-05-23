/**
 * Shared helpers for FOLLOW-UP capacity rows (stored in appointments with patient_id NULL).
 */

import { all } from "../db.js";

export function scheduleSlotBookingKeyFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}|${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function scheduleSlotPartsFromIso(iso) {
  const key = scheduleSlotBookingKeyFromIso(iso);
  if (!key) return null;
  const pipe = key.indexOf("|");
  if (pipe < 0) return null;
  return { dateIso: key.slice(0, pipe), time24: key.slice(pipe + 1) };
}

export function scheduleSlotsMatch(a, b) {
  return a.dateIso === b.dateIso && a.time24 === b.time24;
}

export async function findFollowUpScheduleConflict(scheduledAt, excludeId = null) {
  const target = scheduleSlotPartsFromIso(scheduledAt);
  if (!target) return null;
  const rows = await all(
    `
    SELECT id, scheduled_at
    FROM appointments
    WHERE tab = 'FOLLOW-UP' AND patient_id IS NULL AND scheduled_at LIKE ? || '%'
  `,
    [target.dateIso],
  );
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const parts = scheduleSlotPartsFromIso(row.scheduled_at);
    if (parts && scheduleSlotsMatch(parts, target)) return row;
  }
  return null;
}

export function mapScheduleSlotRow(r) {
  const attendantId = r.attendant_user_id;
  return {
    id: r.a_id,
    scheduledAt: r.scheduled_at,
    attendant: {
      id: `user-${attendantId}`,
      firstName: r.u_first_name,
      lastName: r.u_last_name,
      credential: "RN",
    },
    category: r.category,
    status: r.status,
    slotUsed: r.slot_used ?? undefined,
    slotTotal: r.slot_total ?? undefined,
  };
}
