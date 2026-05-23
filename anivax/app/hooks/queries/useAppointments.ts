import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../lib/queryKeys";
import type { AppointmentTab, ISODate } from "../../types/domain";
import {
  countAppointmentsByTab,
  searchAppointments,
  type SearchAppointmentsParams,
} from "../../services/queueService";

export function useAppointmentsQuery(params: SearchAppointmentsParams & { tab: AppointmentTab }) {
  return useQuery({
    queryKey: queryKeys.appointments.list(params),
    queryFn: () => searchAppointments(params),
  });
}

export function useAppointmentTabCountsQuery(date: ISODate) {
  return useQuery({
    queryKey: queryKeys.appointments.tabCounts(date),
    queryFn: () => countAppointmentsByTab(date),
  });
}
