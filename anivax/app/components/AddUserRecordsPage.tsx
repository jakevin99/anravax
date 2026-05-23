import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { usePatientRegistryQuery } from "../hooks/queries/usePatientRegistry";
import {
  cachePatientCreateRecord,
  clearConsultationOcrResult,
  getCurrentUser,
  searchPatientRegistry,
  type PatientRegistryRow,
  type PatientRegistrySort,
} from "../services/queueService";
import type { AuthUser, Paginated } from "../types/domain";
import { patientDisplayAgeYears } from "../utils/patientAge";
import type { ConsultationOcrLocationState } from "./ConsultationOcrPage";
import AnivaxSearchBar from "./AnivaxSearchBar";
import TopNav from "./TopNav";
import { VaccinationM3DatePickerField } from "./VaccinationM3Pickers";

const PAGE_SIZE = 8;

const RECORDS_SORT_OPTIONS: { value: PatientRegistrySort; label: string }[] = [
  { value: "last_name_asc", label: "Last name (A–Z)" },
  { value: "last_name_desc", label: "Last name (Z–A)" },
  { value: "registration_asc", label: "Registration no. (ascending)" },
  { value: "registration_desc", label: "Registration no. (descending)" },
  { value: "registered_asc", label: "Date registered (oldest first)" },
  { value: "registered_desc", label: "Date registered (newest first)" },
];

function sortPatientRegistryItems(
  items: PatientRegistryRow[],
  sort: PatientRegistrySort,
): PatientRegistryRow[] {
  const list = [...items];
  const byNameAsc = (a: PatientRegistryRow, b: PatientRegistryRow) => {
    const last = a.patient.lastName.localeCompare(b.patient.lastName, "en", {
      sensitivity: "base",
    });
    if (last !== 0) return last;
    return a.patient.firstName.localeCompare(b.patient.firstName, "en", { sensitivity: "base" });
  };
  const byRegistration = (a: PatientRegistryRow, b: PatientRegistryRow) => {
    const reg = (a.patient.registrationNo ?? "").localeCompare(
      b.patient.registrationNo ?? "",
      "en",
      { numeric: true, sensitivity: "base" },
    );
    if (reg !== 0) return reg;
    return byNameAsc(a, b);
  };
  const byRegistered = (a: PatientRegistryRow, b: PatientRegistryRow, dir: 1 | -1) => {
    const da = a.patient.registeredAt ?? "";
    const db = b.patient.registeredAt ?? "";
    const cmp = da.localeCompare(db);
    if (cmp !== 0) return cmp * dir;
    return byNameAsc(a, b);
  };

  switch (sort) {
    case "last_name_desc":
      return list.sort((a, b) => byNameAsc(b, a));
    case "registration_asc":
      return list.sort(byRegistration);
    case "registration_desc":
      return list.sort((a, b) => byRegistration(b, a));
    case "registered_asc":
      return list.sort((a, b) => byRegistered(a, b, 1));
    case "registered_desc":
    case "recent":
      return list.sort((a, b) => byRegistered(a, b, -1));
    case "last_name_asc":
    case "name":
    default:
      return list.sort(byNameAsc);
  }
}

/** Figma: 4px 4px 4px @ 25% black */
const FIGMA_CARD_SHADOW = "shadow-[4px_4px_4px_rgb(0_0_0/0.25)]";

/** New consultation / narrow registry (5 columns). */
const REGISTRY_GRID_CLASS_CONSULTATION =
  "grid-cols-[minmax(72px,_0.9fr)_minmax(160px,_2fr)_minmax(72px,_0.85fr)_minmax(120px,_1.2fr)_minmax(100px,_0.95fr)]";

/** Records table — 7 columns fill card width (retrieve + history split). */
const REGISTRY_GRID_CLASS_RECORDS =
  "w-full grid-cols-[minmax(0,1.05fr)_minmax(0,2.25fr)_minmax(0,0.5fr)_minmax(0,0.85fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(36px,0.35fr)] gap-x-2";

const RECORDS_REGISTRY_COLUMNS = [
  { label: "REGISTRATION NO.", align: "left" },
  { label: "NAME", align: "center" },
  { label: "AGE | SEX", align: "center" },
  { label: "BIRTHDAY", align: "center" },
  { label: "DATE REGISTERED", align: "center" },
] as const;

