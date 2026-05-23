/**
 * Queue / schedules / registry — backed by REST (`/api/v1/appointments`, `/patients`, …).
 */

import type {
  Appointment,
  AppointmentSearchFilters,
  AppointmentTab,
  AuthUser,
  CalendarDay,
  CalendarDayStatus,
  DoseAdministration,
  DoseSchedule,
  ISODate,
  Paginated,
  Patient,
  PatientConsultationRow,
  PatientHistory,
  QueueTicket,
  RegimenInfo,
  RegimenKey,
  UUID,
  Vaccine,
  VaccineLot,
  Vitals,
} from "../types/domain";
import {
  patientCreateRecordCacheKey,
  type PatientCreateRecord,
} from "../components/createProfileRecord";
import { fetchJson, getApiBaseUrl, rawFetch } from "./apiClient";
import { notifyDataChanged } from "./dataSync";

import { getCurrentUserSync, toAuthUser } from "./authStore";

const API_BASE = getApiBaseUrl();

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  }
}

export async function getCurrentUser(): Promise<AuthUser> {
  const u = getCurrentUserSync();
  if (u) return toAuthUser(u);
  return { id: "u_guest", firstName: "Guest", lastName: "User", role: "RHU STAFF" };
}

export interface SearchAppointmentsParams extends AppointmentSearchFilters {
  page?: number;
  pageSize?: number;
}

export type AppointmentExposurePayload = {
  chiefComplaint?: string;
  dateOfIncidence?: string;
  timeOfIncidence?: string;
  placeOfIncidence?: string;
  siteOfInjury?: string;
  animalType?: string;
  washedInjury?: boolean;
  animalVaccinated?: boolean;
  biteType?: string;
  strayOwned?: string;
};

export interface UpsertScheduleAppointmentParams {
  /** Required for all appointment tabs (capacity uses /schedule-slots). */
  patientId: string;
  attendantUserId: number;
  scheduledAt: string;
  category: 1 | 2 | 3 | 4 | 5;
  status: "SCHEDULED" | "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "OVERDUE";
  tab: "QUEUE" | "FOLLOW-UP" | "REQUESTS";
  slotUsed?: number;
  slotTotal?: number;
  vitals?: Vitals;
  exposure?: AppointmentExposurePayload;
}

export async function searchAppointments(
  params: SearchAppointmentsParams = {},
): Promise<Paginated<Appointment>> {
  const { page = 1, pageSize = 10, tab, lastName, firstName, middleName, date } = params;
  const q = new URLSearchParams();
  q.set("page", String(page));
  q.set("page_size", String(pageSize));
  if (tab) q.set("tab", tab);
  if (date) q.set("date", date);
  if (lastName) q.set("last_name", lastName);
  if (firstName) q.set("first_name", firstName);
  if (middleName) q.set("middle_name", middleName);

  const res = await rawFetch(`${API_BASE}/appointments?${q.toString()}`);
  const body = await readJson<{ data?: Paginated<Appointment>; error?: string }>(res);
  if (!res.ok) {
    console.error(body.error ?? res.status);
    return emptyPage(page, pageSize);
  }
  const d = body.data;
  if (!d) return emptyPage(page, pageSize);

  return d;
}

function emptyPage(page: number, pageSize: number): Paginated<Appointment> {
  return { items: [], page, pageSize, totalItems: 0, totalPages: 1 };
}

/** Patient appointments only (queue / follow-up visits / requests). */
export async function getCalendarMonth(
  year: number,
  monthIndex0: number,
): Promise<CalendarDay[]> {
  const month = monthIndex0 + 1;
  const q = new URLSearchParams({
    year: String(year),
    month: String(month),
  });
  const res = await rawFetch(`${API_BASE}/appointments/calendar?${q.toString()}`);
  const body = await readJson<{
    data?: { days?: Array<{ date: string; count: number }> };
    error?: string;
  }>(res);
  if (!res.ok || !body.data?.days) {
    console.error(body.error ?? res.status);
    return buildEmptyMonth(year, monthIndex0);
  }

  const today = new Date();
  const out: CalendarDay[] = [];
  for (const { date: iso, count } of body.data.days) {
    const date = new Date(iso + "T12:00:00");
    let status: CalendarDayStatus;
    if (count > 0) status = "appointment";
    else if (date < stripTime(today)) status = "overdue";
    else status = "available";
    out.push({ date: iso as ISODate, status, appointmentCount: count });
  }
  return out;
}

