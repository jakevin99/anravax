import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import TopNav from "./TopNav";
import { getCurrentUser } from "../services/queueService";
import {
  fetchDashboardStats,
  toISODate,
  type DashboardFilters,
  type DashboardStats,
  type VisitGranularity,
} from "../services/dashboardService";
import type { AuthUser } from "../types/domain";

const PIE_COLORS = [
  "#00979d",
  "#3eb489",
  "#0378aa",
  "#ff7a59",
  "#6750a4",
  "#1b6253",
  "#bf0d3e",
  "#636667",
  "#a8d7e9",
  "#198d6c",
];

const CLASSIFICATION_OPTIONS = [
  { value: "Consultation", label: "Consultation" },
  { value: "Follow-up", label: "Follow-up" },
  { value: "Requests", label: "Requests" },
  { value: "All", label: "All" },
];

const PATIENT_STATUS_OPTIONS = [
  { value: "Ended Consults", label: "Ended Consults" },
  { value: "All", label: "All statuses" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const AGE_GROUP_OPTIONS = [
  { value: "ALL", label: "All ages" },
  { value: "INFANT", label: "0-11 months (Infant)" },
  { value: "TODDLER", label: "1-4 years" },
  { value: "SCHOOL", label: "5-9 years" },
  { value: "ADOLESCENT", label: "10-19 years" },
  { value: "ADULT", label: "20-59 years" },
  { value: "SENIOR", label: "60+ years" },
];

const GENDER_OPTIONS = [
  { value: "ALL", label: "ALL" },
  { value: "MALE", label: "MALE" },
  { value: "FEMALE", label: "FEMALE" },
];

const TREND_TABS: { id: VisitGranularity; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "annual", label: "Annual" },
];

function defaultFilters(): DashboardFilters {
  const today = toISODate(new Date());
  return {
    classification: "Consultation",
    healthFacility: "",
    startDate: today,
    endDate: today,
    patientStatus: "Ended Consults",
    ageGroup: "INFANT",
    gender: "ALL",
  };
}

function filtersToAgeGroupLabel(value: string): string {
  return AGE_GROUP_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export default function DashboardPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);
  const [draft, setDraft] = useState<DashboardFilters>(defaultFilters);
  const [applied, setApplied] = useState<DashboardFilters>(defaultFilters);
  const [tabular, setTabular] = useState(false);
  const [trendTab, setTrendTab] = useState<VisitGranularity>("daily");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      const desktop = media.matches;
      setIsDesktop(desktop);
      setSidebarOpen(desktop);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const loadStats = useCallback(async (filters: DashboardFilters) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchDashboardStats(filters);
      setStats(data);
    } catch {
      setError("Unable to load dashboard data. Ensure you are signed in and the API is running.");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats(applied);
  }, [applied, loadStats]);

  const trendData = useMemo(() => {
    if (!stats) return [];
    return stats.visitTrends[trendTab] ?? [];
  }, [stats, trendTab]);

  const handleFilter = () => {
    if (!draft.healthFacility.trim()) {
      window.alert("Health facility is required.");
      return;
    }
    setApplied({ ...draft });
    if (!isDesktop) setSidebarOpen(false);
  };

  const handleClear = () => {
    const cleared = defaultFilters();
    setDraft(cleared);
    setApplied(cleared);
    setTabular(false);
  };

  const handleExport = () => {
    if (!stats) return;
    const lines: string[] = [
      "Anivax Dashboard Export",
      `Period,${applied.startDate} to ${applied.endDate}`,
      `Classification,${applied.classification}`,
      `Health Facility,${applied.healthFacility}`,
      `Patient Status,${applied.patientStatus}`,
      `Age Group,${filtersToAgeGroupLabel(applied.ageGroup)}`,
      `Gender,${applied.gender}`,
      "",
      `Visit trends (${trendTab})`,
      "Label,Count",
      ...trendData.map((r) => `${r.label},${r.count}`),
      "",
      "Patients per barangay",
      "Barangay,Count",
      ...stats.byBarangay.map((r) => `"${r.name}",${r.count}`),
      "",
      "Distribution by animal type",
      "Animal type,Count",
      ...stats.byAnimalType.map((r) => `"${r.name}",${r.count}`),
      "",
      "Case category (I–IV)",
      "Category,Count",
      ...stats.byCaseCategory.map((r) => `"${r.name}",${r.count}`),
      "",
      "Injury type",
      "Type,Count",
      ...stats.byInjuryType.map((r) => `"${r.name}",${r.count}`),
      "",
      "Animal status after 14 days",
      "Status,Count",
      ...stats.byAnimalStatusAfter14d.map((r) => `"${r.name}",${r.count}`),
      "",
      "Vaccination status",
      "Status,Count",
      ...stats.byVaccinationStatus.map((r) => `"${r.name}",${r.count}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anivax-dashboard-${applied.startDate}-${applied.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="relative flex min-h-screen w-full flex-col bg-anivax-page">
      <TopNav user={user} />

      {!sidebarOpen ? (
        <button
          type="button"
          aria-label="Open search filters"
          onClick={() => setSidebarOpen(true)}
          className="fixed left-0 top-24 z-40 flex h-12 w-12 cursor-pointer items-center justify-center rounded-r-lg border-0 bg-white shadow-md min-[900px]:top-28"
        >
          <HamburgerIcon />
        </button>
      ) : null}

      {sidebarOpen && !isDesktop ? (
        <button
          type="button"
          aria-label="Close filters"
          className="fixed inset-0 z-30 border-0 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className={`fixed left-0 top-16 z-40 flex h-[calc(100vh-4rem)] w-[min(100%,280px)] shrink-0 flex-col overflow-y-auto border-r border-black/8 bg-white px-4 py-4 shadow-lg transition-transform duration-200 min-[900px]:top-20 min-[900px]:h-[calc(100vh-5rem)] lg:sticky lg:top-16 lg:z-auto lg:h-auto lg:min-h-[calc(100vh-4rem)] lg:max-h-[calc(100vh-4rem)] lg:translate-x-0 lg:shadow-none min-[900px]:lg:top-20 min-[900px]:lg:min-h-[calc(100vh-5rem)] min-[900px]:lg:max-h-[calc(100vh-5rem)] ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:hidden"
          }`}
        >
          <SidebarToggle onClick={() => setSidebarOpen((o) => !o)} />

          <div className="flex flex-col gap-4">
            <OutlinedSelect
              label="Classification"
              value={draft.classification}
              options={CLASSIFICATION_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, classification: v }))}
            />
            <OutlinedInput
              label="Health Facility"
              required
              value={draft.healthFacility}
              onChange={(v) => setDraft((d) => ({ ...d, healthFacility: v }))}
            />
            <OutlinedDate
              label="Start Date"
              required
              value={draft.startDate}
              onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))}
            />
            <OutlinedDate
              label="End Date"
              required
              value={draft.endDate}
              onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
            />
            <OutlinedSelect
              label="Patient Status"
              value={draft.patientStatus}
              options={PATIENT_STATUS_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, patientStatus: v }))}
            />
            <OutlinedSelect
              label="Age Group"
              value={draft.ageGroup}
              options={AGE_GROUP_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, ageGroup: v }))}
            />
            <OutlinedSelect
              label="Gender"
              value={draft.gender}
              options={GENDER_OPTIONS}
              onChange={(v) => setDraft((d) => ({ ...d, gender: v }))}
            />

            <label className="flex cursor-pointer items-center gap-3 pt-1">
              <span className="text-sm font-semibold text-anivax-ink">Tabular</span>
              <button
                type="button"
                role="switch"
                aria-checked={tabular}
                onClick={() => setTabular((t) => !t)}
                className={`relative h-7 w-12 shrink-0 rounded-full border-0 transition-colors ${
                  tabular ? "bg-anivax-teal" : "bg-[#C7CED2]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                    tabular ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </label>
          </div>

          <div className="mt-auto flex flex-col gap-3 pt-6">
            <ActionButton label="FILTER" variant="filter" onClick={handleFilter} />
            <ActionButton label="CLEAR" variant="clear" onClick={handleClear} />
            <ActionButton label="EXPORT TO EXCEL" variant="export" onClick={handleExport} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 min-[1180px]:gap-6 min-[1180px]:p-8">
          {error ? (
            <p className="m-0 rounded-md border border-anivax-danger/30 bg-red-50 px-4 py-3 text-sm font-semibold text-anivax-danger">
              {error}
            </p>
          ) : null}

          <section className="rounded-md bg-white p-4 shadow-anivax-card min-[1180px]:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-xl font-extrabold tracking-wide text-anivax-teal min-[1180px]:text-2xl">
                Patient visits
              </h2>
              <div className="flex flex-wrap gap-2">
                {TREND_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTrendTab(tab.id)}
                    className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-bold tracking-wide transition-colors ${
                      trendTab === tab.id
                        ? "border-anivax-teal bg-anivax-teal text-white"
                        : "border-anivax-border bg-white text-anivax-body hover:border-anivax-teal hover:text-anivax-teal"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <ChartPlaceholder text="Loading trends…" />
            ) : tabular ? (
              <TrendTable data={trendData} />
            ) : (
              <div className="h-[320px] w-full min-[1180px]:h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#565659" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#565659" }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #C7CED2",
                        fontSize: 13,
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name="Visits"
                      stroke="#00979d"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: "#00979d" }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div
            className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-2 min-[1180px]:gap-6 min-[1500px]:grid-cols-3"
            aria-label="Distribution charts"
          >
            <DistributionCard
              title="Patients per barangay"
              data={stats?.byBarangay ?? []}
              loading={loading}
              tabular={tabular}
            />
            <DistributionCard
              title="Distribution by animal type"
              data={stats?.byAnimalType ?? []}
              loading={loading}
              tabular={tabular}
            />
            <DistributionCard
              title="Case category (I–IV)"
              data={stats?.byCaseCategory ?? []}
              loading={loading}
              tabular={tabular}
            />
            <DistributionCard
              title="Injury type (bite / non-bite)"
              data={stats?.byInjuryType ?? []}
              loading={loading}
              tabular={tabular}
            />
            <DistributionCard
              title="Animal status after 14 days"
              data={stats?.byAnimalStatusAfter14d ?? []}
              loading={loading}
              tabular={tabular}
            />
            <DistributionCard
              title="Vaccination status"
              data={stats?.byVaccinationStatus ?? []}
              loading={loading}
              tabular={tabular}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function SidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-end">
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClick}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-anivax-page"
      >
        <HamburgerIcon />
      </button>
    </div>
  );
}

