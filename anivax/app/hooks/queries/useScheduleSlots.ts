import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../lib/queryKeys";
import {
  searchScheduleSlots,
  type SearchScheduleSlotsParams,
} from "../../services/scheduleSlotsService";

export function useScheduleSlotsQuery(params: SearchScheduleSlotsParams) {
  return useQuery({
    queryKey: queryKeys.scheduleSlots.list(params),
    queryFn: () => searchScheduleSlots(params),
  });
}