function buildEmptyMonth(year: number, monthIndex0: number): CalendarDay[] {
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  const today = new Date();
  const out: CalendarDay[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, monthIndex0, day);
    const iso = toISODate(date);
    const status: CalendarDayStatus =
      date < stripTime(today) ? "overdue" : "available";
    out.push({ date: iso, status, appointmentCount: 0 });
  }
  return out;
}

export async function retrieveAppointment(id: string): Promise<Appointment | null> {
  const res = await rawFetch(`${API_BASE}/appointments/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const body = await readJson<{ data?: Appointment; error?: string }>(res);
  if (!res.ok) {
    console.error(body.error ?? res.status);
    return null;
  }
  return body.data ?? null;
}

export interface PatientConsultationHistoryResult {
  patient: Patient;
  items: PatientConsultationRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export async function getPatientConsultationHistory(
  patientId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<PatientConsultationHistoryResult | null> {
  const { page = 1, pageSize = 8 } = params;
  const q = new URLSearchParams();
  q.set("page", String(page));
  q.set("page_size", String(pageSize));
  const res = await rawFetch(
    `${API_BASE}/patients/${encodeURIComponent(patientId)}/consultation-history?${q.toString()}`,
  );
  const body = await readJson<{
    data?: PatientConsultationHistoryResult;
    error?: string;
  }>(res);
  if (!res.ok) {
    console.error(body.error ?? res.status);
    return null;
  }
  return body.data ?? null;
}

export async function getPatientHistory(appointmentId: string): Promise<PatientHistory | null> {
  const res = await rawFetch(
    `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/history`,
  );
  if (res.status === 404) return null;
  const body = await readJson<{ data?: PatientHistory; error?: string }>(res);
  if (!res.ok) {
    console.error(body.error ?? res.status);
    return null;
  }
  return body.data ?? null;
}

/** Vitals recorded during queueing, scheduling, or consultation for this visit. */
export async function getRecordedVitalsForAppointment(
  appointmentId: string,
): Promise<Vitals | undefined> {
  const history = await getPatientHistory(appointmentId);
  return history?.vitals;
}

/**
 * Same personal-info source as the create-profile page: appointment history +
 * current `GET /patients/:id/record` profile_json.
 */
export async function getPatientHistoryWithProfile(
  appointmentId: string,
): Promise<PatientHistory | null> {
  const history = await getPatientHistory(appointmentId);
  if (!history?.patient?.id) return history;

  const profile = await getPatientCreateRecord(history.patient.id);
  if (!profile.ok) return history;

  return {
    ...history,
    createRecord: profile.record,
    patient: {
      ...history.patient,
      firstName: profile.record.form.firstName || history.patient.firstName,
      middleName: profile.record.form.middleName || history.patient.middleName,
      lastName: profile.record.form.lastName || history.patient.lastName,
      suffix: profile.record.form.suffix || history.patient.suffix,
      birthDate: profile.record.form.birthDate || history.patient.birthDate,
      sex:
        profile.record.form.sex === "MALE"
          ? "M"
          : profile.record.form.sex === "FEMALE"
            ? "F"
            : history.patient.sex,
      ageYears:
        profile.record.form.ageYears.trim() !== ""
          ? Number.parseInt(profile.record.form.ageYears, 10) || history.patient.ageYears
          : history.patient.ageYears,
      bloodType: profile.record.form.bloodType || history.patient.bloodType,
      contactNumber: profile.record.form.mobile || history.patient.contactNumber,
      registrationNo: profile.record.form.registrationNo || history.patient.registrationNo,
      address:
        [
          profile.record.form.street,
          profile.record.form.barangay,
          profile.record.form.city,
          profile.record.form.province,
          profile.record.form.region,
          profile.record.form.zip,
        ]
          .map((s) => String(s).trim())
          .filter(Boolean)
          .join(", ") || history.patient.address,
    },
  };
}

export interface SearchPatientRegistryParams {
  lastName?: string;
  firstName?: string;
  middleName?: string;
  date?: ISODate;
  page?: number;
  pageSize?: number;
  /**
   * Registry sort. Legacy: `recent` (newest registered), `name` (last name A–Z).
   * Records filter also supports explicit last_name / registration / registered variants.
   */
  sort?: PatientRegistrySort;
}

export type PatientRegistrySort =
  | "recent"
  | "name"
  | "last_name_asc"
  | "last_name_desc"
  | "registration_asc"
  | "registration_desc"
  | "registered_asc"
  | "registered_desc";

export type PatientRegistryRow = {
  patient: Patient;
  appointmentId?: UUID | null;
  createRecord?: PatientCreateRecord;
};

export async function searchPatientRegistry(
  params: SearchPatientRegistryParams = {},
): Promise<Paginated<PatientRegistryRow>> {
  const { page = 1, pageSize = 8, lastName, firstName, middleName, date, sort } = params;
  const q = new URLSearchParams();
  q.set("page", String(page));
  q.set("page_size", String(pageSize));
  if (lastName) q.set("last_name", lastName);
  if (firstName) q.set("first_name", firstName);
  if (middleName) q.set("middle_name", middleName);
  if (date) q.set("date", date);
  if (sort) q.set("sort", sort);

  const res = await rawFetch(`${API_BASE}/patient-registry?${q.toString()}`);
  const body = await readJson<{ data?: Paginated<PatientRegistryRow>; error?: string }>(res);
  if (!res.ok) {
    console.error(body.error ?? res.status);
    return { items: [], page, pageSize, totalItems: 0, totalPages: 1 };
  }
  return body.data ?? { items: [], page, pageSize, totalItems: 0, totalPages: 1 };
}

export type GetPatientCreateRecordResult =
  | { ok: true; record: PatientCreateRecord }
  | {
      ok: false;
      reason: "not_found" | "unauthorized" | "forbidden" | "server" | "network";
      message?: string;
    };

async function fetchPatientCreateRecordFromUrl(
  path: string,
): Promise<GetPatientCreateRecordResult | null> {
  const res = await rawFetch(path);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  const body = await readJson<{ data?: { record?: PatientCreateRecord }; error?: string }>(res);
  if (res.status === 401) {
    return {
      ok: false,
      reason: "unauthorized",
      message: body.error ?? "Sign in to load patient records.",
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason: "forbidden",
      message: body.error ?? "You do not have permission to view this record.",
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      reason: "not_found",
      message: body.error ?? "Patient not found.",
    };
  }
  if (!res.ok) {
    return null;
  }
  const record = body.data?.record;
  if (!record) {
    return { ok: false, reason: "not_found", message: "Patient record is empty." };
  }
  return { ok: true, record };
}

async function fetchPatientCreateRecordFromRegistry(
  patientId: string,
): Promise<GetPatientCreateRecordResult | null> {
  const q = new URLSearchParams();
  q.set("patient_id", patientId);
  q.set("page_size", "1");
  const res = await rawFetch(`/patient-registry?${q.toString()}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  const body = await readJson<{
    data?: Paginated<PatientRegistryRow>;
    error?: string;
  }>(res);
  if (res.status === 401) {
    return {
      ok: false,
      reason: "unauthorized",
      message: body.error ?? "Sign in to load patient records.",
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason: "forbidden",
      message: body.error ?? "You do not have permission to view this record.",
    };
  }
  if (!res.ok) {
    return null;
  }
  const row = body.data?.items?.[0];
  if (!row?.createRecord) {
    return null;
  }
  return { ok: true, record: row.createRecord };
}

export function cachePatientCreateRecord(
  patientId: string,
  record: PatientCreateRecord,
): void {
  try {
    sessionStorage.setItem(patientCreateRecordCacheKey(patientId), JSON.stringify(record));
  } catch {
    /* ignore quota */
  }
}

export function clearPatientCreateRecordCache(patientId: string): void {
  try {
    sessionStorage.removeItem(patientCreateRecordCacheKey(patientId));
  } catch {
    /* ignore */
  }
}

export async function getPatientCreateRecord(
  patientId: string,
): Promise<GetPatientCreateRecordResult> {
  const id = patientId.trim();
  if (!id) {
    return { ok: false, reason: "not_found", message: "Patient id is required." };
  }

  const paths = [
    `/patients/${encodeURIComponent(id)}/record`,
    `/patient-records/${encodeURIComponent(id)}`,
  ];

  try {
    for (const path of paths) {
      const result = await fetchPatientCreateRecordFromUrl(path);
      if (result) return result;
    }

    const fromRegistry = await fetchPatientCreateRecordFromRegistry(id);
    if (fromRegistry) return fromRegistry;

    return {
      ok: false,
      reason: "server",
      message:
        "Could not load patient record. Run npm run api:start in the anivax folder (this restarts the API with the latest routes).",
    };
  } catch {
    return {
      ok: false,
      reason: "network",
      message: "Network error. Check that the API server is running (npm run api:start).",
    };
  }
}

export interface SavePatientProfileParams {
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  birthDate: string;
  sex: "M" | "F";
  ageYears?: number;
  address?: string;
  contactNumber?: string;
  bloodType?: string;
  registrationNo?: string;
  profile: PatientCreateRecord;
}

export type SavePatientProfileResult = {
  ok: boolean;
  patientId?: string;
  error?: string;
  /** Server returned 409 — same first name, last name, and birth date. */
  duplicate?: boolean;
};

export async function savePatientProfile(
  params: SavePatientProfileParams & { patientId?: string },
): Promise<SavePatientProfileResult> {
  const url = params.patientId
    ? `${API_BASE}/patients/${encodeURIComponent(params.patientId)}`
    : `${API_BASE}/patients`;
  try {
    const res = await rawFetch(
      params.patientId
        ? `/patients/${encodeURIComponent(params.patientId)}`
        : "/patients",
      {
        method: params.patientId ? "PUT" : "POST",
        body: {
          firstName: params.firstName,
          lastName: params.lastName,
          middleName: params.middleName,
          suffix: params.suffix,
          birthDate: params.birthDate,
          sex: params.sex,
          ageYears: params.ageYears,
          address: params.address,
          contactNumber: params.contactNumber,
          bloodType: params.bloodType,
          registrationNo: params.registrationNo,
          profile: params.profile,
        },
      },
    );
    let body: {
      data?: { id?: string; existingPatientId?: string; patient?: { id?: string } };
      error?: string;
    };
    try {
      body = await readJson<typeof body>(res);
    } catch (parseErr) {
      return {
        ok: false,
        error:
          parseErr instanceof Error
            ? parseErr.message
            : `Save failed (${res.status})`,
      };
    }
    if (res.status === 409) {
      const existingPatientId =
        body.data?.existingPatientId ?? body.data?.patient?.id ?? body.data?.id;
      return {
        ok: false,
        duplicate: true,
        patientId: existingPatientId,
        error:
          body.error ??
          "A patient with this name and date of birth already exists.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: body.error ?? `Save failed (${res.status})` };
    }
    const patientId = body.data?.id ?? params.patientId;
    if (patientId) {
      cachePatientCreateRecord(patientId, params.profile);
    }
    notifyDataChanged("patients");
    return { ok: true, patientId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return {
        ok: false,
        error: "Cannot reach the API. Start it with npm run api:start (port 4000).",
      };
    }
    return { ok: false, error: msg || "Save failed." };
  }
}

export async function countAppointmentsByTab(
  date: ISODate,
): Promise<Record<AppointmentTab, number>> {
  const res = await rawFetch(
    `${API_BASE}/appointments/tab-counts?date=${encodeURIComponent(date)}`,
  );
  const body = await readJson<{
    data?: Record<AppointmentTab, number>;
    error?: string;
  }>(res);
  if (!res.ok) {
    console.error(body.error ?? res.status);
    return { QUEUE: 0, "FOLLOW-UP": 0, REQUESTS: 0 };
  }
  const d = body.data;
  if (!d) return { QUEUE: 0, "FOLLOW-UP": 0, REQUESTS: 0 };
  return {
    QUEUE: d.QUEUE ?? 0,
    "FOLLOW-UP": d["FOLLOW-UP"] ?? 0,
    REQUESTS: d.REQUESTS ?? 0,
  };
}

export async function createAppointment(
  params: UpsertScheduleAppointmentParams,
): Promise<Appointment | null> {
  const res = await rawFetch(`${API_BASE}/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await readJson<{ data?: Appointment; error?: string }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? `Failed to create appointment (${res.status})`);
  }
  notifyDataChanged("appointments");
  return body.data ?? null;
}

export async function updateAppointment(
  id: string,
  params: Partial<UpsertScheduleAppointmentParams>,
): Promise<Appointment | null> {
  const res = await rawFetch(`${API_BASE}/appointments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await readJson<{ data?: Appointment; error?: string }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? `Failed to update appointment (${res.status})`);
  }
  notifyDataChanged("appointments");
  return body.data ?? null;
}

export async function deleteAppointment(id: string): Promise<void> {
  const res = await rawFetch(`${API_BASE}/appointments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (res.status === 204) {
    notifyDataChanged("appointments");
    return;
  }
  const body = await readJson<{ error?: string }>(res);
  throw new Error(body.error ?? `Failed to delete appointment (${res.status})`);
}

export type PatientRecycleMeta = {
  id: string;
  deletedAt: string;
  purgeAfter: string;
  retentionDays: number;
};

export type RecyclePatientListItem = PatientRecycleMeta & {
  firstName: string;
  middleName?: string;
  lastName: string;
  birthDate: string;
  sex: string;
  ageYears?: number;
  registeredAt?: string | null;
  createdAt?: string;
  daysUntilPurge: number;
};

/** Admin registry: move patient to recycle bin (DELETE → 200 with purge schedule). */
export async function deletePatient(id: string): Promise<PatientRecycleMeta> {
  const res = await rawFetch(`${API_BASE}/patients/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const body = await readJson<{ data?: PatientRecycleMeta; error?: string }>(res);
  if (!res.ok) {
    throw new Error(body.error ?? `Failed to move patient to recycle bin (${res.status})`);
  }
  if (!body.data) {
    throw new Error("Invalid recycle response from server.");
  }
  clearPatientCreateRecordCache(id);
  notifyDataChanged("patients");
  return body.data;
}

export async function restorePatient(id: string): Promise<void> {
  const res = await rawFetch(`${API_BASE}/patients/${encodeURIComponent(id)}/restore`, {
    method: "POST",
  });
  if (res.status === 200) {
    notifyDataChanged("patients");
    return;
  }
  const body = await readJson<{ error?: string }>(res);
  throw new Error(body.error ?? `Failed to restore patient (${res.status})`);
}

export async function permanentlyDeleteRecycledPatient(id: string): Promise<void> {
  const res = await rawFetch(
    `${API_BASE}/patients/recycle/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (res.status === 204) {
    clearPatientCreateRecordCache(id);
    notifyDataChanged("patients");
    return;
  }
  const body = await readJson<{ error?: string }>(res);
  throw new Error(body.error ?? `Failed to permanently delete patient (${res.status})`);
}

export async function listRecyclePatients(params: {
  page?: number;
  pageSize?: number;
  q?: string;
} = {}): Promise<{
  items: RecyclePatientListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  retentionDays: number;
}> {
  const { page = 1, pageSize = 50, q } = params;
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("page_size", String(pageSize));
  if (q?.trim()) search.set("q", q.trim());
  const res = await rawFetch(`${API_BASE}/patients/recycle?${search.toString()}`);
  const body = await readJson<{
    data?: {
      items: RecyclePatientListItem[];
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
      retentionDays: number;
    };
    error?: string;
  }>(res);
  if (!res.ok || !body.data) {
    throw new Error(body.error ?? `Failed to load recycle bin (${res.status})`);
  }
  return body.data;
}

/** Persisted after consultation PDF OCR; cleared when the patient is saved from create profile. */
export const CONSULTATION_OCR_RESULT_STORAGE_KEY = "anivax.consultationOcrResult";

export type OcrPageSlice = { pageNumber: number; text: string };

export type OcrSuccessData = {
  fileName: string;
  mimeType: string;
  fullText: string;
  /** Mistral document_annotation JSON when structured extraction is enabled. */
  personalInfo?: Record<string, unknown> | null;
  pages?: OcrPageSlice[];
  paragraphs?: string[];
  totalPagesReported?: number | null;
};

export type StoredConsultationOcr = {
  fileName: string;
  mimeType: string;
  fullText: string;
  personalInfo?: Record<string, unknown> | null;
  extractedAt: string;
  truncated?: boolean;
};

/**
 * Sends a file to `POST /api/v1/ocr` (Mistral OCR when `MISTRAL_API_KEY` is set on the server, else OCR.space).
 * @param options.pages — optional `1,2,3` query (1-based). Forwarded to Mistral as zero-based indices only when set.
 *   Avoid passing a fixed list like `1-5` for unknown PDFs: Mistral returns no text if any requested index is past the last page.
 */
export async function postOcrFile(file: File, options?: { pages?: string }): Promise<OcrSuccessData> {
  const body = new FormData();
  body.append("file", file);
  const q =
    options?.pages && options.pages.trim() !== ""
      ? `?pages=${encodeURIComponent(options.pages.trim())}`
      : "";
  const res = await rawFetch(`${API_BASE}/ocr${q}`, {
    method: "POST",
    body,
  });
  const json = await readJson<{ data?: OcrSuccessData; error?: string; details?: string }>(res);
  if (!res.ok) {
    throw new Error(json.details ?? json.error ?? `OCR failed (${res.status})`);
  }
  if (!json.data) {
    throw new Error("Invalid OCR response from server.");
  }
  return json.data;
}

export function persistConsultationOcrResult(data: OcrSuccessData): void {
  if (typeof window === "undefined") return;
  const max = 400_000;
  const ft = data.fullText ?? "";
  const truncated = ft.length > max;
  const payload: StoredConsultationOcr = {
    fileName: data.fileName,
    mimeType: data.mimeType,
    fullText: truncated ? ft.slice(0, max) : ft,
    personalInfo: data.personalInfo ?? null,
    extractedAt: new Date().toISOString(),
    truncated,
  };
  try {
    sessionStorage.setItem(CONSULTATION_OCR_RESULT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    try {
      sessionStorage.setItem(
        CONSULTATION_OCR_RESULT_STORAGE_KEY,
        JSON.stringify({
          ...payload,
          fullText: ft.slice(0, 50_000),
          truncated: true,
        }),
      );
    } catch {
      /* ignore quota */
    }
  }
}

export function clearConsultationOcrResult(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(CONSULTATION_OCR_RESULT_STORAGE_KEY);
}

/* -------------------------------------------------------------------------- */
/*                       PEP schedules + dose admin                            */
/* -------------------------------------------------------------------------- */

export async function listRegimens(): Promise<RegimenInfo[]> {
  return fetchJson<RegimenInfo[]>("/regimens");
}

export async function getDoctorsOrderForAppointment(
  appointmentId: string,
): Promise<{ payload: unknown; schedules: DoseSchedule[] }> {
  return fetchJson(`/appointments/${encodeURIComponent(appointmentId)}/doctors-order`);
}

export interface SaveDoctorsOrderInput {
  payload?: unknown;
  schedule?: { regimen: RegimenKey; day0Date: ISODate };
}

export async function saveDoctorsOrder(
  appointmentId: string,
  input: SaveDoctorsOrderInput,
): Promise<{ savedAt: string; schedule: DoseSchedule | null }> {
  return fetchJson(`/appointments/${encodeURIComponent(appointmentId)}/doctors-order`, {
    method: "POST",
    body: input,
  });
}

export async function getVaccinationRecordForAppointment(
  appointmentId: string,
): Promise<{ payload: unknown; updatedAt: string | null }> {
  return fetchJson(`/appointments/${encodeURIComponent(appointmentId)}/vaccination-record`);
}

export async function saveVaccinationRecord(
  appointmentId: string,
  payload: unknown,
): Promise<{ savedAt: string; payload: unknown }> {
  return fetchJson(`/appointments/${encodeURIComponent(appointmentId)}/vaccination-record`, {
    method: "POST",
    body: { payload },
  });
}

export async function getDoseScheduleForPatient(
  patientId: string,
): Promise<DoseSchedule[]> {
  const data = await fetchJson<{ items: DoseSchedule[] }>(
    `/patients/${encodeURIComponent(patientId)}/dose-schedule`,
  );
  return data.items;
}

export interface MarkDoseGivenInput {
  givenAt?: string | null;
  vaccineLotId?: number | null;
  site?: string | null;
  route?: string | null;
}

export async function updateDoseAdministration(
  doseId: number,
  input: MarkDoseGivenInput,
): Promise<DoseAdministration> {
  return fetchJson<DoseAdministration>(`/dose-administrations/${doseId}`, {
    method: "PATCH",
    body: input,
  });
}

/* -------------------------------------------------------------------------- */
/*                              Vaccine inventory                              */
/* -------------------------------------------------------------------------- */

export async function listVaccines(): Promise<Vaccine[]> {
  const data = await fetchJson<{ items: Vaccine[] }>("/vaccines");
  return data.items;
}

export async function listVaccineLots(): Promise<VaccineLot[]> {
  const data = await fetchJson<{ items: VaccineLot[] }>("/vaccine-lots");
  return data.items;
}

/* -------------------------------------------------------------------------- */
/*                              Queue tickets                                  */
/* -------------------------------------------------------------------------- */

export async function issueQueueTicket(appointmentId: string): Promise<QueueTicket | null> {
  try {
    const ticket = await fetchJson<QueueTicket>("/queue-tickets", {
      method: "POST",
      body: { appointmentId },
    });
    notifyDataChanged("appointments");
    return ticket;
  } catch {
    return null;
  }
}

export async function getQueueTicketForAppointment(
  appointmentId: string,
): Promise<QueueTicket | null> {
  try {
    return await fetchJson<QueueTicket>(
      `/queue-tickets/${encodeURIComponent(appointmentId)}`,
    );
  } catch {
    return null;
  }
}

export async function callNextQueueTicket(
  date?: ISODate,
): Promise<QueueTicket | null> {
  try {
    const ticket = await fetchJson<QueueTicket>("/queue-tickets/call-next", {
      method: "POST",
      body: { date: date ?? null },
    });
    notifyDataChanged("appointments");
    return ticket;
  } catch {
    return null;
  }
}

export async function listQueueTicketsForDay(
  date: ISODate,
): Promise<QueueTicket[]> {
  const data = await fetchJson<{ items: QueueTicket[] }>(
    `/queue-tickets?date=${encodeURIComponent(date)}`,
  );
  return data.items ?? [];
}

/* -------------------------------------------------------------------------- */
/*                                 Helpers                                    */
/* -------------------------------------------------------------------------- */

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
