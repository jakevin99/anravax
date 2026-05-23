/** Minimum age (inclusive) for senior-citizen classification in the Philippines. */
export const SENIOR_CITIZEN_MIN_AGE = 60;

export function patientAgeYearsFromBirthDate(birthDate: string): number | null {
  if (!birthDate.trim()) return null;
  const d = new Date(birthDate + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/** Prefer birth date (source of truth); fall back to cached ageYears. */
export function resolvePatientAgeYears(patient: {
  birthDate?: string;
  ageYears?: number | null;
}): number | null {
  const fromDob = patient.birthDate ? patientAgeYearsFromBirthDate(patient.birthDate) : null;
  if (fromDob != null) return fromDob;
  const cached = patient.ageYears;
  if (cached != null && Number.isFinite(cached) && cached >= 0) return Math.floor(cached);
  return null;
}

export function isSeniorCitizen(patient: {
  birthDate?: string;
  ageYears?: number | null;
}): boolean {
  const age = resolvePatientAgeYears(patient);
  return age != null && age >= SENIOR_CITIZEN_MIN_AGE;
}

/** Display age for registry tables (birth date preferred, else stored age). */
export function patientDisplayAgeYears(
  birthDate: string | undefined,
  ageYears?: number | null,
): number | string {
  const age = resolvePatientAgeYears({ birthDate, ageYears });
  return age ?? "—";
}
