import { useEffect, useMemo, useState } from "react";
import type { Appointment, Vitals } from "../types/domain";
import ConfirmAlert from "./ConfirmAlert";
import SuccessAlert from "./SuccessAlert";
import { SectionTag } from "./ProfileSectionAccordion";
import {
  isVitalsFieldValueValid,
  normalizeVitalsDigitValue,
  VITALS_FIELD_LIMITS,
  VitalsBloodPressureField,
  VitalsSuffixedField,
  vitalsModalFieldsGridClass,
} from "./VitalsFormFields";

interface VitalsModalProps {
  appointment: Appointment;
  onClose: () => void;
  onSave: (appointmentId: string, vitals: Vitals) => void | Promise<void>;
}

function parseBloodPressure(bp?: string): { sys: string; dia: string } {
  const [sys, dia] = (bp ?? "").split("/");
  return { sys: sys?.trim() ?? "", dia: dia?.trim() ?? "" };
}

/**
 * Vitals capture dialog. Triggered from the heart-pulse icon in a queue row.
 * Uses the same field layout and inputs as schedule appointment (VITALS section).
 */
export default function VitalsModal({ appointment, onClose, onSave }: VitalsModalProps) {
  const initial = appointment.vitals ?? {};
  const initialBp = parseBloodPressure(initial.bloodPressure);

  const [vitalsTemp, setVitalsTemp] = useState(
    normalizeVitalsDigitValue(
      initial.temperatureC != null ? String(initial.temperatureC) : "",
      VITALS_FIELD_LIMITS.temperature,
    ),
  );
  const [vitalsBpSys, setVitalsBpSys] = useState(initialBp.sys);
  const [vitalsBpDia, setVitalsBpDia] = useState(initialBp.dia);
  const [vitalsPr, setVitalsPr] = useState(
    normalizeVitalsDigitValue(
      initial.pulseRate != null ? String(initial.pulseRate) : "",
      VITALS_FIELD_LIMITS.pulseRate,
    ),
  );
  const [vitalsSpo2, setVitalsSpo2] = useState(
    normalizeVitalsDigitValue(
      initial.spo2 != null ? String(initial.spo2) : "",
      VITALS_FIELD_LIMITS.spo2,
    ),
  );
  const [vitalsHeight, setVitalsHeight] = useState(
    normalizeVitalsDigitValue(
      initial.heightCm != null ? String(initial.heightCm) : "",
      VITALS_FIELD_LIMITS.heightCm,
    ),
  );
  const [vitalsWeight, setVitalsWeight] = useState(
    normalizeVitalsDigitValue(
      initial.weightKg != null ? String(initial.weightKg) : "",
      VITALS_FIELD_LIMITS.weightKg,
    ),
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isValid = useMemo(
    () =>
      isVitalsFieldValueValid(vitalsTemp, VITALS_FIELD_LIMITS.temperature) &&
      vitalsBpSys.trim() !== "" &&
      vitalsBpDia.trim() !== "" &&
      isVitalsFieldValueValid(vitalsPr, VITALS_FIELD_LIMITS.pulseRate) &&
      isVitalsFieldValueValid(vitalsSpo2, VITALS_FIELD_LIMITS.spo2) &&
      isVitalsFieldValueValid(vitalsHeight, VITALS_FIELD_LIMITS.heightCm) &&
      isVitalsFieldValueValid(vitalsWeight, VITALS_FIELD_LIMITS.weightKg),
    [vitalsTemp, vitalsBpSys, vitalsBpDia, vitalsPr, vitalsSpo2, vitalsHeight, vitalsWeight],
  );

  const handleSaveClick = () => {
    if (!isValid) return;
    setConfirming(true);
  };

  const handleConfirmSave = async () => {
    if (saving) return;
    const vitals: Vitals = {
      temperatureC: Number(vitalsTemp),
      pulseRate: Number(vitalsPr),
      spo2: Number(vitalsSpo2),
      bloodPressure: `${vitalsBpSys.trim()}/${vitalsBpDia.trim()}`,
      heightCm: Number(vitalsHeight),
      weightKg: Number(vitalsWeight),
      recordedAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      await onSave(appointment.id, vitals);
      setConfirming(false);
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  const handleSavedNoticeClose = () => {
    setSavedNotice(false);
    onClose();
  };

  const patientName = formatPatientName(appointment);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Record vitals"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative box-border w-full max-w-[min(100vw-32px,520px)] rounded-lg border-2 border-anivax-green-border bg-white px-5 pb-6 pt-8 shadow-anivax-card transition-shadow duration-200 sm:px-6 sm:pb-7 sm:pt-9"
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-2.5 top-2.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anivax-teal"
        >
          <CloseIcon />
        </button>

        <p className="mb-4 text-center text-xs font-semibold tracking-wide text-anivax-muted">
          {patientName}
        </p>

        <div className="relative box-border rounded-[10px] border-4 border-anivax-teal bg-white pt-6">
          <div className="absolute left-[18px] top-[-16px] z-[2]">
            <SectionTag label="VITALS" />
          </div>
          <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
            <div className={vitalsModalFieldsGridClass}>
            <VitalsSuffixedField
              label="TEMPERATURE"
              required
              unit="°C"
              value={vitalsTemp}
              onChange={setVitalsTemp}
              digitLimit={VITALS_FIELD_LIMITS.temperature}
            />
            <VitalsBloodPressureField
              sys={vitalsBpSys}
              dia={vitalsBpDia}
              onSys={setVitalsBpSys}
              onDia={setVitalsBpDia}
            />
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
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={!isValid}
            onClick={handleSaveClick}
            className="min-w-[88px] h-8 cursor-pointer rounded-lg border-none bg-anivax-teal px-5 text-sm font-bold tracking-wide text-white transition-[transform,opacity,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            SAVE
          </button>
        </div>
      </div>

      <ConfirmAlert
        open={confirming}
        title="SAVE CHANGES?"
        confirmLabel="SAVE"
        cancelLabel="CANCEL"
        busy={saving}
        onCancel={() => {
          if (!saving) setConfirming(false);
        }}
        onConfirm={handleConfirmSave}
      />

      <SuccessAlert open={savedNotice} title="CHANGES SAVED" onClose={handleSavedNoticeClose} />
    </div>
  );
}

function formatPatientName(a: Appointment): string {
  const { lastName, firstName, middleName } = a.patient;
  const middle = middleName ? ` ${middleName}` : "";
  return `${lastName.toUpperCase()}, ${firstName.toUpperCase()}${middle.toUpperCase()}`;
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-black">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
