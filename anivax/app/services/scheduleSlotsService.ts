/**
 * REST client for /api/v1/schedule-slots (vaccination capacity, no patient).
 */

import { ApiError, fetchJson } from "./apiClient";
import { notifyDataChanged } from "./dataSync";
import type {
  AppointmentCategory,
  AppointmentStatus,
  Attendant,
  CalendarDay,
  CalendarDayStatus,
  ISODate,
  Paginated,
} from "../types/domain";

export type ScheduleSlot = {
  id: string;
  scheduledAt: string;
  attendant: Attendant;
  category: AppointmentCategory;
  status: AppointmentStatus;
  slotUsed?: number;
  slotTotal?: number;
};

export type UpsertScheduleSlotParams = {
  attendantUserId: number;
  scheduledAt: string;
  category: AppointmentCategory;
  status: AppointmentStatus;
  slotUsed?: number;
  slotTotal: number;
};

export type SearchScheduleSlotsParams = {
  date?: ISODate;
  page?: number;
  pageSize?: number;
};

function stripTime(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function buildEmptyMonth(year: number, monthIndex0: number): CalendarDay[] {
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  const today = new Date();
  const out: CalendarDay[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, monthIndex0, day);
    const iso = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const status: CalendarDayStatus =
      date < stripTime(today) ? "overdue" : "available";
    out.push({ date: iso as ISODate, status, appointmentCount: 0 });
  }
  return out;
}

export async function searchScheduleSlots(
  params: SearchScheduleSlotsParams = {},
): Promise<Paginated<ScheduleSlot>> {
  const { page = 1, pageSize = 100, date } = params;
  const q = new URLSearchParams();
  q.set("page", String(page));
  q.set("page_size", String(pageSize));
  if (date) q.set("date", date);

  try {
    return await fetchJson<Paginated<ScheduleSlot>>(`/schedule-slots?${q.toString()}`);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "Failed to load schedule slots.";
    throw new Error(msg);
  }
}

export async function createScheduleSlot(
  params: UpsertScheduleSlotParams,
): Promise<ScheduleSlot> {
  try {
    const slot = await fetchJson<ScheduleSlot>("/schedule-slots", {
      method: "POST",
      body: params,
    });
    notifyDataChanged("scheduleSlots");
    return slot;
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "Failed to create schedule slot.";
    throw new Error(msg);
  }
}

export async function updateScheduleSlot(
  id: string,
  params: Partial<UpsertScheduleSlotParams>,
): Promise<ScheduleSlot> {
  try {
    const slot = await fetchJson<ScheduleSlot>(
      `/schedule-slots/${encodeURIComponent(id)}`,
      { method: "PATCH", body: params },
    );
    notifyDataChanged("scheduleSlots");
    return slot;
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "Failed to update schedule slot.";
    throw new Error(msg);
  }
}

export async function deleteScheduleSlot(id: string): Promise<void> {
  try {
    await fetchJson<null>(`/schedule-slots/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    notifyDataChanged("scheduleSlots");
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "Failed to delete schedule slot.";
    throw new Error(msg);
  }
}

export async function getScheduleSlotsCalendarMonth(
  year: number,
  monthIndex0: number,
): Promise<CalendarDay[]> {
  const month = monthIndex0 + 1;
  const q = new URLSearchParams({ year: String(year), month: String(month) });
  try {
    const data = await fetchJson<{ days: Array<{ date: string; count: number }> }>(
      `/schedule-slots/calendar?${q.toString()}`,
    );
    if (!data?.days?.length) return buildEmptyMonth(year, monthIndex0);

    const today = new Date();
    const out: CalendarDay[] = [];
    for (const { date: iso, count } of data.days) {
      const date = new Date(iso + "T12:00:00");
      let status: CalendarDayStatus;
      if (count > 0) status = "appointment";
      else if (date < stripTime(today)) status = "overdue";
      else status = "available";
      out.push({ date: iso as ISODate, status, appointmentCount: count });
    }
    return out;
  } catch (err) {
    if (err instanceof ApiError) console.error(err.message);
    return buildEmptyMonth(year, monthIndex0);
  }
}
