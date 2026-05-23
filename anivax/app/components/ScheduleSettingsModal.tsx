import { useEffect, useMemo, useState } from "react";
import {
  normalizeScheduleSlotInput,
  parseScheduleSlotCount,
} from "../utils/scheduleAppointmentRow";
import { VaccinationM3DatePickerField, VaccinationM3TimePickerField } from "./VaccinationM3Pickers";

export type ScheduleRow = {
  id: string;
  time: string;
  date: string;
  /** YYYY-MM-DD from the date picker — used for save and duplicate checks. */
  dateIso: string;
  /** HH:MM (24h) from the time picker — used for save and duplicate checks. */
  time24: string;
  slots: string;
  addedBy: string;
  dateAdded: string;
};

type FlowStep = "form" | "confirmSave" | "confirmDelete";

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toISODateInput(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatRowDate(d: Date) {
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

function parseRowDateUpper(s: string): Date | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d+),\s*(\d{4})$/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse "10:00 AM" style → 12h clock parts */
function parseDisplayTime(s: string): { hour12: number; minute: number; pm: boolean } {
  const t = s.trim().toUpperCase();
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!m) return { hour12: 9, minute: 0, pm: false };
  let hour12 = Number(m[1]);
  const minute = Math.min(59, Math.max(0, Number(m[2]) || 0));
  const pm = m[3] === "PM";
  if (hour12 < 1 || hour12 > 12) hour12 = 9;
  return { hour12, minute, pm };
}

