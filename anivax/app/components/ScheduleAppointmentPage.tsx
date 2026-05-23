import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  clearConsultationOcrResult,
  createAppointment,
  getCurrentUser,
  savePatientProfile,
} from "../services/queueService";
import { updateScheduleSlot } from "../services/scheduleSlotsService";
import { notifyDataChanged } from "../services/dataSync";
import { getStaffUserId } from "../services/authStore";
import type { AuthUser } from "../types/domain";
import PatientQueuedAlert from "./PatientQueuedAlert";
import {
  SCHEDULE_APPOINTMENT_DRAFT_KEY,
  type ScheduleAppointmentPatientDraft,
} from "./scheduleAppointmentDraft";
import TopNav from "./TopNav";
import { AccordionCard, SectionTag } from "./ProfileSectionAccordion";
import {
  areOptionalVitalsFieldsValid,
  VITALS_FIELD_LIMITS,
  VitalsBloodPressureField,
  VitalsSuffixedField,
  vitalsFieldsGridClass,
} from "./VitalsFormFields";
import { VaccinationM3DatePickerField, VaccinationM3TimePickerField } from "./VaccinationM3Pickers";
import {
  emptyCreateProfileForm,
  emptyCreateProfileGuardian,
  type PatientCreateRecord,
} from "./createProfileRecord";
import { promptOpenExistingPatientProfile } from "../utils/patientDuplicate";
import {
  buildNowScheduledAt,
  formatScheduledAtSummary,
  formatSlotCountDisplay,
  isSlotFull,
  loadVaccinationScheduleSlots,
  toIsoDateLocal,
  type ScheduleSlotChoice,
} from "../utils/scheduleSlots";

/** Match Create profile personal information / UPLOADS inputs. */
const createProfileInputClass =
  "create-profile-input box-border h-[25px] w-full rounded border border-[#D9D9D9] bg-white px-2.5 text-[13px] font-semibold text-anivax-ink outline-none transition-[box-shadow,border-color,opacity] focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/20 disabled:opacity-60";

const createProfileLabelClass = "mb-1 block text-[11px] font-semibold tracking-wide text-anivax-muted";

const ANIMAL_TYPE_OTHER = "OTHER";

function readSessionUserId(): number | null {
  return getStaffUserId();
}

