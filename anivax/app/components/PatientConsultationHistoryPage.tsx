import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  cachePatientCreateRecord,
  getCurrentUser,
  getPatientConsultationHistory,
  getPatientCreateRecord,
} from "../services/queueService";
import { fetchStoredPatientFile } from "../services/filesService";
import type { AuthUser, PatientConsultationRow } from "../types/domain";
import type { CreateProfileFormState, PatientCreateRecord } from "./createProfileRecord";
import TopNav from "./TopNav";

const PAGE_SIZE = 8;

function formatProfileName(form: CreateProfileFormState): string {
  const middle = form.middleName.trim()
    ? ` ${form.middleName.trim().charAt(0)}.`
    : "";
  const suffix =
    form.suffix.trim() && form.suffix.trim().toUpperCase() !== "NONE"
      ? ` ${form.suffix.trim()}`
      : "";
  return `${form.firstName.trim()}${middle} ${form.lastName.trim()}${suffix}`
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function formatProfileAddress(form: CreateProfileFormState, fallback?: string): string {
  const parts = [form.street, form.barangay, form.city, form.province, form.region, form.zip]
    .map((p) => p?.trim())
    .filter(Boolean);
  const joined = parts.join(", ");
  return (joined || fallback || "—").toUpperCase();
}

function formatAttendantName(row: PatientConsultationRow): string {
  const { firstName, lastName, credential } = row.attendant;
  return `${firstName} ${lastName}, ${credential}`.trim().toUpperCase();
}

function formatConsultationMonthYear(scheduledAt: string): string {
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

function formatSexDisplay(formSex?: string, patientSex?: string): string {
  const raw = (formSex?.trim() || patientSex?.trim() || "").toUpperCase();
  if (!raw) return "—";
  if (raw === "M" || raw === "MALE") return "M";
  if (raw === "F" || raw === "FEMALE") return "F";
  return raw;
}

export default function PatientConsultationHistoryPage() {
  const navigate = useNavigate();
  const { patientId = "" } = useParams();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [record, setRecord] = useState<PatientCreateRecord | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getPatientConsultationHistory>>>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    getPatientCreateRecord(patientId).then((result) => {
      if (!active) return;
      if (result?.ok) {
        setRecord(result.record);
        cachePatientCreateRecord(patientId, result.record);
      } else {
        setRecord(null);
      }
    });
    return () => {
      active = false;
    };
  }, [patientId]);

  useEffect(() => {
    const fileId = record?.photo?.fileId;
    if (!fileId) {
      setPhotoUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    fetchStoredPatientFile(fileId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => {
        if (active) setPhotoUrl(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record?.photo?.fileId]);

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    setLoading(true);
    getPatientConsultationHistory(patientId, { page, pageSize: PAGE_SIZE }).then((data) => {
      if (!active) return;
      setHistory(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [patientId, page]);

  const form = record?.form;
  const patient = history?.patient;
  const displayName = form ? formatProfileName(form) : patient
    ? `${patient.firstName} ${patient.lastName}`.trim().toUpperCase()
    : "PATIENT";
  const ageYears = form?.ageYears || (patient?.ageYears != null ? String(patient.ageYears) : "—");
  const ageSexLine = `Age: ${ageYears}   ${formatSexDisplay(form?.sex, patient?.sex)}`;
  const address = form
    ? formatProfileAddress(form, patient?.address)
    : (patient?.address ?? "—").toUpperCase();

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-anivax-page">
      <TopNav user={user} />

      <div className="box-border flex min-h-0 flex-1 flex-col px-6 py-5 min-[1180px]:px-10 min-[1180px]:py-6">
        <article className="sticky top-0 z-10 mb-4 shrink-0 rounded border border-black/10 bg-white px-5 py-5 shadow-[4px_4px_4px_rgb(0_0_0/0.25)] min-[1180px]:px-8 min-[1180px]:py-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex min-w-0 flex-1 flex-wrap items-start gap-6">
              <div className="flex h-[150px] w-[150px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/20 bg-[#E8E8E8]">
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <img
                    src="/images/ADD%20PHOTO.svg"
                    alt=""
                    className="h-full w-full object-cover object-center opacity-80"
                    draggable={false}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <h1 className="m-0 text-[clamp(2rem,5vw,3.5rem)] font-bold leading-none tracking-wide text-anivax-records-coral">
                  {displayName}
                </h1>
                <p className="mt-3 mb-2 text-sm font-semibold text-anivax-ink">{ageSexLine}</p>
                <p className="m-0 max-w-[720px] text-sm font-medium leading-snug text-anivax-ink">
                  {address}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/queue/records")}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded border border-[#A61F46] bg-anivax-danger px-4 text-xs font-bold uppercase tracking-wide text-white shadow-anivax-elevated transition-opacity hover:opacity-90"
              >
                CLOSE
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate(`/queue/create-profile/${encodeURIComponent(patientId)}`, {
                    state: { cancelReturnTo: "records" },
                  })
                }
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border-none bg-black px-4 text-xs font-bold uppercase tracking-wide text-white shadow-anivax-elevated transition-opacity hover:opacity-90"
              >
                <EditIcon />
                EDIT
              </button>
            </div>
          </div>
        </article>

        <section className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
          <h2 className="m-0 mb-4 shrink-0 text-[clamp(1.75rem,4vw,2.75rem)] font-bold uppercase tracking-wide text-[#7C5CFC]">
            HISTORY
          </h2>

          <div className="shrink-0 overflow-hidden rounded border border-black/10 bg-white shadow-[4px_4px_4px_rgb(0_0_0/0.25)]">
            <div className="registry-data-table w-full min-w-0">
              <div className="registry-table-header grid min-h-11 h-11 w-full grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.1fr)] items-center bg-anivax-table-head px-4 text-left text-[13px] font-bold uppercase tracking-wide text-black">
                <div>DATE</div>
                <div className="text-center">STATUS</div>
                <div className="text-center">ATTENDANT</div>
                <div className="text-center">ACTIONS</div>
              </div>

              {loading ? (
                <HistoryEmptyRow label="Loading consultation history…" />
              ) : !history || history.items.length === 0 ? (
                <HistoryEmptyRow label="No consultations recorded yet." />
              ) : (
                history.items.map((row, index) => (
                  <div
                    key={row.appointmentId}
                    className={`registry-table-row grid min-h-11 h-11 w-full grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.1fr)] items-center px-4 text-[13px] font-medium text-anivax-body ${
                      index % 2 === 0 ? "bg-white" : "bg-anivax-page"
                    }`}
                  >
                    <span className="truncate">{formatConsultationMonthYear(row.scheduledAt)}</span>
                    <span
                      className={`text-center text-xs font-bold uppercase tracking-wide ${
                        row.consultationStatus === "COMPLETED"
                          ? "text-[#2E8C6C]"
                          : "text-anivax-danger"
                      }`}
                    >
                      {row.consultationStatus}
                    </span>
                    <span className="truncate text-center">{formatAttendantName(row)}</span>
                    <span className="flex justify-center">
                      <Link
                        to={`/retrieve/${encodeURIComponent(row.appointmentId)}`}
                        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-anivax-admin-teal no-underline transition-opacity hover:opacity-80"
                      >
                        VIEW CONSULTATION
                        <ExternalLinkIcon />
                      </Link>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {history && history.totalPages > 1 ? (
            <div className="mt-8 flex shrink-0 justify-center">
              <HistoryPagination
                page={history.page}
                totalPages={history.totalPages}
                onChange={setPage}
              />
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function HistoryEmptyRow({ label }: { label: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center px-4 text-sm font-semibold text-anivax-body">
      {label}
    </div>
  );
}

function HistoryPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => canPrev && onChange(page - 1)}
        disabled={!canPrev}
        className={`inline-flex h-8 items-center gap-2 rounded-lg border-none bg-transparent px-3 text-xs font-semibold uppercase tracking-wide ${
          canPrev
            ? "cursor-pointer text-[#757575] hover:text-anivax-ink"
            : "cursor-not-allowed text-[#757575]/50"
        }`}
      >
        <ArrowLeft active={canPrev} /> PREV
      </button>
      <span className="inline-flex h-7 min-w-[30px] items-center justify-center rounded-full bg-[#2E8C6C] px-1.5 text-xs font-bold text-[#F5F5F5]">
        {page}
      </span>
      <button
        type="button"
        onClick={() => canNext && onChange(page + 1)}
        disabled={!canNext}
        className={`inline-flex h-8 items-center gap-2 rounded-lg border-none bg-transparent px-3 text-xs font-semibold uppercase tracking-wide ${
          canNext
            ? "cursor-pointer text-[#1e1e1e] hover:text-anivax-ink"
            : "cursor-not-allowed text-[#1e1e1e]/50"
        }`}
      >
        NEXT <ArrowRight active={canNext} />
      </button>
    </div>
  );
}

function ArrowLeft({ active = true }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={active ? "text-[#1e1e1e]" : "text-[#1e1e1e]/50"}>
      <path d="M9 3L5 7l4 4M5 7h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRight({ active = true }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={active ? "text-[#1e1e1e]" : "text-[#1e1e1e]/50"}>
      <path d="M5 3l4 4-4 4M9 7H2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-white">
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M14 3h7v7M10 14L21 3M21 10v11H3V3h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
