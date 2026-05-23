import { QueryClient } from "@tanstack/react-query";

import type { DataSyncScope } from "./dataSyncScope";
import { queryKeys } from "./queryKeys";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /** Clinical lists should refetch when invalidated or tab regains focus. */
      staleTime: 0,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Invalidate cached GETs for a REST resource family (same-tab + called from dataSync). */
export async function invalidateByScope(scope: DataSyncScope): Promise<void> {
  switch (scope) {
    case "patients":
      await queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      break;
    case "appointments":
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.queueTickets.all }),
      ]);
      break;
    case "scheduleSlots":
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduleSlots.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all }),
      ]);
      break;
    case "staff":
      await queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      break;
    case "all":
      await queryClient.invalidateQueries();
      break;
    default:
      break;
  }
}
