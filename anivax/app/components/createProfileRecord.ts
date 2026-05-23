import { DEFAULT_PH_ADDRESS, type PhAddressFormSlice } from "./PhilippineAddressBlock";

/** Personal information fields on Create profile / Retrieve record. */
export type CreateProfileFormState = {
  philhealthNo: string;
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  noMiddleName: boolean;
  birthDate: string;
  ageYears: string;
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
  registrationNo: string;
} & PhAddressFormSlice;

export type CreateProfileGuardianState = {
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  noMiddleName: boolean;
  birthDate: string;
  ageYears: string;
  sex: string;
  relationship: string;
  mobile: string;
  email: string;
  placeOfBirth: string;
  similarAddress: boolean;
  street: string;
} & PhAddressFormSlice;

export type IdUploadSideState = {
  fileName: string;
  /** Stored file id from `POST /api/v1/files` (kind `ID_CARD`). */
  fileId?: number | null;
};

export type CreateProfileUploadsState = {
  idType: string;
  files: IdUploadSideState[];
};

export function emptyIdUploadSide(): IdUploadSideState {
  return { fileName: "", fileId: null };
}

export function emptyUploadsState(): CreateProfileUploadsState {
  return {
    idType: "",
    files: [],
  };
}

function sideHasData(side: IdUploadSideState | null | undefined): boolean {
  return Boolean(side && (side.fileName?.trim() || side.fileId));
}

/** Supports legacy `front`/`back` and single `fileName` / `fileId`. */
export function normalizeUploads(raw: unknown): CreateProfileUploadsState {
  const u = raw as
    | (Partial<CreateProfileUploadsState> & {
        fileName?: string;
        fileId?: number | null;
        front?: IdUploadSideState;
        back?: IdUploadSideState;
        files?: IdUploadSideState[];
      })
    | null
    | undefined;

  if (!u || typeof u !== "object") {
    return emptyUploadsState();
  }

  if (Array.isArray(u.files)) {
    return {
      idType: u.idType ?? "",
      files: u.files
        .filter((f) => sideHasData(f))
        .map((f) => ({
          fileName: f?.fileName ?? "",
          fileId: f?.fileId ?? null,
        })),
    };
  }

  const files: IdUploadSideState[] = [];
  if (sideHasData(u.front)) {
    files.push({
      fileName: u.front!.fileName ?? "",
      fileId: u.front!.fileId ?? null,
    });
  }
  if (sideHasData(u.back)) {
    files.push({
      fileName: u.back!.fileName ?? "",
      fileId: u.back!.fileId ?? null,
    });
  }
  if (files.length === 0 && (u.fileName?.trim() || u.fileId)) {
    files.push({
      fileName: u.fileName ?? "",
      fileId: u.fileId ?? null,
    });
  }

  return {
    idType: u.idType ?? "",
    files,
  };
}

export function uploadsHasData(u: CreateProfileUploadsState): boolean {
  return Boolean(
    u.idType.trim() || u.files.some((f) => f.fileName.trim() || f.fileId),
  );
}

export type ProfilePhotoState = {
  fileName: string;
  /** Stored file id from `POST /api/v1/files` (kind `PROFILE_PHOTO`). */
  fileId?: number | null;
};

export function emptyProfilePhoto(): ProfilePhotoState {
  return { fileName: "", fileId: null };
}

export function normalizeProfilePhoto(raw: unknown): ProfilePhotoState {
  const p = raw as Partial<ProfilePhotoState> | null | undefined;
  if (!p || typeof p !== "object") return emptyProfilePhoto();
  return {
    fileName: p.fileName ?? "",
    fileId: p.fileId ?? null,
  };
}

/** Full create-profile payload stored on the patient row. */
export type PatientCreateRecord = {
  form: CreateProfileFormState;
  guardian: CreateProfileGuardianState;
  uploads: CreateProfileUploadsState;
  photo?: ProfilePhotoState;
};

/** Blank personal-information form (includes default PH address fields). */
export function emptyCreateProfileForm(): CreateProfileFormState {
  return {
    philhealthNo: "",
    lastName: "",
    firstName: "",
    middleName: "",
    suffix: "",
    noMiddleName: false,
    birthDate: "",
    ageYears: "",
    sex: "FEMALE",
    civilStatus: "SINGLE",
    placeOfBirth: "",
    bloodType: "A+",
    mobile: "",
    email: "",
    religion: "",
    scPwdId: "",
    telephone: "",
    street: "",
    registrationNo: "",
    ...DEFAULT_PH_ADDRESS,
  };
}

export function emptyCreateProfileGuardian(): CreateProfileGuardianState {
  return {
    lastName: "",
    firstName: "",
    middleName: "",
    suffix: "",
    noMiddleName: false,
    birthDate: "",
    ageYears: "",
    sex: "FEMALE",
    relationship: "MOTHER",
    mobile: "",
    email: "",
    placeOfBirth: "",
    similarAddress: false,
    street: "",
    ...DEFAULT_PH_ADDRESS,
  };
}

export function patientCreateRecordCacheKey(patientId: string): string {
  return `anivax:create-record:${patientId.trim()}`;
}

export function guardianHasData(g: CreateProfileGuardianState): boolean {
  return Boolean(
    g.lastName.trim() ||
      g.firstName.trim() ||
      g.middleName.trim() ||
      g.mobile.trim() ||
      g.email.trim() ||
      g.birthDate.trim() ||
      g.placeOfBirth.trim() ||
      g.street.trim(),
  );
}
