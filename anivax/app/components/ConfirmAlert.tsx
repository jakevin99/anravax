import { useEffect, type ReactNode } from "react";

/**
 * Generic confirmation dialog used to gate destructive or otherwise
 * irreversible actions. Callers control `open`, labels, and handlers.
 */

interface ConfirmAlertProps {
  open: boolean;
  title?: string;
  icon?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Disables both buttons (e.g. while the save request is in flight). */
  busy?: boolean;
}

export default function ConfirmAlert({
  open,
  title = "SAVE CHANGES?",
  icon = <HeartIcon />,
  confirmLabel = "SAVE",
  cancelLabel = "CANCEL",
  onCancel,
  onConfirm,
  busy = false,
}: ConfirmAlertProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-[rgb(217_217_217/0.45)] backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="box-border flex w-[480px] max-w-[calc(100vw-32px)] flex-col items-center gap-4 rounded border-2 border-anivax-green-border bg-white px-8 pb-8 pt-9 shadow-anivax-card"
      >
        <div className="flex h-[120px] w-[120px] items-center justify-center">{icon}</div>

        <h2 className="m-0 text-center text-[28px] font-extrabold tracking-wide text-anivax-teal">
          {title}
        </h2>

        <div className="mt-2 flex gap-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-w-24 h-10 cursor-pointer rounded-lg border border-anivax-body bg-anivax-danger px-5 text-sm font-bold tracking-wide text-white shadow-md transition-[transform,box-shadow,opacity] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-w-24 h-10 cursor-pointer rounded-lg border border-anivax-body bg-anivax-teal px-5 text-sm font-bold tracking-wide text-white shadow-md transition-[transform,box-shadow,opacity] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function HeartIcon() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className="text-anivax-danger"
    >
      <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="6" fill="none" />
      <line
        x1="32"
        y1="18"
        x2="32"
        y2="36"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="32" cy="46" r="3.5" fill="currentColor" />
    </svg>
  );
}
