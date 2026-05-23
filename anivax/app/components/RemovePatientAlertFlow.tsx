import { useEffect, type ReactNode } from "react";

export type RemovePatientAlertPhase = "confirm" | "success" | "canceled";

export type RemovePatientAlertVariant = "queue" | "registry" | "recyclePermanent";

interface RemovePatientAlertFlowProps {
  phase: RemovePatientAlertPhase | null;
  busy?: boolean;
  variant?: RemovePatientAlertVariant;
  /** Shown in registry (admin) delete — e.g. "CRUZ, MIGUEL" */
  patientName?: string;
  /** Shown in registry delete — e.g. p_a1b2c3d4e5f6 */
  patientId?: string;
  /** Days before automatic permanent purge (admin recycle bin). */
  recycleRetentionDays?: number;
  onConfirmYes: () => void;
  onConfirmNo: () => void;
  onDismissResult: () => void;
}

/**
 * Queue gear → Remove Patient: confirm (YES/NO), then success or canceled overlay.
 */
export default function RemovePatientAlertFlow({
  phase,
  busy = false,
  variant = "queue",
  patientName,
  patientId,
  recycleRetentionDays = 30,
  onConfirmYes,
  onConfirmNo,
  onDismissResult,
}: RemovePatientAlertFlowProps) {
  if (!phase) return null;

  if (phase === "confirm") {
    return (
      <RemovePatientConfirmDialog
        busy={busy}
        variant={variant}
        patientName={patientName}
        patientId={patientId}
        recycleRetentionDays={recycleRetentionDays}
        onYes={onConfirmYes}
        onNo={onConfirmNo}
      />
    );
  }

  if (phase === "success") {
    return (
      <RemovePatientResultOverlay
        title={
          variant === "registry" ? (
            <>
              Patient moved to
              <br />
              Recycle Bin
            </>
          ) : variant === "recyclePermanent" ? (
            <>
              Patient permanently
              <br />
              deleted
            </>
          ) : (
            <>
              Queued Patient has been
              <br />
              removed
            </>
          )
        }
        icon="success"
        onDismiss={onDismissResult}
      />
    );
  }

  return (
    <RemovePatientResultOverlay
      title="ACTIONS CANCELED"
      icon="canceled"
      onDismiss={onDismissResult}
    />
  );
}

