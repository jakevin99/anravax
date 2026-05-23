import type { NavigateFunction } from "react-router";

/** When save returns 409 duplicate identity, offer to open the existing profile. */
export function promptOpenExistingPatientProfile(
  existingPatientId: string,
  navigate: NavigateFunction,
  state?: unknown,
): void {
  const open = window.confirm(
    "A patient profile already exists with this name and date of birth.\n\nOpen that profile instead of creating a duplicate?",
  );
  if (!open) return;
  navigate(`/queue/create-profile/${encodeURIComponent(existingPatientId)}`, {
    replace: true,
    state,
  });
}
