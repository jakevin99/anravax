import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  fetchStoredPatientFile,
  uploadPatientIdFile,
  uploadPatientProfilePhoto,
} from "../services/filesService";
import {
  cachePatientCreateRecord,
  clearConsultationOcrResult,
  clearPatientCreateRecordCache,
  CONSULTATION_OCR_RESULT_STORAGE_KEY,
  getCurrentUser,
  getPatientCreateRecord,
  savePatientProfile,
  type StoredConsultationOcr,
} from "../services/queueService";
import {
  emptyCreateProfileForm,
  emptyCreateProfileGuardian,
  emptyIdUploadSide,
  emptyProfilePhoto,
  guardianHasData,
  normalizeProfilePhoto,
  normalizeUploads,
  uploadsHasData,
  type IdUploadSideState,
  type PatientCreateRecord,
  type ProfilePhotoState,
} from "./createProfileRecord";
import type { AppointmentTab, AuthUser } from "../types/domain";
import { AccordionCard, SectionTag } from "./ProfileSectionAccordion";
import { DEFAULT_PH_ADDRESS, PhilippineAddressBlock } from "./PhilippineAddressBlock";
import { SCHEDULE_APPOINTMENT_DRAFT_KEY } from "./scheduleAppointmentDraft";
import TopNav from "./TopNav";
import { VaccinationM3DatePickerField } from "./VaccinationM3Pickers";
import { extractPersonalInfoFromOcr, mergeOcrIntoForm } from "../utils/parsePersonalInfoOcr";
import { promptOpenExistingPatientProfile } from "../utils/patientDuplicate";

const inputFieldClass =
  "create-profile-input box-border h-[25px] w-full rounded border border-[#D9D9D9] bg-white px-2.5 text-[13px] font-semibold text-anivax-ink outline-none transition-[box-shadow,border-color,opacity] focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/20 disabled:opacity-60";

const labelFieldClass =
  "mb-1 block text-[11px] font-semibold tracking-wide text-anivax-muted";

const SUFFIX_OPTIONS = ["NONE", "JR.", "SR.", "II", "III"];

export type CreateProfileLocationState = {
  fromOcr?: boolean;
  /** Where CANCEL navigates after retrieve / edit flows. */
  cancelReturnTo?: "queue" | "records" | "new-consultation";
  queueActiveTab?: AppointmentTab;
  queueFocusDate?: string;
};

function calcAge(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? String(age) : "";
}

