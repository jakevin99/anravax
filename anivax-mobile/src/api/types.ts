/**
 * Shared response types — mirror the server's camelCase `data` envelope.
 *
 * Keep this file in sync with `anivax/app/types/domain.ts`.
 */

export type ISODate = string;
export type ISODateTime = string;

export type DoseStatus = "GIVEN" | "OVERDUE" | "DUE" | "UPCOMING";

export interface DoseAdministration {
  id: number;
  scheduleId: number;
  doseNumber: number;
  dueDate: ISODate;
  givenAt: ISODateTime | null;
  vaccineLotId: number | null;
  givenByUserId: number | null;
  site: string | null;
  route: string | null;
  status: DoseStatus;
}

export interface DoseSchedule {
  id: number;
  patientId: string;
  exposureAppointmentId: string;
  regimen: string;
  regimenLabel: string;
  day0Date: ISODate;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  createdAt: ISODateTime;
  doses: DoseAdministration[];
  nextDueDose: DoseAdministration | null;
}

export type QueueTicketStatus =
  | "WAITING"
  | "CALLED"
  | "SERVING"
  | "FINISHED"
  | "CANCELLED";

export interface QueueTicket {
  appointmentId: string;
  tokenCode: string;
  dayIso: ISODate;
  position: number;
  status: QueueTicketStatus;
  calledAt: ISODateTime | null;
  servedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
  peopleAhead: number;
  etaMinutes: number | null;
}

export interface PatientProfile {
  id: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  birthDate: ISODate;
  sex: "M" | "F";
  ageYears: number;
  address: string | null;
  contactNumber: string | null;
  bloodType: string | null;
  registeredAt: ISODate | null;
}

export interface ExposureIntake {
  chiefComplaint: string;
  dateOfIncidence: ISODate;
  timeOfIncidence: string;
  placeOfIncidence: string;
  siteOfInjury: string;
  animalType: string;
  washedInjury: boolean;
  animalVaccinated: boolean;
}
