import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  createAppointment,
  getCurrentUser,
  getPatientHistoryWithProfile,
  getRecordedVitalsForAppointment,
  retrieveAppointment,
  saveDoctorsOrder,
  saveVaccinationRecord,
  getVaccinationRecordForAppointment,
  searchAppointments,
  updateAppointment,
} from "../services/queueService";
import { notifyDataChanged } from "../services/dataSync";
import { getStaffUserId } from "../services/authStore";
import type {
  Appointment,
  AppointmentTab,
  AuthUser,
  BiteCategory,
  BodyView,
  DoctorsOrder,
  HistoryTabId,
  PatientHistory,
  Vitals,
} from "../types/domain";
import {
  buildScheduledAtFromSlot,
  loadVaccinationScheduleSlots,
  scheduleSlotPartsFromIso,
} from "../utils/scheduleSlots";
import { BITE_CATEGORY_OPTIONS, biteCategoryLabel, parseBiteCategory } from "../utils/biteCategory";
import { normalizeDoctorsOrder } from "../utils/defaultDoctorsOrder";
import {
  emptyCreateProfileForm,
  patientCreateRecordCacheKey,
  type CreateProfileFormState,
  type PatientCreateRecord,
} from "./createProfileRecord";
import { SectionTag } from "./ProfileSectionAccordion";
import SuccessAlert from "./SuccessAlert";
import TopNav from "./TopNav";
import { SignaturePadField } from "./SignaturePadField";
import { VaccinationM3DatePickerField, VaccinationM3TimePickerField } from "./VaccinationM3Pickers";

/** Tab bar matches retrieve-history Figma (3 sections). */
const TABS: { id: HistoryTabId; label: string }[] = [
  { id: "PERSONAL_INFO", label: "PERSONAL INFORMATION" },
  { id: "DOCTORS_ORDER", label: "DOCTOR'S ORDER" },
  { id: "VACCINATION", label: "VACCINATION" },
];

const HISTORY_TAB_ACTIVE_COLOR: Record<HistoryTabId, string> = {
  PERSONAL_INFO: "#21A89F",
  DOCTORS_ORDER: "#7C5CFC",
  VACCINATION: "#FF7A59",
};

