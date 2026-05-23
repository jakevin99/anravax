/**
 * Domain types for the Anivax application.
 *
 * These mirror the expected database schema so the front-end stays
 * stable when the backend (Prisma / Postgres / Supabase / REST) is wired in.
 * Field names use snake_case-friendly camelCase that maps cleanly to a SQL schema.
 */

export type UUID = string;
export type ISODateTime = string; // e.g. "2026-05-08T10:00:00.000Z"
export type ISODate = string; // e.g. "2026-05-08"

export type Sex = "M" | "F";

export type AppointmentTab = "QUEUE" | "FOLLOW-UP" | "REQUESTS";

/**
 * Triage / priority category for an appointment.
 * 1 = highest priority, increases with number.
 */
export type AppointmentCategory = 1 | 2 | 3 | 4 | 5;

export type AppointmentStatus =
  | "SCHEDULED"
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "OVERDUE";

export interface Patient {
  id: UUID;
  firstName: string;
  middleName?: string;
  lastName: string;
  /** Generational suffix (Jr., Sr., III, etc.). */
  suffix?: string;
  birthDate: ISODate;
  sex: Sex;
  /** Cached age for display; the source of truth is birthDate. */
  ageYears: number;
  /** Optional extended profile fields used on the history page. */
  address?: string;
  contactNumber?: string;
  bloodType?: string;
  registrationNo?: string;
  /** Patient registry / enrollment date (add-user records table). */
  registeredAt?: ISODate;
}

export interface Attendant {
  id: UUID;
  firstName: string;
  lastName: string;
  /** Role suffix shown after the name, e.g. "RN", "MD". */
  credential: string;
}

export interface Vitals {
  /** Pulse rate (bpm). Labeled "PR" in the UI. */
  pulseRate?: number;
  /** Oxygen saturation as a percentage (0-100). */
  spo2?: number;
  /** Systolic / diastolic blood pressure formatted as "120/80". */
  bloodPressure?: string;
  temperatureC?: number;
  weightKg?: number;
  heightCm?: number;
  recordedAt?: ISODateTime;
}

export interface Appointment {
  id: UUID;
  /** Scheduled time of the appointment. */
  scheduledAt: ISODateTime;
  /** Omitted for FOLLOW-UP capacity slots (Schedules page); required for QUEUE / REQUESTS. */
  patient: Patient | null;
  attendant: Attendant;
  /**
   * Scheduling / triage placeholder (e.g. slot load). Queue UI shows {@link biteCategory}
   * once set on Doctor's Order.
   */
  category: AppointmentCategory;
  /** WHO exposure category (I–IV) set by the doctor on Doctor's Order. */
  biteCategory?: BiteCategory;
  status: AppointmentStatus;
  tab: AppointmentTab;
  /** Optional persisted slot usage for schedule rows (used/total). */
  slotUsed?: number;
  slotTotal?: number;
  vitals?: Vitals;
  notes?: string;
}

/**
 * Status for a calendar day, used to color-code the calendar legend:
 * - available: future / open day
 * - appointment: has at least one scheduled appointment
 * - overdue: past day with unfinished items
 */
export type CalendarDayStatus = "available" | "appointment" | "overdue" | "none";

export interface CalendarDay {
  date: ISODate;
  status: CalendarDayStatus;
  /** Number of appointments scheduled for that day. */
  appointmentCount: number;
}

export interface AuthUser {
  id: UUID;
  firstName: string;
  lastName: string;
  role: "RHU STAFF" | "ADMIN" | "ENCODER" | "PROGRAM COORDINATOR";
}

export interface AppointmentSearchFilters {
  lastName?: string;
  firstName?: string;
  middleName?: string;
  date?: ISODate;
  tab?: AppointmentTab;
}

/** Which collection backs CalendarCard (separate REST resources). */
export type CalendarResource = "appointments" | "schedule-slots";

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/* -------------------------------------------------------------------------- */
/*                       Retrieve / patient history                            */
/* -------------------------------------------------------------------------- */

/**
 * The 4 sections shown on the patient-history page. The active section is
 * selected by the tab bar. PERSONAL_INFO is the default landing tab.
 */