function ScheduleQueueConfirmModal({
  open,
  submitting,
  title,
  appointmentSummary,
  onNo,
  onYes,
}: {
  open: boolean;
  submitting: boolean;
  title: string;
  appointmentSummary: string;
  onNo: () => void;
  onYes: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="queue-confirm-title"
      className="fixed inset-0 z-[1250] flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-3 backdrop-blur-[2px]"
      onClick={() => {
        if (!submitting) onNo();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="box-border flex w-[min(520px,calc(100vw-24px))] max-w-full flex-col items-center rounded-[10px] border-4 border-anivax-teal bg-white px-6 py-9 text-center shadow-lg min-[1180px]:px-10 min-[1180px]:py-10"
      >
        <div
          className="flex h-[80px] w-[80px] items-center justify-center rounded-full bg-anivax-danger text-[40px] font-bold leading-none text-white min-[1180px]:h-[88px] min-[1180px]:w-[88px] min-[1180px]:text-[46px]"
          aria-hidden="true"
        >
          !
        </div>
        <p
          id="queue-confirm-title"
          className="mt-5 text-[15px] font-bold leading-snug text-anivax-ink min-[1180px]:mt-6 min-[1180px]:text-lg"
        >
          {title}
        </p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-anivax-muted min-[1180px]:text-sm">
          {appointmentSummary}
        </p>
        <div className="mt-7 flex w-full flex-wrap justify-center gap-3 min-[1180px]:mt-8 min-[1180px]:gap-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onNo}
            className="h-9 min-w-[100px] rounded-md border-none bg-anivax-teal px-6 text-[12px] font-bold tracking-wide text-white shadow-anivax-btn transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 min-[1180px]:h-10 min-[1180px]:min-w-[110px] min-[1180px]:text-sm"
          >
            NO
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onYes}
            className="h-9 min-w-[100px] rounded-md border-none bg-anivax-danger px-6 text-[12px] font-bold tracking-wide text-white shadow-anivax-btn transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 min-[1180px]:h-10 min-[1180px]:min-w-[110px] min-[1180px]:text-sm"
          >
            {submitting ? "…" : "YES"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ScheduleAppointmentPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [draft, setDraft] = useState<ScheduleAppointmentPatientDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [confirmQueueOpen, setConfirmQueueOpen] = useState(false);
  const [bookTargetTab, setBookTargetTab] = useState<"QUEUE" | "REQUESTS">("QUEUE");
  const [scheduleSelectedOpen, setScheduleSelectedOpen] = useState(false);
  const [queueSubmitting, setQueueSubmitting] = useState(false);

  const [chiefComplaint, setChiefComplaint] = useState("");
  const [incidenceDate, setIncidenceDate] = useState("");
  const [incidenceTime24, setIncidenceTime24] = useState("10:00");
  const [place, setPlace] = useState("");
  const [siteOfInjury, setSiteOfInjury] = useState("");
  const [animalType, setAnimalType] = useState("");
  const [animalTypeOther, setAnimalTypeOther] = useState("");
  const [biteType, setBiteType] = useState<"BITE" | "NON-BITE">("BITE");
  const [washedInjury, setWashedInjury] = useState<boolean | null>(null);
  const [animalVaccinated, setAnimalVaccinated] = useState<boolean | null>(null);
  const [strayOwned, setStrayOwned] = useState<"STRAY" | "OWNED">("STRAY");
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [vitalsTemp, setVitalsTemp] = useState("");
  const [vitalsBpSys, setVitalsBpSys] = useState("");
  const [vitalsBpDia, setVitalsBpDia] = useState("");
  const [vitalsPr, setVitalsPr] = useState("");
  const [vitalsSpo2, setVitalsSpo2] = useState("");
  const [vitalsHeight, setVitalsHeight] = useState("");
  const [vitalsWeight, setVitalsWeight] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const lastBookedFocusIsoRef = useRef<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [slots, setSlots] = useState<ScheduleSlotChoice[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [todayClock, setTodayClock] = useState(() => new Date());
  const [scheduleTodayAtIso, setScheduleTodayAtIso] = useState<string | null>(null);
  /** When false, only the selected vaccination row can be changed after EDIT is pressed. */
  const [editVaccinationDate, setEditVaccinationDate] = useState(false);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem(SCHEDULE_APPOINTMENT_DRAFT_KEY);
    if (!raw) {
      clearConsultationOcrResult();
      navigate("/queue/create-profile", { replace: true });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ScheduleAppointmentPatientDraft;
      if (!parsed?.form) throw new Error("invalid");
      setDraft(parsed);
    } catch {
      clearConsultationOcrResult();
      navigate("/queue/create-profile", { replace: true });
      return;
    }
    setChiefComplaint("");
    setIncidenceDate(new Date().toISOString().slice(0, 10));
    setIncidenceTime24("10:00");
    setPlace("");
    setSiteOfInjury("");
    setAnimalType("");
    setAnimalTypeOther("");
    setBiteType("BITE");
    setWashedInjury(null);
    setAnimalVaccinated(null);
    setStrayOwned("STRAY");
    setVitalsOpen(false);
    setVitalsTemp("");
    setVitalsBpSys("");
    setVitalsBpDia("");
    setVitalsPr("");
    setVitalsSpo2("");
    setVitalsHeight("");
    setVitalsWeight("");
    setUploadedFileName("");
    setSelectedIndex(0);
    setSlots([]);
    setSlotsLoading(true);
    setDraftReady(true);
  }, [navigate]);

  useEffect(() => {
    if (!draftReady) return;
    let active = true;
    setSlotsLoading(true);
    loadVaccinationScheduleSlots()
      .then((next) => {
        if (!active) return;
        setSlots(next);
        setEditVaccinationDate(false);
        setSelectedIndex((prev) => {
          if (next.length === 0) return 0;
          const open = next.findIndex((s) => !isSlotFull(s));
          if (open >= 0) return open;
          return Math.min(prev, next.length - 1);
        });
      })
      .catch(() => {
        if (!active) return;
        setSlots([]);
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [draftReady]);

  useEffect(() => {
    const tick = () => setTodayClock(new Date());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const selected = slots.length > 0 ? (slots[selectedIndex] ?? slots[0]) : null;
  const selectedScheduledAt = selected?.scheduledAt ?? new Date().toISOString();

  const queueConfirmSummary = formatScheduledAtSummary(selectedScheduledAt);
  const scheduleTodaySummary = formatScheduledAtSummary(todayClock.toISOString());

  const scheduleFieldClass =
    "mt-1 w-full rounded border border-anivax-registry-upload-bg px-2.5 text-[12px] font-semibold text-anivax-ink outline-none focus:border-anivax-teal focus:ring-1 focus:ring-anivax-teal/25 min-[1180px]:px-3 min-[1180px]:text-[13px]";
  const scheduleLabelClass =
    "text-[10px] font-bold tracking-wide text-anivax-muted min-[1180px]:text-[11px] min-[1360px]:text-[12px]";

  const handleScheduleToday = () => {
    if (!canQueue || queueSubmitting) return;
    const idx = slots.findIndex((s) => !isSlotFull(s));
    setSelectedIndex(idx >= 0 ? idx : 0);
    setBookTargetTab("REQUESTS");
    setScheduleTodayAtIso(buildNowScheduledAt());
    setConfirmQueueOpen(true);
  };

  const resolvedAnimalType =
    animalType === ANIMAL_TYPE_OTHER ? animalTypeOther.trim() : animalType;

  const canQueue =
    !!draft &&
    !!chiefComplaint.trim() &&
    !!incidenceDate &&
    !!resolvedAnimalType &&
    !!siteOfInjury.trim() &&
    washedInjury != null &&
    animalVaccinated != null &&
    !!selected &&
    !isSlotFull(selected) &&
    slots.length > 0;

  const openQueueConfirm = () => {
    if (!canQueue || queueSubmitting) return;
    setBookTargetTab("QUEUE");
    setConfirmQueueOpen(true);
  };

  const performQueue = async () => {
    if (!draft || queueSubmitting || !canQueue) return;
    const form = draft.form;
    const lastName = form.lastName.trim();
    const firstName = form.firstName.trim();
    if (!lastName || !firstName || !form.birthDate) {
      window.alert("Last name, first name, and date of birth are required to queue.");
      return;
    }
    const attendantId = readSessionUserId();
    if (attendantId == null) {
      window.alert("Session expired. Please log in again.");
      return;
    }
    const slotIndex = selectedIndex;
    const slot = slots[slotIndex] ?? slots[0];
    if (!slot || isSlotFull(slot)) {
      window.alert("This time slot is full.");
      setConfirmQueueOpen(false);
      return;
    }
    setQueueSubmitting(true);
    try {
      const address = [form.street, form.barangay, form.city, form.province, form.region, form.zip]
        .map((s) => String(s).trim())
        .filter(Boolean)
        .join(", ");
      const profile: PatientCreateRecord = {
        form: { ...emptyCreateProfileForm(), ...form },
        guardian: emptyCreateProfileGuardian(),
        uploads: { idType: "", files: [] },
      };
      const savedPatient = await savePatientProfile({
        patientId: draft.patientId,
        firstName,
        lastName,
        middleName: form.noMiddleName ? undefined : form.middleName.trim() || undefined,
        suffix: form.suffix.trim() || undefined,
        birthDate: form.birthDate,
        sex: form.sex === "MALE" ? "M" : "F",
        ageYears: Number(draft.ageDisplay) || undefined,
        address: address || undefined,
        contactNumber: form.mobile.trim() || undefined,
        bloodType: form.bloodType,
        registrationNo: form.registrationNo.trim() || undefined,
        profile,
      });
      if (!savedPatient.ok) {
        if (savedPatient.duplicate && savedPatient.patientId) {
          promptOpenExistingPatientProfile(savedPatient.patientId, navigate, {
            fromSchedule: true,
          });
          return;
        }
        window.alert(savedPatient.error ?? "Could not save patient.");
        return;
      }
      const patientId = savedPatient.patientId;
      if (!patientId) {
        window.alert("Invalid response from server.");
        return;
      }
      const nextSlotUsed =
        slot.total <= 0 ? slot.used + 1 : Math.min(slot.total, slot.used + 1);
      const hasVitals =
        vitalsTemp.trim() ||
        vitalsBpSys.trim() ||
        vitalsBpDia.trim() ||
        vitalsPr.trim() ||
        vitalsSpo2.trim() ||
        vitalsHeight.trim() ||
        vitalsWeight.trim();
      if (
        hasVitals &&
        !areOptionalVitalsFieldsValid({
          temperature: vitalsTemp,
          pulseRate: vitalsPr,
          spo2: vitalsSpo2,
          heightCm: vitalsHeight,
          weightKg: vitalsWeight,
        })
      ) {
        window.alert(
          "Vitals must use the allowed digit lengths: temperature 2, PR 2–3, SpO2 2–3, height 2–3, weight 1–3.",
        );
        return;
      }
      const vitalsPayload = hasVitals
        ? {
            temperatureC: vitalsTemp.trim() ? Number(vitalsTemp) : undefined,
            bloodPressure:
              vitalsBpSys.trim() && vitalsBpDia.trim()
                ? `${vitalsBpSys.trim()}/${vitalsBpDia.trim()}`
                : undefined,
            pulseRate: vitalsPr.trim() ? Number(vitalsPr) : undefined,
            spo2: vitalsSpo2.trim() ? Number(vitalsSpo2) : undefined,
            heightCm: vitalsHeight.trim() ? Number(vitalsHeight) : undefined,
            weightKg: vitalsWeight.trim() ? Number(vitalsWeight) : undefined,
          }
        : undefined;
      const scheduledAt = buildNowScheduledAt();
      try {
        await createAppointment({
          patientId,
          attendantUserId: attendantId,
          scheduledAt,
          category: nextSlotUsed >= 9 ? 1 : nextSlotUsed >= 7 ? 2 : 3,
          status: bookTargetTab === "QUEUE" ? "IN_QUEUE" : "SCHEDULED",
          tab: bookTargetTab,
          slotUsed: nextSlotUsed,
          slotTotal: slot.total,
          vitals: vitalsPayload,
          exposure: {
            chiefComplaint: chiefComplaint.trim(),
            dateOfIncidence: incidenceDate,
            timeOfIncidence: incidenceTime24,
            placeOfIncidence: place.trim(),
            siteOfInjury: siteOfInjury.trim(),
            animalType: resolvedAnimalType,
            washedInjury: washedInjury === true,
            animalVaccinated: animalVaccinated === true,
            biteType,
            strayOwned,
          },
        });
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "Patient saved but could not add to queue.",
        );
        return;
      }

      notifyDataChanged("patients");
      notifyDataChanged("appointments");

      if (bookTargetTab === "QUEUE" && slot.scheduleAppointmentId) {
        try {
          await updateScheduleSlot(slot.scheduleAppointmentId, { slotUsed: nextSlotUsed });
        } catch {
          /* queue row created; slot counter will resync on reload */
        }
      }

      setSlots((prev) =>
        prev.map((s, i) => (i === slotIndex ? { ...s, used: nextSlotUsed } : s)),
      );

      try {
        sessionStorage.removeItem(SCHEDULE_APPOINTMENT_DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setConfirmQueueOpen(false);
      setScheduleTodayAtIso(null);
      const refreshed = await loadVaccinationScheduleSlots();
      setSlots(refreshed);
      const openIdx = refreshed.findIndex((s) => !isSlotFull(s));
      setSelectedIndex(openIdx >= 0 ? openIdx : 0);
      lastBookedFocusIsoRef.current =
        bookTargetTab === "REQUESTS" ? toIsoDateLocal(new Date()) : slot.dateIso;
      setScheduleSelectedOpen(true);
    } catch {
      window.alert("Network error. Try again.");
    } finally {
      setQueueSubmitting(false);
    }
  };

  const handleScheduleSelectedClose = () => {
    setScheduleSelectedOpen(false);
    const iso = lastBookedFocusIsoRef.current;
    const bookedTab = bookTargetTab;
    lastBookedFocusIsoRef.current = null;
    const focusIso =
      bookedTab === "REQUESTS" ? toIsoDateLocal(new Date()) : iso;
    if (focusIso && /^\d{4}-\d{2}-\d{2}$/.test(focusIso)) {
      navigate("/queue", {
        state: {
          queueFocusDate: focusIso,
          queueActiveTab: bookedTab === "REQUESTS" ? "REQUESTS" : undefined,
        },
      });
    } else {
      navigate("/queue", {
        state: bookedTab === "REQUESTS" ? { queueActiveTab: "REQUESTS" } : undefined,
      });
    }
  };

  if (!draftReady || !draft) {
    return (
      <main className="flex min-h-screen flex-col bg-anivax-page">
        <TopNav user={user} />
        <div className="schedule-appointment-page-body flex min-h-0 flex-1 flex-col items-center justify-center text-sm font-semibold text-anivax-muted min-[1180px]:text-base">
          Loading…
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-anivax-page">
      <TopNav user={user} />

      <div className="schedule-appointment-page-body box-border flex w-full min-w-0 flex-1 flex-col">
        <div className="w-full min-w-0">
          <div className="mb-6 flex flex-wrap items-center justify-center gap-3 min-[1180px]:mb-8 min-[1180px]:gap-4">
            <button
              type="button"
              onClick={openQueueConfirm}
              disabled={!canQueue || queueSubmitting || editVaccinationDate}
              className="h-9 min-w-[120px] rounded-md border-none bg-anivax-teal px-6 text-[12px] font-bold tracking-wide text-white shadow-anivax-btn transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 min-[1180px]:h-10 min-[1180px]:min-w-[132px] min-[1180px]:px-8 min-[1180px]:text-sm"
            >
              {queueSubmitting ? "…" : "QUEUE"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearConsultationOcrResult();
                navigate("/queue/create-profile");
              }}
              className="h-9 min-w-[120px] rounded-md border-none bg-anivax-danger px-6 text-[12px] font-bold tracking-wide text-white shadow-anivax-btn transition hover:brightness-105 min-[1180px]:h-10 min-[1180px]:min-w-[132px] min-[1180px]:px-8 min-[1180px]:text-sm"
            >
              CANCEL
            </button>
          </div>

          <div className="schedule-appointment-main-grid">
            <div className="flex min-w-0 flex-col">
              <section className="relative mt-3.5 box-border rounded-[10px] border-4 border-anivax-teal bg-white px-6 pb-7 pt-5">
                <div className="absolute left-[18px] top-[-16px] z-[2]">
                  <SectionTag label="HISTORY OF EXPOSURE" />
                </div>

                <div className="schedule-appointment-two-col-exposure pt-1.5">
                  <div className="flex min-w-0 flex-col gap-3 min-[1180px]:gap-3.5">
                    <label className="block">
                      <span className={scheduleLabelClass}>
                        CHIEF COMPLAINT<span className="text-anivax-danger"> *</span>
                      </span>
                      <textarea
                        value={chiefComplaint}
                        onChange={(e) => setChiefComplaint(e.target.value)}
                        rows={4}
                        className={`${scheduleFieldClass} min-h-[88px] resize-y py-2 min-[1180px]:min-h-[100px] min-[1180px]:py-2.5`}
                      />
                    </label>

                    <label className="block">
                      <span className={scheduleLabelClass}>
                        SITE OF BITE/INJURY<span className="text-anivax-danger"> *</span>
                      </span>
                      <input
                        value={siteOfInjury}
                        onChange={(e) => setSiteOfInjury(e.target.value)}
                        className={`${scheduleFieldClass} h-8 min-[1180px]:h-9`}
                      />
                    </label>

                    <div className="grid gap-3 min-[420px]:grid-cols-[1fr_128px] min-[420px]:items-end min-[1180px]:grid-cols-[1fr_140px] min-[1180px]:gap-3.5">
                      <label className="block min-w-0">
                        <span className={scheduleLabelClass}>
                          DATE OF INCIDENCE<span className="text-anivax-danger"> *</span>
                        </span>
                        <div className="mt-1 h-[32px] overflow-hidden rounded border border-anivax-registry-upload-bg bg-white min-[1180px]:h-[36px]">
                          <VaccinationM3DatePickerField dateIso={incidenceDate} onChange={setIncidenceDate} dense />
                        </div>
                      </label>
                      <label className="block min-w-0">
                        <span className={scheduleLabelClass}>
                          TIME<span className="text-anivax-danger"> *</span>
                        </span>
                        <div className="mt-1 h-[32px] overflow-hidden rounded border border-anivax-registry-upload-bg bg-white min-[1180px]:h-[36px]">
                          <VaccinationM3TimePickerField
                            time24={incidenceTime24}
                            onChange={setIncidenceTime24}
                            dense
                          />
                        </div>
                      </label>
                    </div>

                    <label className="block">
                      <span className={scheduleLabelClass}>PLACE OF INCIDENCE</span>
                      <input value={place} onChange={(e) => setPlace(e.target.value)} className={`${scheduleFieldClass} h-8 min-[1180px]:h-9`} />
                    </label>
                  </div>

                  <div className="flex min-w-0 flex-col gap-3 min-[1180px]:gap-3.5">
                    <div>
                      <p className={scheduleLabelClass}>
                        ANIMAL VACCINATED:<span className="text-anivax-danger"> *</span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-4 text-[12px] font-semibold min-[1180px]:gap-5 min-[1180px]:text-[13px]">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={animalVaccinated === true} onChange={() => setAnimalVaccinated(true)} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          YES
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={animalVaccinated === false} onChange={() => setAnimalVaccinated(false)} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          NO
                        </label>
                      </div>
                      <p className="mt-1.5 max-w-md text-[9px] leading-snug text-anivax-body min-[1180px]:text-[10px]">
                        (If yes please upload file or bring the animal vaccination card verification)
                      </p>
                      <div className="mt-2 flex flex-col gap-1">
                        <input
                          ref={uploadInputRef}
                          type="file"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            setUploadedFileName(file?.name ?? "");
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => uploadInputRef.current?.click()}
                          className="inline-flex h-8 w-fit items-center justify-center gap-1.5 rounded bg-black px-3 text-[10px] font-bold tracking-wide text-white min-[1180px]:h-9 min-[1180px]:px-4 min-[1180px]:text-[11px]"
                        >
                          <span aria-hidden>⭳</span> Upload File
                        </button>
                        {uploadedFileName ? (
                          <p className="max-w-[min(100%,280px)] truncate text-[9px] text-anivax-muted min-[1180px]:text-[10px]">{uploadedFileName}</p>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <span className={`block ${scheduleLabelClass}`}>BITE / NON-BITE</span>
                      <div className="mt-1 flex flex-wrap gap-4 text-[12px] font-semibold min-[1180px]:gap-5 min-[1180px]:text-[13px]">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={biteType === "BITE"} onChange={() => setBiteType("BITE")} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          BITE
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={biteType === "NON-BITE"} onChange={() => setBiteType("NON-BITE")} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          NON-BITE
                        </label>
                      </div>
                    </div>

                    <div>
                      <p className={scheduleLabelClass}>
                        WASHING OF INJURY<span className="text-anivax-danger"> *</span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-4 text-[12px] font-semibold min-[1180px]:gap-5 min-[1180px]:text-[13px]">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={washedInjury === true} onChange={() => setWashedInjury(true)} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          YES
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={washedInjury === false} onChange={() => setWashedInjury(false)} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          NO
                        </label>
                      </div>
                    </div>

                    <div className="block w-full max-w-full min-[1180px]:max-w-md">
                      <label className="block">
                        <span className={scheduleLabelClass}>
                          ANIMAL TYPE<span className="text-anivax-danger"> *</span>
                        </span>
                        <select
                          value={animalType}
                          onChange={(e) => {
                            const next = e.target.value;
                            setAnimalType(next);
                            if (next !== ANIMAL_TYPE_OTHER) setAnimalTypeOther("");
                          }}
                          className={`${scheduleFieldClass} h-8 min-[1180px]:h-9`}
                        >
                          <option value="">Select</option>
                          <option value="DOG">DOG</option>
                          <option value="CAT">CAT</option>
                          <option value="PIG">PIG</option>
                          <option value="MONKEY">MONKEY</option>
                          <option value={ANIMAL_TYPE_OTHER}>OTHER</option>
                        </select>
                      </label>
                      {animalType === ANIMAL_TYPE_OTHER ? (
                        <label className="mt-2 block">
                          <span className={scheduleLabelClass}>
                            SPECIFY ANIMAL<span className="text-anivax-danger"> *</span>
                          </span>
                          <input
                            type="text"
                            value={animalTypeOther}
                            onChange={(e) => setAnimalTypeOther(e.target.value)}
                            placeholder="Type the animal that bit the patient"
                            className={`${scheduleFieldClass} h-8 min-[1180px]:h-9`}
                          />
                        </label>
                      ) : null}
                    </div>

                    <div>
                      <span className={`block ${scheduleLabelClass}`}>STRAY / OWNED</span>
                      <div className="mt-1 flex flex-wrap gap-4 text-[12px] font-semibold min-[1180px]:gap-5 min-[1180px]:text-[13px]">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={strayOwned === "STRAY"} onChange={() => setStrayOwned("STRAY")} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          STRAY
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={strayOwned === "OWNED"} onChange={() => setStrayOwned("OWNED")} className="h-4 w-4 min-[1180px]:h-[18px] min-[1180px]:w-[18px]" />
                          OWNED
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <AccordionCard
                title="VITALS"
                open={vitalsOpen}
                onToggle={() => setVitalsOpen((o) => !o)}
                className="mt-5"
                contentClassName="!pb-3 !pt-0 !text-anivax-ink !font-normal"
              >
                <div className={vitalsFieldsGridClass}>
                  <VitalsSuffixedField
                    label="TEMPERATURE"
                    required
                    unit="°C"
                    value={vitalsTemp}
                    onChange={setVitalsTemp}
                    digitLimit={VITALS_FIELD_LIMITS.temperature}
                  />
                  <VitalsBloodPressureField sys={vitalsBpSys} dia={vitalsBpDia} onSys={setVitalsBpSys} onDia={setVitalsBpDia} />
                  <VitalsSuffixedField
                    label="PR"
                    required
                    unit="bpm"
                    value={vitalsPr}
                    onChange={setVitalsPr}
                    digitLimit={VITALS_FIELD_LIMITS.pulseRate}
                  />
                  <VitalsSuffixedField
                    label="SpO2"
                    required
                    unit="%"
                    value={vitalsSpo2}
                    onChange={setVitalsSpo2}
                    digitLimit={VITALS_FIELD_LIMITS.spo2}
                  />
                  <VitalsSuffixedField
                    label="HEIGHT"
                    required
                    unit="cm"
                    value={vitalsHeight}
                    onChange={setVitalsHeight}
                    digitLimit={VITALS_FIELD_LIMITS.heightCm}
                  />
                  <VitalsSuffixedField
                    label="WEIGHT"
                    required
                    unit="kg"
                    value={vitalsWeight}
                    onChange={setVitalsWeight}
                    digitLimit={VITALS_FIELD_LIMITS.weightKg}
                  />
                </div>
              </AccordionCard>
            </div>

            <div className="flex h-fit w-full min-w-0 flex-col self-start rounded-lg bg-white shadow-anivax-card ring-1 ring-black/5 min-[1180px]:self-start">
              <h3 className="border-b border-black/5 py-3 text-center text-[13px] font-extrabold tracking-wide text-anivax-ink min-[1180px]:py-3.5 min-[1180px]:text-sm min-[1360px]:text-[15px]">
                Vaccination Date
              </h3>
              <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
                <table className="w-full min-w-[280px] border-collapse text-left text-[11px] min-[1180px]:text-xs">
                  <thead>
                    <tr className="border-b border-black/10">
                      <th className="px-3 py-2 font-extrabold tracking-wide text-[#7c5cfb] min-[1180px]:px-4 min-[1180px]:py-2.5">
                        Date
                      </th>
                      <th className="px-3 py-2 font-extrabold tracking-wide text-[#7c5cfb] min-[1180px]:px-4 min-[1180px]:py-2.5">
                        Time
                      </th>
                      <th className="px-3 py-2 font-extrabold tracking-wide text-[#7c5cfb] min-[1180px]:px-4 min-[1180px]:py-2.5">
                        Slots
                      </th>
                      <th className="px-3 py-2 text-right min-[1180px]:px-4 min-[1180px]:py-2.5">
                        <button
                          type="button"
                          disabled={slotsLoading || slots.length === 0 || editVaccinationDate}
                          onClick={() => setEditVaccinationDate(true)}
                          aria-label="Edit vaccination date"
                          className="inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-md border-none bg-black px-2.5 text-[10px] font-bold tracking-wide text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 min-[1180px]:h-8 min-[1180px]:gap-1.5 min-[1180px]:px-3 min-[1180px]:text-[11px]"
                        >
                          <VaccinationDateEditIcon />
                          EDIT
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {slotsLoading ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-xs font-semibold text-anivax-muted">
                          Loading schedules…
                        </td>
                      </tr>
                    ) : slots.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-xs font-semibold text-anivax-muted">
                          No schedules yet. Add dates on the Schedules page.
                        </td>
                      </tr>
                    ) : null}
                    {!slotsLoading &&
                      slots.map((slot, idx) => {
                      const full = isSlotFull(slot);
                      const rowSelected = selectedIndex === idx;
                      const slotLocked = !editVaccinationDate && !rowSelected;
                      return (
                        <tr
                          key={`${slot.scheduledAt}-${idx}`}
                          className={`border-b border-black/6 ${rowSelected ? "bg-anivax-sky/25" : idx % 2 === 1 ? "bg-[#fafafa]" : ""}`}
                        >
                          <td className="whitespace-nowrap px-3 py-2.5 font-bold uppercase min-[1180px]:px-4 min-[1180px]:py-3">{slot.labelDate}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-semibold min-[1180px]:px-4 min-[1180px]:py-3">{slot.labelTime.replace(" ", "\u00A0")}</td>
                          <td
                            className={`whitespace-nowrap px-3 py-2.5 font-bold min-[1180px]:px-4 min-[1180px]:py-3 ${
                              full ? "text-black" : "text-anivax-danger"
                            }`}
                          >
                            {formatSlotCountDisplay(slot)}
                          </td>
                          <td className="px-3 py-2 text-right min-[1180px]:px-4 min-[1180px]:py-2.5">
                            <button
                              type="button"
                              disabled={slotLocked || (full && !rowSelected)}
                              onClick={() => {
                                if (slotLocked || (full && !rowSelected)) return;
                                setSelectedIndex(idx);
                                setEditVaccinationDate(false);
                              }}
                              className={`inline-flex h-7 min-w-[72px] items-center justify-center rounded px-2 text-[10px] font-bold tracking-wide transition min-[1180px]:h-8 min-[1180px]:min-w-[80px] min-[1180px]:px-2.5 min-[1180px]:text-[11px] ${
                                rowSelected
                                  ? "bg-black text-white shadow-sm"
                                  : full
                                    ? "cursor-not-allowed bg-anivax-registry-upload-bg text-anivax-muted"
                                    : slotLocked
                                      ? "cursor-not-allowed bg-anivax-registry-upload-bg/80 text-anivax-muted"
                                      : "bg-anivax-teal text-white shadow-sm hover:brightness-110"
                              }`}
                            >
                              {full && !rowSelected
                                ? "FULL"
                                : rowSelected
                                  ? "SELECTED"
                                  : "SELECT"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-auto flex flex-col gap-3 border-t border-black/10 bg-anivax-sky/90 px-3 py-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between min-[1180px]:gap-4 min-[1180px]:px-4 min-[1180px]:py-3.5">
                <div className="min-w-0 text-center min-[520px]:text-left">
                  {editVaccinationDate ? (
                    <p className="text-[10px] font-bold uppercase leading-snug text-anivax-teal min-[520px]:text-[11px] min-[1180px]:text-xs min-[1360px]:text-[13px]">
                      Select a date and time below
                    </p>
                  ) : (
                    <>
                      <p className="text-[10px] font-bold uppercase leading-snug text-anivax-ink min-[520px]:text-[11px] min-[1180px]:text-xs min-[1360px]:text-[13px]">
                        {queueConfirmSummary.toUpperCase()}
                      </p>
                      <p className="mt-1 text-[9px] font-semibold uppercase leading-snug text-[#7c5cfb] min-[1180px]:text-[10px] min-[1360px]:text-[11px]">
                        Schedule today: {scheduleTodaySummary.toUpperCase()}
                      </p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!canQueue || queueSubmitting || editVaccinationDate}
                  onClick={handleScheduleToday}
                  className="h-8 shrink-0 self-center rounded-md border-none bg-[#7c5cfb] px-4 text-[10px] font-bold tracking-wide text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 min-[520px]:self-auto min-[1180px]:h-9 min-[1180px]:px-5 min-[1180px]:text-[11px] min-[1360px]:text-xs"
                >
                  Schedule Today
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ScheduleQueueConfirmModal
        open={confirmQueueOpen}
        submitting={queueSubmitting}
        title={
          bookTargetTab === "REQUESTS"
            ? "Schedule this patient for today? They will appear under Requests."
            : "Are you sure you want to add this patient to the queue?"
        }
        appointmentSummary={
          bookTargetTab === "REQUESTS"
            ? formatScheduledAtSummary(scheduleTodayAtIso ?? buildNowScheduledAt())
            : queueConfirmSummary
        }
        onNo={() => {
          if (!queueSubmitting) {
            setConfirmQueueOpen(false);
            setScheduleTodayAtIso(null);
          }
        }}
        onYes={() => void performQueue()}
      />

      <PatientQueuedAlert
        open={scheduleSelectedOpen}
        onClose={handleScheduleSelectedClose}
        title={bookTargetTab === "REQUESTS" ? "REQUEST SUBMITTED" : "SCHEDULE SELECTED"}
        titleClassName="text-anivax-ink"
      />
    </main>
  );
}

function VaccinationDateEditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