const retrieveLabelClass = "mb-1 block text-[11px] font-semibold tracking-wide text-anivax-muted";
const retrieveReadonlyClass =
  "create-profile-input box-border h-[25px] w-full cursor-default rounded border border-[#D9D9D9] bg-white px-2.5 text-[13px] font-semibold text-anivax-ink outline-none read-only:opacity-100";

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function useWindowWidth() {
  const [w, setW] = useState<number>(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

function formatLongDate(iso: string): string {
  if (!iso || iso === "???") return iso;
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  if (!y || !m || !d) return iso;
  const months = [
    "JANUARY",
    "FEBRUARY",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUGUST",
    "SEPTEMBER",
    "OCTOBER",
    "NOVEMBER",
    "DECEMBER",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

function formatTime12h(t: string): string {
  if (!t || t === "???") return t;
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const m = Number(mStr ?? 0);
  if (Number.isNaN(h)) return t;
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${h}:${mm} ${suffix}`;
}

function formatIncidenceDate(iso: string): string {
  if (!iso || iso === "???") return "";
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  if (!y || !m || !d) return iso;
  const mm = m < 10 ? `0${m}` : `${m}`;
  const dd = d < 10 ? `0${d}` : `${d}`;
  return `${mm}/${dd}/${y}`;
}

function parseBloodPressureParts(bp?: string): { sys: string; dia: string } {
  if (!bp) return { sys: "", dia: "" };
  const m = bp.match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
  if (!m) return { sys: "", dia: "" };
  return { sys: m[1], dia: m[2] };
}

function formatAnimalTypeLabel(value: string): string {
  if (!value || value === "???") return "";
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function vitalsDisplayValue(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return String(value);
}

function nurseNoteVitalsAvailable(vitals?: Vitals): boolean {
  if (!vitals) return false;
  const bp = parseBloodPressureParts(vitals.bloodPressure);
  return Boolean(
    vitals.temperatureC != null ||
      vitals.weightKg != null ||
      bp.sys ||
      bp.dia,
  );
}

function vitalsToNurseNotePatch(vitals: Vitals): Partial<NurseNoteRowState> {
  const bp = parseBloodPressureParts(vitals.bloodPressure);
  return {
    tempC: vitalsDisplayValue(vitals.temperatureC),
    weightKg: vitalsDisplayValue(vitals.weightKg),
    bpSys: bp.sys,
    bpDia: bp.dia,
  };
}

/**
 * Computes a "Y M D" age string (e.g. "45Y 4M 12D") from a birth date.
 * Uses the same anchor "now" the rest of the queue uses.
 */
function ageBreakdown(birthIso: string): string {
  if (!birthIso) return "";
  const birth = new Date(birthIso);
  if (Number.isNaN(birth.getTime())) return "";
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();
  if (days < 0) {
    months -= 1;
    const lastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += lastMonth;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${years}Y ${months}M ${days}D`;
}

/* -------------------------------------------------------------------------- */
/*                                Page entry                                  */
/* -------------------------------------------------------------------------- */

export default function RetrieveHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ appointmentId: string }>();
  const appointmentId = params.appointmentId ?? "";
  const queueReturnState = location.state as {
    queueActiveTab?: AppointmentTab;
    queueFocusDate?: string;
  } | null;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [history, setHistory] = useState<PatientHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<HistoryTabId>("PERSONAL_INFO");
  const [abtcPreviewOpen, setAbtcPreviewOpen] = useState(false);
  const [abtcVaccinationPayload, setAbtcVaccinationPayload] =
    useState<VaccinationPersistedPayload | null>(null);
  const [abtcPayloadLoading, setAbtcPayloadLoading] = useState(false);
  const [abtcPreviewKey, setAbtcPreviewKey] = useState(0);
  const abtcVaccinationGetterRef = useRef<(() => VaccinationPersistedPayload) | null>(null);
  const [showUnauthorizedAlert, setShowUnauthorizedAlert] = useState(false);
  const [doctorsOrderToolbar, setDoctorsOrderToolbar] = useState<{
    onSave: () => void;
    saving: boolean;
  } | null>(null);
  const [vaccinationToolbar, setVaccinationToolbar] = useState<{
    onSave: () => void;
    saving: boolean;
  } | null>(null);

  const canAccessClinicalHistoryTabs = useMemo(() => {
    if (!user) return true;
    const role = user.role.toUpperCase();
    // ENCODER may view Personal Information only (not Doctor's Order / Vaccination).
    if (role === "ENCODER") return false;
    return (
      role === "ADMIN" ||
      role === "PROGRAM COORDINATOR" ||
      role === "RHU STAFF"
    );
  }, [user]);

  const handleHistoryTabChange = (tab: HistoryTabId) => {
    if (tab !== "PERSONAL_INFO" && !canAccessClinicalHistoryTabs) {
      setShowUnauthorizedAlert(true);
      return;
    }
    if (tab !== "DOCTORS_ORDER") setDoctorsOrderToolbar(null);
    if (tab !== "VACCINATION") setVaccinationToolbar(null);
    setActiveTab(tab);
  };

  const handleViewAbtcForm = async () => {
    if (!canAccessClinicalHistoryTabs) {
      setShowUnauthorizedAlert(true);
      return;
    }
    if (!history) return;
    setAbtcPreviewOpen(true);
    setAbtcPayloadLoading(true);
    try {
      const payload = await resolveAbtcVaccinationPayload(
        history.appointmentId,
        abtcVaccinationGetterRef.current,
      );
      setAbtcVaccinationPayload(payload);
      setAbtcPreviewKey((k) => k + 1);
    } catch {
      setAbtcVaccinationPayload({ vaccination: {}, nursesNote: { rows: [] } });
      setAbtcPreviewKey((k) => k + 1);
    } finally {
      setAbtcPayloadLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyHistoryFromServer = (h: PatientHistory) => {
    const doctorsOrder = normalizeDoctorsOrder(h.doctorsOrder);
    setHistory({
      ...h,
      doctorsOrder,
      category: doctorsOrder.biteCategory ?? h.category,
    });
  };

  const reloadHistory = async () => {
    const h = await getPatientHistoryWithProfile(appointmentId);
    if (h) applyHistoryFromServer(h);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPatientHistoryWithProfile(appointmentId).then((h) => {
      if (cancelled) return;
      if (h) applyHistoryFromServer(h);
      else setHistory(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  const winW = useWindowWidth();
  const isSmall = winW < 900;

  const [planBoosterActive, setPlanBoosterActive] = useState<boolean | null>(null);
  const [planPepActive, setPlanPepActive] = useState<boolean | null>(null);
  const [planPrepActive, setPlanPrepActive] = useState<boolean | null>(null);
  const serverPlanBooster = !!normalizeDoctorsOrder(history?.doctorsOrder).plan.booster;
  const serverPlanPep = !!normalizeDoctorsOrder(history?.doctorsOrder).plan.pep;
  const serverPlanPrep = !!normalizeDoctorsOrder(history?.doctorsOrder).plan.prep;
  const boosterScheduleActive = planBoosterActive ?? serverPlanBooster;
  const pepScheduleActive = planPepActive ?? serverPlanPep;
  const prepScheduleActive = planPrepActive ?? serverPlanPrep;

  useEffect(() => {
    setPlanBoosterActive(null);
  }, [history?.appointmentId, serverPlanBooster]);

  useEffect(() => {
    setPlanPepActive(null);
  }, [history?.appointmentId, serverPlanPep]);

  useEffect(() => {
    setPlanPrepActive(null);
  }, [history?.appointmentId, serverPlanPrep]);

  return (
    <main className="flex min-h-screen w-full flex-col bg-white">

      <div className="no-print">
        <TopNav user={user} />
      </div>

      <div
        className={
          [
            "print-area",
            "box-border flex w-full flex-1 flex-col gap-5 bg-white px-4 pb-8 pt-4 min-[900px]:px-8 min-[900px]:pt-5",
            activeTab === "VACCINATION" && "print-area-vaccination",
            activeTab === "PERSONAL_INFO" && "print-area-personal",
          ]
            .filter(Boolean)
            .join(" ") || "print-area"
        }
      >
        <div className="no-print sticky top-16 z-[25] bg-white min-[900px]:top-20">
          <HistoryTabBar
            activeTab={activeTab}
            onChange={handleHistoryTabChange}
            onPrint={() => window.print()}
            onViewAbtcForm={handleViewAbtcForm}
            onBack={() =>
              navigate("/queue", {
                state: {
                  queueActiveTab: queueReturnState?.queueActiveTab,
                  queueFocusDate: queueReturnState?.queueFocusDate,
                  queueRefetch: Date.now(),
                },
              })
            }
            isSmall={isSmall}
            saveAction={
              activeTab === "DOCTORS_ORDER" && history && doctorsOrderToolbar
                ? doctorsOrderToolbar
                : activeTab === "VACCINATION" && history && vaccinationToolbar
                  ? vaccinationToolbar
                  : undefined
            }
          />
        </div>

        {loading ? (
          <PlaceholderCard text="Loading patient history???" />
        ) : !history ? (
          <PlaceholderCard text="Patient history not found." />
        ) : activeTab === "PERSONAL_INFO" ? (
          <div className="print-personal-bundle flex w-full flex-col gap-4">
            <PersonalInfoCard history={history} isSmall={isSmall} />
            <ExposureCard history={history} isSmall={isSmall} />
          </div>
        ) : activeTab === "DOCTORS_ORDER" ? (
          <DoctorsOrderCard
            history={history}
            isSmall={isSmall}
            winW={winW}
            onSaved={reloadHistory}
            onRegisterToolbar={setDoctorsOrderToolbar}
            onPlanBoosterChange={setPlanBoosterActive}
            onPlanPepChange={setPlanPepActive}
            onPlanPrepChange={setPlanPrepActive}
          />
        ) : activeTab === "VACCINATION" ? (
          <VaccinationTabShell
            history={history}
            isSmall={isSmall}
            boosterScheduleActive={boosterScheduleActive}
            pepScheduleActive={pepScheduleActive}
            prepScheduleActive={prepScheduleActive}
            onRegisterToolbar={setVaccinationToolbar}
            onRegisterAbtcSnapshot={(getter) => {
              abtcVaccinationGetterRef.current = getter;
            }}
            onFollowUpSynced={() => notifyDataChanged("appointments")}
          />
        ) : (
          <PlaceholderCard
            text={`${TABS.find((t) => t.id === activeTab)?.label ?? ""} ??? coming soon.`}
          />
        )}
      </div>

      {!loading && history ? (
        <AbtcFormPreviewModal
          open={abtcPreviewOpen}
          onClose={() => setAbtcPreviewOpen(false)}
          history={history}
          isSmall={isSmall}
          winW={winW}
          vaccinationPayload={abtcVaccinationPayload}
          payloadLoading={abtcPayloadLoading}
          previewKey={abtcPreviewKey}
          boosterScheduleActive={boosterScheduleActive}
          pepScheduleActive={pepScheduleActive}
          prepScheduleActive={prepScheduleActive}
        />
      ) : null}

      {showUnauthorizedAlert ? (
        <RetrieveUnauthorizedAlert onClose={() => setShowUnauthorizedAlert(false)} />
      ) : null}
    </main>
  );
}

function RetrieveUnauthorizedAlert({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/15 backdrop-blur-[1px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(560px,calc(100vw-40px))] rounded-lg border-2 border-anivax-teal bg-white px-5 pb-9 pt-8 text-center shadow-anivax-card"
      >
        <div className="mx-auto mb-6 flex h-[74px] w-[74px] items-center justify-center rounded-full border-[5px] border-[#C21A4A] text-[42px] font-bold leading-none text-[#C21A4A]">
          !
        </div>
        <p className="m-0 text-[34px] font-extrabold tracking-wide text-[#111]">UNAUTHORIZED USER</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Tab + print bar                                */
/* -------------------------------------------------------------------------- */

interface HistoryTabBarProps {
  activeTab: HistoryTabId;
  onChange: (id: HistoryTabId) => void;
  onPrint: () => void;
  onViewAbtcForm: () => void;
  onBack: () => void;
  isSmall: boolean;
  saveAction?: { onSave: () => void; saving: boolean };
}

function HistoryTabBar({
  activeTab,
  onChange,
  onPrint,
  onViewAbtcForm,
  onBack,
  isSmall,
  saveAction,
}: HistoryTabBarProps) {
  return (
    <div className="grid w-full grid-cols-1 items-center gap-3 border-b border-black/10 bg-white px-0 pb-2.5 pt-1 shadow-[0_4px_6px_-2px_rgba(0,0,0,0.1)] min-[900px]:grid-cols-[1fr_auto_1fr] min-[900px]:gap-4">
      <div className="flex flex-wrap items-center justify-center gap-3 min-[900px]:justify-start min-[900px]:gap-4">
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded border-none bg-[#D9D9D9] px-3.5 text-[11px] font-bold tracking-wide text-black transition-[transform,filter] hover:brightness-95 active:translate-y-px min-[900px]:h-10 min-[900px]:px-4 min-[900px]:text-xs"
        >
          <PrinterIcon />
          Print Vaccine Card
        </button>
        <button
          type="button"
          onClick={onViewAbtcForm}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded border-none bg-black px-3.5 text-[11px] font-bold tracking-wide text-white transition-[transform,filter] hover:brightness-110 active:translate-y-px min-[900px]:h-10 min-[900px]:px-4 min-[900px]:text-xs"
        >
          View ABTC Form
          <ExternalLinkIcon />
        </button>
      </div>

      <nav className="flex min-w-0 items-stretch justify-center gap-1 overflow-x-auto sm:gap-2">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          const tabColor = HISTORY_TAB_ACTIVE_COLOR[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              style={active ? { color: tabColor } : undefined}
              className={`relative shrink-0 cursor-pointer border-none bg-transparent px-4 pb-2.5 pt-1 text-center font-bold uppercase tracking-wide transition-colors sm:min-w-[140px] sm:px-6 min-[1180px]:px-8 ${
                isSmall ? "min-w-[108px] text-[11px]" : "min-w-[120px] text-sm"
              } ${active ? "" : "text-anivax-muted hover:opacity-80"}`}
            >
              {tab.label}
              <span
                style={active ? { backgroundColor: tabColor } : undefined}
                className={`absolute bottom-0 left-0 h-0.5 rounded-full transition-all ${
                  active ? "w-full" : "w-0 bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </nav>

      <div className="flex items-center justify-center gap-3 min-[900px]:justify-end min-[900px]:gap-4">
        {saveAction ? (
          <button
            type="button"
            onClick={() => void saveAction.onSave()}
            disabled={saveAction.saving}
            className="flex h-9 w-[122px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-[#2F9470] bg-[#3EB487] px-2 text-[10px] leading-none font-extrabold tracking-[0.03em] whitespace-nowrap text-white shadow-[0_2px_6px_rgba(0,0,0,0.22)] transition-[transform,box-shadow,filter,opacity] hover:-translate-y-px hover:brightness-105 hover:shadow-[0_5px_12px_rgba(0,0,0,0.26)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 min-[900px]:h-10"
          >
            {saveAction.saving ? "SAVING…" : "SAVE"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer border-none bg-transparent px-1 py-1 text-[11px] font-extrabold uppercase tracking-wide text-anivax-danger transition-opacity hover:opacity-80 min-[900px]:text-xs"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function displayOrDash(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

function RetrieveReadonlyField({
  label,
  value,
  required,
  className,
  narrow,
}: {
  label: string;
  value: string;
  required?: boolean;
  className?: string;
  narrow?: boolean;
}) {
  return (
    <div className={className ?? (narrow ? "min-w-[100px]" : "min-w-0")}>
      <span className={retrieveLabelClass}>
        {label}
        {required ? <span className="ml-1 text-anivax-danger">*</span> : null}
      </span>
      <input type="text" readOnly value={value} className={retrieveReadonlyClass} tabIndex={-1} />
    </div>
  );
}

function RetrieveReadonlyCheckboxPair({
  label,
  options,
  selected,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected?: string;
}) {
  return (
    <div className="min-w-0">
      <span className={retrieveLabelClass}>{label}</span>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] font-semibold text-anivax-ink">
        {options.map((opt) => (
          <label key={opt.id} className="flex select-none items-center gap-1.5">
            <input
              type="checkbox"
              readOnly
              checked={selected === opt.id}
              className="h-[15px] w-[15px] shrink-0 accent-anivax-teal"
              tabIndex={-1}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function RetrieveYesNoPair({
  label,
  value,
}: {
  label: string;
  value: boolean | null | undefined;
}) {
  return (
    <RetrieveReadonlyCheckboxPair
      label={label}
      options={[
        { id: "YES", label: "YES" },
        { id: "NO", label: "NO" },
      ]}
      selected={value === true ? "YES" : value === false ? "NO" : undefined}
    />
  );
}

function RetrieveVitalsSuffixedField({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="min-w-0">
      <span className={retrieveLabelClass}>{label}</span>
      <div className="relative mt-1">
        <input type="text" readOnly value={value} className={`${retrieveReadonlyClass} pr-9`} tabIndex={-1} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-anivax-muted">
          {unit}
        </span>
      </div>
    </div>
  );
}

function RetrieveVitalsBloodPressure({ sys, dia }: { sys: string; dia: string }) {
  return (
    <div className="min-w-0">
      <span className={retrieveLabelClass}>BLOOD PRESSURE</span>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <div className="box-border flex h-[25px] min-w-0 flex-1 items-center gap-1.5 rounded border border-[#D9D9D9] bg-white px-2">
          <input
            type="text"
            readOnly
            value={sys}
            placeholder="SYS"
            className="min-w-0 w-0 flex-1 border-none bg-transparent p-0 text-[13px] font-semibold text-anivax-ink outline-none"
            tabIndex={-1}
          />
          <input
            type="text"
            readOnly
            value={dia}
            placeholder="DIA"
            className="min-w-0 w-0 flex-1 border-none bg-transparent p-0 text-[13px] font-semibold text-anivax-ink outline-none"
            tabIndex={-1}
          />
        </div>
        <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-anivax-muted">mmHg</span>
      </div>
    </div>
  );
}

function RetrieveVitalsPanel({ vitals }: { vitals?: Vitals }) {
  const bp = parseBloodPressureParts(vitals?.bloodPressure);
  return (
    <aside className="box-border rounded-md border border-[#D9D9D9] bg-white px-3 pb-3 pt-2">
      <h3 className="mb-2 text-center text-[12px] font-extrabold tracking-wide text-anivax-danger">VITALS</h3>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5">
        <RetrieveVitalsSuffixedField
          label="TEMPERATURE"
          value={vitalsDisplayValue(vitals?.temperatureC)}
          unit="?C"
        />
        <RetrieveVitalsBloodPressure sys={bp.sys} dia={bp.dia} />
        <RetrieveVitalsSuffixedField label="PR" value={vitalsDisplayValue(vitals?.pulseRate)} unit="bpm" />
        <RetrieveVitalsSuffixedField label="SpO2" value={vitalsDisplayValue(vitals?.spo2)} unit="%" />
        <RetrieveVitalsSuffixedField label="HEIGHT" value={vitalsDisplayValue(vitals?.heightCm)} unit="cm" />
        <RetrieveVitalsSuffixedField label="WEIGHT" value={vitalsDisplayValue(vitals?.weightKg)} unit="kg" />
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Personal information card                          */
/* -------------------------------------------------------------------------- */

interface CardProps {
  history: PatientHistory;
  isSmall: boolean;
}

function resolvePersonalForm(history: PatientHistory): CreateProfileFormState {
  const base = emptyCreateProfileForm();
  if (history.createRecord?.form) {
    return { ...base, ...history.createRecord.form };
  }
  try {
    const cached = sessionStorage.getItem(
      patientCreateRecordCacheKey(history.patient.id),
    );
    if (cached) {
      const parsed = JSON.parse(cached) as PatientCreateRecord;
      if (parsed?.form) return { ...base, ...parsed.form };
    }
  } catch {
    /* ignore */
  }
  const p = history.patient;
  return {
    ...base,
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: p.middleName ?? "",
    suffix: p.suffix && p.suffix !== "NONE" ? p.suffix : "",
    noMiddleName: !p.middleName?.trim(),
    birthDate: p.birthDate,
    ageYears: p.ageYears != null ? String(p.ageYears) : "",
    sex: p.sex === "F" ? "FEMALE" : "MALE",
    bloodType: p.bloodType ?? "A+",
    mobile: p.contactNumber ?? "",
    street: p.address ?? "",
    registrationNo: p.registrationNo ?? "",
  };
}

function displaySuffixLabel(suffix: string): string {
  const t = suffix.trim();
  if (!t || t.toUpperCase() === "NONE") return "NONE";
  return t.toUpperCase();
}

function PersonalInfoCard({ history, isSmall }: CardProps) {
  const f = resolvePersonalForm(history);
  const noMiddleName = f.noMiddleName;
  const ageDisplay =
    f.ageYears.trim() !== ""
      ? f.ageYears.trim()
      : ageBreakdown(f.birthDate).split(" ")[0]?.replace("Y", "") ?? "";

  const nameGridClass = isSmall
    ? "grid grid-cols-1 gap-3"
    : "grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(100px,150px)_minmax(0,1.1fr)_auto] items-end gap-3";
  const dobGridClass = isSmall
    ? "grid grid-cols-2 gap-3"
    : "grid grid-cols-[180px_100px_153px_180px_minmax(0,1fr)_136px] items-end gap-3";
  const contactGridClass = isSmall ? "grid grid-cols-1 gap-3" : "grid grid-cols-5 gap-3";
  const regGridClass = isSmall ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3";

  return (
    <section className="print-card relative mt-3.5 box-border rounded-[10px] border-4 border-anivax-teal bg-white px-6 pb-7 pt-5">
      <div className="absolute left-[18px] top-[-16px] z-[2]">
        <SectionTag label="PERSONAL INFORMATION" />
      </div>

      <div className="flex flex-col gap-3.5 pt-1.5">
        <div className={regGridClass}>
          <RetrieveReadonlyField
            label="REGISTRATION NUMBER"
            value={displayOrDash(f.registrationNo)}
          />
          <RetrieveReadonlyField label="PHILHEALTH NO." value={displayOrDash(f.philhealthNo)} />
        </div>

        <div className={nameGridClass}>
          <RetrieveReadonlyField label="LAST NAME" required value={f.lastName.toUpperCase()} />
          <RetrieveReadonlyField label="FIRST NAME" required value={f.firstName.toUpperCase()} />
          <RetrieveReadonlyField label="SUFFIX" value={displaySuffixLabel(f.suffix)} />
          <RetrieveReadonlyField
            label="MIDDLE NAME"
            required
            value={noMiddleName ? "" : f.middleName.toUpperCase()}
          />
          <label className="flex select-none items-center gap-2 whitespace-nowrap pb-1 text-[11px] font-bold text-black">
            <input
              type="checkbox"
              readOnly
              checked={noMiddleName}
              className="h-[15px] w-[15px] shrink-0 accent-anivax-teal"
              tabIndex={-1}
            />
            NO MIDDLE NAME
          </label>
        </div>

        <div className={dobGridClass}>
          <RetrieveReadonlyField
            label="DATE OF BIRTH"
            required
            value={formatShortDate(f.birthDate)}
          />
          <RetrieveReadonlyField label="AGE" value={ageDisplay} narrow />
          <RetrieveReadonlyField label="SEX" required value={f.sex.toUpperCase()} />
          <RetrieveReadonlyField
            label="CIVIL STATUS"
            required
            value={displayOrDash(f.civilStatus).toUpperCase()}
          />
          <RetrieveReadonlyField
            label="PLACE OF BIRTH"
            required
            value={displayOrDash(f.placeOfBirth).toUpperCase()}
          />
          <RetrieveReadonlyField
            label="BLOOD TYPE"
            narrow
            value={displayOrDash(f.bloodType).toUpperCase()}
          />
        </div>

        <div className={contactGridClass}>
          <RetrieveReadonlyField
            label="MOBILE NUMBER"
            required
            value={displayOrDash(f.mobile)}
          />
          <RetrieveReadonlyField label="EMAIL ADDRESS" value={displayOrDash(f.email)} />
          <RetrieveReadonlyField label="RELIGION" value={displayOrDash(f.religion).toUpperCase()} />
          <RetrieveReadonlyField label="SC/PWD ID NO." value={displayOrDash(f.scPwdId)} />
          <RetrieveReadonlyField label="TELEPHONE NUMBER" value={displayOrDash(f.telephone)} />
        </div>

        <div className="mt-2.5">
          <span className="mb-3 block text-center text-[15px] font-extrabold tracking-wide text-anivax-teal">
            ADDRESS
          </span>
          <div className={isSmall ? "grid grid-cols-1 gap-3" : "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_100px] gap-3"}>
            <RetrieveReadonlyField
              label="HOUSE NO./ STREET/ SUBDIVISION"
              required
              value={displayOrDash(f.street).toUpperCase()}
            />
            <RetrieveReadonlyField label="REGION" value={displayOrDash(f.region).toUpperCase()} />
            <RetrieveReadonlyField label="PROVINCE" value={displayOrDash(f.province).toUpperCase()} />
            <RetrieveReadonlyField label="ZIP CODE" value={displayOrDash(f.zip)} narrow />
          </div>
          <div
            className={`mt-3 ${isSmall ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}`}
          >
            <RetrieveReadonlyField
              label="CITY/MUNICIPALITY"
              value={displayOrDash(f.city).toUpperCase()}
            />
            <RetrieveReadonlyField label="BARANGAY" value={displayOrDash(f.barangay).toUpperCase()} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                            History of exposure card                         */
/* -------------------------------------------------------------------------- */

function ExposureCard({
  history,
  isSmall,
  hideVitalsSidebar,
}: CardProps & { hideVitalsSidebar?: boolean }) {
  const e = history.exposure;
  const chiefComplaint = displayOrDash(e.chiefComplaint);
  const exposureGridClass =
    hideVitalsSidebar || isSmall
      ? "grid grid-cols-1 gap-4"
      : "grid grid-cols-[minmax(0,1fr)_minmax(220px,280px)] items-start gap-4 min-[1100px]:gap-5";
  const row1Class = isSmall
    ? "grid grid-cols-1 gap-3"
    : "grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3";
  const row2Class = isSmall
    ? "grid grid-cols-1 gap-3"
    : "grid grid-cols-[minmax(0,1fr)_128px_minmax(0,1fr)] items-end gap-3";
  const row3Class = isSmall
    ? "grid grid-cols-1 gap-3"
    : "grid grid-cols-2 gap-x-3 gap-y-3 min-[900px]:grid-cols-3 min-[1180px]:grid-cols-5";

  return (
    <section className="print-card relative mt-3.5 box-border rounded-[10px] border-4 border-anivax-teal bg-white px-6 pb-7 pt-5">
      <div className="absolute left-[18px] top-[-16px] z-[2]">
        <SectionTag label="HISTORY OF EXPOSURE" />
      </div>

      <div className={`pt-1.5 ${exposureGridClass}`}>
        <div className="flex min-w-0 flex-col gap-3">
          <div className={row1Class}>
            <div className="min-w-0">
              <span className={retrieveLabelClass}>
                CHIEF COMPLAINT<span className="ml-1 text-anivax-danger">*</span>
              </span>
              <textarea
                readOnly
                value={chiefComplaint}
                rows={4}
                className={`${retrieveReadonlyClass} mt-1 min-h-[88px] resize-none py-2`}
                tabIndex={-1}
              />
            </div>
            <RetrieveReadonlyField
              label="SITE OF BITE/INJURY"
              required
              value={displayOrDash(e.siteOfInjury)}
            />
          </div>

          <div className={row2Class}>
            <RetrieveReadonlyField
              label="DATE OF INCIDENCE"
              required
              value={formatIncidenceDate(e.dateOfIncidence)}
            />
            <RetrieveReadonlyField
              label="TIME"
              required
              value={formatTime12h(e.timeOfIncidence)}
            />
            <RetrieveReadonlyField label="PLACE OF INCIDENCE" value={displayOrDash(e.placeOfIncidence)} />
          </div>

          <div className={row3Class}>
            <RetrieveReadonlyCheckboxPair
              label="BITE / NON-BITE"
              options={[
                { id: "BITE", label: "BITE" },
                { id: "NON-BITE", label: "NON-BITE" },
              ]}
              selected={e.biteType}
            />
            <RetrieveReadonlyField
              label="ANIMAL TYPE"
              required
              value={formatAnimalTypeLabel(e.animalType)}
            />
            <RetrieveReadonlyCheckboxPair
              label="STRAY / OWNED"
              options={[
                { id: "STRAY", label: "STRAY" },
                { id: "OWNED", label: "OWNED" },
              ]}
              selected={e.strayOwned}
            />
            <RetrieveYesNoPair label="WASHING OF INJURY" value={e.washedInjury} />
            <RetrieveYesNoPair label="ANIMAL VACCINATED" value={e.animalVaccinated} />
          </div>
        </div>

        {!hideVitalsSidebar ? (
          <div className="flex min-w-0 flex-col gap-2">
            <RetrieveVitalsPanel vitals={history.vitals} />
            <div className="no-print flex justify-center">
              <button
                type="button"
                onClick={() => {
                  if (e.uploadedFileUrl) window.open(e.uploadedFileUrl, "_blank");
                }}
                disabled={!e.uploadedFileUrl}
                className="inline-flex h-8 w-full cursor-pointer items-center justify-center border-none bg-black px-4 text-[11px] font-bold tracking-wide text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                VIEW UPLOADS
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Doctor's order card                              */
/* -------------------------------------------------------------------------- */

interface DoctorsOrderCardProps {
  history: PatientHistory;
  isSmall: boolean;
  winW: number;
  onSaved: () => Promise<void>;
  onRegisterToolbar: (
    toolbar: { onSave: () => void; saving: boolean } | null,
  ) => void;
  onPlanBoosterChange?: (booster: boolean) => void;
  onPlanPepChange?: (pep: boolean) => void;
  onPlanPrepChange?: (prep: boolean) => void;
}

type VaccinationRowMeta = {
  postDay: string;
  preDay: string;
};

type VaccinationRowSlot = {
  postDateIso: string;
  postTime24: string;
  preDateIso: string;
  preTime24: string;
  postNod: string;
  preNod: string;
  postSiteRight: boolean;
  postSiteLeft: boolean;
  preSiteRight: boolean;
  preSiteLeft: boolean;
};

type VaccinationAnimalStatus = "DEAD" | "ALIVE" | "LOST_STRAY";
type VaccinationTreatmentStatus = "COMPLETE" | "INCOMPLETE";

const VACCINATION_ROW_META: VaccinationRowMeta[] = [
  { postDay: "DAY 0", preDay: "DAY 0" },
  { postDay: "DAY 3", preDay: "" },
  { postDay: "DAY 7", preDay: "DAY 7" },
  { postDay: "DAY 14 (IM)", preDay: "DAY 21" },
  { postDay: "DAY 28", preDay: "DAY 28" },
];

function formatShortDate(iso: string): string {
  if (!iso || iso === "???") return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function shiftDateByDays(iso: string, days: number): string {
  if (!iso || iso === "???") return "";
  const base = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${`${base.getMonth() + 1}`.padStart(2, "0")}-${`${base.getDate()}`.padStart(2, "0")}`;
}

/** Post-exposure rows locked when PLAN → BOOSTER is checked (Day 14, Day 28 — date, time, site, nod). */
function isBoosterLockedPostRow(rowIndex: number): boolean {
  return rowIndex === 3 || rowIndex === 4;
}

function clearBoosterLockedPostSlots(slots: VaccinationRowSlot[]): VaccinationRowSlot[] {
  const next = slots.map((s) => ({ ...s }));
  for (const i of [3, 4]) {
    if (!next[i]) continue;
    next[i] = {
      ...next[i],
      postDateIso: "",
      postTime24: "",
      postNod: "",
      postSiteRight: false,
      postSiteLeft: false,
    };
  }
  return next;
}

function clearBoosterLockedPreSlots(slots: VaccinationRowSlot[]): VaccinationRowSlot[] {
  return slots.map((s) => ({
    ...s,
    preDateIso: "",
    preTime24: "",
    preNod: "",
    preSiteRight: false,
    preSiteLeft: false,
  }));
}

/** All post-exposure fields cleared when PLAN → PrEP is checked. */
function clearPrepLockedPostSlots(slots: VaccinationRowSlot[]): VaccinationRowSlot[] {
  return slots.map((s) => ({
    ...s,
    postDateIso: "",
    postTime24: "",
    postNod: "",
    postSiteRight: false,
    postSiteLeft: false,
  }));
}

function appointmentVisitTime24(scheduledAt?: string, fallback = "09:00"): string {
  if (!scheduledAt) return fallback;
  const parts = scheduleSlotPartsFromIso(scheduledAt);
  return parts?.time24 ?? fallback;
}

/** Post-exposure Day 0 time from the appointment's chosen schedule slot. */
function applyPostDay0VisitTime(
  slots: VaccinationRowSlot[],
  visitTime24?: string,
): VaccinationRowSlot[] {
  if (!visitTime24 || !slots[0]) return slots;
  const next = slots.map((s) => ({ ...s }));
  next[0] = { ...next[0], postTime24: visitTime24 };
  return next;
}

function applyPepScheduleToSlots(
  slots: VaccinationRowSlot[],
  baseDate: string,
  visitTime24?: string,
): VaccinationRowSlot[] {
  return applyPepPostExposureDates(
    clearBoosterLockedPreSlots(slots),
    baseDate,
    visitTime24,
  );
}

/** Post-exposure Day 0 / 3 / 7 / 14 / 28 dates from post Day 0 anchor; Day 0 time from visit schedule. */
function applyPepPostExposureDates(
  slots: VaccinationRowSlot[],
  fallbackBaseDate?: string,
  visitTime24?: string,
): VaccinationRowSlot[] {
  const anchor = slots[0]?.postDateIso || fallbackBaseDate;
  if (!anchor || anchor === "???") return applyPostDay0VisitTime(slots, visitTime24);
  const next = slots.map((s) => ({ ...s }));
  const pepPostRows: { index: number; days: number }[] = [
    { index: 0, days: 0 },
    { index: 1, days: 3 },
    { index: 2, days: 7 },
    { index: 3, days: 14 },
    { index: 4, days: 28 },
  ];
  for (const { index, days } of pepPostRows) {
    const iso = shiftDateByDays(anchor, days);
    if (!iso || !next[index]) continue;
    next[index] = { ...next[index], postDateIso: iso };
  }
  return applyPostDay0VisitTime(next, visitTime24);
}

function applyPrepScheduleToSlots(
  slots: VaccinationRowSlot[],
  baseDate: string,
  visitTime24?: string,
): VaccinationRowSlot[] {
  return applyPrepPreExposureDates(clearPrepLockedPostSlots(slots), baseDate, visitTime24);
}

/** Pre-exposure Day 0 / 7 / 21 / 28 dates from pre Day 0 anchor; Day 0 time from visit schedule. */
function applyPrepPreExposureDates(
  slots: VaccinationRowSlot[],
  fallbackBaseDate?: string,
  visitTime24?: string,
): VaccinationRowSlot[] {
  const anchor = slots[0]?.preDateIso || fallbackBaseDate;
  if (!anchor || anchor === "???") return slots;
  const next = slots.map((s) => ({ ...s }));
  const activePreRows: { index: number; days: number }[] = [
    { index: 0, days: 0 },
    { index: 2, days: 7 },
    { index: 3, days: 21 },
    { index: 4, days: 28 },
  ];
  for (const { index, days } of activePreRows) {
    const iso = shiftDateByDays(anchor, days);
    if (!iso || !next[index]) continue;
    next[index] = { ...next[index], preDateIso: iso };
  }
  if (next[0] && visitTime24) {
    next[0] = { ...next[0], preTime24: visitTime24 };
  }
  return next;
}

function applyBoosterScheduleToSlots(
  slots: VaccinationRowSlot[],
  baseDate: string,
  visitTime24?: string,
): VaccinationRowSlot[] {
  return clearBoosterLockedPreSlots(
    clearBoosterLockedPostSlots(applyBoosterPostExposureDates(slots, baseDate, visitTime24)),
  );
}

/** Post-exposure Day 0 / 3 / 7 dates from Day 0 anchor; Day 0 time from visit schedule. */
function applyBoosterPostExposureDates(
  slots: VaccinationRowSlot[],
  fallbackBaseDate?: string,
  visitTime24?: string,
): VaccinationRowSlot[] {
  const anchor = slots[0]?.postDateIso || fallbackBaseDate;
  if (!anchor || anchor === "???") return applyPostDay0VisitTime(slots, visitTime24);
  const next = slots.map((s) => ({ ...s }));
  const activePostRows: { index: number; days: number }[] = [
    { index: 0, days: 0 },
    { index: 1, days: 3 },
    { index: 2, days: 7 },
  ];
  for (const { index, days } of activePostRows) {
    const iso = shiftDateByDays(anchor, days);
    if (!iso || !next[index]) continue;
    next[index] = { ...next[index], postDateIso: iso };
  }
  return applyPostDay0VisitTime(next, visitTime24);
}

async function findPatientFollowUpOnDate(
  patientId: string,
  dateIso: string,
  excludeAppointmentId: string,
): Promise<Appointment | null> {
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const res = await searchAppointments({
      tab: "FOLLOW-UP",
      date: dateIso,
      page,
      pageSize: 50,
    });
    const match = res.items.find(
      (a) => a.patient?.id === patientId && a.id !== excludeAppointmentId,
    );
    if (match) return match;
    totalPages = res.totalPages;
    page += 1;
  }
  return null;
}

async function resolveBoosterFollowUpScheduledAt(
  day3Iso: string,
  fallbackTime24: string,
): Promise<string> {
  const day = new Date(`${day3Iso}T12:00:00`);
  const slots = await loadVaccinationScheduleSlots({ day });
  const sameDay = slots.filter((s) => s.dateIso === day3Iso);
  if (sameDay.length > 0) {
    const sameTime = sameDay.find((s) => s.time24 === fallbackTime24);
    return (sameTime ?? sameDay[0]).scheduledAt;
  }
  return buildScheduledAtFromSlot({ dateIso: day3Iso, time24: fallbackTime24 });
}

/** Persist Day 3 on the vaccination record and book the patient on FOLLOW-UP for that date. */
async function syncBoosterVaccinationAndFollowUp(history: PatientHistory): Promise<void> {
  const baseDate = history.date;
  const day3Iso = shiftDateByDays(baseDate, 3);
  if (!day3Iso) return;

  const record = await getVaccinationRecordForAppointment(history.appointmentId);
  const rawPayload = record?.payload;
  const payload: VaccinationPersistedPayload =
    rawPayload && typeof rawPayload === "object"
      ? (rawPayload as VaccinationPersistedPayload)
      : { vaccination: {}, nursesNote: { rows: [] } };

  const existingSlots =
    Array.isArray(payload.vaccination?.slots) && payload.vaccination.slots.length > 0
      ? payload.vaccination.slots
      : buildInitialVaccinationSlots(baseDate, appointmentVisitTime24(history.scheduledAt));
  const scheduleBase = existingSlots[0]?.postDateIso || baseDate;
  const visit = await retrieveAppointment(history.appointmentId);
  const visitTime24 = appointmentVisitTime24(visit?.scheduledAt ?? history.scheduledAt);
  const slots = applyBoosterScheduleToSlots(existingSlots, scheduleBase, visitTime24);

  await saveVaccinationRecord(history.appointmentId, {
    ...payload,
    vaccination: { ...payload.vaccination, slots },
  });

  const time24 = visitTime24 || slots[0]?.postTime24 || "09:00";
  const scheduledAt = await resolveBoosterFollowUpScheduledAt(day3Iso, time24);

  const attendantUserId = getStaffUserId();
  if (!attendantUserId) return;

  const existingFollowUp = await findPatientFollowUpOnDate(
    history.patient.id,
    day3Iso,
    history.appointmentId,
  );

  if (existingFollowUp) {
    await updateAppointment(existingFollowUp.id, {
      scheduledAt,
      tab: "FOLLOW-UP",
      status: "SCHEDULED",
      attendantUserId,
      category: history.category,
    });
    return;
  }

  await createAppointment({
    patientId: history.patient.id,
    attendantUserId,
    scheduledAt,
    category: history.category,
    status: "SCHEDULED",
    tab: "FOLLOW-UP",
  });
}

function buildInitialVaccinationSlots(
  baseDate: string,
  visitTime24 = "09:00",
): VaccinationRowSlot[] {
  const day0PostIso = shiftDateByDays(baseDate, 0);
  const day3PostIso = shiftDateByDays(baseDate, 3);
  const day7PostIso = shiftDateByDays(baseDate, 7);
  return [
    {
      postDateIso: day0PostIso,
      postTime24: visitTime24,
      preDateIso: "",
      preTime24: "",
      postNod: "",
      preNod: "",
      postSiteRight: true,
      postSiteLeft: false,
      preSiteRight: false,
      preSiteLeft: false,
    },
    {
      postDateIso: day3PostIso,
      postTime24: "",
      preDateIso: "",
      preTime24: "",
      postNod: "",
      preNod: "",
      postSiteRight: false,
      postSiteLeft: false,
      preSiteRight: false,
      preSiteLeft: false,
    },
    {
      postDateIso: day7PostIso,
      postTime24: "",
      preDateIso: "",
      preTime24: "",
      postNod: "",
      preNod: "",
      postSiteRight: false,
      postSiteLeft: false,
      preSiteRight: false,
      preSiteLeft: false,
    },
    {
      postDateIso: "",
      postTime24: "",
      preDateIso: "",
      preTime24: "",
      postNod: "",
      preNod: "",
      postSiteRight: false,
      postSiteLeft: false,
      preSiteRight: false,
      preSiteLeft: false,
    },
    {
      postDateIso: "",
      postTime24: "",
      preDateIso: "",
      preTime24: "",
      postNod: "",
      preNod: "",
      postSiteRight: false,
      postSiteLeft: false,
      preSiteRight: false,
      preSiteLeft: false,
    },
  ];
}

const VAX_TABLE_BORDER = "1px solid #000000";

const VAX_HEADER_BLUE = "#A8D7E9";
const VAX_CELL_GRAY = "#F9F9F9";
const VAX_OUTLINE_GRAY = "#D9D9D9";

const VAX_TD_TOP = "border border-black p-0 align-top";
const VAX_TD_LABEL =
  "border border-black bg-[#F9F9F9] px-2.5 py-3 text-center align-middle text-sm font-semibold text-black";
const VAX_TH =
  "border border-black px-2 py-2.5 text-center align-middle text-sm font-bold tracking-wide text-black";

function VaccinationSiteCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className="vaccination-site-checkbox-mark box-border inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-[0.5px] border-black bg-[#D9D9D9]"
      aria-hidden="true"
    >
      {checked ? (
        <svg width="10" height="10" viewBox="0 0 12 12">
          <path
            d="M2 6 L5 9 L10 3"
            stroke="#0D7A4F"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ) : null}
    </span>
  );
}

const vaxSiteHitClass =
  "m-0 inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 font-inherit text-sm font-medium text-black";

function VaccinationSiteCell({
  rightChecked,
  leftChecked,
  onToggleRight,
  onToggleLeft,
  disabled,
  readOnly = false,
}: {
  rightChecked: boolean;
  leftChecked: boolean;
  onToggleRight: () => void;
  onToggleLeft: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <div className="vaccination-site-cell box-border flex min-h-[52px] flex-wrap items-center gap-x-2.5 gap-y-1.5 bg-white px-2.5 py-2 text-sm font-medium text-black">
        <span className="inline-flex items-center gap-1.5">
          <VaccinationSiteCheckbox checked={rightChecked} />R
        </span>
        <span>DELTOID</span>
        <span className="inline-flex items-center gap-1.5">
          <VaccinationSiteCheckbox checked={leftChecked} />L
        </span>
      </div>
    );
  }
  const hitClass = disabled
    ? "m-0 inline-flex cursor-default items-center gap-1.5 border-none bg-transparent p-0 font-inherit text-sm font-medium text-black opacity-50"
    : vaxSiteHitClass;
  return (
    <div
      className={`vaccination-site-cell box-border flex min-h-[52px] flex-wrap items-center gap-x-2.5 gap-y-1.5 bg-white px-2.5 py-2 text-sm font-medium text-black ${disabled ? "opacity-50" : ""}`}
      aria-disabled={disabled || undefined}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : onToggleRight}
        className={hitClass}
        aria-pressed={rightChecked}
      >
        <VaccinationSiteCheckbox checked={rightChecked} />R
      </button>
      <span>DELTOID</span>
      <button
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : onToggleLeft}
        className={hitClass}
        aria-pressed={leftChecked}
      >
        <VaccinationSiteCheckbox checked={leftChecked} />L
      </button>
    </div>
  );
}

function VaccinationNodCell({
  value,
  disabled,
  onChange,
  ariaLabel,
  readOnly = false,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
  readOnly?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      disabled={disabled || readOnly}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={`vaccination-nod-cell box-border min-h-[52px] w-full border-0 bg-white p-2.5 text-sm font-medium text-black outline-none focus:ring-1 focus:ring-inset focus:ring-anivax-teal disabled:cursor-not-allowed disabled:opacity-50 ${readOnly ? "cursor-default" : ""}`}
    />
  );
}

/** Vertical folder-tab clip: flat left edge, rounded top-right, tapered bottom-right. */
const FOLDER_SIDE_TAB_CLIP =
  "polygon(0 0, 100% 0, 100% calc(100% - 14px), 78% 100%, 0 100%)";

type VaccinationSidePanelId = "vaccination" | "nurses_note";

function FolderSideTab({
  label,
  color,
  expanded,
  onClick,
}: {
  label: string;
  color: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-current={expanded ? "true" : undefined}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
      className="relative flex w-11 shrink-0 cursor-pointer border-none bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C5CFC]"
    >
      <span
        className={[
          "relative flex min-h-[152px] w-full items-center justify-center rounded-tr-[14px] text-[11px] font-bold leading-tight tracking-wide text-white transition-[transform,filter,opacity,box-shadow] duration-300",
          expanded
            ? "z-[1] translate-x-2 opacity-100 shadow-[3px_8px_18px_rgba(0,0,0,0.32)] brightness-110 ring-2 ring-white/70 ring-offset-2 ring-offset-white"
            : "translate-x-0 opacity-60 shadow-[1px_2px_6px_rgba(0,0,0,0.18)] hover:opacity-85 hover:brightness-105",
        ].join(" ")}
        style={{
          backgroundColor: color,
          clipPath: FOLDER_SIDE_TAB_CLIP,
        }}
      >
        {expanded ? (
          <span
            className="pointer-events-none absolute inset-y-4 right-0 w-[3px] rounded-l-full bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.65)]"
            aria-hidden="true"
          />
        ) : null}
        <span
          className="select-none px-1 py-3"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          {label}
        </span>
      </span>
    </button>
  );
}

const NURSE_NOTE_TH =
  "border border-black bg-white px-2 py-3 text-center align-middle text-xs font-bold uppercase tracking-wide text-black sm:text-sm";
const NURSE_NOTE_TD = "border border-black bg-white p-0 align-top";
const NURSE_NOTE_INPUT =
  "box-border h-[22px] rounded border border-[#D9D9D9] bg-white px-1.5 text-xs font-medium text-black outline-none focus:border-anivax-teal";
const NURSE_NOTE_SCHEDULE = [
  { label: "Day 0", focusKey: "standard" as const },
  { label: "Day 3", focusKey: "standard" as const },
  { label: "Day 7", focusKey: "standard" as const },
  { label: "Day 28", focusKey: "day28" as const },
];

const NURSE_FOCUS_OPTIONS = {
  standard: [
    "V/S taken and recorded, referred ROD.",
    "ARV given 0.1cc @ both deltoid",
    "Advised to observe the animal within 14 days from incident",
    "Advised to comeback on the next following schedule",
  ],
  day28: [
    "V/S taken and recorded, referred ROD.",
    "ARV given 0.1cc @ both deltoid",
  ],
} as const;

type NurseNoteRowState = {
  tempC: string;
  weightKg: string;
  bpSys: string;
  bpDia: string;
  focusChecked: boolean[];
  signature: string;
};

function buildInitialNurseNoteRows(): NurseNoteRowState[] {
  return NURSE_NOTE_SCHEDULE.map((row) => ({
    tempC: "",
    weightKg: "",
    bpSys: "",
    bpDia: "",
    focusChecked: NURSE_FOCUS_OPTIONS[row.focusKey].map(() => false),
    signature: "",
  }));
}

function NursesNoteFocusCheckbox({
  label,
  checked,
  onChange,
  readOnly = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <span className="flex w-full select-none items-start gap-2 text-left text-xs font-medium leading-snug text-black sm:text-sm">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-black/30 bg-[#D9D9D9]"
        >
          {checked ? (
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path
                d="M2 6 L5 9 L10 3"
                stroke="#0D7A4F"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          ) : null}
        </span>
        <span>{label}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full cursor-pointer items-start gap-2 border-none bg-transparent p-0 text-left font-inherit text-xs font-medium leading-snug text-black transition-opacity hover:opacity-80 sm:text-sm"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-black/30 bg-[#D9D9D9]"
      >
        {checked ? (
          <svg width="11" height="11" viewBox="0 0 12 12">
            <path
              d="M2 6 L5 9 L10 3"
              stroke="#0D7A4F"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </span>
      <span>{label}</span>
    </button>
  );
}

const NURSE_NOTE_VITALS_CLEAR_PATCH: Pick<
  NurseNoteRowState,
  "tempC" | "weightKg" | "bpSys" | "bpDia"
> = {
  tempC: "",
  weightKg: "",
  bpSys: "",
  bpDia: "",
};

function NursesNoteVitalsCell({
  row,
  onChange,
  onAddVitals,
  onClearVitals,
  addingVitals,
  vitalsMessage,
  readOnly = false,
}: {
  row: NurseNoteRowState;
  onChange: (patch: Partial<NurseNoteRowState>) => void;
  onAddVitals: () => void;
  onClearVitals: () => void;
  addingVitals?: boolean;
  vitalsMessage?: string | null;
  readOnly?: boolean;
}) {
  const hasVitals =
    Boolean(row.tempC.trim()) ||
    Boolean(row.weightKg.trim()) ||
    Boolean(row.bpSys.trim()) ||
    Boolean(row.bpDia.trim());

  const vitalsInputClass = (width: string) =>
    `${NURSE_NOTE_INPUT} ${width}${readOnly ? " cursor-default" : ""}`;

  return (
    <div className="relative box-border px-3 py-3">
      {!readOnly ? (
        <div className="absolute right-3 top-2 flex max-w-[7.5rem] flex-col items-end gap-0.5">
          <button
            type="button"
            onClick={onAddVitals}
            disabled={addingVitals}
            className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-anivax-teal hover:underline disabled:cursor-wait disabled:opacity-60 sm:text-sm"
          >
            {addingVitals ? "Loading?" : "+Add Vitals"}
          </button>
          <button
            type="button"
            onClick={onClearVitals}
            disabled={!hasVitals}
            className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-anivax-teal hover:underline disabled:cursor-default disabled:text-anivax-muted disabled:no-underline sm:text-sm"
            aria-label="Clear vitals"
          >
            Clear
          </button>
          {vitalsMessage ? (
            <p className="m-0 text-right text-[10px] font-medium leading-tight text-anivax-danger">
              {vitalsMessage}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className={`flex flex-col gap-2.5 ${readOnly ? "" : "mt-6"}`}>
        <label className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-black sm:text-sm">
          <span className="shrink-0">temp:</span>
          <input
            type="text"
            inputMode="decimal"
            value={row.tempC}
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
            onChange={(e) => onChange({ tempC: e.target.value })}
            className={vitalsInputClass("w-14")}
            aria-label="Temperature"
          />
          <span className="text-[10px] font-semibold text-anivax-muted">?C</span>
        </label>
        <label className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-black sm:text-sm">
          <span className="shrink-0">weight:</span>
          <input
            type="text"
            inputMode="decimal"
            value={row.weightKg}
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
            onChange={(e) => onChange({ weightKg: e.target.value })}
            className={vitalsInputClass("w-14")}
            aria-label="Weight"
          />
          <span className="text-[10px] font-semibold text-anivax-muted">kg</span>
        </label>
        <label className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-black sm:text-sm">
          <span className="shrink-0">BP:</span>
          <div className="flex min-w-0 items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              value={row.bpSys}
              readOnly={readOnly}
              tabIndex={readOnly ? -1 : undefined}
              onChange={(e) => onChange({ bpSys: e.target.value })}
              placeholder="SYS"
              className={vitalsInputClass("w-12")}
              aria-label="Blood pressure systolic"
            />
            <span className="text-anivax-muted">/</span>
            <input
              type="text"
              inputMode="numeric"
              value={row.bpDia}
              readOnly={readOnly}
              tabIndex={readOnly ? -1 : undefined}
              onChange={(e) => onChange({ bpDia: e.target.value })}
              placeholder="DIA"
              className={vitalsInputClass("w-12")}
              aria-label="Blood pressure diastolic"
            />
          </div>
          <span className="text-[10px] font-semibold text-anivax-muted">mmHg</span>
        </label>
      </div>
    </div>
  );
}

function NursesNoteCard({
  history,
  isSmall,
  persistedNursesNote,
  onDraftChange,
  onRegisterSnapshot,
  readOnly = false,
}: CardProps & {
  persistedNursesNote?: { rows?: NurseNoteRowState[] };
  onDraftChange?: () => void;
  onRegisterSnapshot?: (getter: (() => { rows: NurseNoteRowState[] }) | null) => void;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<NurseNoteRowState[]>(() => buildInitialNurseNoteRows());
  const [recordedVitals, setRecordedVitals] = useState<Vitals | undefined>(() => history.vitals);
  const [vitalsLoadingRow, setVitalsLoadingRow] = useState<number | null>(null);
  const [vitalsRowMessage, setVitalsRowMessage] = useState<Record<number, string>>({});

  useEffect(() => {
    setRows(buildInitialNurseNoteRows());
    setRecordedVitals(history.vitals);
    setVitalsRowMessage({});
  }, [history.appointmentId, history.date, history.vitals]);

  useEffect(() => {
    const saved = persistedNursesNote?.rows;
    if (Array.isArray(saved) && saved.length === NURSE_NOTE_SCHEDULE.length) {
      setRows(saved);
    }
  }, [persistedNursesNote, history.appointmentId]);

  useEffect(() => {
    if (readOnly || !onRegisterSnapshot) return;
    onRegisterSnapshot(() => ({ rows }));
    return () => onRegisterSnapshot(null);
  }, [onRegisterSnapshot, readOnly, rows]);

  useEffect(() => {
    if (readOnly) return;
    onDraftChange?.();
  }, [onDraftChange, readOnly, rows]);

  const updateRow = (index: number, patch: Partial<NurseNoteRowState>) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const setFocusChecked = (rowIndex: number, focusIndex: number, checked: boolean) => {
    setRows((prev) => {
      const next = [...prev];
      const focusChecked = [...next[rowIndex].focusChecked];
      focusChecked[focusIndex] = checked;
      next[rowIndex] = { ...next[rowIndex], focusChecked };
      return next;
    });
  };

  const clearVitalsForRow = (rowIndex: number) => {
    updateRow(rowIndex, NURSE_NOTE_VITALS_CLEAR_PATCH);
    setVitalsRowMessage((prev) => {
      const next = { ...prev };
      delete next[rowIndex];
      return next;
    });
  };

  const addVitalsFromHistory = async (rowIndex: number) => {
    setVitalsRowMessage((prev) => {
      const next = { ...prev };
      delete next[rowIndex];
      return next;
    });
    setVitalsLoadingRow(rowIndex);

    try {
      let vitals = recordedVitals;
      if (!nurseNoteVitalsAvailable(vitals)) {
        vitals = await getRecordedVitalsForAppointment(history.appointmentId);
        if (nurseNoteVitalsAvailable(vitals)) {
          setRecordedVitals(vitals);
        }
      }

      if (!nurseNoteVitalsAvailable(vitals)) {
        setVitalsRowMessage((prev) => ({
          ...prev,
          [rowIndex]: "No vitals recorded for this visit yet.",
        }));
        return;
      }

      updateRow(rowIndex, vitalsToNurseNotePatch(vitals!));
    } catch {
      setVitalsRowMessage((prev) => ({
        ...prev,
        [rowIndex]: "Could not load vitals. Try again.",
      }));
    } finally {
      setVitalsLoadingRow(null);
    }
  };

  return (
    <Card className="print-nurses-note-card !p-0 shadow-anivax-card">
      <div className="box-border overflow-hidden rounded-lg border border-[#D9D9D9] bg-white">
        <header className="bg-anivax-sky px-4 py-3 text-center">
          <h2 className="m-0 text-lg font-bold tracking-wide text-black min-[900px]:text-xl">
            NURSE&apos;S NOTE
          </h2>
        </header>

        <div className="w-full touch-pan-x overflow-x-auto scroll-smooth">
          <table
            className={`w-full border-collapse border border-black table-fixed ${isSmall ? "min-w-[720px]" : "min-w-[960px]"}`}
          >
            <thead>
              <tr>
                <th className={`${NURSE_NOTE_TH} w-[12%]`}>Date &amp; time</th>
                <th className={`${NURSE_NOTE_TH} w-[28%]`}>Vitals</th>
                <th className={`${NURSE_NOTE_TH} w-[42%]`}>Focus</th>
                <th className={`${NURSE_NOTE_TH} w-[18%]`}>Signature</th>
              </tr>
            </thead>
            <tbody>
              {NURSE_NOTE_SCHEDULE.map((schedule, rowIndex) => {
                const row = rows[rowIndex];
                const focusOptions = NURSE_FOCUS_OPTIONS[schedule.focusKey];
                return (
                  <tr key={schedule.label}>
                    <td className={`${NURSE_NOTE_TD} w-[12%]`}>
                      <div className="flex min-h-[140px] items-center justify-center px-2 py-3 text-center text-sm font-semibold text-black">
                        {schedule.label}
                      </div>
                    </td>
                    <td className={`${NURSE_NOTE_TD} w-[28%]`}>
                      <NursesNoteVitalsCell
                        row={row}
                        readOnly={readOnly}
                        onChange={(patch) => updateRow(rowIndex, patch)}
                        onAddVitals={() => void addVitalsFromHistory(rowIndex)}
                        onClearVitals={() => clearVitalsForRow(rowIndex)}
                        addingVitals={vitalsLoadingRow === rowIndex}
                        vitalsMessage={vitalsRowMessage[rowIndex] ?? null}
                      />
                    </td>
                    <td className={`${NURSE_NOTE_TD} w-[42%]`}>
                      <div className="flex min-h-[140px] flex-col gap-2.5 px-3 py-3">
                        {focusOptions.map((label, focusIndex) => (
                          <NursesNoteFocusCheckbox
                            key={label}
                            label={label}
                            readOnly={readOnly}
                            checked={row.focusChecked[focusIndex] ?? false}
                            onChange={(checked) => setFocusChecked(rowIndex, focusIndex, checked)}
                          />
                        ))}
                      </div>
                    </td>
                    <td className={`${NURSE_NOTE_TD} w-[18%]`}>
                      <div className="px-1.5 py-2">
                        <SignaturePadField
                          value={row.signature}
                          readOnly={readOnly}
                          onChange={(signature) => updateRow(rowIndex, { signature })}
                          placeholder="Signature"
                          ariaLabel={`Signature, ${schedule.label}`}
                          compact
                          minHeight={108}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

type VaccinationFormSnapshot = {
  slots: VaccinationRowSlot[];
  observationIso: string;
  pcecv: boolean;
  pvrv: boolean;
  siteId: boolean;
  siteIm: boolean;
  brandSpeeda: boolean;
  brandVaxiran: boolean;
  brandAbhayrab: boolean;
  erigEquirab: boolean;
  erigDoseMl: string;
  erigDateIso: string;
  erigTime24: string;
  animalStatus: VaccinationAnimalStatus | "";
  treatmentStatus: VaccinationTreatmentStatus | "";
  receivedBy: string;
};

type VaccinationPersistedPayload = {
  vaccination?: Partial<VaccinationFormSnapshot>;
  nursesNote?: { rows?: NurseNoteRowState[] };
};

function vaccinationLivePayload(
  vaccinationGetter: (() => VaccinationFormSnapshot) | null,
  nursesGetter: (() => { rows: NurseNoteRowState[] }) | null,
): VaccinationPersistedPayload {
  return {
    vaccination: vaccinationGetter?.() ?? {},
    nursesNote: nursesGetter?.() ?? { rows: [] },
  };
}

/** Merge REST vaccination-record payload with unsaved tab draft for ABTC preview. */
function mergeAbtcVaccinationPayload(
  fromApi: VaccinationPersistedPayload | null,
  live: VaccinationPersistedPayload | null,
): VaccinationPersistedPayload {
  if (!fromApi && !live) {
    return { vaccination: {}, nursesNote: { rows: [] } };
  }
  if (!fromApi) return live!;
  if (!live) return fromApi;

  const apiRows = fromApi.nursesNote?.rows;
  const liveRows = live.nursesNote?.rows;
  const rows =
    Array.isArray(liveRows) && liveRows.length === NURSE_NOTE_SCHEDULE.length
      ? liveRows
      : Array.isArray(apiRows) && apiRows.length === NURSE_NOTE_SCHEDULE.length
        ? apiRows
        : [];

  return {
    vaccination: { ...fromApi.vaccination, ...live.vaccination },
    nursesNote: { rows },
  };
}

async function resolveAbtcVaccinationPayload(
  appointmentId: string,
  liveGetter: (() => VaccinationPersistedPayload) | null,
): Promise<VaccinationPersistedPayload> {
  let fromApi: VaccinationPersistedPayload | null = null;
  try {
    const record = await getVaccinationRecordForAppointment(appointmentId);
    if (record?.payload && typeof record.payload === "object") {
      fromApi = record.payload as VaccinationPersistedPayload;
    }
  } catch {
    fromApi = null;
  }
  const live = liveGetter?.() ?? null;
  return mergeAbtcVaccinationPayload(fromApi, live);
}

interface VaccinationTabShellProps extends CardProps {
  boosterScheduleActive: boolean;
  pepScheduleActive: boolean;
  prepScheduleActive: boolean;
  onRegisterToolbar: (toolbar: { onSave: () => void; saving: boolean } | null) => void;
  onRegisterAbtcSnapshot?: (getter: (() => VaccinationPersistedPayload) | null) => void;
  onFollowUpSynced?: () => void;
}

function VaccinationTabShell({
  history,
  isSmall,
  boosterScheduleActive,
  pepScheduleActive,
  prepScheduleActive,
  onRegisterToolbar,
  onRegisterAbtcSnapshot,
  onFollowUpSynced,
}: VaccinationTabShellProps) {
  const [activePanel, setActivePanel] = useState<VaccinationSidePanelId | null>(
    "vaccination",
  );
  const [persisted, setPersisted] = useState<VaccinationPersistedPayload | null>(null);
  const [persistedLoaded, setPersistedLoaded] = useState(false);
  const [savedSnapshotJson, setSavedSnapshotJson] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const vaccinationSnapshotRef = useRef<(() => VaccinationFormSnapshot) | null>(null);
  const nursesSnapshotRef = useRef<(() => { rows: NurseNoteRowState[] }) | null>(null);

  const closeSaveSuccess = useCallback(() => setSaveSuccess(false), []);
  const bumpDraftRevision = useCallback(() => setDraftRevision((n) => n + 1), []);

  const syncSavedBaseline = useCallback(() => {
    setSavedSnapshotJson(
      JSON.stringify(
        vaccinationLivePayload(vaccinationSnapshotRef.current, nursesSnapshotRef.current),
      ),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPersistedLoaded(false);
    setSavedSnapshotJson(null);
    getVaccinationRecordForAppointment(history.appointmentId)
      .then((data) => {
        if (cancelled) return;
        const payload = data?.payload as VaccinationPersistedPayload | null;
        setPersisted(payload && typeof payload === "object" ? payload : null);
      })
      .catch(() => {
        if (!cancelled) setPersisted(null);
      })
      .finally(() => {
        if (!cancelled) setPersistedLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [history.appointmentId]);

  useEffect(() => {
    if (!persistedLoaded) return;
    const id = window.requestAnimationFrame(() => {
      syncSavedBaseline();
      setDraftRevision(0);
    });
    return () => window.cancelAnimationFrame(id);
  }, [persisted, persistedLoaded, history.appointmentId, syncSavedBaseline]);

  const hasUnsavedChanges = useMemo(() => {
    if (savedSnapshotJson === null) return false;
    void draftRevision;
    const current = JSON.stringify(
      vaccinationLivePayload(vaccinationSnapshotRef.current, nursesSnapshotRef.current),
    );
    return current !== savedSnapshotJson;
  }, [draftRevision, savedSnapshotJson]);

  const handleSave = useCallback(async () => {
    const payload = vaccinationLivePayload(
      vaccinationSnapshotRef.current,
      nursesSnapshotRef.current,
    );
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const result = await saveVaccinationRecord(history.appointmentId, payload);
      const saved = result?.payload as VaccinationPersistedPayload | undefined;
      const nextPersisted = saved && typeof saved === "object" ? saved : payload;
      setPersisted(nextPersisted);
      setSavedSnapshotJson(JSON.stringify(payload));
      setDraftRevision(0);
      setSaveSuccess(true);
      if (boosterScheduleActive) {
        await syncBoosterVaccinationAndFollowUp(history);
        onFollowUpSynced?.();
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save vaccination record.");
    } finally {
      setSaving(false);
    }
  }, [boosterScheduleActive, history, onFollowUpSynced]);

  useEffect(() => {
    onRegisterToolbar({
      onSave: () => void handleSave(),
      saving,
    });
    return () => onRegisterToolbar(null);
  }, [handleSave, onRegisterToolbar, saving]);

  useEffect(() => {
    if (!onRegisterAbtcSnapshot) return;
    onRegisterAbtcSnapshot(() =>
      vaccinationLivePayload(vaccinationSnapshotRef.current, nursesSnapshotRef.current),
    );
    return () => onRegisterAbtcSnapshot(null);
  }, [onRegisterAbtcSnapshot]);

  const selectPanel = (id: VaccinationSidePanelId) => {
    setActivePanel((prev) => (prev === id ? null : id));
  };

  const vaccinationOpen = activePanel === "vaccination";
  const nursesOpen = activePanel === "nurses_note";

  return (
    <>
      <SuccessAlert
        open={saveSuccess}
        title="CHANGES HAS BEEN SAVED"
        onClose={closeSaveSuccess}
        autoDismissMs={2000}
      />
      {saveError ? (
        <p className="no-print mb-2 m-0 text-center text-xs text-anivax-danger">{saveError}</p>
      ) : null}
    <div className="flex w-full min-w-0 flex-col">
      {hasUnsavedChanges && (vaccinationOpen || nursesOpen) ? (
        <div className="no-print sticky top-[calc(4rem+3.25rem)] z-[24] -mx-4 mb-2 border-b border-black/5 bg-white px-4 py-2 min-[900px]:-mx-8 min-[900px]:top-[calc(5rem+3.25rem)] min-[900px]:px-8">
          <p
            role="status"
            className="m-0 text-left text-xs font-semibold leading-snug text-anivax-danger min-[900px]:text-sm"
          >
            changes detected! be sure to save the changes before closing
          </p>
        </div>
      ) : null}
    <div className="vaccination-tab-shell flex w-full min-w-0 items-stretch">
      <aside
        className="vaccination-folder-tabs no-print sticky top-[calc(4rem+3.25rem)] z-[23] flex shrink-0 flex-col gap-3 self-start pt-1 min-[900px]:top-[calc(5rem+3.25rem)]"
        aria-label="Vaccination section folders"
      >
        <FolderSideTab
          label="Vaccination"
          color="#7C5CFC"
          expanded={vaccinationOpen}
          onClick={() => selectPanel("vaccination")}
        />
        <FolderSideTab
          label="Nurse's Note"
          color="#0097B2"
          expanded={nursesOpen}
          onClick={() => selectPanel("nurses_note")}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-5 pl-1">
        <div
          className={
            vaccinationOpen ? "min-w-0" : "hidden min-w-0 print:!block"
          }
        >
          <VaccinationCard
            history={history}
            isSmall={isSmall}
            boosterScheduleActive={boosterScheduleActive}
            pepScheduleActive={pepScheduleActive}
            prepScheduleActive={prepScheduleActive}
            persistedVaccination={persisted?.vaccination}
            onDraftChange={bumpDraftRevision}
            onRegisterSnapshot={(getter) => {
              vaccinationSnapshotRef.current = getter;
            }}
          />
        </div>
        <div className={nursesOpen ? "min-w-0" : "hidden min-w-0 print:!block"}>
          <NursesNoteCard
            history={history}
            isSmall={isSmall}
            persistedNursesNote={persisted?.nursesNote}
            onDraftChange={bumpDraftRevision}
            onRegisterSnapshot={(getter) => {
              nursesSnapshotRef.current = getter;
            }}
          />
        </div>
        {!vaccinationOpen && !nursesOpen ? (
          <p className="m-0 py-8 text-sm text-anivax-muted">
            Click a folder tab on the left to open a section.
          </p>
        ) : null}
      </div>
    </div>
    </div>
    </>
  );
}

const VAX_FORM_DIVIDER = "my-5 border-0 border-t border-dashed border-[#C4C4C4]";

function VaccinationFormCheckbox({
  label,
  checked,
  onChange,
  readOnly = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <span className="inline-flex select-none items-center gap-2 text-sm font-medium text-black">
        <span
          aria-hidden="true"
          className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-black/30 bg-[#D9D9D9]"
        >
          {checked ? (
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path
                d="M2 6 L5 9 L10 3"
                stroke="#0D7A4F"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          ) : null}
        </span>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="inline-flex cursor-pointer select-none items-center gap-2 border-none bg-transparent p-0 font-inherit text-sm font-medium text-black transition-opacity hover:opacity-80"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-black/30 bg-[#D9D9D9]"
      >
        {checked ? (
          <svg width="11" height="11" viewBox="0 0 12 12">
            <path
              d="M2 6 L5 9 L10 3"
              stroke="#0D7A4F"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </span>
      {label}
    </button>
  );
}

function VaccinationFormSelect({
  label,
  value,
  onChange,
  options,
  className = "",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  readOnly?: boolean;
}) {
  const display =
    options.find((o) => o.value === value)?.label ?? (value ? value : "—");
  if (readOnly) {
    return (
      <div className={className}>
        <div className="mb-2 text-sm font-bold text-black">{label}</div>
        <div className="min-h-[38px] rounded border border-[#D9D9D9] bg-white px-2.5 py-2 text-sm font-semibold text-black">
          {display}
        </div>
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="mb-2 text-sm font-bold text-black">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="box-border w-full min-w-[140px] cursor-pointer rounded border border-[#D9D9D9] bg-white px-2.5 py-2 font-inherit text-sm text-black outline-none focus:border-anivax-teal"
      >
        <option value="">Select</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function VaccinationCard({
  history,
  isSmall,
  boosterScheduleActive,
  pepScheduleActive,
  prepScheduleActive,
  persistedVaccination,
  onDraftChange,
  onRegisterSnapshot,
  readOnly = false,
}: CardProps & {
  boosterScheduleActive: boolean;
  pepScheduleActive: boolean;
  prepScheduleActive: boolean;
  persistedVaccination?: Partial<VaccinationFormSnapshot>;
  onDraftChange?: () => void;
  onRegisterSnapshot?: (getter: (() => VaccinationFormSnapshot) | null) => void;
  readOnly?: boolean;
}) {
  const preview = Boolean(readOnly);
  const baseDate = history.date;
  const visitTime24 = appointmentVisitTime24(history.scheduledAt);
  const [slots, setSlots] = useState<VaccinationRowSlot[]>(() =>
    buildInitialVaccinationSlots(baseDate, visitTime24),
  );
  const [observationIso, setObservationIso] = useState(() =>
    shiftDateByDays(baseDate, 14),
  );
  const [pcecv, setPcecv] = useState(false);
  const [pvrv, setPvrv] = useState(false);
  const [siteId, setSiteId] = useState(false);
  const [siteIm, setSiteIm] = useState(false);
  const [brandSpeeda, setBrandSpeeda] = useState(false);
  const [brandVaxiran, setBrandVaxiran] = useState(false);
  const [brandAbhayrab, setBrandAbhayrab] = useState(false);
  const [erigEquirab, setErigEquirab] = useState(false);
  const [erigDoseMl, setErigDoseMl] = useState("");
  const [erigDateIso, setErigDateIso] = useState(() => baseDate || "");
  const [erigTime24, setErigTime24] = useState("09:00");
  const [animalStatus, setAnimalStatus] = useState<VaccinationAnimalStatus | "">("");
  const [treatmentStatus, setTreatmentStatus] = useState<VaccinationTreatmentStatus | "">(
    "",
  );
  const [receivedBy, setReceivedBy] = useState("");

  useEffect(() => {
    setSlots(buildInitialVaccinationSlots(baseDate, visitTime24));
    setObservationIso(shiftDateByDays(baseDate, 14));
    setPcecv(false);
    setPvrv(false);
    setSiteId(false);
    setSiteIm(false);
    setBrandSpeeda(false);
    setBrandVaxiran(false);
    setBrandAbhayrab(false);
    setErigEquirab(false);
    setErigDoseMl("");
    setErigDateIso(baseDate || "");
    setErigTime24("09:00");
    setAnimalStatus("");
    setTreatmentStatus("");
    setReceivedBy("");
  }, [baseDate, history.appointmentId, visitTime24]);

  useEffect(() => {
    const v = persistedVaccination;
    if (!v) return;
    if (Array.isArray(v.slots) && v.slots.length > 0) {
      let loaded = v.slots;
      if (!preview) {
        if (boosterScheduleActive && !prepScheduleActive && !pepScheduleActive) {
          loaded = applyBoosterScheduleToSlots(loaded, baseDate, visitTime24);
        } else if (prepScheduleActive && !boosterScheduleActive && !pepScheduleActive) {
          loaded = applyPrepScheduleToSlots(loaded, baseDate, visitTime24);
        } else if (pepScheduleActive && !boosterScheduleActive && !prepScheduleActive) {
          loaded = applyPepScheduleToSlots(loaded, baseDate, visitTime24);
        }
      }
      setSlots(loaded);
    }
    if (v.observationIso != null) setObservationIso(v.observationIso);
    if (v.pcecv != null) setPcecv(!!v.pcecv);
    if (v.pvrv != null) setPvrv(!!v.pvrv);
    if (v.siteId != null) setSiteId(!!v.siteId);
    if (v.siteIm != null) setSiteIm(!!v.siteIm);
    if (v.brandSpeeda != null) setBrandSpeeda(!!v.brandSpeeda);
    if (v.brandVaxiran != null) setBrandVaxiran(!!v.brandVaxiran);
    if (v.brandAbhayrab != null) setBrandAbhayrab(!!v.brandAbhayrab);
    if (v.erigEquirab != null) setErigEquirab(!!v.erigEquirab);
    if (v.erigDoseMl != null) setErigDoseMl(v.erigDoseMl);
    if (v.erigDateIso != null) setErigDateIso(v.erigDateIso);
    if (v.erigTime24 != null) setErigTime24(v.erigTime24);
    if (v.animalStatus != null) setAnimalStatus(v.animalStatus);
    if (v.treatmentStatus != null) setTreatmentStatus(v.treatmentStatus);
    if (v.receivedBy != null) setReceivedBy(v.receivedBy);
  }, [
    persistedVaccination,
    history.appointmentId,
    preview,
    boosterScheduleActive,
    prepScheduleActive,
    pepScheduleActive,
    baseDate,
    visitTime24,
  ]);

  const day0PostDateIso = slots[0]?.postDateIso;
  useEffect(() => {
    if (preview || !boosterScheduleActive || prepScheduleActive || pepScheduleActive) return;
    setSlots((prev) => applyBoosterScheduleToSlots(prev, baseDate, visitTime24));
  }, [
    boosterScheduleActive,
    prepScheduleActive,
    pepScheduleActive,
    day0PostDateIso,
    baseDate,
    visitTime24,
  ]);

  useEffect(() => {
    if (preview || !pepScheduleActive || boosterScheduleActive || prepScheduleActive) return;
    setSlots((prev) => applyPepScheduleToSlots(prev, baseDate, visitTime24));
  }, [
    preview,
    pepScheduleActive,
    boosterScheduleActive,
    prepScheduleActive,
    day0PostDateIso,
    baseDate,
    visitTime24,
  ]);

  useEffect(() => {
    if (preview || prepScheduleActive) return;
    setSlots((prev) => applyPostDay0VisitTime(prev, visitTime24));
  }, [preview, visitTime24, prepScheduleActive, history.scheduledAt]);

  const day0PreDateIso = slots[0]?.preDateIso;
  useEffect(() => {
    if (preview || !prepScheduleActive || boosterScheduleActive || pepScheduleActive) return;
    setSlots((prev) => applyPrepScheduleToSlots(prev, baseDate, visitTime24));
  }, [
    prepScheduleActive,
    boosterScheduleActive,
    pepScheduleActive,
    day0PreDateIso,
    baseDate,
    visitTime24,
  ]);

  useEffect(() => {
    if (preview || !onRegisterSnapshot) return;
    onRegisterSnapshot(() => ({
      slots,
      observationIso,
      pcecv,
      pvrv,
      siteId,
      siteIm,
      brandSpeeda,
      brandVaxiran,
      brandAbhayrab,
      erigEquirab,
      erigDoseMl,
      erigDateIso,
      erigTime24,
      animalStatus,
      treatmentStatus,
      receivedBy,
    }));
    return () => onRegisterSnapshot(null);
  }, [
    animalStatus,
    brandAbhayrab,
    brandSpeeda,
    brandVaxiran,
    erigDateIso,
    erigDoseMl,
    erigEquirab,
    erigTime24,
    observationIso,
    onRegisterSnapshot,
    preview,
    pcecv,
    pvrv,
    receivedBy,
    siteId,
    siteIm,
    slots,
    treatmentStatus,
  ]);

  useEffect(() => {
    if (preview) return;
    onDraftChange?.();
  }, [
    preview,
    animalStatus,
    brandAbhayrab,
    brandSpeeda,
    brandVaxiran,
    erigDateIso,
    erigDoseMl,
    erigEquirab,
    erigTime24,
    observationIso,
    onDraftChange,
    pcecv,
    pvrv,
    receivedBy,
    siteId,
    siteIm,
    slots,
    treatmentStatus,
  ]);

  return (
    <Card className="print-vaccination-card !p-0 shadow-anivax-card">
      <div className="print-vaccination-outer box-border overflow-hidden rounded-lg border border-[#D9D9D9] bg-white">
        <header className="bg-anivax-sky px-4 py-3 text-center">
          <h2 className="print-vaccination-title m-0 text-lg font-bold tracking-wide text-black min-[900px]:text-xl">
            VACCINATION
          </h2>
        </header>

        <div className={`box-border ${isSmall ? "px-4 py-4" : "px-6 py-5"}`}>
          <p className="m-0 text-sm italic text-black/80">(To be filled by ABTC Nurse)</p>

          <div
            className={`mt-4 grid gap-6 ${isSmall ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}
          >
            <div className="flex flex-col gap-3">
              <div className="text-sm font-semibold text-black">
                Cultural Cell Embryonic Vaccine:
              </div>
              <div className="flex flex-wrap gap-4">
                <VaccinationFormCheckbox
                  label="PCECV"
                  checked={pcecv}
                  readOnly={preview}
                  onChange={setPcecv}
                />
                <VaccinationFormCheckbox
                  label="PVRV"
                  checked={pvrv}
                  readOnly={preview}
                  onChange={setPvrv}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-black">SITE:</span>
                <VaccinationFormCheckbox
                  label="ID"
                  checked={siteId}
                  readOnly={preview}
                  onChange={setSiteId}
                />
                <VaccinationFormCheckbox
                  label="IM"
                  checked={siteIm}
                  readOnly={preview}
                  onChange={setSiteIm}
                />
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold text-black">BRAND:</div>
                <div className="flex flex-col items-start gap-2">
                  <VaccinationFormCheckbox
                    label="SPEEDA"
                    checked={brandSpeeda}
                    readOnly={preview}
                    onChange={setBrandSpeeda}
                  />
                  <VaccinationFormCheckbox
                    label="VAXIRAN-N"
                    checked={brandVaxiran}
                    readOnly={preview}
                    onChange={setBrandVaxiran}
                  />
                  <VaccinationFormCheckbox
                    label="ABHAYRAB"
                    checked={brandAbhayrab}
                    readOnly={preview}
                    onChange={setBrandAbhayrab}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="text-sm font-semibold text-black">
                Rabbies Immunoglobulin (ERIG) (BWx40/200):
              </div>
              <VaccinationFormCheckbox
                label="EQUIRAB/ERIG"
                checked={erigEquirab}
                readOnly={preview}
                onChange={setErigEquirab}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-black">Dose:</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={erigDoseMl}
                  readOnly={preview}
                  tabIndex={preview ? -1 : undefined}
                  onChange={(e) => setErigDoseMl(e.target.value)}
                  className="box-border h-8 w-16 rounded border border-[#D9D9D9] bg-white px-2 text-sm text-black outline-none focus:border-anivax-teal"
                  aria-label="ERIG dose in milliliters"
                />
                <span className="text-sm text-black">ml</span>
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold text-black">Date&amp;Time:</div>
                <div className="flex max-w-[320px] flex-col gap-0 overflow-hidden rounded border border-[#D9D9D9]">
                  <VaccinationM3DatePickerField
                    dateIso={erigDateIso}
                    showClear={!preview}
                    disabled={preview}
                    onChange={setErigDateIso}
                  />
                  <VaccinationM3TimePickerField
                    time24={erigTime24}
                    showClear={!preview}
                    disabled={preview}
                    onChange={setErigTime24}
                  />
                </div>
              </div>
            </div>
          </div>

          <hr className={VAX_FORM_DIVIDER} aria-hidden="true" />

          <h3
            className={`print-vaccination-title mb-4 text-center font-bold text-black ${isSmall ? "text-lg" : "text-[22px]"}`}
          >
            Schedule of Vaccination
          </h3>

        <div className="print-vaccination-table-wrap w-full touch-pan-x overflow-x-auto scroll-smooth">
          <table
            className={`print-vaccination-table w-full border-collapse table-fixed ${isSmall ? "min-w-[720px]" : "min-w-[960px]"}`}
          >
            <thead>
              <tr>
                <th rowSpan={2} className={`${VAX_TH} w-[11%] bg-[#F9F9F9]`}>
                  BOOSTER
                  <br />
                  DOSE
                </th>
                <th colSpan={4} className={`${VAX_TH} bg-anivax-sky`}>
                  POST EXPOSURE
                </th>
                <th rowSpan={2} className={`${VAX_TH} w-[9%] bg-[#F9F9F9]`} />
                <th colSpan={4} className={`${VAX_TH} bg-anivax-sky`}>
                  PRE EXPOSURE
                </th>
              </tr>
              <tr>
                <th className={`${VAX_TH} w-[11%] bg-[#F9F9F9]`}>DATE</th>
                <th className={`${VAX_TH} w-[10%] bg-[#F9F9F9]`}>TIME</th>
                <th className={`${VAX_TH} w-[18%] bg-[#F9F9F9]`}>SITE</th>
                <th className={`${VAX_TH} w-[8%] bg-[#F9F9F9]`}>NOD</th>
                <th className={`${VAX_TH} w-[11%] bg-[#F9F9F9]`}>DATE</th>
                <th className={`${VAX_TH} w-[10%] bg-[#F9F9F9]`}>TIME</th>
                <th className={`${VAX_TH} w-[18%] bg-[#F9F9F9]`}>SITE</th>
                <th className={`${VAX_TH} w-[8%] bg-[#F9F9F9]`}>NOD</th>
              </tr>
            </thead>
            <tbody>
              {VACCINATION_ROW_META.map((meta, i) => {
                const slot = slots[i];
                const postLocked =
                  preview ||
                  prepScheduleActive ||
                  (boosterScheduleActive && isBoosterLockedPostRow(i));
                const preRowActive = Boolean(meta.preDay);
                const preLocked =
                  preview ||
                  (!prepScheduleActive &&
                    (boosterScheduleActive || pepScheduleActive) &&
                    preRowActive);
                return (
                  <tr key={`vax-row-${i}`}>
                    <td className={VAX_TD_LABEL}>{meta.postDay}</td>
                    <td className={VAX_TD_TOP}>
                      <VaccinationM3DatePickerField
                        dateIso={slot.postDateIso}
                        showClear={!preview}
                        disabled={postLocked}
                        onChange={(v) =>
                          setSlots((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], postDateIso: v };
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className={VAX_TD_TOP}>
                      <VaccinationM3TimePickerField
                        time24={slot.postTime24}
                        showClear={!preview}
                        disabled={postLocked}
                        onChange={(v) =>
                          setSlots((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], postTime24: v };
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className={VAX_TD_TOP}>
                      <VaccinationSiteCell
                        rightChecked={slot.postSiteRight}
                        leftChecked={slot.postSiteLeft}
                        readOnly={preview}
                        disabled={postLocked}
                        onToggleRight={() =>
                          setSlots((prev) => {
                            const next = [...prev];
                            next[i] = {
                              ...next[i],
                              postSiteRight: !next[i].postSiteRight,
                            };
                            return next;
                          })
                        }
                        onToggleLeft={() =>
                          setSlots((prev) => {
                            const next = [...prev];
                            next[i] = {
                              ...next[i],
                              postSiteLeft: !next[i].postSiteLeft,
                            };
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className={VAX_TD_TOP}>
                      <VaccinationNodCell
                        value={slot.postNod ?? ""}
                        readOnly={preview}
                        disabled={postLocked}
                        ariaLabel={`Post exposure NOD ${meta.postDay}`}
                        onChange={(v) =>
                          setSlots((prev) => {
                            const next = [...prev];
                            next[i] = { ...next[i], postNod: v };
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className={VAX_TD_LABEL}>{meta.preDay}</td>
                    <td className={VAX_TD_TOP}>
                      {preRowActive ? (
                        <VaccinationM3DatePickerField
                          dateIso={slot.preDateIso}
                          showClear={!preview}
                          disabled={preLocked}
                          onChange={(v) =>
                            setSlots((prev) => {
                              const next = [...prev];
                              next[i] = { ...next[i], preDateIso: v };
                              return next;
                            })
                          }
                        />
                      ) : null}
                    </td>
                    <td className={VAX_TD_TOP}>
                      {preRowActive ? (
                        <VaccinationM3TimePickerField
                          time24={slot.preTime24}
                          showClear={!preview}
                          disabled={preLocked}
                          onChange={(v) =>
                            setSlots((prev) => {
                              const next = [...prev];
                              next[i] = { ...next[i], preTime24: v };
                              return next;
                            })
                          }
                        />
                      ) : null}
                    </td>
                    <td className={VAX_TD_TOP}>
                      {preRowActive ? (
                        <VaccinationSiteCell
                          rightChecked={slot.preSiteRight}
                          leftChecked={slot.preSiteLeft}
                          readOnly={preview}
                          disabled={preLocked}
                          onToggleRight={() =>
                            setSlots((prev) => {
                              const next = [...prev];
                              next[i] = {
                                ...next[i],
                                preSiteRight: !next[i].preSiteRight,
                              };
                              return next;
                            })
                          }
                          onToggleLeft={() =>
                            setSlots((prev) => {
                              const next = [...prev];
                              next[i] = {
                                ...next[i],
                                preSiteLeft: !next[i].preSiteLeft,
                              };
                              return next;
                            })
                          }
                        />
                      ) : null}
                    </td>
                    <td className={VAX_TD_TOP}>
                      {preRowActive ? (
                        <VaccinationNodCell
                          value={slot.preNod ?? ""}
                          readOnly={preview}
                          disabled={preLocked}
                          ariaLabel={`Pre exposure NOD ${meta.preDay}`}
                          onChange={(v) =>
                            setSlots((prev) => {
                              const next = [...prev];
                              next[i] = { ...next[i], preNod: v };
                              return next;
                            })
                          }
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div
          className={`print-vaccination-footer mt-7 grid items-start ${isSmall ? "grid-cols-1 gap-5" : "grid-cols-[minmax(0,_1.15fr)_minmax(0,_0.85fr)_minmax(0,_0.95fr)] gap-6"}`}
        >
          <div>
            <div className="mb-1 text-sm font-bold text-black">STATUS OF ANIMAL:</div>
            <div className="mb-2.5 text-xs text-black">(AFTER 14 DAY OF OBSERVATION)</div>
            <div className="mb-3.5 flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-black/50">14th Day</span>
              <div className="print-vaccination-obs-wrap box-border max-w-[260px] flex-[1_1_180px] overflow-hidden rounded border border-[#D9D9D9]">
                <VaccinationM3DatePickerField
                  dateIso={observationIso}
                  showClear={!preview}
                  disabled={preview}
                  onChange={setObservationIso}
                  dense
                />
              </div>
            </div>
            </div>

            <VaccinationFormSelect
              label="TREATMENT STATUS:"
              value={treatmentStatus}
              readOnly={preview}
              onChange={(v) => setTreatmentStatus(v as VaccinationTreatmentStatus | "")}
              options={[
                { value: "COMPLETE", label: "COMPLETE" },
                { value: "INCOMPLETE", label: "INCOMPLETE" },
              ]}
            />

          <div>
            <div className="mb-2.5 text-sm font-bold text-black">RECEIVED BY:</div>
            <SignaturePadField
              value={receivedBy}
              readOnly={preview}
              onChange={setReceivedBy}
              placeholder="Signature"
              ariaLabel="Received by signature ? patient or relatives"
              className="print-vaccination-received-signature"
              minHeight={96}
            />
            <div className="mt-2 text-center text-xs tracking-wide text-black">PATIENT/RELATIVES</div>
          </div>
        </div>
        </div>
      </div>
    </Card>
  );
}

function VaccinationStatusOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="inline-flex cursor-pointer select-none items-center gap-2 border-none bg-transparent p-0 font-inherit text-sm font-semibold text-anivax-muted transition-opacity hover:opacity-80"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center bg-[#D9D9D9]"
      >
        {selected ? (
          <svg width="11" height="11" viewBox="0 0 12 12">
            <path
              d="M2 6 L5 9 L10 3"
              stroke="#0D7A4F"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </span>
      {label}
    </button>
  );
}


function DoctorsOrderCard({
  history,
  isSmall,
  winW,
  onSaved,
  onRegisterToolbar,
  onPlanBoosterChange,
  onPlanPepChange,
  onPlanPrepChange,
}: DoctorsOrderCardProps) {
  const serverOrder = useMemo(
    () => normalizeDoctorsOrder(history.doctorsOrder),
    [history.doctorsOrder],
  );
  const [draft, setDraft] = useState(serverOrder);
  const [bodyMarks, setBodyMarks] = useState<NonNullable<DoctorsOrder["bodyMarks"]>>(
    () => serverOrder.bodyMarks ?? [],
  );
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const closeSaveSuccess = useCallback(() => setSaveSuccess(false), []);

  useEffect(() => {
    setDraft(serverOrder);
    setBodyMarks(serverOrder.bodyMarks ?? []);
    setSaveError(null);
    setCategoryError(null);
  }, [history.appointmentId, serverOrder]);

  useEffect(() => {
    setSaveSuccess(false);
  }, [history.appointmentId]);

  // Below this width we drop the body-diagrams column underneath the form
  // instead of side-by-side, otherwise the bodies become unreadable.
  const stacked = winW < 1100;

  const savedOrder = useMemo(
    () => normalizeDoctorsOrder(serverOrder),
    [serverOrder],
  );

  const draftForCompare = useMemo(
    () => normalizeDoctorsOrder({ ...draft, bodyMarks }),
    [draft, bodyMarks],
  );

  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(draftForCompare) !== JSON.stringify(savedOrder),
    [draftForCompare, savedOrder],
  );

  const handleBodyMarksChange = (marks: NonNullable<DoctorsOrder["bodyMarks"]>) => {
    setBodyMarks(marks);
    setDraft((prev) => ({ ...prev, bodyMarks: marks }));
  };

  const handleOrderChange = (updated: DoctorsOrder) => {
    const prevBooster = draft.plan.booster;
    const prevPep = draft.plan.pep;
    const prevPrep = draft.plan.prep;
    const normalized = normalizeDoctorsOrder(updated);
    setDraft(normalized);
    setSaveSuccess(false);
    if (normalized.biteCategory != null) setCategoryError(null);
    if (onPlanBoosterChange && normalized.plan.booster !== prevBooster) {
      onPlanBoosterChange(normalized.plan.booster);
    }
    if (onPlanPepChange && normalized.plan.pep !== prevPep) {
      onPlanPepChange(normalized.plan.pep);
    }
    if (onPlanPrepChange && normalized.plan.prep !== prevPrep) {
      onPlanPrepChange(normalized.plan.prep);
    }
  };

  const handleSave = useCallback(async () => {
    const payload = normalizeDoctorsOrder({ ...draft, bodyMarks });
    if (payload.biteCategory == null) {
      setCategoryError("Please select an exposure category.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await saveDoctorsOrder(history.appointmentId, { payload });
      setDraft(payload);
      setCategoryError(null);
      setSaveSuccess(true);
      if (payload.plan.booster) {
        await syncBoosterVaccinationAndFollowUp(history);
        notifyDataChanged("appointments");
      }
      await onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save doctor's order.");
    } finally {
      setSaving(false);
    }
  }, [bodyMarks, draft, history.appointmentId, onSaved]);

  useEffect(() => {
    onRegisterToolbar({
      onSave: () => void handleSave(),
      saving,
    });
    return () => onRegisterToolbar(null);
  }, [handleSave, onRegisterToolbar, saving]);

  return (
    <>
      {hasUnsavedChanges ? (
        <div className="no-print sticky top-[calc(4rem+3.25rem)] z-[24] -mx-4 mb-1 border-b border-black/5 bg-white px-4 py-2 min-[900px]:-mx-8 min-[900px]:top-[calc(5rem+3.25rem)] min-[900px]:px-8">
          <p
            role="status"
            className="m-0 text-xs font-semibold leading-snug text-anivax-danger min-[900px]:text-sm"
          >
            changes detected! be sure to save the changes before closing
          </p>
        </div>
      ) : null}

      <SuccessAlert
        open={saveSuccess}
        title="CHANGES HAS BEEN SAVED"
        onClose={closeSaveSuccess}
        autoDismissMs={2000}
      />

      <Card>
        {saveError ? (
          <p className="mb-4 m-0 text-center text-xs text-anivax-danger">{saveError}</p>
        ) : null}
        <div
          className={`grid items-start ${stacked ? "grid-cols-1 gap-6" : "grid-cols-[minmax(0,_1.3fr)_minmax(0,_1fr)] gap-8"}`}
        >
          <DoctorsOrderForm order={draft} onOrderChange={handleOrderChange} categoryError={categoryError} />
          <div className="flex flex-col gap-1">
            <BodyDiagramRow marks={bodyMarks} onMarksChange={handleBodyMarksChange} />
            <p className="m-0 text-center text-[11px] text-anivax-muted">
              Click on the body to mark injury sites. Click an existing mark to remove it.
            </p>
          </div>
        </div>

        <HomeMedsSection order={draft} isSmall={isSmall} onOrderChange={handleOrderChange} />
      </Card>
    </>
  );
}

function DoctorsOrderCategoryField({
  value,
  onChange,
  error,
}: {
  value?: BiteCategory;
  onChange: (category: BiteCategory) => void;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="print-field-row flex min-w-0 flex-col items-stretch gap-2">
      <span className="print-field-label shrink-0 whitespace-nowrap text-sm font-semibold tracking-wide text-anivax-muted">
        CATEGORY:
      </span>
      <div className="min-w-0 rounded border border-[#D9D9D9] bg-white">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-3 py-2.5 text-left font-inherit text-base font-medium text-black transition-colors hover:bg-anivax-page/30"
        >
          <span className={value == null ? "text-anivax-muted" : undefined}>{biteCategoryLabel(value)}</span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className={`h-5 w-5 shrink-0 text-anivax-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path
              d="M5 7l5 6 5-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open ? (
          <div
            className="grid grid-cols-2 gap-2 border-t border-[#E8E8E8] px-2 py-2 sm:grid-cols-4"
            role="listbox"
            aria-label="Exposure category"
          >
            {BITE_CATEGORY_OPTIONS.map((opt) => {
              const selected = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`cursor-pointer rounded border px-2 py-2 text-center text-sm font-semibold transition-colors ${
                    selected
                      ? "border-anivax-teal bg-anivax-teal/10 text-anivax-teal-deep"
                      : "border-[#D9D9D9] bg-white text-black hover:border-anivax-teal/50 hover:bg-anivax-page/40"
                  }`}
                >
                  <span className="block text-base leading-none">{opt.roman}</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-anivax-muted">{opt.num}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {error ? <p className="m-0 text-xs text-anivax-danger">{error}</p> : null}
    </div>
  );
}

function DoctorsOrderForm({
  order,
  onOrderChange,
  categoryError,
  readOnlyCategory,
}: {
  order: DoctorsOrder;
  onOrderChange?: (order: DoctorsOrder) => void;
  categoryError?: string | null;
  readOnlyCategory?: boolean;
}) {
  const { plan } = order;
  const editable = !!onOrderChange && !readOnlyCategory;
  const [pertinentPE, setPertinentPE] = useState(order.pertinentPE);
  const [diagnosis, setDiagnosis] = useState(order.diagnosis);

  useEffect(() => {
    setPertinentPE(order.pertinentPE);
    setDiagnosis(order.diagnosis);
  }, [order.pertinentPE, order.diagnosis]);

  const patch = (next: DoctorsOrder) => {
    if (editable && onOrderChange) onOrderChange(next);
  };

  /** Radio-style: selecting one option; clicking the active option again does not clear it. */
  const setPleaseGiveOption = (key: "booster" | "prep" | "pep", checked: boolean) => {
    if (!checked) return;
    patch({
      ...order,
      plan: {
        ...order.plan,
        booster: key === "booster",
        prep: key === "prep",
        pep: key === "pep",
      },
    });
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <DoctorsOrderTextField
        label="PERTINENT PE:"
        value={pertinentPE}
        stack
        valueMinHClass="min-h-[80px]"
        editable={editable}
        onChange={(v) => {
          setPertinentPE(v);
          if (editable) patch({ ...order, pertinentPE: v });
        }}
      />
      <DoctorsOrderTextField
        label="DIAGNOSIS:"
        value={diagnosis}
        stack
        valueMinHClass="min-h-[72px]"
        editable={editable}
        onChange={(v) => {
          setDiagnosis(v);
          if (editable) patch({ ...order, diagnosis: v });
        }}
      />

      {readOnlyCategory || !editable ? (
        <FieldRow label="CATEGORY:" value={biteCategoryLabel(order.biteCategory)} />
      ) : (
        <DoctorsOrderCategoryField
          value={order.biteCategory}
          onChange={(biteCategory) => patch({ ...order, biteCategory })}
          error={categoryError}
        />
      )}

      <h2 className="print-plan-title my-3 mb-1 text-center text-[28px] font-extrabold tracking-wide text-black">
        PLAN
      </h2>

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-bold tracking-wide text-black">PLEASE GIVE:</span>
        <CheckboxItem
          checked={plan.booster}
          label="BOOSTER"
          onChange={editable ? (checked) => setPleaseGiveOption("booster", checked) : undefined}
        />
        <CheckboxItem
          checked={plan.prep}
          label="PrEP"
          onChange={editable ? (checked) => setPleaseGiveOption("prep", checked) : undefined}
        />
        <CheckboxItem
          checked={plan.pep}
          label="PEP"
          onChange={editable ? (checked) => setPleaseGiveOption("pep", checked) : undefined}
        />
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex flex-col justify-between gap-2">
          <CheckboxWithInline
            checked={plan.ats.given}
            label="ATS:"
            onChange={
              editable
                ? (given) =>
                    patch({
                      ...order,
                      plan: {
                        ...plan,
                        ats: { given, units: given ? (plan.ats.units ?? "") : "" },
                      },
                    })
                : undefined
            }
            input={
              <InlineInput
                value={plan.ats.units ?? ""}
                size="sm"
                numeric="integer"
                ariaLabel="ATS dose in IU"
                disabled={editable ? !plan.ats.given : false}
                onChange={
                  editable
                    ? (units) => {
                        if (!plan.ats.given) return;
                        patch({
                          ...order,
                          plan: { ...plan, ats: { ...plan.ats, given: true, units } },
                        });
                      }
                    : undefined
                }
              />
            }
            suffix="IU"
          />
          <div className="flex flex-wrap items-center gap-6">
            <CheckboxItem
              checked={plan.erig}
              label="ERIG"
              onChange={editable ? (erig) => patch({ ...order, plan: { ...plan, erig } }) : undefined}
            />
            <CheckboxItem
              checked={plan.arv}
              label="ARV"
              onChange={editable ? (arv) => patch({ ...order, plan: { ...plan, arv } }) : undefined}
            />
          </div>
        </div>
        <div className="flex flex-col justify-between gap-2">
          <CheckboxWithInline
            checked={plan.tetanusToxoid.given}
            label="TETANUS TOXOID: 0.5ml"
            onChange={
              editable
                ? (given) =>
                    patch({
                      ...order,
                      plan: {
                        ...plan,
                        tetanusToxoid: {
                          given,
                          note: given ? (plan.tetanusToxoid.note ?? "") : "",
                        },
                      },
                    })
                : undefined
            }
            input={
              <InlineInput
                value={plan.tetanusToxoid.note ?? ""}
                size="md"
                numeric="decimal"
                ariaLabel="Tetanus toxoid volume in ml"
                disabled={editable ? !plan.tetanusToxoid.given : false}
                onChange={
                  editable
                    ? (note) => {
                        if (!plan.tetanusToxoid.given) return;
                        patch({
                          ...order,
                          plan: {
                            ...plan,
                            tetanusToxoid: { ...plan.tetanusToxoid, given: true, note },
                          },
                        });
                      }
                    : undefined
                }
              />
            }
            suffix="ml"
          />
          <CheckboxItem
            checked={plan.fic}
            label="FIC"
            onChange={editable ? (fic) => patch({ ...order, plan: { ...plan, fic } }) : undefined}
          />
        </div>
      </div>

      <p className="m-0 text-xs italic text-black">
        (PLEASE INCLUDE DATE AND TIME GIVEN THE INITIALS NOD FOR ANTI TETANUS)
      </p>
    </div>
  );
}

function HomeMedsSection({
  order,
  isSmall,
  onOrderChange,
}: {
  order: DoctorsOrder;
  isSmall: boolean;
  onOrderChange?: (order: DoctorsOrder) => void;
}) {
  const { homeMeds } = order;
  const editable = !!onOrderChange;

  const setDrugStrength = (
    drug: "amoxicillin" | "paracetamol" | "mefenamicAcid",
    key: "mg125" | "mg250" | "mg500",
    checked: boolean,
  ) => {
    if (!onOrderChange) return;
    const strengthKeys =
      drug === "mefenamicAcid"
        ? (["mg250", "mg500"] as const)
        : (["mg125", "mg250", "mg500"] as const);
    const nextStrengths = { ...homeMeds[drug] };
    for (const strengthKey of strengthKeys) {
      nextStrengths[strengthKey] = strengthKey === key && checked;
    }
    onOrderChange({
      ...order,
      homeMeds: {
        ...homeMeds,
        [drug]: nextStrengths,
      },
    });
  };

  return (
    <div
      className={`mt-7 grid ${isSmall ? "grid-cols-1 gap-4" : "grid-cols-[minmax(0,_1.3fr)_minmax(0,_1fr)] gap-8"}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          <span
            className="text-base font-extrabold tracking-wide text-black"
          >
            HOME MEDS:
          </span>
          <span className="text-sm font-bold tracking-wide text-anivax-muted">
            AMOXICILLIN
          </span>
          <CheckboxItem
            checked={!!homeMeds.amoxicillin.mg125}
            label="125mg"
            onChange={
              editable
                ? (v) => setDrugStrength("amoxicillin", "mg125", v)
                : undefined
            }
          />
          <CheckboxItem
            checked={!!homeMeds.amoxicillin.mg250}
            label="250mg"
            onChange={
              editable
                ? (v) => setDrugStrength("amoxicillin", "mg250", v)
                : undefined
            }
          />
          <CheckboxItem
            checked={!!homeMeds.amoxicillin.mg500}
            label="500mg"
            onChange={
              editable
                ? (v) => setDrugStrength("amoxicillin", "mg500", v)
                : undefined
            }
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-sm font-semibold text-anivax-muted">
            OTHERS:
          </span>
          {editable ? (
            <input
              type="text"
              value={homeMeds.others}
              onChange={(e) =>
                onOrderChange({ ...order, homeMeds: { ...homeMeds, others: e.target.value } })
              }
              className="box-border flex min-h-8 flex-1 rounded border border-[#D9D9D9] bg-white px-3 text-sm text-black outline-none focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/25"
            />
          ) : (
            <div className="flex min-h-8 flex-1 items-center rounded border border-[#D9D9D9] px-3 text-sm text-black">
              {homeMeds.others || "???"}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="text-sm font-bold tracking-wide text-anivax-muted">
            PARACETAMOL:
          </span>
          <CheckboxItem
            checked={!!homeMeds.paracetamol.mg125}
            label="125mg"
            onChange={
              editable
                ? (v) => setDrugStrength("paracetamol", "mg125", v)
                : undefined
            }
          />
          <CheckboxItem
            checked={!!homeMeds.paracetamol.mg250}
            label="250mg"
            onChange={
              editable
                ? (v) => setDrugStrength("paracetamol", "mg250", v)
                : undefined
            }
          />
          <CheckboxItem
            checked={!!homeMeds.paracetamol.mg500}
            label="500mg"
            onChange={
              editable
                ? (v) => setDrugStrength("paracetamol", "mg500", v)
                : undefined
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="text-sm font-bold tracking-wide text-anivax-muted">
            MEFENAMIC ACID:
          </span>
          <CheckboxItem
            checked={!!homeMeds.mefenamicAcid.mg250}
            label="250mg"
            onChange={
              editable
                ? (v) => setDrugStrength("mefenamicAcid", "mg250", v)
                : undefined
            }
          />
          <CheckboxItem
            checked={!!homeMeds.mefenamicAcid.mg500}
            label="500mg"
            onChange={
              editable
                ? (v) => setDrugStrength("mefenamicAcid", "mg500", v)
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Checkbox / inline input                            */
/* -------------------------------------------------------------------------- */

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center bg-[#D9D9D9]"
    >
      {checked ? (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path
            d="M2 6 L5 9 L10 3"
            stroke="#0D7A4F"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ) : null}
    </span>
  );
}

function CheckboxItem({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange?: (checked: boolean) => void;
}) {
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-anivax-muted">
        <Checkbox checked={checked} />
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap border-none bg-transparent p-0 text-left text-sm font-semibold text-anivax-muted transition-opacity hover:opacity-80"
    >
      <Checkbox checked={checked} />
      {label}
    </button>
  );
}

function CheckboxWithInline({
  checked,
  label,
  input,
  suffix,
  onChange,
}: {
  checked: boolean;
  label: string;
  input: React.ReactNode;
  suffix?: string;
  onChange?: (checked: boolean) => void;
}) {
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-anivax-muted">
        <Checkbox checked={checked} />
        {label}
        {input}
        {suffix ? <span>{suffix}</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 whitespace-nowrap text-sm font-semibold text-anivax-muted">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="inline-flex cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left font-inherit text-inherit transition-opacity hover:opacity-80"
      >
        <Checkbox checked={checked} />
        {label}
      </button>
      {input}
      {suffix ? <span>{suffix}</span> : null}
    </span>
  );
}

/** Restrict ATS (IU) and tetanus (ml) inline fields to numeric characters only. */
function sanitizePlanNumericInput(raw: string, mode: "integer" | "decimal"): string {
  if (mode === "integer") {
    return raw.replace(/\D/g, "");
  }
  let s = raw.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot === -1) return s;
  const head = s.slice(0, dot);
  const tail = s.slice(dot + 1).replace(/\./g, "");
  return `${head}.${tail}`;
}

function InlineInput({
  value,
  size,
  onChange,
  numeric,
  ariaLabel,
  disabled,
}: {
  value: string;
  size: "sm" | "md";
  onChange?: (value: string) => void;
  /** integer = whole IU; decimal = ml (e.g. 0.5) */
  numeric?: "integer" | "decimal";
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const boxClass = `inline-flex h-6 items-center rounded border border-[#D9D9D9] bg-white px-2 text-[13px] text-black ${
    size === "sm" ? "min-w-20" : "min-w-[120px]"
  } ${disabled ? "cursor-not-allowed bg-[#F0F0F0] text-anivax-muted" : ""}`;
  if (!onChange) {
    return <span className={boxClass}>{value || "\u00A0"}</span>;
  }
  const handleChange = (raw: string) => {
    onChange(numeric ? sanitizePlanNumericInput(raw, numeric) : raw);
  };
  return (
    <input
      type="text"
      inputMode={numeric === "integer" ? "numeric" : numeric === "decimal" ? "decimal" : "text"}
      pattern={numeric === "integer" ? "[0-9]*" : numeric === "decimal" ? "[0-9.]*" : undefined}
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
      className={`${boxClass} outline-none focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/25 disabled:pointer-events-none`}
    />
  );
}

function DoctorsOrderTextField({
  label,
  value,
  stack,
  valueMinHClass,
  editable,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  stack?: boolean;
  valueMinHClass?: string;
  editable: boolean;
  onChange?: (value: string) => void;
  onBlur?: () => void;
}) {
  if (!editable || !onChange) {
    return (
      <FieldRow
        label={label}
        value={value || "?"}
        stack={stack}
        valueMinHClass={valueMinHClass}
      />
    );
  }
  return (
    <label
      className={`print-field-row flex min-w-0 cursor-text flex-col items-stretch gap-2 ${stack ? "" : "flex-row items-center gap-3"}`}
    >
      <span className="print-field-label shrink-0 whitespace-nowrap text-sm font-semibold tracking-wide text-anivax-muted">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={stack ? 4 : 2}
        className={`print-field-value box-border w-full resize-y rounded border border-[#D9D9D9] bg-white px-3 py-2.5 text-base font-medium leading-snug text-black outline-none focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/25 ${valueMinHClass ?? "min-h-9"}`}
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Body diagrams                                  */
/* -------------------------------------------------------------------------- */

const BODY_IMAGE_SRC = "/images/HUMAN%20BODY.svg";
const BODY_VIEWS: BodyView[] = ["RIGHT", "FRONT", "BACK", "LEFT"];
const MARK_HIT_RADIUS = 0.05;

type BodyMark = NonNullable<DoctorsOrder["bodyMarks"]>[number];

function relToViewLocal(relX: number, relY: number): BodyMark {
  const viewIndex = Math.min(
    BODY_VIEWS.length - 1,
    Math.max(0, Math.floor(relX * BODY_VIEWS.length)),
  );
  return {
    view: BODY_VIEWS[viewIndex],
    x: relX * BODY_VIEWS.length - viewIndex,
    y: relY,
  };
}

function markPositionPercent(mark: BodyMark): { left: string; top: string } {
  const viewIndex = BODY_VIEWS.indexOf(mark.view);
  const left = ((viewIndex + mark.x) / BODY_VIEWS.length) * 100;
  const top = mark.y * 100;
  return { left: `${left}%`, top: `${top}%` };
}

function findMarkNear(
  marks: BodyMark[],
  view: BodyView,
  x: number,
  y: number,
): number {
  return marks.findIndex(
    (m) =>
      m.view === view &&
      Math.hypot(m.x - x, m.y - y) < MARK_HIT_RADIUS,
  );
}

function BodyDiagramRow({
  marks,
  onMarksChange,
  readOnly,
}: {
  marks: BodyMark[];
  onMarksChange?: (marks: BodyMark[]) => void;
  readOnly?: boolean;
}) {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || !onMarksChange) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const relX = (event.clientX - rect.left) / rect.width;
    const relY = (event.clientY - rect.top) / rect.height;
    const { view, x, y } = relToViewLocal(relX, relY);

    const nearIdx = findMarkNear(marks, view, x, y);
    if (nearIdx >= 0) {
      onMarksChange(marks.filter((_, i) => i !== nearIdx));
      return;
    }
    onMarksChange([...marks, { view, x, y }]);
  };

  return (
    <div className="print-body-diagram flex w-full justify-center">
      <div
        role="img"
        aria-label={
          readOnly
            ? "Anatomical reference: right, front, back and left views with injury marks."
            : "Anatomical reference: right, front, back and left views. Click to mark injury sites."
        }
        className={`relative w-full max-w-[520px] ${readOnly ? "" : "cursor-crosshair"}`}
        onClick={readOnly ? undefined : handleClick}
      >
        <img
          src={BODY_IMAGE_SRC}
          alt=""
          draggable={false}
          className="pointer-events-none block h-auto w-full select-none"
        />
        {marks.map((mark, index) => {
          const { left, top } = markPositionPercent(mark);
          return (
            <span
              key={`${mark.view}-${mark.x}-${mark.y}-${index}`}
              aria-hidden="true"
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-red-600"
              style={{ left, top }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M2 2 L12 12 M12 2 L2 12"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Building blocks                                */
/* -------------------------------------------------------------------------- */

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={["print-card", "box-border", "bg-white", "p-7", "shadow-anivax-card", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

interface FieldRowProps {
  label: string;
  value: string;
  /** Stack label above the value (for full-width fields like CHIEF COMPLAINT). */
  stack?: boolean;
  /** Stop the field from filling its grid track. */
  grow?: boolean;
  /** Tailwind min-height class for the value cell (screen; print CSS may override). */
  valueMinHClass?: string;
}

function FieldRow({
  label,
  value,
  stack = false,
  grow = true,
  valueMinHClass = "min-h-9",
}: FieldRowProps) {
  return (
    <div
      className={`print-field-row flex min-w-0 ${stack ? "flex-col items-stretch gap-2" : "flex-row items-center gap-3"} ${grow ? "flex-1" : "shrink-0 grow-0 basis-auto"}`}
    >
      <span className="print-field-label shrink-0 whitespace-nowrap text-sm font-semibold tracking-wide text-anivax-muted">
        {label}
      </span>
      <div
        className={`print-field-value flex min-w-0 rounded border border-[#D9D9D9] bg-white text-base font-medium leading-snug text-black ${valueMinHClass} ${
          stack
            ? "flex-[0_0_auto] items-start overflow-hidden text-clip whitespace-pre-wrap break-words px-3 py-2.5"
            : "flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap px-3 py-0"
        }`}
        title={stack ? undefined : value}
      >
        {value}
      </div>
    </div>
  );
}

function PlaceholderCard({ text }: { text: string }) {
  return (
    <div className="print-card box-border bg-white px-6 py-12 text-center text-base font-medium text-anivax-muted shadow-anivax-card">
      {text}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Icons                                     */
/* -------------------------------------------------------------------------- */

function PrinterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"
        stroke="#000"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M14 3v6h6" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 3h7v7M10 14L21 3M21 14v7h-7M3 10V3h7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*                           ABTC form preview modal                           */
/* -------------------------------------------------------------------------- */

function AbtcFormPreviewContent({
  history,
  isSmall,
  winW,
  vaccinationPayload,
  boosterScheduleActive,
  pepScheduleActive,
  prepScheduleActive,
}: {
  history: PatientHistory;
  isSmall: boolean;
  winW: number;
  vaccinationPayload: VaccinationPersistedPayload;
  boosterScheduleActive: boolean;
  pepScheduleActive: boolean;
  prepScheduleActive: boolean;
}) {
  const order = history.doctorsOrder;

  return (
    <>
      <div className="abtc-print-page-1 flex w-full flex-col gap-3">
        <PersonalInfoCard history={history} isSmall={isSmall} />
        <ExposureCard history={history} isSmall={isSmall} hideVitalsSidebar />
        {order ? (
          <DoctorsOrderPreviewCard order={order} isSmall={isSmall} winW={winW} />
        ) : (
          <PlaceholderCard text="No doctor's order has been recorded for this appointment yet." />
        )}
      </div>
      <div className="abtc-print-page-2 flex w-full flex-col gap-3" inert="">
        <VaccinationCard
          history={history}
          isSmall={isSmall}
          readOnly
          boosterScheduleActive={boosterScheduleActive}
          pepScheduleActive={pepScheduleActive}
          prepScheduleActive={prepScheduleActive}
          persistedVaccination={vaccinationPayload.vaccination}
        />
        <NursesNoteCard
          history={history}
          isSmall={isSmall}
          readOnly
          persistedNursesNote={vaccinationPayload.nursesNote}
        />
      </div>
    </>
  );
}

function DoctorsOrderPreviewCard({
  order,
  isSmall,
  winW,
}: {
  order: DoctorsOrder;
  isSmall: boolean;
  winW: number;
}) {
  const stacked = winW < 1100;
  const marks = order.bodyMarks ?? [];

  return (
    <Card>
      <div
        className={`grid items-start ${stacked ? "grid-cols-1 gap-6" : "grid-cols-[minmax(0,_1.3fr)_minmax(0,_1fr)] gap-8"}`}
      >
        <DoctorsOrderForm order={order} readOnlyCategory />
        <BodyDiagramRow marks={marks} readOnly />
      </div>
      <HomeMedsSection order={order} isSmall={isSmall} />
    </Card>
  );
}

function AbtcFormPreviewModal({
  open,
  onClose,
  history,
  isSmall,
  winW,
  vaccinationPayload,
  payloadLoading,
  previewKey,
  boosterScheduleActive,
  pepScheduleActive,
  prepScheduleActive,
}: {
  open: boolean;
  onClose: () => void;
  history: PatientHistory;
  isSmall: boolean;
  winW: number;
  vaccinationPayload: VaccinationPersistedPayload | null;
  payloadLoading: boolean;
  previewKey: number;
  boosterScheduleActive: boolean;
  pepScheduleActive: boolean;
  prepScheduleActive: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="abtc-preview-overlay fixed inset-0 z-[200] flex flex-col bg-black/40"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="no-print flex shrink-0 items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-3 shadow-sm min-[900px]:px-8">
        <h2 className="m-0 text-sm font-extrabold uppercase tracking-wide text-anivax-ink min-[900px]:text-base">
          ABTC Form Preview
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border-none bg-[#D9D9D9] px-3.5 text-[11px] font-bold tracking-wide text-black transition-[transform,filter] hover:brightness-95 active:translate-y-px min-[900px]:h-10 min-[900px]:px-4 min-[900px]:text-xs"
          >
            <PrinterIcon />
            Print ABTC Form
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 cursor-pointer items-center rounded border border-anivax-border bg-white px-3.5 text-[11px] font-bold uppercase tracking-wide text-anivax-muted transition-colors hover:bg-anivax-sky/40 min-[900px]:h-10 min-[900px]:px-4 min-[900px]:text-xs"
          >
            Close
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="print-area-abtc box-border flex w-full flex-col gap-5 px-4 py-5 min-[900px]:px-8 min-[900px]:py-6">
          <p className="no-print m-0 text-sm text-anivax-muted">
            ABTC form preview ? prints on <strong>Legal</strong> paper, <strong>Portrait</strong>,
            2 pages, 10pt type. Vitals and upload controls are omitted from History of Exposure.
          </p>
          {payloadLoading || !vaccinationPayload ? (
            <PlaceholderCard text="Loading vaccination and nurse's note for ABTC preview…" />
          ) : (
            <AbtcFormPreviewContent
              key={`abtc-${history.appointmentId}-${previewKey}`}
              history={history}
              isSmall={isSmall}
              winW={winW}
              vaccinationPayload={vaccinationPayload}
              boosterScheduleActive={boosterScheduleActive}
              pepScheduleActive={pepScheduleActive}
              prepScheduleActive={prepScheduleActive}
            />
          )}
        </div>
      </div>
    </div>
  );
}