export type HistoryTabId =
  | "PERSONAL_INFO"
  | "DOCTORS_ORDER"
  | "VACCINATION"
  | "NURSES_NOTE";

/**
 * Body view selected when annotating an injury site.
 * Mirrors the four illustrations on the Doctor's Order tab.
 */
export type BodyView = "RIGHT" | "FRONT" | "BACK" | "LEFT";

/**
 * Discrete dose strengths available for a medication.
 * Stored as a record so additional strengths can be added without breaking
 * existing rows.
 */
export interface MedicationStrengths {
  /** Whether 125 mg was prescribed. */
  mg125?: boolean;
  /** Whether 250 mg was prescribed. */
  mg250?: boolean;
  /** Whether 500 mg was prescribed. */
  mg500?: boolean;
}

/**
 * Patient-facing prescriptions written on the Doctor's Order tab.
 * Only the drugs in the form are tracked; an "others" free-text bin
 * is included for anything not on the standard formulary.
 */
export interface HomeMeds {
  amoxicillin: MedicationStrengths;
  paracetamol: MedicationStrengths;
  /** Mefenamic acid only ships in 250 / 500 mg in the form. */
  mefenamicAcid: Pick<MedicationStrengths, "mg250" | "mg500">;
  others: string;
}

/**
 * Plan section of the Doctor's Order — biologics, ATS units, and
 * supporting checkboxes (ERIG, ARV, FIC). The free-text fields capture
 * the date / time / initials shorthand the form footnote requests.
 */
export interface TreatmentPlan {
  booster: boolean;
  prep: boolean;
  pep: boolean;
  ats: {
    given: boolean;
    /** Free-text IU dose, e.g. "5000". */
    units?: string;
  };
  tetanusToxoid: {
    given: boolean;
    /** Free-text date / time / initials annotation. */
    note?: string;
  };
  erig: boolean;
  arv: boolean;
  fic: boolean;
}

/**
 * The full Doctor's Order tab payload. Maps to a "doctors_orders" row
 * once a backend is wired in.
 */
/** WHO-style animal bite exposure category (I–IV / 1–4). */
export type BiteCategory = 1 | 2 | 3 | 4;

export interface DoctorsOrder {
  pertinentPE: string;
  diagnosis: string;
  /** Exposure category selected on the Doctor's Order tab. */
  biteCategory?: BiteCategory;
  plan: TreatmentPlan;
  homeMeds: HomeMeds;
  /**
   * Optional body annotations. Each entry pins an injury / lesion to a
   * coordinate on one of the four body views. Stored normalised
   * (0..1) so the markers stay in place at any render size.
   */
  bodyMarks?: Array<{
    view: BodyView;
    /** Normalised x position (0..1) within the body image. */
    x: number;
    /** Normalised y position (0..1) within the body image. */
    y: number;
    label?: string;
  }>;
}

/**
 * One incident a patient is being seen for. Maps 1:1 to a row in the
 * "exposure_records" table once a backend is wired in.
 */
export interface ExposureRecord {
  /** Patient-reported chief complaint (free text). */
  chiefComplaint: string;
  /** Date the incident occurred. */
  dateOfIncidence: ISODate;
  /** Wall-clock time the incident occurred (e.g. "15:00"). */
  timeOfIncidence: string;
  placeOfIncidence: string;
  siteOfInjury: string;
  animalType: string;
  washedInjury: boolean;
  animalVaccinated: boolean;
  biteType?: "BITE" | "NON-BITE";
  strayOwned?: "STRAY" | "OWNED";
  /** Optional URL to a supporting document the patient uploaded. */
  uploadedFileUrl?: string;
}

/**
 * Aggregate payload for the retrieve / history page. Joins the
 * appointment with the patient's enriched profile and any exposure
 * record on file. The shape is intentionally flat so a backend can
 * return it from a single endpoint such as
 * GET /appointments/:id/history.
 */
/** One row on the patient consultation history list (records → History). */
export type ConsultationHistoryStatus = "COMPLETED" | "INCOMPLETE";

