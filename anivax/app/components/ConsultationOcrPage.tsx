import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { getCurrentUser, persistConsultationOcrResult, postOcrFile } from "../services/queueService";
import type { AuthUser } from "../types/domain";
import TopNav from "./TopNav";

export type ConsultationOcrLocationState = {
  file: File;
  fileName: string;
  fileSize: number;
};

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(1)} KB`;
}

function formatStamp(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * After PDF upload from new consultation: sends the file to `POST /api/v1/ocr` (Mistral when configured on the server, else OCR.space),
 * then a short “extracting” beat for UI continuity before the completion screen.
 */
export default function ConsultationOcrPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ConsultationOcrLocationState | null;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [phase, setPhase] = useState<"uploading" | "ocr" | "extracting" | "complete" | "error">("uploading");
  const [uploadPct, setUploadPct] = useState(0);
  const [ocrDone, setOcrDone] = useState(false);
  const [extractDone, setExtractDone] = useState(false);
  const [timestamps, setTimestamps] = useState<{ upload: Date; ocr: Date; extract: Date } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [ocrPreview, setOcrPreview] = useState<string | null>(null);
  const [pipelineAttempt, setPipelineAttempt] = useState(0);

  const fileName = state?.fileName ?? "document.pdf";
  const fileSize = state?.fileSize ?? 0;

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  useEffect(() => {
    if (!state?.file) {
      navigate("/queue/new-consultation", { replace: true });
    }
  }, [navigate, state?.file]);

  useEffect(() => {
    if (!state?.file) return;
    let cancelled = false;
    let intervalId = 0;

    const run = async () => {
      setErrorMessage("");
      setOcrPreview(null);
      setPhase("uploading");
      setUploadPct(0);
      setOcrDone(false);
      setExtractDone(false);
      const uploadStamp = new Date();
      setTimestamps({ upload: uploadStamp, ocr: uploadStamp, extract: uploadStamp });

      intervalId = window.setInterval(() => {
        setUploadPct((p) => (p >= 99 ? 99 : p + 6));
      }, 160);

      try {
        const data = await postOcrFile(state.file);
        if (cancelled) return;
        window.clearInterval(intervalId);
        intervalId = 0;
        setUploadPct(100);
        setPhase("ocr");
        setOcrDone(true);
        setTimestamps((prev) =>
          prev ? { ...prev, ocr: new Date() } : { upload: uploadStamp, ocr: new Date(), extract: uploadStamp },
        );
        persistConsultationOcrResult(data);
        const full = data.fullText ?? "";
        const preview = full.slice(0, 1200);
        setOcrPreview(preview.length < full.length ? `${preview}…` : preview || "(No text detected in this file.)");

        await new Promise((r) => window.setTimeout(r, 380));
        if (cancelled) return;

        setPhase("extracting");
        setTimestamps((prev) => (prev ? { ...prev, extract: new Date() } : null));

        await new Promise((r) => window.setTimeout(r, 450));
        if (cancelled) return;

        setExtractDone(true);
        setPhase("complete");
        setTimestamps((prev) =>
          prev ? { ...prev, extract: new Date() } : { upload: uploadStamp, ocr: new Date(), extract: new Date() },
        );
      } catch (e) {
        if (intervalId) window.clearInterval(intervalId);
        intervalId = 0;
        if (cancelled) return;
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [state?.file, pipelineAttempt]);

  const displayUploadPct = useMemo(() => {
    if (phase === "uploading") return uploadPct;
    return 100;
  }, [phase, uploadPct]);

  const bannerPct = useMemo(() => {
    if (phase === "uploading") return displayUploadPct;
    if (phase === "ocr") return 72;
    if (phase === "extracting") return 92;
    if (phase === "error") return displayUploadPct;
    return 100;
  }, [phase, displayUploadPct]);

  const handleUseInformation = () => {
    navigate("/queue/create-profile", { replace: false, state: { fromOcr: true } });
  };

  if (!state?.file) {
    return null;
  }

  return (
    <main className="flex min-h-screen w-full flex-col bg-anivax-page">
      <TopNav user={user} />

      <div className="box-border flex w-full flex-1 flex-col items-center px-4 py-8 min-[1180px]:px-8 min-[1180px]:py-10">
        {phase === "error" ? (
          <div className="w-full max-w-[560px] rounded-xl border border-black/10 bg-white px-6 py-8 shadow-[4px_4px_4px_rgb(0_0_0/0.12)] min-[1180px]:max-w-[640px] min-[1180px]:px-10 min-[1180px]:py-10">
            <h1 className="m-0 text-center text-xl font-bold text-anivax-danger min-[1180px]:text-2xl">OCR failed</h1>
            <p className="mx-auto mt-3 max-w-[480px] text-center text-sm font-medium text-anivax-muted min-[1180px]:text-base">
              {errorMessage || "Something went wrong while processing your file."}
            </p>
            <p className="mx-auto mt-2 max-w-[480px] text-center text-xs text-anivax-muted">
              Ensure the API server is running (`npm run api:start`). For Mistral OCR, set <code className="text-sm">MISTRAL_API_KEY</code> in the
              server <code className="text-sm">.env</code> (see <code className="text-sm">.env.example</code>). Otherwise configure OCR.space (
              <code className="text-sm">OCR_SPACE_API_KEY</code>).
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setPipelineAttempt((n) => n + 1)}
                className="rounded-md border-none bg-anivax-teal px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:brightness-105"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => navigate("/queue/new-consultation")}
                className="rounded-md border border-black/20 bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-anivax-ink transition hover:bg-black/3"
              >
                Upload another file
              </button>
            </div>
          </div>
        ) : phase !== "complete" ? (
          <div className="w-full max-w-[560px] rounded-xl border border-black/10 bg-white px-6 py-8 shadow-[4px_4px_4px_rgb(0_0_0/0.12)] min-[1180px]:max-w-[640px] min-[1180px]:px-10 min-[1180px]:py-10">
            <h1 className="m-0 text-center text-xl font-bold text-[#1a2b4a] min-[1180px]:text-2xl">
              {phase === "uploading" ? "Uploading…" : "Processing…"}
            </h1>
            <p className="mx-auto mt-2 max-w-[480px] text-center text-sm font-medium text-anivax-muted min-[1180px]:text-base">
              {phase === "uploading"
                ? "Sending your file to the server…"
                : phase === "ocr"
                  ? "Running text recognition…"
                  : "Preparing extracted text…"}
            </p>

            <div className="mx-auto mt-8 max-w-[420px] rounded-lg border border-black/10 bg-white px-4 py-4 shadow-sm min-[1180px]:mt-10">
              <div className="flex items-center gap-3">
                <PdfIcon className="h-12 w-10 shrink-0 text-[#c62828]" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-bold text-anivax-ink">{fileName}</p>
                  <p className="m-0 mt-0.5 text-xs font-semibold text-anivax-muted">{formatFileSize(fileSize)}</p>
                </div>
              </div>
            </div>

            <OcrStepper phase={phase} uploadPct={displayUploadPct} ocrDone={ocrDone} extractDone={extractDone} />

            <div className="mx-auto mt-8 w-full max-w-[420px] rounded-lg border border-black/10 bg-white px-4 py-4 min-[1180px]:mt-10">
              <p className="m-0 text-3xl font-bold text-[#7c5cfb] min-[1180px]:text-4xl">{Math.round(bannerPct)}%</p>
              <p className="m-0 mt-1 text-sm font-semibold text-anivax-ink">
                {phase === "uploading"
                  ? "Uploading your file…"
                  : phase === "ocr"
                    ? "Running OCR on your file…"
                    : "Finishing extraction…"}
              </p>
              <p className="m-0 mt-1 text-xs font-semibold text-anivax-danger">Please don&apos;t close this window.</p>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[#e8e4f7]">
                <div
                  className="h-full rounded-full bg-[#7c5cfb] transition-[width] duration-300 ease-out"
                  style={{
                    width: `${bannerPct}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="relative w-full max-w-[560px] rounded-xl border border-black/10 bg-white px-6 py-8 shadow-[4px_4px_4px_rgb(0_0_0/0.12)] min-[1180px]:max-w-[720px] min-[1180px]:px-12 min-[1180px]:py-11">
            <button
              type="button"
              onClick={handleUseInformation}
              className="absolute right-4 top-4 rounded-md border-none bg-anivax-teal px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition hover:brightness-105 min-[1180px]:right-8 min-[1180px]:top-6 min-[1180px]:px-5 min-[1180px]:py-2.5 min-[1180px]:text-xs"
            >
              Use the Information
            </button>

            <div className="flex flex-col items-center pt-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-anivax-teal text-white min-[1180px]:h-[72px] min-[1180px]:w-[72px]">
                <CheckBoldIcon className="h-9 w-9 min-[1180px]:h-10 min-[1180px]:w-10" />
              </div>
              <h1 className="m-0 mt-5 text-center text-xl font-bold text-anivax-ink min-[1180px]:text-2xl">Processing Complete!</h1>
              <p className="mx-auto mt-2 max-w-[520px] text-center text-sm font-medium text-anivax-muted min-[1180px]:text-base">
                Your file has been successfully processed and the data has been extracted.
              </p>
            </div>

            <div className="mx-auto mt-8 flex max-w-[480px] items-center justify-between gap-3 rounded-lg border border-black/10 px-4 py-3 min-[1180px]:mt-10 min-[1180px]:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <PdfIcon className="h-10 w-8 shrink-0 text-[#c62828]" />
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-bold text-anivax-ink">{fileName}</p>
                  <p className="m-0 text-xs font-semibold text-anivax-muted">{formatFileSize(fileSize)}</p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="inline-flex items-center gap-1 rounded-full bg-anivax-teal/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-anivax-teal">
                  <CheckSmallIcon /> Completed
                </span>
                <p className="m-0 mt-1 text-[10px] font-semibold text-anivax-muted">
                  {timestamps ? formatStamp(timestamps.extract) : ""}
                </p>
              </div>
            </div>

            <CompleteTimeline stamps={timestamps} />

            {ocrPreview ? (
              <div className="mx-auto mt-8 w-full max-w-[640px] rounded-lg border border-black/10 bg-[#fafafa] px-4 py-3 min-[1180px]:px-5">
                <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-anivax-muted">Extracted text preview</p>
                <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap wrap-break-word text-left text-xs font-medium leading-relaxed text-anivax-ink">
                  {ocrPreview}
                </pre>
                <p className="m-0 mt-2 text-[10px] font-semibold text-anivax-muted">
                  Full text is also available on the next screen (create profile) while you fill the form.
                </p>
              </div>
            ) : null}

            <div className="mt-10 flex justify-center pb-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-black bg-black px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:opacity-90"
              >
                View Full Size
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function OcrStepper({
  phase,
  uploadPct,
  ocrDone,
  extractDone,
}: {
  phase: "uploading" | "ocr" | "extracting" | "complete" | "error";
  uploadPct: number;
  ocrDone: boolean;
  extractDone: boolean;
}) {
  const uploadDone = phase !== "uploading" || uploadPct >= 100;
  const ocrComplete = ocrDone || phase === "extracting" || phase === "complete";
  const extractComplete = extractDone || phase === "complete";

  return (
    <div className="mx-auto mt-10 w-full max-w-[500px] min-[1180px]:mt-12">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-0">
        <StepNode
          label="Uploading"
          sublabel={phase === "uploading" ? `${Math.round(uploadPct)}%` : "Done"}
          icon={<CloudUploadIcon />}
          circleClass={phase === "uploading" ? "bg-[#7c5cfb] text-white" : "bg-[#7c5cfb] text-white"}
        />
        <div className={`mx-1 h-0.5 min-w-[24px] ${uploadDone ? "bg-anivax-teal" : "bg-[#d0c4f0]"}`} />
        <StepNode
          label="OCR Processing"
          sublabel={phase === "ocr" ? "In Progress" : ocrComplete ? "Done" : "Pending"}
          icon={<OcrGlyphIcon />}
          circleClass={
            phase === "ocr" ? "bg-anivax-teal text-white" : ocrComplete ? "bg-anivax-teal text-white" : "bg-[#e8e8e8] text-anivax-muted"
          }
        />
        <div className={`mx-1 h-0.5 min-w-[24px] ${ocrComplete ? "bg-anivax-teal" : "bg-[#e0e0e0]"}`} />
        <StepNode
          label="Extracting Data"
          sublabel={phase === "extracting" ? "In Progress" : extractComplete ? "Done" : "Pending"}
          icon={<CheckCircleOutlineIcon />}
          circleClass={
            extractComplete ? "bg-anivax-teal text-white" : phase === "extracting" ? "bg-anivax-teal text-white" : "bg-[#e8e8e8] text-anivax-muted"
          }
        />
      </div>
    </div>
  );
}

function StepNode({
  label,
  sublabel,
  icon,
  circleClass,
}: {
  label: string;
  sublabel: string;
  icon: ReactNode;
  circleClass: string;
}) {
  return (
    <div className="flex min-w-0 w-full flex-col items-center text-center">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full text-[11px] font-bold shadow-sm min-[1180px]:h-14 min-[1180px]:w-14 ${circleClass}`}
      >
        <span className="scale-90">{icon}</span>
      </div>
      <p className="m-0 mt-2 text-[10px] font-bold uppercase leading-tight text-anivax-ink min-[1180px]:text-[11px]">{label}</p>
      <p className="m-0 mt-0.5 text-[9px] font-semibold text-anivax-muted min-[1180px]:text-[10px]">{sublabel}</p>
    </div>
  );
}

function CompleteTimeline({ stamps }: { stamps: { upload: Date; ocr: Date; extract: Date } | null }) {
  if (!stamps) return null;
  return (
    <div className="mx-auto mt-8 w-full max-w-[520px] border-t border-black/10 pt-6 min-[1180px]:mt-10">
      <div className="flex flex-col gap-4">
        <TimelineRow label="Uploaded" time={formatStamp(stamps.upload)} active />
        <TimelineRow label="OCR Processing" time={formatStamp(stamps.ocr)} active />
        <TimelineRow label="Extracting Data" time={formatStamp(stamps.extract)} active />
      </div>
    </div>
  );
}

function TimelineRow({ label, time, active }: { label: string; time: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          active ? "bg-anivax-teal text-white" : "bg-[#e0e0e0] text-anivax-muted"
        }`}
      >
        <CheckSmallIcon />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-anivax-ink">{label}</span>
        <span className="text-xs font-semibold text-anivax-muted">{time}</span>
      </div>
    </div>
  );
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 48" fill="none" className={className} aria-hidden>
      <path d="M8 4h16l10 10v30a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" opacity={0.12} />
      <path
        d="M8 4h16l10 10v30a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M24 4v10h10" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <text x="10" y="38" fill="currentColor" fontSize="11" fontWeight="bold">
        PDF
      </text>
    </svg>
  );
}

function CloudUploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 17a4 4 0 0 1 0-8 5 5 0 0 1 9.9 1A4 4 0 0 1 16 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M12 11v8m-3-3 3-3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OcrGlyphIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 9h6M9 12h4M9 15h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckCircleOutlineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12l2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckBoldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M6 12l4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path d="M6 12l4 4 8-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M14 4h6v6M10 14L20 4M8 20h10a2 2 0 0 0 2-2V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