function ageYearsResolved(f: { birthDate: string; ageYears: string }): number | undefined {
  const manual = f.ageYears.trim();
  if (manual !== "") {
    const n = Number(manual);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  const fromDob = calcAge(f.birthDate);
  if (fromDob !== "") {
    const n = Number(fromDob);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

function ageDisplayString(f: { birthDate: string; ageYears: string }): string {
  if (f.ageYears.trim() !== "") return f.ageYears.trim();
  return calcAge(f.birthDate);
}

type UploadSideLocal = IdUploadSideState & { pendingFile: File | null };

function sideFromRecord(side: IdUploadSideState): UploadSideLocal {
  return {
    fileName: side.fileName,
    fileId: side.fileId ?? null,
    pendingFile: null,
  };
}

function emptyUploadSideLocal(): UploadSideLocal {
  return { ...emptyIdUploadSide(), pendingFile: null };
}

type PhotoLocal = ProfilePhotoState & { pendingFile: File | null };

function photoFromRecord(photo: ProfilePhotoState | undefined): PhotoLocal {
  const normalized = normalizeProfilePhoto(photo);
  return { ...normalized, pendingFile: null };
}

function emptyPhotoLocal(): PhotoLocal {
  return { ...emptyProfilePhoto(), pendingFile: null };
}

type IdPreviewItem = {
  url: string;
  mime: string;
  fileName: string;
};

function revokeIdPreviewItems(items: IdPreviewItem[]) {
  for (const item of items) URL.revokeObjectURL(item.url);
}

function idFileKey(file: UploadSideLocal, index: number): string {
  return `${index}-${file.fileId ?? "pending"}-${file.fileName}`;
}

async function buildIdPreviewItems(files: UploadSideLocal[]): Promise<IdPreviewItem[]> {
  const items: IdPreviewItem[] = [];
  for (const side of files) {
    if (side.pendingFile) {
      items.push({
        url: URL.createObjectURL(side.pendingFile),
        mime: side.pendingFile.type,
        fileName: side.pendingFile.name,
      });
      continue;
    }
    if (side.fileId) {
      const blob = await fetchStoredPatientFile(side.fileId);
      items.push({
        url: URL.createObjectURL(blob),
        mime: blob.type,
        fileName: side.fileName,
      });
    }
  }
  return items;
}

export default function CreateProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientId: retrievePatientId } = useParams();
  const locationState = (location.state as CreateProfileLocationState | null) ?? {};
  const fromOcr = locationState.fromOcr === true;
  const [user, setUser] = useState<AuthUser | null>(null);
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [guardianOpen, setGuardianOpen] = useState(false);
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const [uploadIdType, setUploadIdType] = useState("");
  const [idFiles, setIdFiles] = useState<UploadSideLocal[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [idPreviewOpen, setIdPreviewOpen] = useState(false);
  const [idPreviewItems, setIdPreviewItems] = useState<IdPreviewItem[]>([]);
  /** Index in `idFiles` when a single-file preview is open; null if closed or showing multiple. */
  const [previewFileIndex, setPreviewFileIndex] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<PhotoLocal>(emptyPhotoLocal);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [ocrDraft, setOcrDraft] = useState<StoredConsultationOcr | null>(null);
  const [ocrAutoFilledCount, setOcrAutoFilledCount] = useState(0);
  const [ocrFillSource, setOcrFillSource] = useState<"structured" | "text" | "merged" | null>(null);

  const [form, setForm] = useState(emptyCreateProfileForm);

  const [guardian, setGuardian] = useState(emptyCreateProfileGuardian);

  const handleCancel = () => {
    if (locationState.cancelReturnTo === "queue") {
      navigate("/queue", {
        state: {
          queueActiveTab: locationState.queueActiveTab,
          queueFocusDate: locationState.queueFocusDate,
        },
      });
      return;
    }
    if (locationState.cancelReturnTo === "records") {
      navigate("/queue/records");
      return;
    }
    if (locationState.cancelReturnTo === "new-consultation") {
      navigate("/queue/new-consultation");
      return;
    }
    navigate(retrievePatientId || editingPatientId ? "/queue/records" : "/queue/new-consultation");
  };

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  useEffect(() => {
    return () => revokeIdPreviewItems(idPreviewItems);
  }, [idPreviewItems]);

  useEffect(() => {
    if (!retrievePatientId) return;
    let cancelled = false;

    const applyRecord = (record: PatientCreateRecord) => {
      setEditingPatientId(retrievePatientId);
      setForm({ ...emptyCreateProfileForm(), ...record.form });
      setGuardian({ ...emptyCreateProfileGuardian(), ...record.guardian });
      const uploads = normalizeUploads(record.uploads);
      setUploadIdType(uploads.idType);
      setIdFiles(uploads.files.map((f) => sideFromRecord(f)));
      if (uploadsHasData(uploads)) setUploadsOpen(true);
      if (guardianHasData(record.guardian)) setGuardianOpen(true);
      const photoRec = photoFromRecord(record.photo);
      setPhoto(photoRec);
      if (photoRec.fileId) {
        void fetchStoredPatientFile(photoRec.fileId)
          .then((blob) => {
            setPhotoPreview((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(blob);
            });
          })
          .catch(() => {
            /* preview optional */
          });
      } else {
        setPhotoPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
    };

    clearPatientCreateRecordCache(retrievePatientId);
    setRecordLoading(true);

    getPatientCreateRecord(retrievePatientId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          const fallback =
            result.reason === "unauthorized"
              ? "Sign in from the home page, then open this record again."
              : result.reason === "not_found"
                ? "Patient not found."
                : "Could not load patient record.";
          window.alert(result.message ?? fallback);
          if (result.reason === "unauthorized") {
            navigate("/", { replace: true });
          }
          return;
        }
        applyRecord(result.record);
        cachePatientCreateRecord(retrievePatientId, result.record);
      })
      .finally(() => {
        if (!cancelled) setRecordLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retrievePatientId, navigate]);

  useEffect(() => {
    if (!guardian.similarAddress) return;
    setGuardian((g) => ({
      ...g,
      street: form.street,
      regionCode: form.regionCode,
      region: form.region,
      provinceCode: form.provinceCode,
      province: form.province,
      municipalityCode: form.municipalityCode,
      city: form.city,
      barangayCode: form.barangayCode,
      barangay: form.barangay,
      zip: form.zip,
    }));
  }, [
    guardian.similarAddress,
    form.street,
    form.regionCode,
    form.region,
    form.provinceCode,
    form.province,
    form.municipalityCode,
    form.city,
    form.barangayCode,
    form.barangay,
    form.zip,
  ]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  useEffect(() => {
    if (retrievePatientId) return;
    if (!fromOcr) {
      clearConsultationOcrResult();
      setOcrDraft(null);
      setOcrAutoFilledCount(0);
      setOcrFillSource(null);
      return;
    }
    try {
      const raw = sessionStorage.getItem(CONSULTATION_OCR_RESULT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredConsultationOcr;
      if (parsed?.fullText == null && !parsed?.personalInfo) return;
      setOcrDraft(parsed);
      const { fields, filledCount, source } = extractPersonalInfoFromOcr({
        personalInfo: parsed.personalInfo,
        fullText: parsed.fullText,
      });
      if (filledCount > 0) {
        setForm((f) => mergeOcrIntoForm(f, fields));
        setOcrAutoFilledCount(filledCount);
        setOcrFillSource(source);
      }
    } catch {
      /* ignore */
    }
  }, [retrievePatientId, fromOcr]);

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const v = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
      setForm((f) => ({ ...f, [key]: v }));
    };
  const guardianSet =
    (key: keyof typeof guardian) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const v = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
      setGuardian((g) => ({ ...g, [key]: v }));
    };
  const buildUploadsPayload = (files: UploadSideLocal[]) => ({
    idType: uploadIdType,
    files: files.map((f) => ({ fileName: f.fileName, fileId: f.fileId ?? null })),
  });

  const buildPhotoPayload = (p: PhotoLocal): ProfilePhotoState => ({
    fileName: p.fileName,
    fileId: p.fileId,
  });

  const buildProfilePayload = (
    files: UploadSideLocal[],
    photoState: PhotoLocal,
  ): PatientCreateRecord => ({
    form: { ...form },
    guardian: { ...guardian },
    uploads: buildUploadsPayload(files),
    photo: buildPhotoPayload(photoState),
  });

  const persistProfileToServer = async (
    ownerId: string,
    files: UploadSideLocal[],
    photoState: PhotoLocal,
  ): Promise<void> => {
    const lastName = form.lastName.trim();
    const firstName = form.firstName.trim();
    if (!lastName || !firstName || !form.birthDate) return;

    const address = [form.street, form.barangay, form.city, form.province, form.region, form.zip]
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join(", ");

    const saved = await savePatientProfile({
      patientId: ownerId,
      firstName,
      lastName,
      middleName: form.noMiddleName ? undefined : form.middleName.trim() || undefined,
      suffix: form.suffix.trim() || undefined,
      birthDate: form.birthDate,
      sex: (form.sex === "MALE" ? "M" : "F") as "M" | "F",
      ageYears: ageYearsResolved(form),
      address: address || undefined,
      contactNumber: form.mobile.trim() || undefined,
      bloodType: form.bloodType,
      registrationNo: form.registrationNo.trim() || undefined,
      profile: buildProfilePayload(files, photoState),
    });
    if (!saved.ok) {
      throw new Error(saved.error ?? "Could not save profile to database.");
    }
  };

  const resolveIdFiles = async (
    ownerId: string | null,
    files: UploadSideLocal[],
  ): Promise<UploadSideLocal[]> => {
    if (!ownerId) return files;
    const next: UploadSideLocal[] = [];
    for (const file of files) {
      if (file.pendingFile) {
        const meta = await uploadPatientIdFile(ownerId, file.pendingFile);
        next.push({
          fileName: file.pendingFile.name,
          fileId: meta.id,
          pendingFile: null,
        });
      } else {
        next.push(file);
      }
    }
    return next;
  };

  const resolveProfilePhoto = async (
    ownerId: string | null,
    current: PhotoLocal,
  ): Promise<PhotoLocal> => {
    if (!ownerId || !current.pendingFile) return current;
    const meta = await uploadPatientProfilePhoto(ownerId, current.pendingFile);
    return {
      fileName: current.pendingFile.name,
      fileId: meta.id,
      pendingFile: null,
    };
  };

  const handlePhotoFile = async (file: File) => {
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setPhoto({ fileName: file.name, fileId: null, pendingFile: file });

    const ownerId = editingPatientId ?? retrievePatientId ?? null;
    if (!ownerId) return;

    setPhotoBusy(true);
    try {
      const meta = await uploadPatientProfilePhoto(ownerId, file);
      const resolved = { fileName: file.name, fileId: meta.id, pendingFile: null };
      setPhoto(resolved);
      await persistProfileToServer(ownerId, idFiles, resolved);
      cachePatientCreateRecord(ownerId, buildProfilePayload(idFiles, resolved));
    } catch (err) {
      setPhoto((p) => ({ ...p, pendingFile: null }));
      window.alert(err instanceof Error ? err.message : "Could not upload profile photo.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleIdFilesSelected = async (fileList: FileList) => {
    const picked = Array.from(fileList);
    if (picked.length === 0) return;

    revokeIdPreviewItems(idPreviewItems);
    setIdPreviewItems([]);
    setIdPreviewOpen(false);
    setUploadsOpen(true);

    setUploadBusy(true);
    try {
      const next: UploadSideLocal[] = [
        ...idFiles,
        ...picked.map((file) => ({
          fileName: file.name,
          fileId: null as number | null,
          pendingFile: file,
        })),
      ];
      setIdFiles(next);
      await syncIdPreview(next);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not upload ID file(s).");
    } finally {
      setUploadBusy(false);
    }
  };

  const syncIdPreview = async (
    files: UploadSideLocal[],
    options?: { singleFileIndex?: number | null },
  ) => {
    revokeIdPreviewItems(idPreviewItems);
    const items = await buildIdPreviewItems(files);
    setIdPreviewItems(items);
    setIdPreviewOpen(items.length > 0);
    if (options && "singleFileIndex" in options) {
      setPreviewFileIndex(options.singleFileIndex ?? null);
    } else if (files.length !== 1) {
      setPreviewFileIndex(null);
    }
  };

  const closeIdPreview = () => {
    revokeIdPreviewItems(idPreviewItems);
    setIdPreviewItems([]);
    setIdPreviewOpen(false);
    setPreviewFileIndex(null);
  };

  const handleViewIdFile = async (index: number) => {
    const file = idFiles[index];
    if (!file?.pendingFile && !file?.fileId) return;

    if (idPreviewOpen && previewFileIndex === index) {
      closeIdPreview();
      return;
    }

    setPreviewBusy(true);
    try {
      await syncIdPreview([file], { singleFileIndex: index });
      setUploadsOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not load ID image.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleRemoveIdFile = (index: number) => {
    if (uploadBusy || queueSubmitting || index < 0 || index >= idFiles.length) return;

    const next = idFiles.filter((_, i) => i !== index);
    setIdFiles(next);

    if (!idPreviewOpen) return;

    if (previewFileIndex === index || next.length === 0) {
      closeIdPreview();
      return;
    }

    if (previewFileIndex != null) {
      const adjusted = previewFileIndex > index ? previewFileIndex - 1 : previewFileIndex;
      const file = next[adjusted];
      if (file) {
        void syncIdPreview([file], { singleFileIndex: adjusted }).catch(() => {
          window.alert("Could not refresh ID preview.");
        });
      }
      return;
    }

    void syncIdPreview(next).catch(() => {
      window.alert("Could not refresh ID preview.");
    });
  };

  const handleSavePatient = async () => {
    if (queueSubmitting) return;
    const lastName = form.lastName.trim();
    const firstName = form.firstName.trim();
    if (!lastName || !firstName || !form.birthDate) {
      window.alert("Last name, first name, and date of birth are required to save.");
      return;
    }
    setQueueSubmitting(true);
    try {
      const address = [form.street, form.barangay, form.city, form.province, form.region, form.zip]
        .map((s) => String(s).trim())
        .filter(Boolean)
        .join(", ");
      let ownerId = editingPatientId ?? retrievePatientId ?? null;
      let resolvedFiles = await resolveIdFiles(ownerId, idFiles);
      setIdFiles(resolvedFiles);

      let resolvedPhoto = await resolveProfilePhoto(ownerId, photo);
      setPhoto(resolvedPhoto);

      const saveParams = {
        firstName,
        lastName,
        middleName: form.noMiddleName ? undefined : form.middleName.trim() || undefined,
        suffix: form.suffix.trim() || undefined,
        birthDate: form.birthDate,
        sex: (form.sex === "MALE" ? "M" : "F") as "M" | "F",
        ageYears: ageYearsResolved(form),
        address: address || undefined,
        contactNumber: form.mobile.trim() || undefined,
        bloodType: form.bloodType,
        registrationNo: form.registrationNo.trim() || undefined,
        profile: buildProfilePayload(resolvedFiles, resolvedPhoto),
      };

      let saved = await savePatientProfile({
        ...saveParams,
        patientId: ownerId ?? undefined,
      });
      if (!saved.ok) {
        if (saved.duplicate && saved.patientId) {
          promptOpenExistingPatientProfile(saved.patientId, navigate, location.state);
          return;
        }
        window.alert(saved.error ?? "Could not save patient.");
        return;
      }

      const finalPatientId = saved.patientId ?? ownerId;
      if (
        finalPatientId &&
        (resolvedFiles.some((f) => f.pendingFile) || resolvedPhoto.pendingFile)
      ) {
        resolvedFiles = await resolveIdFiles(finalPatientId, resolvedFiles);
        setIdFiles(resolvedFiles);
        resolvedPhoto = await resolveProfilePhoto(finalPatientId, resolvedPhoto);
        setPhoto(resolvedPhoto);
        saved = await savePatientProfile({
          ...saveParams,
          patientId: finalPatientId,
          profile: buildProfilePayload(resolvedFiles, resolvedPhoto),
        });
        if (!saved.ok) {
          if (saved.duplicate && saved.patientId) {
            promptOpenExistingPatientProfile(saved.patientId, navigate, location.state);
            return;
          }
          window.alert(saved.error ?? "Patient saved but ID file(s) could not be linked.");
          return;
        }
      }

      const finalId = saved.patientId ?? ownerId ?? retrievePatientId;
      if (finalId) {
        setEditingPatientId(finalId);
        const profile = buildProfilePayload(resolvedFiles, resolvedPhoto);
        cachePatientCreateRecord(finalId, profile);
        const refreshed = await getPatientCreateRecord(finalId);
        if (refreshed.ok) {
          setForm({ ...emptyCreateProfileForm(), ...refreshed.record.form });
          setGuardian({ ...emptyCreateProfileGuardian(), ...refreshed.record.guardian });
          const uploadsToApply = normalizeUploads(profile.uploads);
          setUploadIdType(uploadsToApply.idType);
          setIdFiles(uploadsToApply.files.map((f) => sideFromRecord(f)));
          const photoRec = photoFromRecord(refreshed.record.photo);
          setPhoto(photoRec);
          if (uploadsToApply.files.length > 0) {
            void syncIdPreview(uploadsToApply.files.map((f) => sideFromRecord(f)));
          } else {
            closeIdPreview();
          }
          cachePatientCreateRecord(finalId, {
            ...refreshed.record,
            uploads: uploadsToApply,
            photo: profile.photo ?? refreshed.record.photo,
          });
        }
        if (!retrievePatientId) {
          navigate(`/queue/create-profile/${encodeURIComponent(finalId)}`, {
            replace: true,
            state: location.state,
          });
        }
      }
      clearConsultationOcrResult();
      setOcrDraft(null);
      window.alert("Patient profile saved.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        window.alert(
          "Cannot reach the API server. In the anivax folder run: npm run api:start",
        );
      } else {
        window.alert(msg || "Could not save patient profile. Try again.");
      }
    } finally {
      setQueueSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-white">
      <TopNav user={user} />

      <div className="create-profile-page-body box-border w-full flex-1 px-8 pb-10 pt-6">
        {ocrDraft ? (
          <div className="mb-6 rounded-lg border border-anivax-teal/30 bg-anivax-teal/5 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="m-0 text-sm font-bold text-anivax-ink">Text from your consultation PDF (OCR)</p>
                {ocrAutoFilledCount > 0 ? (
                  <p className="mt-1 mb-0 text-xs font-semibold text-anivax-teal">
                    Personal information auto-filled from your PDF ({ocrAutoFilledCount} field
                    {ocrAutoFilledCount === 1 ? "" : "s"}
                    {ocrFillSource === "structured" ? ", structured extraction" : ""}). Review and edit before
                    saving.
                  </p>
                ) : (
                  <p className="mt-1 mb-0 text-xs font-semibold text-anivax-muted">
                    Could not map OCR text to form fields automatically. Use the extracted text below to fill the
                    form manually.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  clearConsultationOcrResult();
                  setOcrDraft(null);
                  setOcrAutoFilledCount(0);
                  setOcrFillSource(null);
                }}
                className="shrink-0 text-xs font-bold uppercase tracking-wide text-anivax-muted underline-offset-2 hover:text-anivax-ink hover:underline"
              >
                Dismiss
              </button>
            </div>
            {ocrDraft.truncated ? (
              <p className="mt-1 text-[11px] font-semibold text-anivax-danger">Note: stored text was truncated for browser storage limits.</p>
            ) : null}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-anivax-teal">Show / hide extracted text</summary>
              <textarea
                readOnly
                value={ocrDraft.fullText}
                rows={8}
                className="mt-2 box-border w-full resize-y rounded border border-black/10 bg-white px-3 py-2 text-xs font-medium leading-relaxed text-anivax-ink"
              />
            </details>
          </div>
        ) : null}
        <div className="mb-5 flex flex-wrap justify-end gap-4">
          <button
            type="button"
            onClick={() => void handleSavePatient()}
            disabled={queueSubmitting}
            className="flex h-[30px] w-[122px] cursor-pointer items-center justify-center rounded-[4px] border border-[#2F9470] bg-[#3EB487] px-2 text-[10px] leading-none font-extrabold tracking-[0.03em] whitespace-nowrap text-white shadow-[0_2px_6px_rgba(0,0,0,0.22)] transition-[transform,box-shadow,filter,opacity] hover:-translate-y-px hover:brightness-105 hover:shadow-[0_5px_12px_rgba(0,0,0,0.26)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {queueSubmitting ? "SAVING…" : "SAVE"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-[30px] w-[122px] cursor-pointer items-center justify-center rounded-[4px] border border-[#A61F46] bg-anivax-danger px-2 text-[10px] leading-none font-extrabold tracking-[0.03em] whitespace-nowrap text-white shadow-[0_2px_6px_rgba(0,0,0,0.22)] transition-[transform,box-shadow,filter] hover:-translate-y-px hover:brightness-105 hover:shadow-[0_5px_12px_rgba(0,0,0,0.26)] active:translate-y-0"
          >
            CANCEL
          </button>
        </div>

        {recordLoading ? (
          <p className="mb-4 text-center text-sm font-semibold text-anivax-muted">Loading patient record…</p>
        ) : null}

        <section className="relative mt-3.5 box-border rounded-[10px] border-4 border-anivax-teal bg-white px-6 pb-7 pt-5">
          <div className="absolute left-[18px] top-[-16px] z-[2]">
            <SectionTag label="PERSONAL INFORMATION" />
          </div>

          <div className="create-profile-grid grid grid-cols-1 items-start gap-x-6 gap-y-0 min-[1181px]:grid-cols-[minmax(0,1fr)_minmax(230px,280px)] pt-1.5">
            <div className="flex min-w-0 flex-col gap-3.5 pt-1.5">
              <FieldRow>
                <LabeledInput
                  label="PHILHEALTH NO."
                  value={form.philhealthNo}
                  onChange={set("philhealthNo")}
                  className="min-w-0 flex-[1_1_220px] max-w-[420px]"
                />
              </FieldRow>

              <div className="name-grid grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(100px,150px)_minmax(0,1.1fr)_auto] items-end gap-3">
                <LabeledInput label="LAST NAME" required value={form.lastName} onChange={set("lastName")} />
                <LabeledInput label="FIRST NAME" required value={form.firstName} onChange={set("firstName")} />
                <SelectField label="SUFFIX" value={form.suffix} onChange={set("suffix")} options={SUFFIX_OPTIONS} placeholder="Select" />
                <LabeledInput label="MIDDLE NAME" required value={form.middleName} onChange={set("middleName")} disabled={form.noMiddleName} />
                <label className="flex cursor-pointer select-none items-center gap-2 whitespace-nowrap pb-1 text-[11px] font-bold text-black transition-opacity hover:opacity-80">
                  <input
                    type="checkbox"
                    checked={form.noMiddleName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, noMiddleName: e.target.checked, middleName: e.target.checked ? "" : f.middleName }))
                    }
                    className="h-[15px] w-[15px] shrink-0 accent-anivax-teal"
                  />
                  NO MIDDLE NAME
                </label>
              </div>

              <div className="dob-grid grid grid-cols-[180px_100px_153px_180px_minmax(0,1fr)_136px] items-end gap-3">
                <DateOfBirthField
                  label="DATE OF BIRTH"
                  required
                  value={form.birthDate}
                  onChangeIso={(iso) =>
                    setForm((f) => ({ ...f, birthDate: iso, ageYears: calcAge(iso) }))
                  }
                />
                <div>
                  <span className={labelFieldClass}>AGE</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="bday-year"
                    placeholder={calcAge(form.birthDate) || undefined}
                    value={form.ageYears}
                    onChange={set("ageYears")}
                    className={inputFieldClass}
                  />
                </div>
                <SelectField
                  label="SEX"
                  required
                  narrow
                  value={form.sex}
                  onChange={set("sex")}
                  options={["FEMALE", "MALE"]}
                />
                <SelectField
                  label="CIVIL STATUS"
                  required
                  value={form.civilStatus}
                  onChange={set("civilStatus")}
                  options={["SINGLE", "MARRIED", "WIDOWED", "SEPARATED"]}
                />
                <LabeledInput label="PLACE OF BIRTH" required value={form.placeOfBirth} onChange={set("placeOfBirth")} />
                <SelectField
                  label="BLOOD TYPE"
                  narrow
                  value={form.bloodType}
                  onChange={set("bloodType")}
                  options={["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]}
                />
              </div>

              <div className="contact-grid grid grid-cols-5 gap-3">
                <LabeledInput label="MOBILE NUMBER" required value={form.mobile} onChange={set("mobile")} />
                <LabeledInput label="EMAIL ADDRESS" value={form.email} onChange={set("email")} type="email" />
                <SelectField
                  label="RELIGION"
                  value={form.religion}
                  onChange={set("religion")}
                  options={["ROMAN CATHOLIC", "CHRISTIAN", "IGLESIA", "ISLAM", "OTHERS"]}
                  placeholder="Select"
                />
                <LabeledInput label="SC/PWD ID NO." value={form.scPwdId} onChange={set("scPwdId")} />
                <LabeledInput label="TELEPHONE NUMBER" value={form.telephone} onChange={set("telephone")} />
              </div>

              <div className="mt-2.5">
                <span className="mb-3 block text-center text-[15px] font-extrabold tracking-wide text-anivax-teal">
                  ADDRESS
                </span>
                <PhilippineAddressBlock
                  street={form.street}
                  onStreetChange={set("street")}
                  value={{
                    regionCode: form.regionCode,
                    region: form.region,
                    provinceCode: form.provinceCode,
                    province: form.province,
                    municipalityCode: form.municipalityCode,
                    city: form.city,
                    barangayCode: form.barangayCode,
                    barangay: form.barangay,
                    zip: form.zip,
                  }}
                  onChange={(ph) => setForm((f) => ({ ...f, ...ph }))}
                />
              </div>
            </div>

          <aside className="create-profile-biometrics box-border flex w-full min-w-0 flex-col items-stretch pt-1.5 min-[1181px]:mt-[33px]">
            <LabeledInput
              label="REGISTRATION NUMBER"
              value={form.registrationNo}
              onChange={set("registrationNo")}
              className="mb-3.5 w-full"
            />

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void handlePhotoFile(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoBusy || queueSubmitting}
              className={`mx-auto mb-4 box-border flex h-[150px] w-[150px] flex-col items-center justify-center overflow-hidden rounded-lg border border-black transition-[transform,box-shadow] hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${
                photoPreview ? "p-0" : "bg-transparent p-0"
              }`}
              aria-label="Add photo"
            >
              {photoPreview ? (
                <img src={photoPreview} alt="" className="h-full w-full rounded-md object-cover" />
              ) : (
                <img
                  src="/images/ADD%20PHOTO.svg"
                  alt="Click to add photo or drag and drop image"
                  className="h-full w-full object-cover object-center"
                  draggable={false}
                />
              )}
            </button>

            <button
              type="button"
              className="mb-2.5 flex h-[35px] w-full cursor-pointer items-center justify-between gap-2 rounded border-none bg-anivax-teal px-3 text-white shadow-anivax-elevated transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
            >
              <span className="flex-1 text-left text-[11px] font-bold tracking-wide">BIOMETRICS ENROLLMENT</span>
              <span className="flex gap-1.5" aria-hidden="true">
                <FingerprintIcon />
                <QrIcon />
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const draftPatientId = editingPatientId ?? retrievePatientId ?? undefined;
                try {
                  sessionStorage.setItem(
                    SCHEDULE_APPOINTMENT_DRAFT_KEY,
                    JSON.stringify({
                      form,
                      ageDisplay: ageDisplayString(form),
                      patientId: draftPatientId,
                    }),
                  );
                } catch {
                  window.alert("Could not continue to scheduling. Try again.");
                  return;
                }
                navigate("/queue/schedule-appointment");
              }}
              disabled={queueSubmitting}
              className="flex h-[35px] w-full cursor-pointer items-center justify-start rounded border-none bg-anivax-records-coral px-3 text-white shadow-anivax-elevated transition-[transform,box-shadow,opacity] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-left text-[11px] font-bold tracking-wide">SCHEDULE AN APPOINTMENT</span>
            </button>
          </aside>
          </div>
        </section>

        <AccordionCard title="UPLOADS" open={uploadsOpen} onToggle={() => setUploadsOpen((o) => !o)} className="mt-5">
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              const list = e.target.files;
              if (!list?.length) return;
              void handleIdFilesSelected(list);
              e.target.value = "";
            }}
          />
          <div className="flex flex-col gap-4">
            <div className="w-full max-w-[320px]">
              <span className="mb-1.5 block text-[11px] font-bold tracking-wide text-anivax-muted">
                CHOOSE VALID ID
              </span>
              <div className="relative">
                <select
                  value={uploadIdType}
                  onChange={(e) => setUploadIdType(e.target.value)}
                  className={`${inputFieldClass} h-[25px] w-full cursor-pointer appearance-none bg-anivax-page pr-7 font-medium transition-shadow hover:shadow-sm`}
                >
                  <option value="">Select</option>
                  <option value="PHILHEALTH ID">PHILHEALTH ID</option>
                  <option value="NATIONAL ID">NATIONAL ID</option>
                  <option value="DRIVER'S LICENSE">DRIVER'S LICENSE</option>
                  <option value="PASSPORT">PASSPORT</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1.5 h-5 w-5 shrink-0 text-anivax-ink" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadBusy || queueSubmitting}
                className="h-[25px] min-w-[109px] cursor-pointer rounded border border-anivax-success-title bg-anivax-success-title px-3.5 text-[11px] font-extrabold tracking-wide text-white shadow-anivax-elevated transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadBusy ? "UPLOADING…" : "UPLOAD FILE"}
              </button>
            </div>

            <p className="m-0 text-[11px] font-semibold text-anivax-muted">
              Pick one or more ID images. Use View to preview. Remove updates the list; click Save to keep changes.
            </p>

            {idFiles.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {idFiles.map((file, index) => (
                  <li
                    key={idFileKey(file, index)}
                    className="flex items-center justify-between gap-3 rounded border border-black/10 bg-white px-3 py-2 shadow-sm"
                  >
                    <span className="min-w-0 truncate text-[11px] font-semibold text-anivax-ink">
                      {file.fileName}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleViewIdFile(index)}
                        disabled={
                          uploadBusy ||
                          previewBusy ||
                          queueSubmitting ||
                          (!file.pendingFile && !file.fileId)
                        }
                        className="cursor-pointer rounded border border-anivax-teal bg-white px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide text-anivax-admin-teal transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {idPreviewOpen && previewFileIndex === index ? "HIDE" : "VIEW"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveIdFile(index)}
                        disabled={uploadBusy || queueSubmitting}
                        className="cursor-pointer rounded border border-anivax-danger bg-white px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide text-anivax-danger transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        REMOVE
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {idPreviewOpen && idPreviewItems.length > 0 ? (
              <div className="max-h-[min(480px,55vh)] overflow-y-auto rounded border border-black/10 bg-white p-3 shadow-inner">
                <div className="flex flex-col gap-6">
                  {idPreviewItems.map((item, index) => (
                    <IdPreviewPanel key={`${item.fileName}-${index}`} item={item} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </AccordionCard>
        <AccordionCard
          title="PARENT/GUARDIAN"
          open={guardianOpen}
          onToggle={() => setGuardianOpen((o) => !o)}
          className="mt-4"
        >
          <div className="flex flex-col gap-3.5 pt-1">
            <div className="guardian-name-grid grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(100px,150px)_minmax(0,1.1fr)_auto] items-end gap-3">
              <LabeledInput label="LAST NAME" value={guardian.lastName} onChange={guardianSet("lastName")} />
              <LabeledInput
                label="FIRST NAME"
                value={guardian.firstName}
                onChange={guardianSet("firstName")}
              />
              <SelectField
                label="SUFFIX"
                value={guardian.suffix}
                onChange={guardianSet("suffix")}
                options={SUFFIX_OPTIONS}
                placeholder="Select"
              />
              <LabeledInput
                label="MIDDLE NAME"
                value={guardian.middleName}
                onChange={guardianSet("middleName")}
                disabled={guardian.noMiddleName}
              />
              <label className="flex cursor-pointer select-none items-center gap-2 whitespace-nowrap pb-1 text-[11px] font-bold text-black transition-opacity hover:opacity-80">
                <input
                  type="checkbox"
                  checked={guardian.noMiddleName}
                  onChange={(e) =>
                    setGuardian((g) => ({
                      ...g,
                      noMiddleName: e.target.checked,
                      middleName: e.target.checked ? "" : g.middleName,
                    }))
                  }
                  className="h-[15px] w-[15px] shrink-0 accent-anivax-teal"
                />
                NO MIDDLE NAME
              </label>
            </div>

            <div className="guardian-bio-grid grid grid-cols-[180px_100px_153px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3">
              <DateOfBirthField
                label="DATE OF BIRTH"
                value={guardian.birthDate}
                onChangeIso={(iso) =>
                  setGuardian((g) => ({ ...g, birthDate: iso, ageYears: calcAge(iso) }))
                }
              />
              <div>
                <span className={labelFieldClass}>AGE</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={calcAge(guardian.birthDate) || undefined}
                  value={guardian.ageYears}
                  onChange={guardianSet("ageYears")}
                  className={inputFieldClass}
                />
              </div>
              <SelectField
                label="SEX"
                required
                narrow
                value={guardian.sex}
                onChange={guardianSet("sex")}
                options={["FEMALE", "MALE"]}
              />
              <SelectField
                label="RELATIONSHIP WITH THE PATIENT"
                value={guardian.relationship}
                onChange={guardianSet("relationship")}
                options={["MOTHER", "FATHER", "GUARDIAN", "GRANDPARENT", "SIBLING", "OTHER"]}
              />
              <LabeledInput label="MOBILE NUMBER" value={guardian.mobile} onChange={guardianSet("mobile")} />
              <LabeledInput label="EMAIL ADDRESS" value={guardian.email} onChange={guardianSet("email")} type="email" />
            </div>

            <LabeledInput label="PLACE OF BIRTH" value={guardian.placeOfBirth} onChange={guardianSet("placeOfBirth")} />

            <div className="mt-1">
              <span className="mb-3 block text-center text-[15px] font-extrabold tracking-wide text-anivax-teal">
                ADDRESS
              </span>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11px] font-bold text-black transition-opacity hover:opacity-80">
                <input
                  type="checkbox"
                  checked={guardian.similarAddress}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setGuardian((g) => {
                      if (!checked) return { ...g, similarAddress: false };
                      return {
                        ...g,
                        similarAddress: true,
                        street: form.street,
                        regionCode: form.regionCode,
                        region: form.region,
                        provinceCode: form.provinceCode,
                        province: form.province,
                        municipalityCode: form.municipalityCode,
                        city: form.city,
                        barangayCode: form.barangayCode,
                        barangay: form.barangay,
                        zip: form.zip,
                      };
                    });
                  }}
                  className="h-[15px] w-[15px] accent-anivax-teal"
                />
                SIMILAR ADDRESS TO THE PATIENT
              </label>
              <div className={guardian.similarAddress ? "pointer-events-none opacity-60" : undefined}>
                <PhilippineAddressBlock
                  street={guardian.street}
                  onStreetChange={guardianSet("street")}
                  value={{
                    regionCode: guardian.regionCode,
                    region: guardian.region,
                    provinceCode: guardian.provinceCode,
                    province: guardian.province,
                    municipalityCode: guardian.municipalityCode,
                    city: guardian.city,
                    barangayCode: guardian.barangayCode,
                    barangay: guardian.barangay,
                    zip: guardian.zip,
                  }}
                  onChange={(ph) => setGuardian((g) => ({ ...g, ...ph }))}
                />
              </div>
            </div>
          </div>
        </AccordionCard>
      </div>

    </main>
  );
}

function LabeledModalField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold text-[#333]">
        {label}
        {required ? <span className="ml-0.5 text-anivax-danger">*</span> : null}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="h-8 rounded border border-[#d5d5d5] bg-white px-2 text-[11px] font-medium transition-[border-color,box-shadow] hover:border-anivax-teal hover:shadow-sm focus:border-anivax-teal focus:ring-1 focus:ring-anivax-teal/30 disabled:bg-[#f1f1f1]"
      />
    </label>
  );
}

function YesNoField({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: boolean | null;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-bold text-[#333]">
        {label}
        {required ? <span className="ml-0.5 text-anivax-danger">*</span> : null}
      </span>
      <div className="flex h-8 items-center gap-4 rounded border border-[#d5d5d5] bg-white px-2">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#333]">
          <input
            type="checkbox"
            checked={value === true}
            onChange={() => onChange(true)}
            className="h-3.5 w-3.5 accent-anivax-teal"
          />
          YES
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#333]">
          <input
            type="checkbox"
            checked={value === false}
            onChange={() => onChange(false)}
            className="h-3.5 w-3.5 accent-anivax-teal"
          />
          NO
        </label>
      </div>
    </div>
  );
}

function IdPreviewPanel({ item }: { item: IdPreviewItem }) {
  const isImage = item.mime.startsWith("image/");
  const isPdf = item.mime === "application/pdf" || item.fileName.toLowerCase().endsWith(".pdf");

  return (
    <div className="flex flex-col gap-2">
      <span className="truncate text-[11px] font-semibold text-anivax-muted">{item.fileName}</span>
      {isImage ? (
        <img
          src={item.url}
          alt="Valid ID"
          className="mx-auto max-h-[min(360px,45vh)] w-auto max-w-full rounded border border-black/10 object-contain"
        />
      ) : isPdf ? (
        <iframe
          title="ID preview"
          src={item.url}
          className="h-[min(360px,45vh)] w-full rounded border border-black/10 bg-white"
        />
      ) : (
        <a
          href={item.url}
          download={item.fileName}
          className="text-[11px] font-bold text-anivax-teal underline"
        >
          Download file
        </a>
      )}
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-4">{children}</div>;
}

function LabeledInput({
  label,
  value,
  onChange,
  required,
  type = "text",
  disabled,
  placeholder,
  className: wrapClass,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={wrapClass ? `min-w-0 ${wrapClass}` : "min-w-0"}>
      <span className={labelFieldClass}>
        {label}
        {required ? <span className="ml-1 text-anivax-danger">*</span> : null}
      </span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`${inputFieldClass} ${disabled ? "opacity-60" : ""}`}
      />
    </div>
  );
}

function DateOfBirthField({
  label,
  value,
  onChangeIso,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChangeIso: (iso: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0">
      <span className={labelFieldClass}>
        {label}
        {required ? <span className="ml-1 text-anivax-danger">*</span> : null}
      </span>
      <div className="mt-1 h-[32px] overflow-hidden rounded border border-anivax-registry-upload-bg bg-white min-[1180px]:h-[36px]">
        <VaccinationM3DatePickerField
          dateIso={value}
          onChange={onChangeIso}
          dense
          disabled={disabled}
          yearRangePast={120}
          yearRangeFuture={0}
        />
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  narrow,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
  required?: boolean;
  narrow?: boolean;
  placeholder?: string;
}) {
  return (
    <div className={narrow ? "min-w-[120px]" : "min-w-0"}>
      <span className={labelFieldClass}>
        {label}
        {required ? <span className="ml-1 text-anivax-danger">*</span> : null}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={onChange}
          className={`${inputFieldClass} h-[25px] w-full cursor-pointer appearance-none pr-7 transition-shadow hover:shadow-sm`}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o || "empty"} value={o}>
              {o || "—"}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1.5 h-5 w-5" />
      </div>
    </div>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={className ?? "h-5 w-5 shrink-0 text-anivax-ink"}
      aria-hidden="true"
    >
      <path d="M5 7l5 6 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <img
      src="/images/Finger%20Print.svg"
      alt=""
      aria-hidden="true"
      className="h-[19px] w-5 object-contain"
    />
  );
}

function QrIcon() {
  return (
    <img src="/images/QRCODE.svg" alt="" aria-hidden="true" className="h-6 w-6 object-contain" />
  );
}

