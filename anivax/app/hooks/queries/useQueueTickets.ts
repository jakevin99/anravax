import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../lib/queryKeys";
import type { ISODate } from "../../types/domain";
import { listQueueTicketsForDay } from "../../services/queueService";

export function useQueueTicketsQuery(date: ISODate, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.queueTickets.day(date),
    queryFn: () => listQueueTicketsForDay(date),
    enabled,
  });
}