function RemovePatientConfirmDialog({
  busy,
  variant,
  patientName,
  patientId,
  recycleRetentionDays,
  onYes,
  onNo,
}: {
  busy: boolean;
  variant: RemovePatientAlertVariant;
  patientName?: string;
  patientId?: string;
  recycleRetentionDays: number;
  onYes: () => void;
  onNo: () => void;
}) {
  const isRegistry = variant === "registry";
  const isPermanent = variant === "recyclePermanent";
  const summary =
    patientName && patientId
      ? `${patientName} (${patientId})`
      : patientName || patientId || "this patient";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onNo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNo, busy]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="remove-patient-confirm-title"
      className="fixed inset-0 z-[1150] flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-4 backdrop-blur-[2px]"
      onClick={() => {
        if (!busy) onNo();
      }}
    >
      <div className="relative w-full max-w-[520px] px-2">
        <span className="mb-1 block pl-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-anivax-muted">
          Alert
        </span>
        <div
          onClick={(e) => e.stopPropagation()}
          className={`box-border flex flex-col items-center rounded-[10px] border-4 bg-white px-6 py-9 text-center shadow-anivax-card min-[480px]:px-10 min-[480px]:py-10 ${
            isRegistry || isPermanent
              ? "border-anivax-danger max-w-[520px]"
              : "border-anivax-teal"
          }`}
        >
          <AlertExclamationIcon />
          <h2
            id="remove-patient-confirm-title"
            className={`mt-5 max-w-[400px] text-[15px] font-extrabold leading-snug min-[480px]:text-lg ${
              isRegistry || isPermanent ? "text-anivax-danger" : "text-anivax-teal"
            }`}
          >
            {isPermanent
              ? "Permanently delete now?"
              : isRegistry
                ? "Move this patient to the Recycle Bin?"
                : "Are you sure you want to remove patient?"}
          </h2>
          {isPermanent ? (
            <div className="mt-4 max-w-[420px] space-y-3 text-left text-[13px] leading-relaxed text-anivax-body min-[480px]:text-sm">
              <p className="m-0 font-semibold text-anivax-ink">
                You are about to permanently erase{" "}
                <span className="text-anivax-danger">{summary}</span>.
              </p>
              <p className="m-0">
                This bypasses the {recycleRetentionDays}-day waiting period. All profile data,
                clinical history, and uploads will be destroyed immediately and{" "}
                <strong className="text-anivax-danger">cannot be recovered</strong>.
              </p>
            </div>
          ) : null}
          {isRegistry ? (
            <div className="mt-4 max-w-[420px] space-y-3 text-left text-[13px] leading-relaxed text-anivax-body min-[480px]:text-sm">
              <p className="m-0 font-semibold text-anivax-ink">
                <span className="text-anivax-danger">{summary}</span> will be removed from the
                active patient list and staff will not be able to retrieve this record from the
                registry.
              </p>
              <p className="m-0">
                The record is <strong>not erased immediately</strong>. It is stored in the{" "}
                <strong>Recycle Bin</strong> for <strong>{recycleRetentionDays} days</strong>, where
                an administrator can restore it if needed.
              </p>
              <p className="m-0">
                After {recycleRetentionDays} days, the system will{" "}
                <strong className="text-anivax-danger">permanently delete</strong> the profile,
                consultation history, vaccination records, queue visits, and uploaded documents.
                That final step cannot be undone.
              </p>
            </div>
          ) : null}
          <div className="mt-7 flex flex-wrap justify-center gap-3 min-[480px]:mt-8 min-[480px]:gap-4">
            <button
              type="button"
              disabled={busy}
              onClick={onYes}
              className="h-9 min-w-[100px] cursor-pointer rounded-md border-none bg-anivax-danger px-6 text-[12px] font-bold tracking-wide text-white shadow-anivax-btn transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 min-[480px]:h-10 min-[480px]:min-w-[110px] min-[480px]:text-sm"
            >
              {busy
                ? isPermanent
                  ? "Deleting…"
                  : "Moving…"
                : isPermanent
                  ? "DELETE FOREVER"
                  : isRegistry
                    ? "MOVE TO RECYCLE BIN"
                    : "YES"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onNo}
              className="h-9 min-w-[100px] cursor-pointer rounded-md border-none bg-anivax-teal px-6 text-[12px] font-bold tracking-wide text-white shadow-anivax-btn transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 min-[480px]:h-10 min-[480px]:min-w-[110px] min-[480px]:text-sm"
            >
              NO
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RemovePatientResultOverlay({
  title,
  icon,
  onDismiss,
}: {
  title: ReactNode;
  icon: "success" | "canceled";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 2200);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[1160] flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-4 backdrop-blur-[2px]"
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="box-border flex w-full max-w-[480px] flex-col items-center gap-5 rounded-lg border-2 border-anivax-teal bg-white px-8 py-10 shadow-anivax-card"
      >
        {icon === "canceled" ? <AlertCanceledIcon /> : <AlertExclamationIcon />}
        <h2 className="m-0 text-center text-xl font-extrabold leading-snug tracking-wide text-anivax-ink min-[480px]:text-[26px]">
          {title}
        </h2>
      </div>
    </div>
  );
}

function AlertExclamationIcon() {
  return (
    <div
      className="flex h-[80px] w-[80px] items-center justify-center rounded-full border-[5px] border-anivax-danger bg-white text-[40px] font-bold leading-none text-anivax-danger min-[480px]:h-[88px] min-[480px]:w-[88px] min-[480px]:text-[46px]"
      aria-hidden="true"
    >
      !
    </div>
  );
}

function AlertCanceledIcon() {
  return (
    <div
      className="flex h-[80px] w-[80px] items-center justify-center rounded-full border-[5px] border-anivax-danger bg-white text-[44px] font-bold leading-none text-anivax-danger min-[480px]:h-[88px] min-[480px]:w-[88px]"
      aria-hidden="true"
    >
      ×
    </div>
  );
}
