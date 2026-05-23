import { useEffect, useMemo, useState } from "react";
import { useCalendarMonthQuery } from "../hooks/queries/useCalendarMonth";
import { toISODate } from "../services/queueService";
import type { CalendarDay, CalendarResource } from "../types/domain";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface CalendarCardProps {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  /** REST resource for month highlights. */
  calendarResource?: CalendarResource;
}

export default function CalendarCard({
  selectedDate,
  onSelectDate,
  calendarResource = "appointments",
}: CalendarCardProps) {
  const [now, setNow] = useState(new Date());
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());

  const { data: days = [] } = useCalendarMonthQuery(viewYear, viewMonth, calendarResource);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setViewYear(selectedDate.getFullYear());
    setViewMonth(selectedDate.getMonth());
  }, [selectedDate]);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth, days), [
    viewYear,
    viewMonth,
    days,
  ]);

  const selectedISO = toISODate(selectedDate);

  const dateLabel = selectedDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeLabel = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  return (
    <div className="box-border flex w-full flex-col gap-2.5 rounded-lg border-2 border-black bg-white p-4 shadow-anivax-elevated min-[1180px]:px-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-anivax-body">
          <CalendarIcon />
          <span className="truncate">{dateLabel}</span>
        </div>
        <div className="shrink-0 text-[15px] font-bold text-anivax-teal tabular-nums transition-colors duration-300">
          {timeLabel}
        </div>
      </div>

      <div className="flex flex-1 flex-col rounded-xl bg-white px-1.5 py-2">
        <div className="mb-2.5 flex items-center justify-center gap-4">
          <IconButton onClick={goPrevMonth} ariaLabel="Previous month">
            <Chevron direction="left" />
          </IconButton>
          <div className="min-w-[130px] text-center text-base font-bold tracking-wide text-anivax-ink">
            {MONTHS[viewMonth].toUpperCase()} {viewYear}
          </div>
          <IconButton onClick={goNextMonth} ariaLabel="Next month">
            <Chevron direction="right" />
          </IconButton>
        </div>

        <div className="mb-1.5 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d, i) => (
            <div
              key={i}
              className="text-center text-xs font-semibold text-[#757575]"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 [grid-auto-rows:2rem]">
          {grid.map((cell, idx) => {
            const isSelected = cell.iso === selectedISO;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => cell.date && onSelectDate(cell.date)}
                disabled={!cell.date}
                className={cellButtonClass(cell, isSelected)}
              >
                {cell.day ?? ""}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface GridCell {
  date: Date | null;
  day: number | null;
  iso: string | null;
  status: CalendarDay["status"] | null;
}

function cellButtonClass(cell: GridCell, selected: boolean): string {
  const base =
    "h-full rounded-md border-none p-0 text-[13px] font-semibold transition-[transform,box-shadow,background-color,color] duration-150 ease-out";
  if (!cell.date) {
    return `${base} cursor-default bg-transparent text-[#B3B3B3]`;
  }
  if (selected) {
    return `${base} cursor-pointer bg-anivax-mint text-white shadow-md hover:scale-105 hover:shadow-lg active:scale-95`;
  }
  switch (cell.status) {
    case "appointment":
      return `${base} cursor-pointer bg-anivax-sky text-anivax-ink hover:scale-105 hover:shadow-md active:scale-95`;
    case "overdue":
      return `${base} cursor-pointer bg-[#D9D9D9] text-white hover:brightness-95 active:scale-95`;
    default:
      return `${base} cursor-pointer bg-transparent text-anivax-ink hover:bg-anivax-sky/35 hover:shadow-sm active:scale-95`;
  }
}

function buildMonthGrid(year: number, monthIndex0: number, days: CalendarDay[]): GridCell[] {
  const firstWeekday = new Date(year, monthIndex0, 1).getDay();
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();

  const cells: GridCell[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ date: null, day: null, iso: null, status: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, monthIndex0, d);
    const iso = toISODate(date);
    const dayInfo = days.find((x) => x.date === iso);
    cells.push({
      date,
      day: d,
      iso,
      status: dayInfo?.status ?? "available",
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, day: null, iso: null, status: null });
  }
  return cells;
}

function IconButton({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none bg-transparent text-anivax-ink transition-[background-color,transform] hover:bg-black/5 active:scale-90"
    >
      {children}
    </button>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      className={direction === "right" ? "rotate-180" : ""}
      aria-hidden="true"
    >
      <path
        d="M8 1L3 6L8 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="shrink-0 text-anivax-body">
      <rect
        x="2.5"
        y="4.5"
        width="17"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M2.5 8.5h17" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7 2.5v4M15 2.5v4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
