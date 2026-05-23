import type { Appointment } from "../types/domain";
import type { ScheduleSlot } from "../services/scheduleSlotsService";
import type { ScheduleRow } from "../components/ScheduleSettingsModal";
import { buildScheduledAtFromSlot, toIsoDateLocal } from "./scheduleSlots";

/** Display/API slot count as a single number (no used/total fraction). */
export function formatScheduleSlotsFromSlot(slot: Pick<ScheduleSlot, "slotUsed" | "slotTotal">): string {
  const total =
    Number.isFinite(slot.slotTotal) && (slot.slotTotal ?? 0) >= 0
      ? Number(slot.slotTotal)
      : null;
  const used =
    Number.isFinite(slot.slotUsed) && (slot.slotUsed ?? 0) >= 0
      ? Number(slot.slotUsed)
      : null;
  if (total != null && total > 0) return String(total);
  if (used != null && used > 0) return String(used);
  return "0";
}

export function formatScheduleSlotsFromAppointment(appt: Appointment): string {
  const total =
    Number.isFinite(appt.slotTotal) && (appt.slotTotal ?? 0) >= 0
      ? Number(appt.slotTotal)
      : null;
  const used =
    Number.isFinite(appt.slotUsed) && (appt.slotUsed ?? 0) >= 0
      ? Number(appt.slotUsed)
      : null;
  if (total != null && total > 0) return String(total);
  if (used != null && used > 0) return String(used);
  return "0";
}

/** Parse slot count from table/modal value; accepts legacy `used/total` (uses total). */
export function parseScheduleSlotCount(slots: string): number | null {
  const t = slots.trim();
  const fraction = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const n = Number(fraction[2]);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function normalizeScheduleSlotInput(raw: string): string {
  const n = parseScheduleSlotCount(raw);
  if (n == null) return "";
  return String(n);
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function scheduleSlotToScheduleRow(slot: ScheduleSlot): ScheduleRow {
  const scheduled = new Date(slot.scheduledAt);
  const time = scheduled.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const date = scheduled
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();

  return {
    id: slot.id,
    time,
    date,
    dateIso: toIsoDateLocal(scheduled),
    time24: `${pad2(scheduled.getHours())}:${pad2(scheduled.getMinutes())}`,
    slots: formatScheduleSlotsFromSlot(slot),
    addedBy: `${slot.attendant.firstName} ${slot.attendant.lastName}, ${slot.attendant.credential}`,
    dateAdded: date,
  };
}

export function appointmentToScheduleRow(appt: Appointment): ScheduleRow {
  const scheduled = new Date(appt.scheduledAt);
  const time = scheduled.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const date = scheduled
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();

  return {
    id: appt.id,
    time,
    date,
    dateIso: toIsoDateLocal(scheduled),
    time24: `${pad2(scheduled.getHours())}:${pad2(scheduled.getMinutes())}`,
    slots: formatScheduleSlotsFromAppointment(appt),
    addedBy: `${appt.attendant.firstName} ${appt.attendant.lastName}, ${appt.attendant.credential}`,
    dateAdded: date,
  };
}

export function rowToScheduledAtIso(row: ScheduleRow): string | null {
  if (row.dateIso && row.time24) {
    return buildScheduledAtFromSlot({ dateIso: row.dateIso, time24: row.time24 });
  }
  const date = parseScheduleDate(row.date);
  const time = parseScheduleTime(row.time);
  if (!date || !time) return null;
  const d = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.hours24,
    time.minutes,
    0,
    0,
  );
  return d.toISOString();
}

function parseScheduleDate(input: string): Date | null {
  const m = input.trim().match(/^([A-Za-z]+)\s+(\d+),\s*(\d{4})$/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseScheduleTime(input: string): { hours24: number; minutes: number } | null {
  const m = input.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  const minutes = Number(m[2]);
  if (m[3] === "PM") hour += 12;
  return { hours24: hour, minutes };
}

export function slotsToCategory(slots: string): 1 | 2 | 3 | 4 | 5 {
  const n = parseScheduleSlotCount(slots);
  if (n == null || !Number.isFinite(n)) return 3;
  if (n >= 9) return 1;
  if (n >= 7) return 2;
  if (n >= 5) return 3;
  if (n >= 3) return 4;
  return 5;
}

/** True when the calendar day of `dateISO` (YYYY-MM-DD) is today or later (local time). */
export function isAllowedScheduleDateIso(dateISO: string): boolean {
  const parts = dateISO.trim().split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return false;
  const [y, m, d] = parts;
  const picked = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  picked.setHours(0, 0, 0, 0);
  return picked.getTime() >= today.getTime();
}
