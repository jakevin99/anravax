import type { AppointmentTab } from "../types/domain";

export const APPOINTMENT_TAB_ITEMS: { id: AppointmentTab; label: string }[] = [
  { id: "QUEUE", label: "QUEUE" },
  { id: "FOLLOW-UP", label: "FOLLOW-UP" },
  { id: "REQUESTS", label: "REQUESTS" },
];

/** Figma QUEUE frame tab accents (dots + active underline). */
const TAB_THEME: Record<
  AppointmentTab,
  { dot: string; text: string; underline: string }
> = {
  QUEUE: {
    dot: "bg-[#3EB489]",
    text: "text-[#3EB489]",
    underline: "bg-[#3EB489]",
  },
  "FOLLOW-UP": {
    dot: "bg-[#0097B2]",
    text: "text-[#0097B2]",
    underline: "bg-[#0097B2]",
  },
  REQUESTS: {
    dot: "bg-[#7C5CFC]",
    text: "text-[#7C5CFC]",
    underline: "bg-[#7C5CFC]",
  },
};

function formatTabCount(n: number): string {
  if (n > 99) return "99+";
  return String(n);
}

export function AppointmentTabBar({
  activeTab,
  onChange,
  tabCounts,
}: {
  activeTab: AppointmentTab;
  onChange: (t: AppointmentTab) => void;
  /** Per-tab totals for the selected calendar day. */
  tabCounts?: Record<AppointmentTab, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-8 min-[1180px]:flex-nowrap min-[1180px]:gap-10">
      {APPOINTMENT_TAB_ITEMS.map((t) => {
        const active = activeTab === t.id;
        const th = TAB_THEME[t.id];
        const count = tabCounts?.[t.id];
        const showCount = count !== undefined;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`group relative flex cursor-pointer items-center gap-2 border-none bg-transparent px-0 pb-2.5 pt-0.5 transition-opacity hover:opacity-90 ${
              active ? "opacity-100" : "opacity-90"
            }`}
          >
            <span
              className={`inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none text-white tabular-nums ${th.dot} ${
                showCount ? "h-6 min-w-6 px-1" : "h-5 w-5"
              }`}
              aria-label={showCount ? `${count} in ${t.label}` : undefined}
            >
              {showCount ? formatTabCount(count) : null}
            </span>
            <span
              className={`text-sm font-bold uppercase tracking-wide ${th.text} ${
                active ? "" : "font-semibold"
              }`}
            >
              {t.label}
            </span>
            <span
              className={`absolute bottom-0 left-0 h-0.5 rounded-none transition-all ${
                active ? `w-full ${th.underline}` : "w-0 bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
