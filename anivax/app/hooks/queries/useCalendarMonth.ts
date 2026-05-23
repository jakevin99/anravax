import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../lib/queryKeys";
import { getCalendarMonth } from "../../services/queueService";
import { getScheduleSlotsCalendarMonth } from "../../services/scheduleSlotsService";
import type { CalendarResource } from "../../types/domain";

export function useCalendarMonthQuery(
  year: number,
  monthIndex0: number,
  resource: CalendarResource = "appointments",
) {
  return useQuery({
    queryKey:
      resource === "schedule-slots"
        ? queryKeys.scheduleSlots.calendar(year, monthIndex0)
        : queryKeys.appointments.calendar(year, monthIndex0),
    queryFn: () =>
      resource === "schedule-slots"
        ? getScheduleSlotsCalendarMonth(year, monthIndex0)
        : getCalendarMonth(year, monthIndex0),
  });
}
