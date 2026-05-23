/**
 * Query keys aligned with REST resources (`/api/v1/...`).
 * Use these for cache identity and targeted invalidation after mutations.
 */

import type { AppointmentTab, ISODate } from "../types/domain";
import type { PatientRegistrySort, SearchPatientRegistryParams } from "../services/queueService";

export const queryKeys = {
  patients: {
    all: ["patients"] as const,
    lists: () => [...queryKeys.patients.all, "list"] as const,
    list: (params: { page?: number; pageSize?: number }) =>
      [...queryKeys.patients.lists(), params] as const,
    registry: (params: SearchPatientRegistryParams) =>
      [...queryKeys.patients.all, "registry", params] as const,
    recycle: (params: { page?: number; pageSize?: number; q?: string }) =>
      [...queryKeys.patients.all, "recycle", params] as const,
  },
  appointments: {
    all: ["appointments"] as const,
    lists: () => [...queryKeys.appointments.all, "list"] as const,
    list: (params: {
      tab?: AppointmentTab;
      date?: ISODate;
      page?: number;
      pageSize?: number;
      lastName?: string;
      firstName?: string;
      middleName?: string;
    }) => [...queryKeys.appointments.lists(), params] as const,
    tabCounts: (date: ISODate) =>
      [...queryKeys.appointments.all, "tab-counts", date] as const,
    calendar: (year: number, monthIndex0: number) =>
      [...queryKeys.appointments.all, "calendar", year, monthIndex0] as const,
  },
  scheduleSlots: {
    all: ["schedule-slots"] as const,
    lists: () => [...queryKeys.scheduleSlots.all, "list"] as const,
    list: (params: { date?: ISODate; page?: number; pageSize?: number }) =>
      [...queryKeys.scheduleSlots.lists(), params] as const,
    calendar: (year: number, monthIndex0: number) =>
      [...queryKeys.scheduleSlots.all, "calendar", year, monthIndex0] as const,
  },
  queueTickets: {
    all: ["queue-tickets"] as const,
    day: (date: ISODate) => [...queryKeys.queueTickets.all, date] as const,
  },
  staff: {
    all: ["staff"] as const,
    directory: () => [...queryKeys.staff.all, "directory"] as const,
  },
} as const;

export type RegistryQueryParams = SearchPatientRegistryParams & {
  sort?: PatientRegistrySort;
};
