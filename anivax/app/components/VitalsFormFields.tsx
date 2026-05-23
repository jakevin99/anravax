import { useRef } from "react";

/** Match Create profile / schedule appointment vitals inputs. */
export const vitalsFieldInputClass =
  "create-profile-input box-border h-[25px] w-full rounded border border-[#D9D9D9] bg-white px-2.5 text-[13px] font-semibold text-anivax-ink outline-none transition-[box-shadow,border-color,opacity] focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/20 disabled:opacity-60";

export const vitalsFieldLabelClass =
  "mb-1 block text-[11px] font-semibold tracking-wide text-anivax-muted";

/** Same responsive grid as schedule appointment VITALS accordion. */
export const vitalsFieldsGridClass =
  "grid grid-cols-2 gap-x-3 gap-y-3 min-[640px]:grid-cols-3 min-[900px]:grid-cols-[minmax(0,0.95fr)_minmax(0,1.55fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] min-[900px]:gap-x-3";

/** Compact 2×3 grid for queue vitals modal (square-ish dialog). */
export const vitalsModalFieldsGridClass = "grid grid-cols-2 gap-x-4 gap-y-4";

/** Digit length rules for queue + schedule vitals inputs. */
export const VITALS_FIELD_LIMITS = {
  temperature: { minDigits: 2, maxDigits: 2 },
  pulseRate: { minDigits: 2, maxDigits: 3 },
  spo2: { minDigits: 2, maxDigits: 3 },
  heightCm: { minDigits: 2, maxDigits: 3 },
  weightKg: { minDigits: 1, maxDigits: 3 },
} as const;

export type VitalsDigitLimit = { minDigits: number; maxDigits: number };

/** Keep vitals inputs numeric — optional single decimal for °C / kg. */
export function sanitizeVitalsNumeralInput(raw: string, allowDecimal = false): string {
  if (!allowDecimal) return raw.replace(/\D/g, "");
  let out = "";
  let sawDot = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !sawDot) {
      sawDot = true;
      out += ch;
    }
  }
  return out;
}

/** Integer-only vitals fields with a fixed digit length range. */
export function sanitizeVitalsDigitInput(raw: string, limit: Pick<VitalsDigitLimit, "maxDigits">): string {
  return raw.replace(/\D/g, "").slice(0, limit.maxDigits);
}

export function normalizeVitalsDigitValue(value: string, limit: Pick<VitalsDigitLimit, "maxDigits">): string {
  return sanitizeVitalsDigitInput(value, limit);
}

export function isVitalsFieldValueValid(value: string, limit: VitalsDigitLimit): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= limit.minDigits && digits.length <= limit.maxDigits;
}

/** True when every non-empty vitals field meets its digit rules (empty fields are ignored). */
export function areOptionalVitalsFieldsValid(values: {
  temperature?: string;
  pulseRate?: string;
  spo2?: string;
  heightCm?: string;
  weightKg?: string;
}): boolean {
  const checks: [string | undefined, VitalsDigitLimit][] = [
    [values.temperature, VITALS_FIELD_LIMITS.temperature],
    [values.pulseRate, VITALS_FIELD_LIMITS.pulseRate],
    [values.spo2, VITALS_FIELD_LIMITS.spo2],
    [values.heightCm, VITALS_FIELD_LIMITS.heightCm],
    [values.weightKg, VITALS_FIELD_LIMITS.weightKg],
  ];
  for (const [raw, limit] of checks) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) continue;
    if (!isVitalsFieldValueValid(trimmed, limit)) return false;
  }
  return true;
}

export function VitalsSuffixedField({
  label,
  required,
  unit,
  value,
  onChange,
  placeholder,
  allowDecimal = false,
  digitLimit,
}: {
  label: string;
  required?: boolean;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowDecimal?: boolean;
  digitLimit?: VitalsDigitLimit;
}) {
  const handleChange = (raw: string) => {
    if (digitLimit) {
      onChange(sanitizeVitalsDigitInput(raw, digitLimit));
      return;
    }
    onChange(sanitizeVitalsNumeralInput(raw, allowDecimal));
  };

  return (
    <div className="min-w-0">
      <span className={vitalsFieldLabelClass}>
        {label}
        {required ? <span className="ml-1 text-anivax-danger">*</span> : null}
      </span>
      <div className="relative mt-1">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={digitLimit?.maxDigits}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className={`${vitalsFieldInputClass} pr-10`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-anivax-muted">
          {unit}
        </span>
      </div>
    </div>
  );
}

const vitalsBpInputClass =
  "min-w-0 w-0 flex-1 border-none bg-transparent p-0 text-[13px] font-semibold text-anivax-ink outline-none placeholder:text-anivax-muted/70";

export function VitalsBloodPressureField({
  sys,
  dia,
  onSys,
  onDia,
}: {
  sys: string;
  dia: string;
  onSys: (v: string) => void;
  onDia: (v: string) => void;
}) {
  const sysRef = useRef<HTMLInputElement>(null);
  const diaRef = useRef<HTMLInputElement>(null);

  const handleSysChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length <= 3) {
      onSys(digits);
      return;
    }
    onSys(digits.slice(0, 3));
    onDia(digits.slice(3, 6));
    requestAnimationFrame(() => diaRef.current?.focus());
  };

  const handleDiaChange = (raw: string) => {
    onDia(raw.replace(/\D/g, "").slice(0, 3));
  };

  return (
    <div className="min-w-0">
      <span className={vitalsFieldLabelClass}>
        BLOOD PRESSURE<span className="ml-1 text-anivax-danger">*</span>
      </span>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <div className="box-border flex h-[25px] min-w-0 flex-1 items-center gap-1.5 rounded border border-[#D9D9D9] bg-white px-2 transition-[box-shadow,border-color] focus-within:border-anivax-teal focus-within:ring-2 focus-within:ring-anivax-teal/20">
          <input
            ref={sysRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Systolic"
            placeholder="SYS"
            value={sys}
            onChange={(e) => handleSysChange(e.target.value)}
            onKeyDown={(e) => {
              if (/^\d$/.test(e.key) && sys.length >= 3) {
                e.preventDefault();
                if (dia.length < 3) {
                  onDia((dia + e.key).slice(0, 3));
                }
                requestAnimationFrame(() => diaRef.current?.focus());
              }
            }}
            className={vitalsBpInputClass}
          />
          <input
            ref={diaRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Diastolic"
            placeholder="DIA"
            value={dia}
            onChange={(e) => handleDiaChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && dia.length === 0) {
                e.preventDefault();
                sysRef.current?.focus();
              }
            }}
            className={vitalsBpInputClass}
          />
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-anivax-muted">
          mmHg
        </span>
      </div>
    </div>
  );
}