function DistributionCard({
  title,
  data,
  loading,
  tabular,
}: {
  title: string;
  data: { name: string; count: number }[];
  loading: boolean;
  tabular: boolean;
}) {
  const chartData = useMemo(
    () => data.map((d) => ({ name: d.name, value: d.count })),
    [data],
  );

  return (
    <section className="min-w-0 rounded-md bg-white p-4 shadow-anivax-card min-[1180px]:p-6">
      <h3 className="m-0 mb-4 text-base font-extrabold tracking-wide text-anivax-teal min-[1180px]:text-lg min-[1500px]:text-base">
        {title}
      </h3>
      {loading ? (
        <ChartPlaceholder text="Loading…" />
      ) : data.length === 0 ? (
        <ChartPlaceholder text="No data for the selected filters." />
      ) : tabular ? (
        <TrendTable data={data.map((d) => ({ label: d.name, count: d.count }))} />
      ) : (
        <div className="h-[300px] w-full min-[1500px]:h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius="72%"
                label={({ name, percent }) =>
                  `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                }
                labelLine={false}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function TrendTable({ data }: { data: { label: string; count: number }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 bg-anivax-table-head">
            <th className="px-3 py-2 text-left font-bold text-anivax-ink">Label</th>
            <th className="px-3 py-2 text-right font-bold text-anivax-ink">Count</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.label} className="border-b border-black/5">
              <td className="px-3 py-2 text-anivax-body">{row.label}</td>
              <td className="px-3 py-2 text-right font-semibold text-anivax-ink">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-[280px] items-center justify-center text-sm font-semibold text-anivax-body">
      {text}
    </div>
  );
}

function OutlinedField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute -top-2 left-3 z-10 bg-white px-1 text-[11px] font-semibold text-anivax-body">
        {label}
        {required ? <span className="text-anivax-danger"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function fieldClass() {
  return "box-border h-11 w-full rounded-md border border-[#C7CED2] bg-white px-3 pt-1 text-sm text-anivax-ink outline-none focus:border-anivax-registry-border focus:ring-2 focus:ring-anivax-registry-border/25";
}

function OutlinedInput({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <OutlinedField label={label} required={required}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass()}
      />
    </OutlinedField>
  );
}

function OutlinedDate({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <OutlinedField label={label} required={required}>
      <div className="relative">
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldClass()} pr-12 [&::-webkit-calendar-picker-indicator]:opacity-0`}
        />
        <span className="pointer-events-none absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded bg-anivax-registry-border text-white">
          <CalendarIcon />
        </span>
      </div>
    </OutlinedField>
  );
}

function OutlinedSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <OutlinedField label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass()}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </OutlinedField>
  );
}

function ActionButton({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: "filter" | "clear" | "export";
  onClick: () => void;
}) {
  const styles =
    variant === "filter"
      ? "bg-[#e53935] hover:bg-[#c62828]"
      : variant === "clear"
        ? "bg-[#43a047] hover:bg-[#2e7d32]"
        : "bg-[#1a237e] hover:bg-[#0d1642]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 w-full cursor-pointer rounded-lg border-0 text-xs font-extrabold tracking-widest text-white shadow-anivax-btn transition-colors ${styles}`}
    >
      {label}
    </button>
  );
}

function HamburgerIcon() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true">
      <path d="M0 1h22M0 8h22M0 15h22" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