function formatDisplayTime(hour12: number, minute: number, pm: boolean) {
  let h24 = hour12 % 12;
  if (pm) h24 += 12;
  if (!pm && hour12 === 12) h24 = 0;
  const d = new Date(2000, 0, 1, h24, minute, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** 12h display row → `HH:MM` 24h for {@link VaccinationM3TimePickerField}. */
function displayTimeToTime24(s: string): string {
  const { hour12, minute, pm } = parseDisplayTime(s);
  let h24 = hour12 % 12;
  if (pm) h24 += 12;
  if (!pm && hour12 === 12) h24 = 0;
  return `${pad2(h24)}:${pad2(minute)}`;
}

/** `HH:MM` → same string as {@link formatDisplayTime} for the schedules table. */
function time24ToDisplayTime(time24: string): string | null {
  const [hs, ms] = time24.trim().split(":");
  const h24 = Number(hs);
  const minute = Math.min(59, Math.max(0, Number(ms ?? 0)));
  if (!Number.isFinite(h24) || h24 < 0 || h24 > 23) return null;
  const pm = h24 >= 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return formatDisplayTime(h12, minute, pm);
}

interface ScheduleSettingsModalProps {
  open: boolean;
  mode: "add" | "edit";
  initialRow: ScheduleRow | null;
  defaultCalendarDate: Date;
  addedByLabel: string;
  onClose: () => void;
  onSave: (row: ScheduleRow) => void;
  onDelete: (id: string) => void;
}

export default function ScheduleSettingsModal({
  open,
  mode,
  initialRow,
  defaultCalendarDate,
  addedByLabel,
  onClose,
  onSave,
  onDelete,
}: ScheduleSettingsModalProps) {
  const [step, setStep] = useState<FlowStep>("form");
  const [dateISO, setDateISO] = useState(() => toISODateInput(defaultCalendarDate));
  const [time24, setTime24] = useState("09:00");
  const [slotField, setSlotField] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("form");
    if (mode === "edit" && initialRow) {
      const d = initialRow.dateIso
        ? new Date(initialRow.dateIso + "T12:00:00")
        : parseRowDateUpper(initialRow.date);
      setDateISO(
        initialRow.dateIso ?? toISODateInput(d ?? defaultCalendarDate),
      );
      setTime24(initialRow.time24 ?? displayTimeToTime24(initialRow.time));
      const count = parseScheduleSlotCount(initialRow.slots);
      setSlotField(count != null ? String(count) : initialRow.slots);
    } else {
      setDateISO(toISODateInput(defaultCalendarDate));
      setTime24("09:00");
      setSlotField("");
    }
  }, [open, mode, initialRow, defaultCalendarDate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step === "form") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

  const rowFromForm = useMemo((): ScheduleRow | null => {
    const d = new Date(dateISO + "T12:00:00");
    if (Number.isNaN(d.getTime())) return null;
    const time = time24ToDisplayTime(time24);
    if (!time) return null;
    const date = formatRowDate(d);
    const slots = normalizeScheduleSlotInput(slotField);
    if (!slots) return null;
    const dateAdded = formatRowDate(new Date());
    const id = mode === "edit" && initialRow ? initialRow.id : newScheduleId();
    const addedBy = mode === "edit" && initialRow ? initialRow.addedBy : addedByLabel;
    return { id, time, date, dateIso: dateISO, time24, slots, addedBy, dateAdded };
  }, [dateISO, time24, slotField, mode, initialRow, addedByLabel]);

  if (!open) return null;

  const handleSaveClick = () => {
    if (!rowFromForm) return;
    setStep("confirmSave");
  };

  const handleConfirmSave = () => {
    if (rowFromForm) onSave(rowFromForm);
    setStep("form");
    onClose();
  };

  const handleDeleteClick = () => {
    if (mode !== "edit" || !initialRow) return;
    setStep("confirmDelete");
  };

  const handleConfirmDelete = () => {
    if (initialRow) onDelete(initialRow.id);
    setStep("form");
    onClose();
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[1050] flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-4 backdrop-blur-[2px]"
      onClick={step === "form" ? onClose : undefined}
    >
      {step === "form" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-settings-title"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-[440px] rounded-lg border-2 border-anivax-teal bg-white shadow-anivax-card"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-anivax-ink transition-colors hover:bg-anivax-page"
          >
            <span className="text-xl font-bold leading-none">×</span>
          </button>

          <div className="border-b border-black/8 px-6 pb-4 pt-6 text-center">
            <h2
              id="schedule-settings-title"
              className="m-0 text-lg font-extrabold tracking-wide text-anivax-ink"
            >
              SETTINGS
            </h2>
          </div>

          <div className="flex flex-col gap-5 px-6 py-6">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-bold tracking-wide text-anivax-ink">DATE</span>
              <div className="h-[32px] overflow-hidden rounded border border-anivax-registry-upload-bg bg-white min-[1180px]:h-[36px]">
                <VaccinationM3DatePickerField dateIso={dateISO} onChange={setDateISO} dense />
              </div>
            </label>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold tracking-wide text-anivax-ink">TIME</span>
              <div className="h-[32px] overflow-hidden rounded border border-anivax-registry-upload-bg bg-white min-[1180px]:h-[36px]">
                <VaccinationM3TimePickerField time24={time24} onChange={setTime24} dense />
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-xs font-bold tracking-wide text-anivax-ink">SLOT</span>
              <input
                type="text"
                value={slotField}
                onChange={(e) => setSlotField(e.target.value)}
                placeholder="e.g. 50"
                className="box-border h-11 w-full rounded-md border border-anivax-border bg-white px-3 text-sm font-semibold text-anivax-ink outline-none placeholder:text-anivax-muted/70 focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/25"
              />
            </label>

            <div className="mt-2 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={handleSaveClick}
                disabled={!rowFromForm}
                className="min-h-10 min-w-[120px] cursor-pointer rounded-lg border-none bg-anivax-mint px-6 text-sm font-bold tracking-wide text-white shadow-anivax-btn transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                SAVE
              </button>
              {mode === "edit" ? (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="min-h-10 min-w-[120px] cursor-pointer rounded-lg border-none bg-anivax-danger px-6 text-sm font-bold tracking-wide text-white shadow-md transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
                >
                  DELETE
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {step === "confirmSave" ? (
        <ScheduleChoiceDialog
          title="SAVE CHANGES?"
          onNo={() => setStep("form")}
          onYes={handleConfirmSave}
          yesLabel="YES"
          noLabel="NO"
        />
      ) : null}

      {step === "confirmDelete" ? (
        <ScheduleChoiceDialog
          title="DELETE SCHEDULE?"
          onNo={() => setStep("form")}
          onYes={handleConfirmDelete}
          yesLabel="YES"
          noLabel="NO"
        />
      ) : null}

    </div>
  );
}

function newScheduleId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sched-${Date.now()}`;
}

function ScheduleChoiceDialog({
  title,
  onNo,
  onYes,
  yesLabel,
  noLabel,
}: {
  title: string;
  onNo: () => void;
  onYes: () => void;
  yesLabel: string;
  noLabel: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onNo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNo]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[1160] flex items-center justify-center bg-[rgb(217_217_217/0.5)] p-4 backdrop-blur-[2px]"
      onClick={onNo}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[440px] flex-col items-center gap-5 rounded-lg border-2 border-anivax-teal bg-white px-8 py-9 shadow-anivax-card"
      >
        <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border-[5px] border-anivax-danger bg-white text-[40px] font-bold leading-none text-anivax-danger">
          !
        </div>
        <h2 className="m-0 text-center text-xl font-extrabold tracking-wide text-anivax-teal min-[480px]:text-[26px]">
          {title}
        </h2>
        <div className="flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={onYes}
            className="min-h-10 min-w-[100px] cursor-pointer rounded-lg border-none bg-anivax-danger px-6 text-sm font-bold tracking-wide text-white shadow-md transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
          >
            {yesLabel}
          </button>
          <button
            type="button"
            onClick={onNo}
            className="min-h-10 min-w-[100px] cursor-pointer rounded-lg border-none bg-anivax-teal px-6 text-sm font-bold tracking-wide text-white shadow-md transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
          >
            {noLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown after save/delete completes (modal has already closed). */
export function ScheduleFeedbackOverlay({
  title,
  variant,
  onDismiss,
}: {
  title: string;
  variant: "success" | "danger";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 2000);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[1260] flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-4 backdrop-blur-[2px]"
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-w-[480px] flex-col items-center gap-5 rounded-lg border-2 border-anivax-teal bg-white px-10 py-10 shadow-anivax-card"
      >
        <div
          className={`flex h-[88px] w-[88px] items-center justify-center rounded-full border-[5px] text-[40px] font-bold leading-none ${
            variant === "danger"
              ? "border-anivax-danger text-anivax-danger"
              : "border-anivax-green-border text-anivax-green-border"
          }`}
        >
          {variant === "danger" ? "!" : "✓"}
        </div>
        <h2 className="m-0 text-center text-xl font-extrabold tracking-wide text-anivax-ink min-[480px]:text-[28px]">
          {title}
        </h2>
      </div>
    </div>
  );
}
