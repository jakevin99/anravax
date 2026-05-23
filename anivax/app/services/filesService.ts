import { getApiBaseUrl, rawFetch } from "./apiClient";

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  }
}

export type UploadedFileMeta = {
  id: number;
  ownerPatientId?: string | null;
  kind: string;
  mime: string;
  bytes: number;
  createdAt?: string;
};

async function uploadPatientFile(
  patientId: string,
  file: File,
  kind: string,
): Promise<UploadedFileMeta> {
  const body = new FormData();
  body.append("file", file);
  body.append("kind", kind);
  body.append("ownerPatientId", patientId);

  const res = await rawFetch("/files", { method: "POST", body });
  const json = await readJson<{ data?: UploadedFileMeta; error?: string }>(res);
  if (!res.ok) {
    throw new Error(json.error ?? `Upload failed (${res.status})`);
  }
  if (!json.data?.id) {
    throw new Error("Invalid upload response from server.");
  }
  return json.data;
}

/** Upload a valid ID document for a patient (`POST /api/v1/files`, kind `ID_CARD`). */
export async function uploadPatientIdFile(
  patientId: string,
  file: File,
): Promise<UploadedFileMeta> {
  return uploadPatientFile(patientId, file, "ID_CARD");
}

/** Upload a profile portrait (`POST /api/v1/files`, kind `PROFILE_PHOTO` or `OTHER`). */
export async function uploadPatientProfilePhoto(
  patientId: string,
  file: File,
): Promise<UploadedFileMeta> {
  try {
    return await uploadPatientFile(patientId, file, "PROFILE_PHOTO");
  } catch (first) {
    const msg = first instanceof Error ? first.message : "";
    if (!/invalid kind/i.test(msg)) throw first;
    return uploadPatientFile(patientId, file, "OTHER");
  }
}

/** Fetch a stored file as a blob (`GET /api/v1/files/:id`). */
export async function fetchStoredPatientFile(fileId: number): Promise<Blob> {
  const res = await rawFetch(`/files/${fileId}`);
  if (!res.ok) {
    const json = await readJson<{ error?: string }>(res).catch(() => ({}));
    throw new Error(
      (json as { error?: string }).error ?? `Could not retrieve file (HTTP ${res.status})`,
    );
  }
  return res.blob();
}

/** Download or open a stored file (`GET /api/v1/files/:id`). */
export async function openStoredPatientFile(
  fileId: number,
  fileName?: string,
): Promise<void> {
  const blob = await fetchStoredPatientFile(fileId);
  const url = URL.createObjectURL(blob);
  const name = fileName?.trim() || "valid-id";

  if (blob.type.startsWith("image/") || blob.type === "application/pdf") {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function patientFileDownloadUrl(fileId: number): string {
  return `${getApiBaseUrl()}/files/${fileId}`;
}
