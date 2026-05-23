import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Footer icon inside the time picker modal (solid clock, matches design comp). */
const CLOCK_MODAL_ICON_SRC = "/images/clockIcon.svg";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

const MONTHS_LONG = [
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
] as const;

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function clampHourFromDigits(digits: string, fallback: number): number {
  const d = digits.replace(/\D/g, "").slice(0, 2);
  if (d === "") return fallback;
  let n = Number(d);
  if (!Number.isFinite(n)) return fallback;
  if (n > 12) n = 12;
  if (n < 1) n = 1;
  return n;
}

function clampMinuteFromDigits(digits: string, fallback: number): number {
  const d = digits.replace(/\D/g, "").slice(0, 2);
  if (d === "") return fallback;
  let n = Number(d);
  if (!Number.isFinite(n)) return fallback;
  if (n > 59) n = 59;
  if (n < 0) n = 0;
  return n;
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseIsoToLocalDate(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, day] = iso.split("-").map((x) => Number(x));
  if (!y || !m || !day) return null;
  const d = new Date(y, m - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatShortDate(iso: string): string {
  if (!iso) return "";
  const d = parseIsoToLocalDate(iso);
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatHeaderWeekday(iso: string): string {
  if (!iso) return "—";
  const d = parseIsoToLocalDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function formatHeaderMonthDay(iso: string): string {
  if (!iso) return "";
  const d = parseIsoToLocalDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime12h(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let h = Number(hStr);
  const m = Number(mStr ?? 0);
  if (Number.isNaN(h)) return time24;
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${h}:${mm} ${suffix}`;
}

function parseTime24ToParts(time24: string): {
  h12: number;
  minute: number;
  am: boolean;
} {
  if (!time24) return { h12: 12, minute: 0, am: true };
  const [hs, ms] = time24.split(":");
  let h24 = Number(hs);
  const minute = Number(ms ?? 0);
  if (Number.isNaN(h24)) h24 = 0;
  const am = h24 < 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, minute: Number.isNaN(minute) ? 0 : minute, am };
}

function partsToTime24(h12: number, minute: number, am: boolean): string {
  let h24: number;
  if (am) {
    h24 = h12 === 12 ? 0 : h12;
  } else {
    h24 = h12 === 12 ? 12 : h12 + 12;
  }
  return `${pad2(h24)}:${pad2(Math.min(59, Math.max(0, minute)))}`;
}

/** Minutes since midnight (0–1439) for wheel nudge; empty string → 0. */
function parseTime24ToTotalMinutes(time24: string): number | null {
  const t = time24.trim();
  if (!t) return 0;
  const [hs, ms] = t.split(":");
  const h = Number(hs);
  const m = Number(ms ?? 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const hMod = ((Math.floor(h) % 24) + 24) % 24;
  const mClamped = Math.min(59, Math.max(0, Math.floor(m)));
  return hMod * 60 + mClamped;
}

function totalMinutesToTime24(total: number): string {
  let t = Math.round(total) % 1440;
  if (t < 0) t += 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Add minutes with day wrap (24h clock). */
function addMinutesToTime24(time24: string, deltaMinutes: number): string {
  const base = parseTime24ToTotalMinutes(time24);
  if (base === null) return "00:00";
  return totalMinutesToTime24(base + deltaMinutes);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function useBodyScrollLock(lock: boolean) {
  useEffect(() => {
    if (!lock || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lock]);
}

/* -------------------------------------------------------------------------- */
/*                              Date picker dialog                             */
/* -------------------------------------------------------------------------- */

function M3DatePickerDialog({
  initialIso,
  onConfirm,
  onDismiss,
  yearRangePast = 15,
  yearRangeFuture = 15,
}: {
  initialIso: string;
  onConfirm: (iso: string) => void;
  onDismiss: () => void;
  /** Years before the later of view year and today (default 15). Use ~120 for date of birth. */
  yearRangePast?: number;
  /** Years after the later of view year and today (default 15). Use 0 to disallow future dates. */
  yearRangeFuture?: number;
}) {
  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const [draft, setDraft] = useState<Date | null>(() => {
    if (!initialIso) return null;
    return parseIsoToLocalDate(initialIso) ?? null;
  });
  const [viewYear, setViewYear] = useState(() => {
    const p = parseIsoToLocalDate(initialIso);
    const d = p ?? new Date();
    return d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const p = parseIsoToLocalDate(initialIso);
    const d = p ?? new Date();
    return d.getMonth();
  });
  const [textMode, setTextMode] = useState(false);
  const [textDraft, setTextDraft] = useState(initialIso);

  useBodyScrollLock(true);

  const draftIso = draft ? toIsoDate(draft) : "";
  const headerLine =
    draftIso && !textMode
      ? `${formatHeaderWeekday(draftIso)}, ${formatHeaderMonthDay(draftIso)}`
      : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const grid = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: ({ day: number } | null)[] = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const yearOptions = useMemo(() => {
    const currentYear = today.getFullYear();
    const lo = Math.min(viewYear, currentYear) - yearRangePast;
    const hi = Math.max(viewYear, currentYear) + yearRangeFuture;
    const out: number[] = [];
    for (let y = lo; y <= hi; y++) out.push(y);
    return out;
  }, [viewYear, today, yearRangePast, yearRangeFuture]);

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

  const applyTextDraft = () => {
    const p = parseIsoToLocalDate(textDraft.trim());
    if (p) {
      setDraft(p);
      setViewYear(p.getFullYear());
      setViewMonth(p.getMonth());
    }
    setTextMode(false);
  };

  const content = (
    <div
      role="presentation"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/32 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Select date"
        className="box-border w-full max-w-[360px] rounded-[28px] bg-m3-surface p-5 pb-3 font-sans text-m3-on-surface shadow-m3-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="mb-1 text-xs font-medium text-m3-primary">Select date</div>
            {textMode ? (
              <input
                autoFocus
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onBlur={applyTextDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyTextDraft();
                }}
                placeholder="YYYY-MM-DD"
                className="box-border w-full max-w-[220px] rounded-lg border-2 border-m3-primary bg-white px-2.5 py-1.5 text-[22px] font-semibold text-m3-on-surface outline-none"
              />
            ) : (
              <div className="text-[22px] font-semibold leading-snug">
                {draft ? headerLine || "Select date" : "Tap a day"}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (textMode) {
                applyTextDraft();
              } else {
                setTextDraft(draftIso || toIsoDate(today));
                setTextMode(true);
              }
            }}
            aria-label="Edit date as text"
            className="cursor-pointer rounded-full border-none bg-transparent p-2 leading-none text-m3-primary transition-opacity hover:opacity-80"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 21h4l10.5-10.5-4-4L4 17v4zM13.5 6.5l4 4L21 7l-4-4-3.5 3.5z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <div className="mb-2 mt-5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <select
              value={viewMonth}
              onChange={(e) => setViewMonth(Number(e.target.value))}
              className="max-w-[130px] cursor-pointer border-none bg-transparent text-[15px] font-semibold text-m3-on-surface outline-none"
            >
              {MONTHS_LONG.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={viewYear}
              onChange={(e) => setViewYear(Number(e.target.value))}
              className="cursor-pointer border-none bg-transparent text-[15px] font-semibold text-m3-on-surface outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={goPrevMonth}
              aria-label="Previous month"
              className="cursor-pointer rounded-full border-none bg-transparent p-2 text-m3-on-surface transition-colors hover:bg-black/5"
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              onClick={goNextMonth}
              aria-label="Next month"
              className="cursor-pointer rounded-full border-none bg-transparent p-2 text-m3-on-surface transition-colors hover:bg-black/5"
            >
              <ChevronRight />
            </button>
          </div>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d, i) => (
            <div
              key={`${d}-${i}`}
              className="py-1 text-center text-xs font-semibold text-m3-primary"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="mb-4 grid grid-cols-7 gap-1">
          {grid.map((cell, idx) => {
            if (!cell) {
              return <div key={`e-${idx}`} />;
            }
            const cellDate = new Date(viewYear, viewMonth, cell.day);
            const isToday = isSameDay(cellDate, today);
            const isSelected = draft ? isSameDay(cellDate, draft) : false;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setDraft(cellDate)}
                className={`h-10 cursor-pointer rounded-full border-none text-sm transition-colors ${
                  isSelected
                    ? "bg-m3-primary font-semibold text-white"
                    : `font-medium text-m3-on-surface hover:bg-black/5 ${isToday ? "ring-2 ring-inset ring-m3-primary" : ""}`
                }`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-m3-outline pt-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="cursor-pointer border-none bg-transparent px-2 py-2.5 text-sm font-semibold text-m3-primary transition-opacity hover:opacity-80"
          >
            Clear
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="cursor-pointer border-none bg-transparent px-3 py-2.5 text-sm font-semibold text-m3-primary transition-opacity hover:opacity-80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(draft ? toIsoDate(draft) : "")}
              className="cursor-pointer border-none bg-transparent px-3 py-2.5 text-sm font-semibold text-m3-primary transition-opacity hover:opacity-80"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

/* -------------------------------------------------------------------------- */
/*                              Time picker dialog                             */
/* -------------------------------------------------------------------------- */

function M3TimePickerDialog({
  initialTime24,
  onConfirm,
  onDismiss,
}: {
  initialTime24: string;
  onConfirm: (time24: string) => void;
  onDismiss: () => void;
}) {
  const initial = useMemo(() => parseTime24ToParts(initialTime24), [initialTime24]);
  const [h12, setH12] = useState(initial.h12);
  const [minute, setMinute] = useState(initial.minute);
  const [am, setAm] = useState(initial.am);
  const [focusField, setFocusField] = useState<"hour" | "minute">("hour");
  /** Raw text while editing so backspace / two-digit entry work with a padded display. */
  const [hourDraft, setHourDraft] = useState<string | null>(null);
  const [minuteDraft, setMinuteDraft] = useState<string | null>(null);
  const hourInputRef = useRef<HTMLInputElement>(null);
  const wheelSurfaceRef = useRef<HTMLDivElement>(null);
  const dialogStateRef = useRef({ h12, minute, am, hourDraft, minuteDraft });
  dialogStateRef.current = { h12, minute, am, hourDraft, minuteDraft };

  useBodyScrollLock(true);

  useEffect(() => {
    const el = wheelSurfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 15 : 1;
      const primary = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (primary === 0) return;
      const delta = primary > 0 ? -step : step;
      const s = dialogStateRef.current;
      const h = s.hourDraft !== null ? clampHourFromDigits(s.hourDraft, s.h12) : s.h12;
      const m = s.minuteDraft !== null ? clampMinuteFromDigits(s.minuteDraft, s.minute) : s.minute;
      const next24 = addMinutesToTime24(partsToTime24(h, m, s.am), delta);
      const p = parseTime24ToParts(next24);
      setH12(p.h12);
      setMinute(p.minute);
      setAm(p.am);
      setHourDraft(null);
      setMinuteDraft(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      hourInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const hourShown = hourDraft !== null ? hourDraft : pad2(h12);
  const minuteShown = minuteDraft !== null ? minuteDraft : pad2(minute);

  const timeInputSharedClass =
    "box-border w-full max-w-[104px] min-h-[76px] text-center font-sans text-[52px] font-normal leading-none text-m3-on-surface rounded-xl px-2.5 py-2 caret-m3-primary outline-none";

  const hourActive = focusField === "hour";
  const minuteActive = focusField === "minute";

  const content = (
    <div
      role="presentation"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/32 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enter time"
        className="box-border w-full max-w-[340px] rounded-[28px] bg-m3-surface px-6 pb-4 pt-6 font-sans text-m3-on-surface shadow-m3-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 text-[13px] font-medium tracking-wide text-m3-on-surface-variant">
          Enter time
        </div>

        <div className="flex flex-row items-center justify-between gap-2.5" ref={wheelSurfaceRef}>
          <div className="flex min-w-0 flex-1 flex-row items-center gap-1.5">
            <div className="flex min-w-0 flex-1 flex-col items-center">
              <input
                ref={hourInputRef}
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={hourShown}
                onFocus={() => {
                  setFocusField("hour");
                  setHourDraft(pad2(h12));
                }}
                onBlur={() => {
                  setH12((prev) => clampHourFromDigits(hourDraft ?? pad2(prev), prev));
                  setHourDraft(null);
                }}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 2);
                  setHourDraft(v);
                }}
                className={`${timeInputSharedClass} border-2 ${
                  hourActive ? "border-m3-primary bg-m3-time-active" : "border-transparent bg-m3-time-idle"
                }`}
              />
              <span className="mt-2.5 text-center text-xs font-medium text-m3-on-surface-variant">Hour</span>
            </div>

            <span className="shrink-0 pb-7 text-5xl font-light leading-none text-m3-on-surface">:</span>

            <div className="flex min-w-0 flex-1 flex-col items-center">
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={minuteShown}
                onFocus={() => {
                  setFocusField("minute");
                  setMinuteDraft(pad2(minute));
                }}
                onBlur={() => {
                  setMinute((prev) => clampMinuteFromDigits(minuteDraft ?? pad2(prev), prev));
                  setMinuteDraft(null);
                }}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 2);
                  setMinuteDraft(v);
                }}
                className={`${timeInputSharedClass} border-2 ${
                  minuteActive ? "border-m3-primary bg-m3-time-active" : "border-transparent bg-m3-time-idle"
                }`}
              />
              <span className="mt-2.5 text-center text-xs font-medium text-m3-on-surface-variant">Minute</span>
            </div>
          </div>

          <div className="flex min-w-[58px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-m3-outline bg-white">
            <button
              type="button"
              onClick={() => setAm(true)}
              className={`cursor-pointer border-none px-2.5 py-4 font-inherit text-sm font-semibold text-m3-on-surface-variant ${
                am ? "bg-m3-am-pink" : "bg-m3-time-idle"
              }`}
            >
              AM
            </button>
            <button
              type="button"
              onClick={() => setAm(false)}
              className={`cursor-pointer border-none border-t border-m3-outline px-2.5 py-4 font-inherit text-sm font-semibold text-m3-on-surface-variant ${
                !am ? "bg-m3-am-pink" : "bg-m3-time-idle"
              }`}
            >
              PM
            </button>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-m3-outline pt-3.5">
          <div className="flex items-center justify-center px-0.5 py-1 leading-none">
            <img src={CLOCK_MODAL_ICON_SRC} alt="" width={20} height={20} draggable={false} />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDismiss}
              className="cursor-pointer border-none bg-transparent px-3.5 py-2.5 font-inherit text-sm font-semibold text-m3-primary transition-opacity hover:opacity-80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const h =
                  hourDraft !== null ? clampHourFromDigits(hourDraft, h12) : h12;
                const m =
                  minuteDraft !== null ? clampMinuteFromDigits(minuteDraft, minute) : minute;
                setH12(h);
                setMinute(m);
                setHourDraft(null);
                setMinuteDraft(null);
                onConfirm(partsToTime24(h, m, am));
              }}
              className="cursor-pointer border-none bg-transparent px-3.5 py-2.5 font-inherit text-sm font-semibold text-m3-primary transition-opacity hover:opacity-80"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

/** Outline calendar (matches create-profile DOB control); scales cleanly in dense fields. */
function M3CalendarGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.65" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
    </svg>
  );
}

/** Outline clock for field trigger (pairs with {@link M3CalendarGlyph}). */
function M3ClockGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.75" stroke="currentColor" strokeWidth="1.65" />
      <path
        d="M12 12V8M12 12h3.5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Field wrappers                                */
/* -------------------------------------------------------------------------- */

function PickerFieldClearButton({
  onClear,
  disabled,
}: {
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      className={`m-0 border-none bg-transparent p-0 text-[10px] font-semibold leading-none ${
        disabled
          ? "cursor-default text-anivax-muted opacity-50"
          : "cursor-pointer text-anivax-teal hover:underline"
      }`}
    >
      Clear
    </button>
  );
}

export function VaccinationM3DatePickerField({
  dateIso,
  onChange,
  disabled,
  dense,
  showClear,
  yearRangePast,
  yearRangeFuture,
}: {
  dateIso: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  dense?: boolean;
  /** Stack a Clear control below the calendar icon (schedule table). */
  showClear?: boolean;
  yearRangePast?: number;
  yearRangeFuture?: number;
}) {
  const [open, setOpen] = useState(false);
  const display = dateIso ? formatShortDate(dateIso) : "";
  const denseCompact = Boolean(dense && !showClear);

  const paddingRight = showClear
    ? dense
      ? "pr-[3.25rem]"
      : "pr-[3.5rem]"
    : dense
      ? "pr-10"
      : "pr-11";
  const minHeight = showClear
    ? dense
      ? "min-h-[52px]"
      : "min-h-[64px]"
    : dense
      ? "min-h-[32px]"
      : "min-h-[52px]";

  const surfaceClass = denseCompact
    ? `relative box-border flex h-full min-h-[32px] w-full items-center bg-white py-0 pl-2.5 ${paddingRight} font-medium text-[13px] leading-none text-black`
    : `relative box-border bg-white font-medium text-black ${minHeight} px-2.5 py-2.5 ${paddingRight} ${
        dense ? "py-1.5 text-[13px]" : "text-sm"
      }`;

  return (
    <>
      <div
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onClick={() => !disabled && setOpen(true)}
        className={`${surfaceClass} ${
          disabled ? "cursor-default opacity-50" : "cursor-pointer transition-opacity hover:opacity-90"
        }`}
      >
        {denseCompact ? (
          <span className="min-w-0 flex-1 truncate">{display}</span>
        ) : (
          display
        )}
        <div
          className={`absolute right-1 flex flex-col items-center ${
            showClear ? "top-1 gap-0.5" : "inset-y-0 justify-center"
          }`}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) setOpen(true);
            }}
            aria-label="Open date picker"
            className={`group m-0 inline-flex shrink-0 items-center justify-center rounded border-none bg-transparent leading-none transition-[color,transform,background-color] active:scale-95 ${
              dense ? "h-8 w-8" : "h-9 w-9"
            } ${
              disabled
                ? "cursor-default text-anivax-muted opacity-50"
                : "cursor-pointer text-anivax-muted hover:bg-anivax-teal/10 hover:text-anivax-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-anivax-teal/40"
            }`}
          >
            <M3CalendarGlyph size={dense ? 20 : 22} className="shrink-0" />
          </button>
          {showClear ? (
            <PickerFieldClearButton disabled={disabled} onClear={() => onChange("")} />
          ) : null}
        </div>
      </div>
      {open ? (
        <M3DatePickerDialog
          initialIso={dateIso}
          yearRangePast={yearRangePast}
          yearRangeFuture={yearRangeFuture}
          onDismiss={() => setOpen(false)}
          onConfirm={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function VaccinationM3TimePickerField({
  time24,
  onChange,
  disabled,
  dense,
  showClear,
}: {
  time24: string;
  onChange: (t: string) => void;
  disabled?: boolean;
  /** Compact row (e.g. schedule incidence time); matches {@link VaccinationM3DatePickerField} `dense`. */
  dense?: boolean;
  /** Stack a Clear control below the clock icon (schedule table). */
  showClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const display = time24 ? formatTime12h(time24) : "";
  const surfaceRef = useRef<HTMLDivElement>(null);
  const timeFieldRef = useRef({ time24, onChange });
  timeFieldRef.current = { time24, onChange };

  useEffect(() => {
    if (disabled || open) return;
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 15 : 1;
      const primary = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (primary === 0) return;
      const delta = primary > 0 ? -step : step;
      const { time24: t, onChange: oc } = timeFieldRef.current;
      const base = t.trim() ? t : "00:00";
      oc(addMinutesToTime24(base, delta));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [disabled, open]);

  const denseCompact = Boolean(dense && !showClear);

  const paddingRight = showClear
    ? dense
      ? "pr-[3.25rem]"
      : "pr-[3.5rem]"
    : dense
      ? "pr-10"
      : "pr-11";
  const minHeight = showClear
    ? dense
      ? "min-h-[52px]"
      : "min-h-[64px]"
    : dense
      ? "min-h-[32px]"
      : "min-h-[52px]";

  const surfaceClass = denseCompact
    ? `relative box-border flex h-full min-h-[32px] w-full items-center bg-white py-0 pl-2.5 ${paddingRight} font-medium text-[13px] leading-none text-black`
    : `relative box-border bg-white font-medium text-black ${minHeight} px-2.5 py-2.5 ${paddingRight} ${
        dense ? "py-1.5 text-[13px]" : "text-sm"
      }`;

  return (
    <>
      <div
        ref={surfaceRef}
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onClick={() => !disabled && setOpen(true)}
        className={`${surfaceClass} ${
          disabled ? "cursor-default opacity-50" : "cursor-pointer transition-opacity hover:opacity-90"
        }`}
      >
        {denseCompact ? (
          <span className="min-w-0 flex-1 truncate">{display}</span>
        ) : (
          display
        )}
        <div
          className={`absolute right-1 flex flex-col items-center ${
            showClear ? "top-1 gap-0.5" : "inset-y-0 justify-center"
          }`}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) setOpen(true);
            }}
            aria-label="Open time picker"
            className={`group m-0 inline-flex shrink-0 items-center justify-center rounded border-none bg-transparent leading-none transition-[color,transform,background-color] active:scale-95 ${
              dense ? "h-8 w-8" : "h-9 w-9"
            } ${
              disabled
                ? "cursor-default text-anivax-muted opacity-50"
                : "cursor-pointer text-anivax-muted hover:bg-anivax-teal/10 hover:text-anivax-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-anivax-teal/40"
            }`}
          >
            <M3ClockGlyph size={dense ? 20 : 22} className="shrink-0" />
          </button>
          {showClear ? (
            <PickerFieldClearButton disabled={disabled} onClear={() => onChange("")} />
          ) : null}
        </div>
      </div>
      {open ? (
        <M3TimePickerDialog
          initialTime24={time24}
          onDismiss={() => setOpen(false)}
          onConfirm={(t) => {
            onChange(t);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
