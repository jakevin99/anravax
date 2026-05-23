import type { Appointment } from "../types/domain";
import { searchAppointments } from "../services/queueService";
import {
  searchScheduleSlots,
  type ScheduleSlot,
} from "../services/scheduleSlotsService";

export type ScheduleSlotChoice = {
  labelDate: string;
  labelTime: string;
  scheduledAt: string;
  dateIso: string;
  time24: string;
  used: number;
  total: number;
  /** FOLLOW-UP schedule row id from Schedules page. */
  scheduleAppointmentId: string;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/** Local calendar day + clock time — stable key for matching bookings to schedule rows. */
export function slotBookingKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${toIsoDateLocal(d)}|${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function slotBookingKey(slot: Pick<ScheduleSlotChoice, "dateIso" | "time24">): string {
  return `${slot.dateIso}|${slot.time24}`;
}

/** Build the same `scheduledAt` value used when saving schedules on the Schedules page. */
export function buildScheduledAtFromSlot(
  slot: Pick<ScheduleSlotChoice, "dateIso" | "time24">,
): string {
  const [y, mo, d] = slot.dateIso.split("-").map(Number);
  const [h, mi] = slot.time24.split(":").map((n) => Number(n) || 0);
  return new Date(y, mo - 1, d, h, mi, 0, 0).toISOString();
}

/** Current local date and time (for Schedule Today / Requests). */
export function buildNowScheduledAt(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString();
}

export function formatScheduledAtSummary(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
}

function capacitySlotToChoice(slot: ScheduleSlot, used: number): ScheduleSlotChoice {
  const d = new Date(slot.scheduledAt);
  const total =
    Number.isFinite(slot.slotTotal) && (slot.slotTotal ?? 0) > 0
      ? Number(slot.slotTotal)
      : Number.isFinite(slot.slotUsed) && (slot.slotUsed ?? 0) > 0
        ? Number(slot.slotUsed)
        : 0;

  return {
    labelDate: d
      .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      .toUpperCase(),
    labelTime: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
    scheduledAt: slot.scheduledAt,
    dateIso: toIsoDateLocal(d),
    time24: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    used,
    total,
    scheduleAppointmentId: slot.id,
  };
}

async function fetchAppointmentsByTabForDate(
  tab: "QUEUE" | "REQUESTS",
  dateIso: string,
): Promise<Appointment[]> {
  const items: Appointment[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const res = await searchAppointments({ tab, date: dateIso, page, pageSize: 100 });
    items.push(...res.items);
    totalPages = res.totalPages;
    page += 1;
  }
  return items;
}

export function scheduleSlotPartsFromIso(
  iso: string,
): { dateIso: string; time24: string } | null {
  const key = slotBookingKeyFromIso(iso);
  const pipe = key.indexOf("|");
  if (pipe < 0) return null;
  return { dateIso: key.slice(0, pipe), time24: key.slice(pipe + 1) };
}

/** Duplicate only when both calendar date (YYYY-MM-DD) and clock time (HH:MM) match. */
export function scheduleSlotsMatch(
  a: { dateIso: string; time24: string },
  b: { dateIso: string; time24: string },
): boolean {
  return a.dateIso === b.dateIso && a.time24 === b.time24;
}

/** Another FOLLOW-UP schedule row at the same local date and time (excludes `excludeId`). */
export async function findConflictingFollowUpSchedule(
  dateIso: string,
  time24: string,
  excludeId?: string,
): Promise<ScheduleSlot | null> {
  const target = { dateIso, time24 };
  const slots = await fetchCapacityScheduleSlots(dateIso);
  for (const slot of slots) {
    if (excludeId && slot.id === excludeId) continue;
    const parts = scheduleSlotPartsFromIso(slot.scheduledAt);
    if (parts && scheduleSlotsMatch(parts, target)) return slot;
  }
  return null;
}

async function fetchCapacityScheduleSlots(dateIso?: string): Promise<ScheduleSlot[]> {
  const items: ScheduleSlot[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const res = await searchScheduleSlots({
      date: dateIso,
      page,
      pageSize: 100,
    });
    items.push(...res.items);
    totalPages = res.totalPages;
    page += 1;
  }
  return items;
}

async function countBookedSlotsByScheduledAt(dateIsos: string[]): Promise<Map<string, number>> {
  const booked = new Map<string, number>();
  const uniqueDates = [...new Set(dateIsos)];
  await Promise.all(
    uniqueDates.map(async (dateIso) => {
      const [queue, requests] = await Promise.all([
        fetchAppointmentsByTabForDate("QUEUE", dateIso),
        fetchAppointmentsByTabForDate("REQUESTS", dateIso),
      ]);
      for (const appt of [...queue, ...requests]) {
        const key = slotBookingKeyFromIso(appt.scheduledAt);
        booked.set(key, (booked.get(key) ?? 0) + 1);
      }
    }),
  );
  return booked;
}

/**
 * Vaccination Date rows from schedules added on the Schedules page (FOLLOW-UP tab).
 * When `day` is set (queue reschedule), only that calendar day is included.
 */
export async function loadVaccinationScheduleSlots(options?: {
  day?: Date;
}): Promise<ScheduleSlotChoice[]> {
  const day = options?.day;
  const dateIso = day ? toIsoDateLocal(day) : undefined;
  let scheduleSlots = await fetchCapacityScheduleSlots(dateIso);

  if (!day) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    scheduleSlots = scheduleSlots.filter(
      (s) => new Date(s.scheduledAt) >= startOfToday,
    );
  }

  scheduleSlots.sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  if (scheduleSlots.length === 0) return [];

  const dateIsos = scheduleSlots.map((s) => s.scheduledAt.slice(0, 10));
  const booked = await countBookedSlotsByScheduledAt(dateIsos);

  return scheduleSlots.map((slot) => {
    const key = slotBookingKeyFromIso(slot.scheduledAt);
    const bookedCount = booked.get(key) ?? 0;
    const storedUsed = Number.isFinite(slot.slotUsed) ? Number(slot.slotUsed) : 0;
    const used = Math.max(storedUsed, bookedCount);
    return capacitySlotToChoice(slot, used);
  });
}

export function formatSlotCountDisplay(slot: ScheduleSlotChoice): string {
  if (slot.total <= 0) return String(slot.used);
  return `${slot.used} / ${slot.total}`;
}

export function isSlotFull(slot: ScheduleSlotChoice): boolean {
  if (slot.total <= 0) return false;
  return slot.used >= slot.total;
}

export function findSlotIndexForScheduledAt(
  slots: ScheduleSlotChoice[],
  scheduledAt: string,
): number {
  const target = slotBookingKeyFromIso(scheduledAt);
  const exact = slots.findIndex((s) => slotBookingKeyFromIso(s.scheduledAt) === target);
  if (exact >= 0) return exact;

  const targetMs = new Date(scheduledAt).getTime();
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  slots.forEach((s, i) => {
    const diff = Math.abs(new Date(s.scheduledAt).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}
