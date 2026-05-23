import { useEffect } from "react";

/**
 * Success notification dialog modeled after the Figma "MODAL-2" frame.
 * Shows a bold green checkmark and a CHANGES SAVED title on a centred
 * white card with a teal border. Auto-dismisses after a short delay;
 * also closes on Escape, Enter, or backdrop click.
 */

interface SuccessAlertProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  /** Time before the dialog dismisses itself. Set to 0 to disable. */
  autoDismissMs?: number;
}

export default function SuccessAlert({
  open,
  title = "CHANGES SAVED",
  onClose,
  autoDismissMs = 1600,
}: SuccessAlertProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !autoDismissMs) return;
    const id = window.setTimeout(onClose, autoDismissMs);
    return () => window.clearTimeout(id);
  }, [open, autoDismissMs, onClose]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-[rgb(217_217_217/0.45)] backdrop-blur-[2px] transition-opacity duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="box-border flex max-h-[90vh] w-[520px] max-w-[calc(100vw-32px)] flex-col items-center gap-5 rounded border-2 border-anivax-green-border bg-white px-8 py-10 shadow-anivax-card transition-shadow duration-200 hover:shadow-xl"
      >
        <CheckCircleIcon />

        <h2 className="m-0 text-center text-[28px] font-extrabold tracking-wide text-anivax-success-title">
          {title}
        </h2>
      </div>
    </div>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      width="132"
      height="132"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className="text-anivax-green-ring"
    >
      <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="6" fill="none" />
      <path
        d="M20 33l8.5 8.5L44 24"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