function recordsRegistryCellClass(
  align: (typeof RECORDS_REGISTRY_COLUMNS)[number]["align"],
  opts?: { truncate?: boolean; extra?: string },
) {
  return [
    "min-w-0 px-2",
    align === "center" ? "w-full text-center" : "text-left",
    opts?.truncate ? "truncate" : "",
    opts?.extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function registryHasSearchCriteria(f: {
  lastName: string;
  firstName: string;
  middleName: string;
  date: string;
}): boolean {
  return Boolean(
    f.lastName.trim() ||
      f.firstName.trim() ||
      f.middleName.trim() ||
      f.date.trim(),
  );
}

function normalizeRegistryNamePart(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

/** Same person: last + first + middle must match after trim, space collapse, and case fold (any mix of upper/lower). */
function patientMatchesTypedFullName(
  patient: PatientRegistryRow["patient"],
  f: { lastName: string; firstName: string; middleName: string },
): boolean {
  return (
    normalizeRegistryNamePart(patient.lastName) === normalizeRegistryNamePart(f.lastName) &&
    normalizeRegistryNamePart(patient.firstName) === normalizeRegistryNamePart(f.firstName) &&
    normalizeRegistryNamePart(patient.middleName ?? "") === normalizeRegistryNamePart(f.middleName)
  );
}

/** Figma: warn when all three names are filled and the current table includes the same person (names match ignoring case/spacing). */
function shouldWarnDuplicateBeforeCreate(
  rows: PatientRegistryRow[] | undefined,
  f: { lastName: string; firstName: string; middleName: string },
): boolean {
  if (!rows?.length) return false;
  if (!f.lastName.trim() || !f.firstName.trim() || !f.middleName.trim()) return false;
  return rows.some((row) => patientMatchesTypedFullName(row.patient, f));
}

export type PatientRegistryPageVariant = "new-consultation" | "records";

export interface AddUserRecordsPageProps {
  variant?: PatientRegistryPageVariant;
}

/**
 * Shared patient registry UI (Figma RECORDS frame).
 * - `new-consultation`: `/queue/new-consultation` — search before listing.
 * - `records`: `/queue/records` — browse registry on load.
 */
export default function AddUserRecordsPage({
  variant = "new-consultation",
}: AddUserRecordsPageProps) {
  const navigate = useNavigate();
  const isRecords = variant === "records";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    lastName: "",
    firstName: "",
    middleName: "",
    date: "",
  });
  const [duplicateRecordAlertOpen, setDuplicateRecordAlertOpen] = useState(false);
  const [recordsSort, setRecordsSort] = useState<PatientRegistrySort>("registered_desc");

  const hasSearchCriteria = registryHasSearchCriteria(filters);
  const registryGridClass = isRecords ? REGISTRY_GRID_CLASS_RECORDS : REGISTRY_GRID_CLASS_CONSULTATION;
  const registryEnabled = isRecords || hasSearchCriteria;

  const {
    data: registryRaw,
    isLoading: registryLoading,
    isFetching: registryFetching,
  } = usePatientRegistryQuery(
    {
      lastName: filters.lastName.trim() || undefined,
      firstName: filters.firstName.trim() || undefined,
      middleName: filters.middleName.trim() || undefined,
      date: filters.date.trim() || undefined,
      page,
      pageSize: PAGE_SIZE,
      sort: recordsSort,
    },
    registryEnabled,
  );

  const data = useMemo((): Paginated<PatientRegistryRow> | null => {
    if (!registryEnabled) return null;
    if (!registryRaw) {
      return { items: [], page, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 1 };
    }
    const items =
      registryRaw.items.length > 0
        ? sortPatientRegistryItems(registryRaw.items, recordsSort)
        : registryRaw.items;
    return { ...registryRaw, items };
  }, [registryEnabled, registryRaw, page, recordsSort]);

  const loading = registryEnabled && (registryLoading || registryFetching);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  const onChangeFilter =
    (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setPage(1);
      setFilters((f) => ({ ...f, [key]: e.target.value }));
    };

  const handleCreateRecordClick = () => {
    if (shouldWarnDuplicateBeforeCreate(data?.items, filters)) {
      setDuplicateRecordAlertOpen(true);
      return;
    }
    clearConsultationOcrResult();
    navigate("/queue/create-profile");
  };

  return (
    <>
      <main className="flex min-h-screen w-full flex-col bg-anivax-page">
      <TopNav user={user} />

      <div
        className={`box-border grid min-h-0 w-full flex-1 grid-cols-1 items-stretch gap-5 px-4 py-5 min-[1180px]:gap-8 min-[1180px]:py-6 ${
          isRecords
            ? "min-[1180px]:px-[clamp(24px,3.1vw,47px)] min-[1180px]:py-[15px]"
            : "min-[1180px]:grid-cols-[417px_minmax(0,1fr)] min-[1180px]:px-8"
        }`}
      >
        {!isRecords ? (
          <RegistrySearchPanel
            variant={variant}
            values={filters}
            onChange={onChangeFilter}
            onDateChange={(iso) => {
              setPage(1);
              setFilters((f) => ({ ...f, date: iso }));
            }}
            onClear={() => {
              setPage(1);
              setDuplicateRecordAlertOpen(false);
              setFilters({ lastName: "", firstName: "", middleName: "", date: "" });
            }}
            onCreateProfile={handleCreateRecordClick}
          />
        ) : null}

        <section
          className={`flex min-h-0 min-w-0 flex-col ${
            isRecords
              ? "w-full min-[1180px]:col-span-full"
              : ""
          }`}
        >
          {isRecords ? (
            <div className="flex min-h-0 min-w-0 flex-col gap-0 px-0 pb-4 pt-0 min-[1180px]:pb-5">
              {/* Figma Rectangle 66 — title strip */}
              <div
                className={`relative z-[2] box-border flex min-h-[80px] shrink-0 flex-wrap items-center justify-between gap-4 border border-black/10 bg-white px-5 py-4 shadow-[4px_4px_4px_rgb(0_0_0/0.25)] min-[1180px]:-mr-[6px] min-[1180px]:flex-nowrap min-[1180px]:px-8 min-[1180px]:py-5`}
              >
                <h1 className="m-0 shrink-0 text-[clamp(1.75rem,4vw,3.5rem)] font-bold leading-none tracking-wide text-anivax-records-coral min-[1180px]:text-[3.5rem]">
                  RECORDS
                </h1>
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-4 min-[1180px]:min-w-[280px] min-[1180px]:flex-nowrap min-[1180px]:justify-end">
                  <AnivaxSearchBar
                    value={filters.lastName}
                    onChange={onChangeFilter("lastName")}
                    ariaLabel="Search registry by patient name or registration number"
                    placeholder="Search by last name…"
                    className="min-w-[200px] flex-1 min-[1180px]:flex-initial"
                  />
                  <RegistryRecordsFilterMenu
                    value={recordsSort}
                    onChange={(sort) => {
                      setPage(1);
                      setRecordsSort(sort);
                    }}
                  />
                </div>
              </div>

              {/* Figma Rectangle 65 — data grid + pagination */}
              <div
                className={`flex min-h-0 min-w-0 flex-col border border-black/10 bg-white ${FIGMA_CARD_SHADOW} min-[1180px]:h-[640px]`}
              >
                <div className="flex min-h-0 flex-1 flex-col px-0 pb-4 pt-0 min-[1180px]:pb-6">
                  <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
                    <div
                      className="registry-data-table w-full min-w-0"
                      onMouseDown={(e) => {
                        const t = e.target;
                        if (!(t instanceof Element)) return;
                        if (t.closest("button, a, input, select, textarea, label")) return;
                        e.preventDefault();
                      }}
                    >
                      <div
                        className={`registry-table-header grid min-h-11 h-11 w-full items-center bg-anivax-table-head px-3 text-left text-[13px] font-bold uppercase tracking-wide text-black min-[1180px]:px-4 ${registryGridClass}`}
                      >
                        {RECORDS_REGISTRY_COLUMNS.map(({ label, align }) => (
                          <div key={label} className={recordsRegistryCellClass(align)}>
                            {label}
                          </div>
                        ))}
                        <div
                          className={`${recordsRegistryCellClass("center")} flex items-center justify-center`}
                        >
                          ACTIONS
                        </div>
                        <div className="min-w-0" aria-hidden="true" />
                      </div>

                      <div className="divide-y divide-black/[0.08]">
                        {loading ? (
                          <EmptyState label="Loading records..." />
                        ) : !data || data.items.length === 0 ? (
                          !hasSearchCriteria ? (
                            <EmptyState label="No patients in the registry." />
                          ) : (
                            <RegistryNoResults />
                          )
                        ) : (
                          data.items.map((row, rowIndex) => (
                            <RegistryRow
                              key={row.patient.id}
                              row={row}
                              rowIndex={rowIndex}
                              tableLayout="records"
                              gridClass={registryGridClass}
                              onRetrieveRecord={(patientId, createRecord) => {
                                if (createRecord) {
                                  cachePatientCreateRecord(patientId, createRecord);
                                }
                                navigate(`/queue/create-profile/${encodeURIComponent(patientId)}`, {
                                  state: { cancelReturnTo: "records" },
                                });
                              }}
                              onOpenHistory={(patientId, createRecord) => {
                                if (createRecord) {
                                  cachePatientCreateRecord(patientId, createRecord);
                                }
                                navigate(
                                  `/queue/records/${encodeURIComponent(patientId)}/history`,
                                );
                              }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {data ? (
                    <div className="mt-auto flex shrink-0 justify-center px-4 pt-5 min-[1180px]:px-8 min-[1180px]:pt-6">
                      <Pagination
                        page={data.page}
                        totalPages={data.totalPages}
                        onChange={setPage}
                        variant="records"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
              {/* Match records page: header strip with shadow + slight right protrusion */}
              <div
                className={`relative z-[2] box-border flex min-h-[80px] shrink-0 flex-wrap items-center justify-between gap-4 border border-black/10 bg-white px-5 py-4 shadow-[4px_4px_4px_rgb(0_0_0/0.25)] min-[1180px]:-mr-[6px] min-[1180px]:flex-nowrap min-[1180px]:px-8 min-[1180px]:py-5`}
              >
                <h1 className="m-0 shrink-0 text-[clamp(1.75rem,4vw,3.5rem)] font-bold leading-none tracking-wide text-anivax-records-coral min-[1180px]:text-[3.5rem]">
                  RECORDS
                </h1>
                <RegistryRecordsFilterMenu
                  value={recordsSort}
                  onChange={(sort) => {
                    setPage(1);
                    setRecordsSort(sort);
                  }}
                />
              </div>

              <div
                className={`flex min-h-0 flex-1 flex-col border border-black/10 bg-white px-0 pt-0 ${FIGMA_CARD_SHADOW}`}
              >
                <div className="flex min-h-0 flex-1 flex-col px-0 pb-4 pt-0 min-[1180px]:pb-6">
                {!hasSearchCriteria ? (
                  <RegistryNoResults />
                ) : (
                  <>
                    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-visible">
                      <div
                        className="registry-data-table min-w-[720px] w-full"
                        onMouseDown={(e) => {
                          const t = e.target;
                          if (!(t instanceof Element)) return;
                          if (t.closest("button, a, input, select, textarea, label")) return;
                          e.preventDefault();
                        }}
                      >
                        <div
                          className={`registry-table-header grid h-10 items-center bg-anivax-table-head px-4 text-[13px] font-bold tracking-wide text-anivax-body ${registryGridClass}`}
                        >
                          {(["ID", "NAME", "AGE | SEX", "DATE REGISTERED", "ACTIONS"] as const).map(
                            (label) => (
                              <div key={label}>{label}</div>
                            ),
                          )}
                        </div>

                        <div>
                          {loading ? (
                            <EmptyState label="Loading records..." />
                          ) : !data || data.items.length === 0 ? (
                            <RegistryNoResults />
                          ) : (
                            data.items.map((row, rowIndex) => (
                              <RegistryRow
                                key={row.patient.id}
                                row={row}
                                rowIndex={rowIndex}
                                tableLayout="consultation"
                                gridClass={registryGridClass}
                                onRetrieveRecord={(patientId, createRecord) => {
                                  if (createRecord) {
                                    cachePatientCreateRecord(patientId, createRecord);
                                  }
                                  navigate(`/queue/create-profile/${encodeURIComponent(patientId)}`, {
                                    state: { cancelReturnTo: "new-consultation" },
                                  });
                                }}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {data && data.totalPages > 1 ? (
                      <div className="mt-auto flex shrink-0 justify-center px-4 pt-4 min-[1180px]:px-8">
                        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
      {!isRecords && duplicateRecordAlertOpen ? (
        <DuplicateRecordAlertModal
          onConfirm={() => {
            setDuplicateRecordAlertOpen(false);
            clearConsultationOcrResult();
            navigate("/queue/create-profile");
          }}
          onDismiss={() => setDuplicateRecordAlertOpen(false)}
        />
      ) : null}
    </>
  );
}

function DuplicateRecordAlertModal({
  onConfirm,
  onDismiss,
}: {
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-record-alert-title"
        tabIndex={-1}
        className="box-border w-full max-w-[730px] rounded-[10px] border-4 border-[#21A89F] bg-white px-6 py-9 shadow-xl outline-none sm:px-10 sm:py-11"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DuplicateRecordAlertIcon className="mx-auto mb-6" />
        <h2
          id="duplicate-record-alert-title"
          className="m-0 mb-3 text-center text-lg font-bold uppercase leading-snug tracking-wide text-anivax-registry-border sm:text-xl"
        >
          THERE IS AN IDENTICAL RECORD!
        </h2>
        <p className="m-0 mb-8 text-center text-sm font-semibold uppercase tracking-wide text-black sm:text-base">
          ARE YOU SURE YOU WANT TO CREATE NEW RECORD?
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 min-w-[112px] cursor-pointer rounded-lg border border-anivax-body bg-anivax-danger px-6 text-sm font-bold uppercase tracking-wide text-anivax-page shadow-[0_4px_4px_rgb(0_0_0/0.25)] transition-[transform,opacity] hover:opacity-95 active:translate-y-px"
          >
            YES
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="h-10 min-w-[112px] cursor-pointer rounded-lg border border-anivax-admin-teal bg-anivax-admin-teal px-6 text-sm font-bold uppercase tracking-wide text-anivax-page shadow-[0_4px_4px_rgb(0_0_0/0.25)] transition-[transform,opacity] hover:opacity-95 active:translate-y-px"
          >
            NO
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateRecordAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      width="150"
      height="150"
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <circle cx="75" cy="75" r="52" stroke="#BF0D3E" strokeWidth="10" />
      <path d="M75 44v44" stroke="#BF0D3E" strokeWidth="10" strokeLinecap="round" />
      <circle cx="75" cy="112" r="6" fill="#BF0D3E" />
    </svg>
  );
}

function RegistrySearchPanel({
  variant,
  values,
  onChange,
  onDateChange,
  onClear,
  onCreateProfile,
}: {
  variant: PatientRegistryPageVariant;
  values: { lastName: string; firstName: string; middleName: string; date: string };
  onChange: (
    key: "lastName" | "firstName" | "middleName",
  ) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDateChange: (dateIso: string) => void;
  onClear: () => void;
  onCreateProfile: () => void;
}) {
  return (
    <div className="flex w-full max-w-[417px] flex-col gap-4 justify-self-center min-[1180px]:max-w-none min-[1180px]:justify-self-start">
      <section
        className={`box-border rounded-[2px] border-2 border-anivax-registry-border bg-white px-5 pb-5 pt-[18px] ${FIGMA_CARD_SHADOW} min-[1180px]:px-[22px]`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="m-0 text-base font-bold tracking-wide text-black">SEARCH FIELDS</h2>
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer border-none bg-transparent text-xs font-bold tracking-wide text-anivax-teal underline-offset-2 transition-opacity hover:opacity-80 hover:underline"
          >
            CLEAR
          </button>
        </div>

        <div className="flex flex-col gap-[11px]">
          <RegistryField
            placeholder="LAST NAME"
            value={values.lastName}
            onChange={onChange("lastName")}
          />
          <RegistryField
            placeholder="FIRST NAME"
            value={values.firstName}
            onChange={onChange("firstName")}
          />
          <RegistryField
            placeholder="MIDDLE NAME"
            value={values.middleName}
            onChange={onChange("middleName")}
          />
          <RegistryDateField value={values.date} onDateChange={onDateChange} />
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onCreateProfile}
            className="h-10 w-full max-w-[212px] cursor-pointer rounded-lg border-none bg-anivax-admin-teal px-4 text-base font-semibold text-[#f5f5f5] shadow-[0_4px_4px_rgb(0_0_0/0.25)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md active:translate-y-0"
          >
            Create Record
          </button>
        </div>
      </section>

      <RegistryUploadZone variant={variant} />
    </div>
  );
}

function RegistryField({
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className="box-border h-10 w-full rounded border border-[#636667] bg-white px-3 text-[13px] font-semibold tracking-wide text-black outline-none transition-[box-shadow,border-color] placeholder:text-[#d9d9d9] focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/25"
    />
  );
}

function RegistryDateField({
  value,
  onDateChange,
}: {
  value: string;
  onDateChange: (dateIso: string) => void;
}) {
  return (
    <div className="box-border flex h-10 w-full items-center overflow-hidden rounded border border-[#636667] bg-white transition-[box-shadow,border-color] focus-within:border-anivax-teal focus-within:ring-2 focus-within:ring-anivax-teal/25">
      <div className="h-[32px] w-full min-w-0 min-[1180px]:h-[36px]">
        <VaccinationM3DatePickerField
          dateIso={value}
          onChange={onDateChange}
          dense
          yearRangePast={120}
          yearRangeFuture={0}
        />
      </div>
    </div>
  );
}

function isConsultationOcrFile(f: File): boolean {
  const name = f.name.toLowerCase();
  if (f.type === "application/pdf" || name.endsWith(".pdf")) return true;
  if (f.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name);
}

function RegistryUploadZone({ variant }: { variant: PatientRegistryPageVariant }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();
  const useAddYourPhotoAsset = variant === "new-consultation";

  const handleFileChosen = (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    if (variant === "new-consultation") {
      if (!isConsultationOcrFile(f)) {
        window.alert("Please upload a PDF or image file (JPEG, PNG, GIF, WebP, BMP, or TIFF).");
        if (inputRef.current) inputRef.current.value = "";
        setFileName(null);
        return;
      }
      const payload: ConsultationOcrLocationState = { file: f, fileName: f.name, fileSize: f.size };
      navigate("/queue/consultation-ocr", { state: payload });
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const sectionShell = useAddYourPhotoAsset
    ? `box-border flex w-full flex-col gap-1.5 bg-transparent p-0 ${FIGMA_CARD_SHADOW} transition-colors ${
        dragOver ? "ring-2 ring-anivax-teal/40" : ""
      }`
    : `box-border flex min-h-[84px] w-full items-center gap-4 border border-black/50 bg-anivax-registry-upload-bg px-4 py-3 ${FIGMA_CARD_SHADOW} transition-colors min-[1180px]:gap-5 min-[1180px]:px-5 ${
        dragOver ? "ring-2 ring-anivax-teal/40" : ""
      }`;

  return (
    <section
      className={sectionShell}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        handleFileChosen(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={useAddYourPhotoAsset ? "application/pdf,.pdf,image/*" : "image/*,.pdf"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          handleFileChosen(f);
        }}
      />
      {useAddYourPhotoAsset ? (
        <>
          <button
            type="button"
            onClick={onPick}
            className="block w-full cursor-pointer border-none bg-transparent p-0 text-left transition-opacity hover:opacity-90"
          >
            <img
              src="/images/ADDyPHOTO.svg"
              alt="Upload file"
              width={417}
              height={84}
              draggable={false}
              className="pointer-events-none block h-auto w-full max-h-[84px]"
            />
          </button>
          {fileName ? (
            <p className="m-0 px-4 pb-3 text-center text-[11px] font-medium leading-tight text-black min-[1180px]:px-5 min-[1180px]:text-left">
              <span className="truncate">{fileName}</span>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <DocumentImageIcon className="h-[50px] w-10 shrink-0 text-black" />
          <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1.5">
            <button
              type="button"
              onClick={onPick}
              className="flex h-[30px] w-full max-w-[273px] cursor-pointer items-center justify-center gap-2 rounded border-none bg-black text-xs font-bold uppercase tracking-wide text-white shadow-[0_4px_4px_rgb(0_0_0/0.25)] transition-[transform,opacity] hover:opacity-90"
            >
              <UploadArrowIcon className="h-4 w-4 shrink-0 text-white" />
              UPLOAD
            </button>
            <p className="m-0 text-center text-[11px] font-medium leading-tight text-black min-[1180px]:text-left">
              {fileName ? (
                <span className="truncate">{fileName}</span>
              ) : (
                <>or drag and drop a file</>
              )}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function RegistryRow({
  row,
  rowIndex,
  onRetrieveRecord,
  onOpenHistory,
  tableLayout,
  gridClass,
}: {
  row: PatientRegistryRow;
  rowIndex: number;
  onRetrieveRecord?: (patientId: string, createRecord?: PatientRegistryRow["createRecord"]) => void;
  onOpenHistory?: (
    patientId: string,
    createRecord?: PatientRegistryRow["createRecord"],
  ) => void;
  tableLayout: "records" | "consultation";
  gridClass: string;
}) {
  const { patient } = row;
  const registeredDisplay = patient.registeredAt
    ? new Date(patient.registeredAt + "T12:00:00")
        .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        .toUpperCase()
    : tableLayout === "records"
      ? "(DATE REGISTERED)"
      : "—";

  const name = formatRegistryName(patient);
  const birthday = formatRegistryBirthday(patient.birthDate);
  const regNo =
    patient.registrationNo?.trim() ||
    (tableLayout === "records" ? "(NUMBER)" : patient.id.slice(0, 8));

  const rowBgClass =
    tableLayout === "records"
      ? rowIndex % 2 === 0
        ? "bg-white"
        : "bg-anivax-page"
      : "";

  return (
    <div
      className={`registry-table-row grid items-center text-[13px] font-medium text-anivax-body ${rowBgClass} ${gridClass} ${
        tableLayout === "records"
          ? "min-h-11 h-11 w-full px-3 min-[1180px]:px-4"
          : "h-10 min-h-10 px-4"
      }`}
    >
      <span
        className={
          tableLayout === "records"
            ? recordsRegistryCellClass("left", { truncate: true })
            : "truncate text-left"
        }
      >
        {tableLayout === "records" ? regNo : patient.id}
      </span>
      <span
        className={
          tableLayout === "records"
            ? recordsRegistryCellClass("center", { truncate: true, extra: "font-medium" })
            : "truncate font-semibold"
        }
      >
        {name}
      </span>
      <span
        className={
          tableLayout === "records" ? recordsRegistryCellClass("center") : "text-left"
        }
      >
        {patientDisplayAgeYears(patient.birthDate, patient.ageYears)}/{patient.sex}
      </span>
      {tableLayout === "records" ? (
        <span className={recordsRegistryCellClass("center", { truncate: true })}>{birthday}</span>
      ) : null}
      <span
        className={
          tableLayout === "records"
            ? recordsRegistryCellClass("center", { truncate: true })
            : "truncate text-left"
        }
      >
        {registeredDisplay}
      </span>
      {tableLayout === "records" ? (
        <>
          <span
            className={`${recordsRegistryCellClass("center")} flex items-center justify-center`}
          >
            <button
              type="button"
              onClick={() => onRetrieveRecord?.(patient.id, row.createRecord)}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-none bg-transparent p-0 text-xs font-bold uppercase tracking-wide text-anivax-admin-teal transition-[opacity,transform] hover:translate-x-0.5 hover:opacity-90"
              aria-label="Retrieve record"
            >
              <EditIcon /> RETRIEVE RECORD
            </button>
          </span>
          <span className="flex min-w-0 items-center justify-center pl-4 min-[1180px]:pl-6">
            <button
              type="button"
              onClick={() => onOpenHistory?.(patient.id, row.createRecord)}
              className="inline-flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0 text-black transition-opacity hover:opacity-80"
              aria-label="Open consultation history"
              title="Consultation history"
            >
              <img
                src="/images/image%2011.svg"
                alt=""
                width={20}
                height={19}
                draggable={false}
                className="h-[19px] w-5 shrink-0 object-contain"
              />
            </button>
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-nowrap items-center justify-start gap-2">
          <button
            type="button"
            onClick={() => onRetrieveRecord?.(patient.id, row.createRecord)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-none bg-transparent p-0 text-xs font-bold uppercase tracking-wide text-anivax-admin-teal transition-[opacity,transform] hover:translate-x-0.5 hover:opacity-90"
            aria-label="Retrieve record"
          >
            <EditIcon /> RETRIEVE RECORD
          </button>
        </span>
      )}
    </div>
  );
}

function formatRegistryBirthday(iso?: string): string {
  if (!iso?.trim()) return "(B-DAY)";
  const d = new Date(`${iso.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "(B-DAY)";
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

function formatRegistryName(p: PatientRegistryRow["patient"]): string {
  const middle = p.middleName ? ` ${p.middleName}` : "";
  return `${p.lastName.toUpperCase()}, ${p.firstName.toUpperCase()}${middle.toUpperCase()}`;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center px-4 text-sm font-semibold text-anivax-body">
      {label}
    </div>
  );
}

function RegistryNoResults() {
  return (
    <div className="flex min-h-[min(400px,calc(100vh-420px))] items-start justify-center px-4 pt-10 min-[1180px]:pt-14">
      <p
        className="m-0 text-center text-lg font-bold uppercase tracking-wide text-anivax-danger min-[1180px]:text-xl"
        role="status"
      >
        NO RESULTS FOUND
      </p>
    </div>
  );
}

function FilterFunnelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 18" fill="none" aria-hidden="true" className={className}>
      <path
        d="M1 3h18M3.5 9h13M6 15h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RegistryRecordsFilterMenu({
  value,
  onChange,
}: {
  value: PatientRegistrySort;
  onChange: (sort: PatientRegistrySort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onDocPointer, true);
    };
  }, [open]);

  const activeLabel =
    RECORDS_SORT_OPTIONS.find((o) => o.value === value)?.label ?? "Sort records";

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Sort records"
            style={{ top: menuPos.top, right: menuPos.right }}
            className="fixed z-[200] min-w-[260px] overflow-hidden rounded-md border border-black/10 bg-white py-1 shadow-lg ring-1 ring-black/5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {RECORDS_SORT_OPTIONS.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide transition-colors hover:bg-anivax-sky/40 ${
                    selected ? "bg-anivax-sky/30 text-anivax-admin-teal" : "text-anivax-ink"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Sort records"
        aria-expanded={open}
        aria-haspopup="menu"
        title={activeLabel}
        onClick={() => {
          if (!open) updateMenuPosition();
          setOpen((prev) => !prev);
        }}
        className={`inline-flex shrink-0 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-[21px] font-semibold leading-none transition-opacity hover:opacity-80 ${
          value !== "registered_desc" ? "text-anivax-admin-teal" : "text-black"
        }`}
      >
        <FilterFunnelIcon className="h-[15px] w-[17px] shrink-0 text-current" />
        Filter
      </button>
      {menu}
    </>
  );
}

function DocumentImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 50" fill="none" aria-hidden="true" className={className}>
      <path
        d="M8 4h14l10 10v32a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M22 4v10h10M12 28h16M12 34h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="16" cy="20" r="3" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

function UploadArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 4v14M8 8l4-4 4 4M5 20h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
  variant,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  variant?: "default" | "records";
}) {
  const isRecords = variant === "records";
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const prevLabel = isRecords ? "PREV" : "Prev";
  const nextLabel = isRecords ? "NEXT" : "Next";

  if (isRecords) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => canPrev && onChange(page - 1)}
          disabled={!canPrev}
          className={`inline-flex h-8 items-center gap-2 rounded-lg border-none bg-transparent px-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
            canPrev
              ? "cursor-pointer text-[#757575] hover:text-anivax-ink"
              : "cursor-not-allowed text-[#757575]/50"
          }`}
        >
          <ArrowLeft active={canPrev} /> {prevLabel}
        </button>
        <PageBubble n={page} active />
        <button
          type="button"
          onClick={() => canNext && onChange(page + 1)}
          disabled={!canNext}
          className={`inline-flex h-8 items-center gap-2 rounded-lg border-none bg-transparent px-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
            canNext
              ? "cursor-pointer text-[#1e1e1e] hover:text-anivax-ink"
              : "cursor-not-allowed text-[#1e1e1e]/50"
          }`}
        >
          {nextLabel} <ArrowRight active={canNext} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => canPrev && onChange(page - 1)}
        disabled={!canPrev}
        className={`flex items-center gap-2 border-none bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
          canPrev
            ? "cursor-pointer text-[#757575] hover:text-anivax-ink"
            : "cursor-not-allowed text-[#757575]/50"
        }`}
      >
        <ArrowLeft active={canPrev} /> {prevLabel}
      </button>
      <PageBubble n={page} active />
      <button
        type="button"
        onClick={() => canNext && onChange(page + 1)}
        disabled={!canNext}
        className={`flex items-center gap-2 border-none bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
          canNext
            ? "cursor-pointer text-[#757575] hover:text-anivax-ink"
            : "cursor-not-allowed text-[#1e1e1e]/50"
        }`}
      >
        {nextLabel} <ArrowRight active={canNext} />
      </button>
    </div>
  );
}

function PageBubble({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 min-w-[30px] items-center justify-center rounded-full px-1.5 text-xs font-bold transition-transform ${
        active ? "bg-[#2E8C6C] text-[#F5F5F5]" : "bg-transparent text-anivax-ink"
      }`}
    >
      {n}
    </span>
  );
}

function ArrowLeft({ active = true }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={active ? "text-[#1e1e1e]" : "text-[#1e1e1e]/50"}
    >
      <path
        d="M9 3L5 7l4 4M5 7h7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRight({ active = true }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={active ? "text-[#1e1e1e]" : "text-[#1e1e1e]/50"}
    >
      <path
        d="M5 3l4 4-4 4M9 7H2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-current"
    >
      <path
        d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
