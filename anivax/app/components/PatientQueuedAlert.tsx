import { useEffect } from "react";

export default function PatientQueuedAlert({
  open,
  onClose,
  title = "PATIENT QUEUED",
  titleClassName = "text-anivax-success-title",
  autoCloseMs = 1500,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  titleClassName?: string;
  autoCloseMs?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    const id = window.setTimeout(onClose, autoCloseMs);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open, onClose, autoCloseMs]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[1300] box-border flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-3 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="box-border flex h-[419px] w-[730px] max-h-[calc(100vh-24px)] max-w-[calc(100vw-24px)] flex-col items-center justify-start rounded-[10px] border-4 border-anivax-green-ring bg-white pt-[98px] transition-transform duration-200 hover:scale-[1.01]"
      >
        <svg width="150" height="150" viewBox="0 0 150 150" fill="none" aria-hidden="true">
          <circle cx="75" cy="75" r="56.25" stroke="#21A89F" strokeWidth="10" />
          <path d="M58 76.5l13.5 13.5L92 68.5" stroke="#21A89F" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className={`mt-10 text-center text-[39px] font-bold leading-none tracking-wide ${titleClassName}`}>{title}</h2>
      </div>
    </div>
  );
}
