/** Client-side mirrors of `server/services/entityIds.js` patterns. */

export const USER_PUBLIC_ID_RE = /^u_[A-Za-z0-9]{6}$/;
export const PATIENT_ID_RE = /^p_[A-Za-z0-9]{12}$/;

export function isUserPublicId(value: string): boolean {
  return USER_PUBLIC_ID_RE.test(value.trim());
}

export function isPatientId(value: string): boolean {
  return PATIENT_ID_RE.test(value.trim());
}
