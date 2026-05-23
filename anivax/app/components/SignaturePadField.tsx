import { useCallback, useEffect, useRef, useState } from "react";

const STROKE_COLOR = "#1e1e1e";
const STROKE_WIDTH = 2;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function isSignatureDataUrl(value: string): boolean {
  return value.startsWith("data:image/");
}

function drawSignatureImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width / img.width, height / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  ctx.drawImage(img, x, y, w, h);
}

type SignaturePadFieldProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  minHeight?: number;
  /** Tighter layout for table cells (e.g. Nurse's Note rows). */
  compact?: boolean;
  /** ABTC preview / print: show captured signature only (no draw, upload, or clear). */
  readOnly?: boolean;
};

/**
 * Signature capture: draw (mouse/touch/pen), upload, or drag-and-drop an image.
 * Value is a PNG data URL, or empty when cleared.
 */
export function SignaturePadField({
  value,
  onChange,
  placeholder = "Signature",
  ariaLabel = "Signature",
  className = "",
  minHeight,
  compact = false,
  readOnly = false,
}: SignaturePadFieldProps) {
  const padHeight = minHeight ?? (compact ? 108 : 96);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = Math.max(parent.clientWidth, 1);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const height = padHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = STROKE_WIDTH;
    if (value && isSignatureDataUrl(value)) {
      const img = new Image();
      img.onload = () => drawSignatureImage(ctx, img, width, height);
      img.src = value;
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  }, [padHeight, value]);

  useEffect(() => {
    resizeCanvas();
    const parent = canvasRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(parent);
    return () => ro.disconnect();
  }, [resizeCanvas]);

  const applyImageFile = (file: File) => {
    const type = file.type.toLowerCase();
    if (!ACCEPTED_IMAGE_TYPES.has(type) && !type.startsWith("image/")) {
      setFileError("Use a PNG, JPG, WEBP, or GIF signature image.");
      return;
    }
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChangeRef.current(reader.result);
      }
    };
    reader.onerror = () => setFileError("Could not read that file. Try another image.");
    reader.readAsDataURL(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) applyImageFile(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyImageFile(file);
    e.target.value = "";
  };

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const exportSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let hasInk = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        hasInk = true;
        break;
      }
    }
    onChangeRef.current(hasInk ? canvas.toDataURL("image/png") : "");
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && lastPointRef.current) {
      const pressure = e.pressure > 0 ? e.pressure : 0.5;
      ctx.lineWidth = STROKE_WIDTH * (0.45 + pressure * 0.9);
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const point = getPoint(e);
    if (!ctx || !point) return;
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    ctx.lineWidth = STROKE_WIDTH * (0.45 + pressure * 0.9);
    const last = lastPointRef.current;
    if (last) {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    lastPointRef.current = point;
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    exportSignature();
  };

  const handleClear = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
    setFileError(null);
    onChange("");
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
  };

  const hasSignature = Boolean(value && isSignatureDataUrl(value));

  if (readOnly) {
    return (
      <div className={`signature-pad-field signature-pad-field--readonly ${className}`.trim()}>
        <div
          className="relative box-border flex items-center justify-center overflow-hidden rounded border border-[#D9D9D9] bg-white"
          style={{ minHeight: padHeight }}
        >
          {hasSignature ? (
            <img
              src={value}
              alt={ariaLabel}
              className="box-border max-h-full w-full object-contain object-center"
              style={{ maxHeight: padHeight }}
            />
          ) : (
            <span className="px-2 text-center text-xs text-anivax-muted/70">{placeholder}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`signature-pad-field ${className}`.trim()}>
      <div
        className={[
          "relative box-border overflow-hidden rounded border bg-white transition-colors",
          dragOver
            ? "border-anivax-teal ring-2 ring-anivax-teal/35"
            : "border-[#D9D9D9]",
        ].join(" ")}
        style={{ minHeight: padHeight }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!hasSignature && !dragOver ? (
          <span
            className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center gap-1 px-2 text-center"
            aria-hidden="true"
          >
            <span className={compact ? "text-xs text-anivax-muted/70" : "text-sm text-anivax-muted/70"}>
              {placeholder}
            </span>
            <span className="text-[10px] font-medium leading-tight text-anivax-muted/55">
              {compact ? "Draw or drop image" : "Draw here, or drag & drop a signature image"}
            </span>
          </span>
        ) : null}
        {dragOver ? (
          <span
            className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center bg-anivax-teal/10 px-2 text-center text-xs font-semibold text-anivax-teal"
            aria-hidden="true"
          >
            Drop signature image
          </span>
        ) : null}
        <canvas
          ref={canvasRef}
          className="relative z-[1] block w-full touch-none cursor-crosshair"
          aria-label={ariaLabel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={(e) => {
            if (drawingRef.current) endStroke(e);
          }}
        />
      </div>
      <div
        className={
          compact
            ? "mt-1 flex flex-col gap-1"
            : "mt-1.5 flex flex-wrap items-center justify-between gap-2"
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={handleFileInputChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-none bg-transparent p-0 font-semibold text-anivax-teal hover:underline ${
            compact ? "text-left text-[10px]" : "text-[11px]"
          }`}
        >
          {compact ? "Upload" : "Upload image"}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className={`cursor-pointer border-none bg-transparent p-0 font-semibold text-anivax-teal hover:underline ${
            compact ? "text-left text-[10px]" : "text-[11px]"
          }`}
        >
          {compact ? "Clear" : "Clear signature"}
        </button>
      </div>
      {fileError ? (
        <p className="m-0 mt-1 text-[11px] font-medium text-anivax-danger">{fileError}</p>
      ) : null}
    </div>
  );
}
