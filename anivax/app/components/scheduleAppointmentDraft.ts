/** Session draft when navigating from Create profile → Schedule appointment (full page). */
export const SCHEDULE_APPOINTMENT_DRAFT_KEY = "anivax.scheduleAppointmentDraft";

export type ScheduleAppointmentPatientDraft = {
  /** Set when the profile was already saved on Create profile (avoids duplicate POST). */
  patientId?: string;
  ageDisplay: string;
  form: {
    philhealthNo: string;
    lastName: string;
    firstName: string;
    middleName: string;
    suffix: string;
    noMiddleName: boolean;
    birthDate: string;
    sex: string;
    civilStatus: string;
    placeOfBirth: string;
    bloodType: string;
    mobile: string;
    email: string;
    religion: string;
    scPwdId: string;
    telephone: string;
    street: string;
    region: string;
    province: string;
    city: string;
    barangay: string;
    zip: string;
    /** PSGC codes for PhilippineAddressBlock (optional on older drafts). */
    regionCode?: string;
    provinceCode?: string;
    municipalityCode?: string;
    barangayCode?: string;
    registrationNo: string;
    /** Manual age when entered; optional for drafts saved before this field existed. */
    ageYears?: string;
  };
};