export interface PatientConsultationRow {
  appointmentId: UUID;
  scheduledAt: ISODateTime;
  consultationStatus: ConsultationHistoryStatus;
  attendant: Attendant;
}

export interface PatientHistory {
  appointmentId: UUID;
  patient: Patient;
  /** Same payload as the create-profile page (`profile_json` on the patient row). */
  createRecord?: import("../components/createProfileRecord").PatientCreateRecord;
  /** Date this record/visit was opened. */
  date: ISODate;
  /** Full scheduled date/time from queue / schedule-appointment (ISO). */
  scheduledAt?: ISODateTime;
  /** Mirrors doctor-assigned exposure category when set on Doctor's Order. */
  category: AppointmentCategory;
  exposure: ExposureRecord;
  /** Vitals captured when the appointment was scheduled (queue flow). */
  vitals?: Vitals;
  /** Optional doctor's order; absent when none has been recorded yet. */
  doctorsOrder?: DoctorsOrder;
}

/* -------------------------------------------------------------------------- */
/*                              PEP schedules                                 */
/* -------------------------------------------------------------------------- */

export type RegimenKey =
  | "WHO_IPC_2_2_2_0_2"
  | "WHO_TRC_2_2_2_0_2"
  | "ESSEN_IM_1_1_1_1"
  | "ZAGREB_IM_2_0_1_0_1"
  | "BOOSTER_2_VISIT";

export type DoseStatus = "GIVEN" | "OVERDUE" | "DUE" | "UPCOMING";

export interface DoseAdministration {
  id: number;
  scheduleId: number;
  doseNumber: number;
  dueDate: ISODate;
  givenAt?: ISODateTime | null;
  vaccineLotId?: number | null;
  givenByUserId?: number | null;
  site?: string | null;
  route?: string | null;
  status: DoseStatus;
}

export interface DoseSchedule {
  id: number;
  patientId: UUID;
  exposureAppointmentId: UUID;
  regimen: RegimenKey;
  regimenLabel: string;
  day0Date: ISODate;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  createdAt: ISODateTime;
  doses: DoseAdministration[];
  nextDueDose: DoseAdministration | null;
}

export interface RegimenInfo {
  key: RegimenKey;
  label: string;
  route: "ID" | "IM";
  offsets: number[];
  sitesPerVisit: number;
}

/* -------------------------------------------------------------------------- */
/*                         Vaccine inventory                                  */
/* -------------------------------------------------------------------------- */

export type VaccineKind = "RABIES_VAX" | "ERIG" | "HRIG" | "TT" | "ATS";

export interface Vaccine {
  id: number;
  code: string;
  name: string;
  kind: VaccineKind;
}

export interface VaccineLot {
  id: number;
  vaccineId: number;
  vaccineCode: string;
  vaccineName: string;
  vaccineKind: VaccineKind;
  lotNo: string;
  expiresOn?: ISODate | null;
  qtyInitial: number;
  qtyRemaining: number;
  receivedAt: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/*                              Queue tickets                                 */
/* -------------------------------------------------------------------------- */

export type QueueTicketStatus =
  | "WAITING"
  | "CALLED"
  | "SERVING"
  | "FINISHED"
  | "CANCELLED";

export interface QueueTicket {
  appointmentId: UUID;
  tokenCode: string;
  dayIso: ISODate;
  position: number;
  status: QueueTicketStatus;
  calledAt?: ISODateTime | null;
  servedAt?: ISODateTime | null;
  finishedAt?: ISODateTime | null;
  peopleAhead: number;
  etaMinutes?: number | null;
}

/* -------------------------------------------------------------------------- */
/*                              Notifications                                 */
/* -------------------------------------------------------------------------- */

export type NotificationKind =
  | "QUEUE_NEAR"
  | "DOSE_DUE_TOMORROW"
  | "DOSE_OVERDUE"
  | "APPOINTMENT_CONFIRMED";

export interface NotificationRow {
  id: number;
  patientId: UUID;
  kind: NotificationKind;
  payload: unknown;
  sentAt?: ISODateTime | null;
  deliveredAt?: ISODateTime | null;
  error?: string | null;
  createdAt: ISODateTime;
}
