/**
 * REST OCR routes.
 *
 * **Primary (recommended): Mistral Document AI OCR** — set `MISTRAL_API_KEY` in `.env`.
 *   POST https://api.mistral.ai/v1/ocr with a base64 data URL (see Mistral docs).
 *
 * **Fallback: OCR.space** — used when `MISTRAL_API_KEY` is unset.
 *
 * Env (Mistral):
 *   MISTRAL_API_KEY — Bearer token (required for Mistral path)
 *   MISTRAL_OCR_URL — optional; default https://api.mistral.ai/v1/ocr
 *   MISTRAL_OCR_MODEL — optional; default mistral-ocr-latest (e.g. mistral-ocr-2512 for OCR 3)
 *   MISTRAL_OCR_INCLUDE_RAW — set to "1" to include raw Mistral JSON in responses
 *
 * Env (OCR.space fallback):
 *   OCR_SPACE_API_KEY — optional; defaults to public demo key "helloworld"
 *   OCR_SPACE_API_URL — optional
 *   OCR_SPACE_LANGUAGE — optional; default eng
 *   OCR_SPACE_INCLUDE_RAW — set to "1" for raw JSON
 *
 * Env (upload size — both providers):
 *   OCR_MAX_FILE_BYTES — optional; overrides default max upload size
 *   OCR_SPACE_MAX_FILE_BYTES — legacy alias for OCR_MAX_FILE_BYTES
 *
 * @see https://docs.mistral.ai/api/endpoint/ocr
 * @see https://ocr.space/ocrapi
 */
import multer from "multer";
import { requireAuth } from "./middleware/auth.js";
import {
  PERSONAL_INFO_DOCUMENT_ANNOTATION_FORMAT,
  PERSONAL_INFO_OCR_PROMPT,
  parsePersonalInfoAnnotation,
} from "./personalInfoOcrSchema.js";

const ocrAccess = requireAuth({ actorKinds: ["staff", "patient"] });

const DEFAULT_OCR_URL = "https://api.ocr.space/parse/image";
const DEMO_API_KEY = "helloworld";

const MISTRAL_API_KEY = (process.env.MISTRAL_API_KEY ?? "").trim();
const MISTRAL_OCR_URL = (process.env.MISTRAL_OCR_URL ?? "https://api.mistral.ai/v1/ocr").trim() || "https://api.mistral.ai/v1/ocr";
const MISTRAL_OCR_MODEL = (process.env.MISTRAL_OCR_MODEL ?? "mistral-ocr-latest").trim() || "mistral-ocr-latest";

const MAX_FILE_BYTES =
  Number.parseInt(process.env.OCR_MAX_FILE_BYTES ?? process.env.OCR_SPACE_MAX_FILE_BYTES ?? "", 10) ||
  (MISTRAL_API_KEY ? 25 * 1024 * 1024 : 1 * 1024 * 1024);

const FREE_PDF_PAGE_HINT = 3;

const ALLOWED_IMAGE = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp", "image/tiff"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});

function getOcrSpaceApiKey() {
  return (process.env.OCR_SPACE_API_KEY ?? DEMO_API_KEY).trim() || DEMO_API_KEY;
}

function getOcrSpaceUrl() {
  return (process.env.OCR_SPACE_API_URL ?? DEFAULT_OCR_URL).trim() || DEFAULT_OCR_URL;
}

function getOcrLanguage() {
  return (process.env.OCR_SPACE_LANGUAGE ?? "eng").trim() || "eng";
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mistral asset ids may appear with or without extensions in markdown refs.
 * @param {string} id
 * @returns {string[]}
 */
function mistralAssetIdVariants(id) {
  const raw = String(id ?? "").trim();
  if (!raw) return [];
  const base = raw.replace(/\.(md|html|jpeg|jpg|png|webp|gif)$/i, "");
  const ext = raw.match(/\.(md|html|jpeg|jpg|png|webp|gif)$/i)?.[1]?.toLowerCase();
  const variants = new Set([raw, base]);
  if (ext) {
    variants.add(`${base}.${ext}`);
  } else {
    variants.add(`${base}.md`);
    variants.add(`${base}.html`);
  }
  return [...variants];
}

/**
 * Replace `[tbl-0.md](tbl-0.md)`-style placeholders with inline table/image content.
 * @param {string} markdown
 * @param {string} id
 * @param {string} content
 */
function replaceMistralAssetRefs(markdown, id, content) {
  let out = markdown;
  for (const variant of mistralAssetIdVariants(id)) {
    const esc = escapeRegExp(variant);
    out = out.replace(new RegExp(`\\[${esc}\\]\\(${esc}\\)`, "gi"), content);
    out = out.replace(new RegExp(`\\[${esc}\\]`, "gi"), content);
  }
  return out;
}

function stripMistralTableRefs(markdown) {
  return markdown
    .replace(/\[(?:tbl-\d+|table-\d+)\.(?:md|html)\]\((?:tbl-\d+|table-\d+)\.(?:md|html)\)/gi, "")
    .replace(/\[(?:tbl-\d+|table-\d+)\.(?:md|html)\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Mistral page markdown references tables in `page.tables[]`; inline that content.
 * @param {Record<string, unknown>} page
 */
function expandMistralPageMarkdown(page) {
  const rawMd = page?.markdown ?? page?.Markdown;
  let md = typeof rawMd === "string" ? rawMd : "";

  const header = typeof page?.header === "string" ? page.header.trim() : "";
  const footer = typeof page?.footer === "string" ? page.footer.trim() : "";
  if (header && !md.includes(header)) md = `${header}\n\n${md}`;
  if (footer && !md.includes(footer)) md = `${md}\n\n${footer}`;

  const tables = Array.isArray(page?.tables) ? page.tables : [];
  for (const table of tables) {
    const id = table?.id;
    const content = typeof table?.content === "string" ? table.content.trim() : "";
    if (!id || !content) continue;
    md = replaceMistralAssetRefs(md, String(id), content);
  }

  const stillHasTableRefs = /\[(?:tbl-\d+|table-\d+)\.(?:md|html)\]/i.test(md);
  if (stillHasTableRefs && tables.length) {
    const appended = tables
      .map((t) => (typeof t?.content === "string" ? t.content.trim() : ""))
      .filter((content) => content && !md.includes(content));
    md = stripMistralTableRefs(md);
    if (appended.length) md = [md, ...appended].filter(Boolean).join("\n\n");
  } else if (!md.trim() && tables.length) {
    md = tables
      .map((t) => (typeof t?.content === "string" ? t.content.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
  }

  return md.trim();
}

/**
 * Query `?pages=1,2,3` is 1-based in the UI; Mistral expects 0-based indices.
 * If the list includes indices beyond the document length, Mistral may return success with empty `pages` (no markdown).
 * @param {unknown} pagesStr
 * @returns {number[] | undefined}
 */
function parseMistralPagesQuery(pagesStr) {
  if (pagesStr == null || String(pagesStr).trim() === "") return undefined;
  const nums = String(pagesStr)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 1);
  if (nums.length === 0) return undefined;
  return [...new Set(nums.map((n) => n - 1))];
}

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} originalName
 * @param {unknown} pagesQuery
 */
async function ocrWithMistral(buffer, mimeType, originalName, pagesQuery) {
  if (!MISTRAL_API_KEY) {
    const err = new Error("MISTRAL_API_KEY is not configured.");
    err.code = "MISTRAL_OCR_CONFIG";
    throw err;
  }

  const mime = mimeType || "application/octet-stream";
  const b64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;

  const isPdf = mime === "application/pdf" || (originalName || "").toLowerCase().endsWith(".pdf");

  /** @type {Record<string, unknown>} */
  const payload = {
    model: MISTRAL_OCR_MODEL,
    document: isPdf
      ? { type: "document_url", document_url: dataUrl }
      : { type: "image_url", image_url: { url: dataUrl } },
    table_format: "markdown",
  };

  const structuredDisabled = process.env.MISTRAL_OCR_STRUCTURED === "0";
  const isImage = ALLOWED_IMAGE.has(mime) || mime.startsWith("image/");
  if (!structuredDisabled && (isPdf || isImage)) {
    payload.document_annotation_format = PERSONAL_INFO_DOCUMENT_ANNOTATION_FORMAT;
    payload.document_annotation_prompt = PERSONAL_INFO_OCR_PROMPT;
  }

  const pageIndices = parseMistralPagesQuery(pagesQuery);
  if (pageIndices && pageIndices.length) {
    payload.pages = pageIndices;
  }

  const res = await fetch(MISTRAL_OCR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`Mistral OCR returned non-JSON (HTTP ${res.status}).`);
    err.code = "MISTRAL_OCR_BAD_RESPONSE";
    throw err;
  }

  if (!res.ok) {
    const detail = json?.message ?? json?.detail ?? json?.error ?? text.slice(0, 400);
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.code = res.status === 429 ? "MISTRAL_OCR_RATE" : "MISTRAL_OCR_HTTP";
    throw err;
  }

  const pagesArr = Array.isArray(json?.pages) ? json.pages : [];
  const pagesOut = pagesArr.map((p, idx) => {
    const md = expandMistralPageMarkdown(p);
    const pageNumber =
      typeof p?.index === "number" && Number.isFinite(p.index) ? p.index + 1 : idx + 1;
    return { pageNumber, text: md };
  });

  const fullText = pagesOut
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n---\n\n");

  const totalPages = json?.usage_info?.pages_processed ?? pagesOut.length;
  const personalInfo = parsePersonalInfoAnnotation(json?.document_annotation);

  return {
    mimeType: mime,
    fullText,
    personalInfo,
    paragraphs: [],
    pages: pagesOut.length ? pagesOut : [{ pageNumber: 1, text: fullText || "(No text detected.)" }],
    totalPagesReported: totalPages || null,
    ocrExitCode: 0,
    processingTimeMs: null,
    raw: process.env.MISTRAL_OCR_INCLUDE_RAW === "1" ? json : undefined,
  };
}

/**
 * @param {unknown} json
 */
function mapOcrSpaceResponse(json, mimeType) {
  const ocrExit = Number(json?.OCRExitCode ?? 0);
  if (json?.IsErroredOnProcessing || ocrExit === 4) {
    const msg = json?.ErrorMessage || json?.ErrorDetails || "OCR.space reported a processing error.";
    const err = new Error(String(msg));
    err.code = "OCR_SPACE_FATAL";
    throw err;
  }
  if (ocrExit === 3) {
    const msg = json?.ErrorMessage || json?.ErrorDetails || "All pages failed to parse (OCR.space exit code 3).";
    const err = new Error(String(msg));
    err.code = "OCR_SPACE_FATAL";
    throw err;
  }

  const parsed = Array.isArray(json?.ParsedResults) ? json.ParsedResults : [];
  const pagesOut = parsed.map((pr, idx) => {
    const code = Number(pr?.FileParseExitCode ?? -99);
    const text = typeof pr?.ParsedText === "string" ? pr.ParsedText.trim() : "";
    if (code === 1 && text) return { pageNumber: idx + 1, text };
    if (text) return { pageNumber: idx + 1, text };
    const errMsg = pr?.ErrorMessage || pr?.ErrorDetails || "";
    return { pageNumber: idx + 1, text: errMsg ? `[Page ${idx + 1}] ${errMsg}` : "" };
  });

  const fullText = pagesOut
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n---\n\n");

  return {
    mimeType,
    fullText,
    paragraphs: [],
    pages: pagesOut.length ? pagesOut : [{ pageNumber: 1, text: fullText }],
    totalPagesReported: pagesOut.length || null,
    ocrExitCode: ocrExit,
    processingTimeMs: json?.ProcessingTimeInMilliseconds ?? null,
    raw: process.env.OCR_SPACE_INCLUDE_RAW === "1" ? json : undefined,
  };
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} mimeType
 * @param {{ isPdf: boolean }} opts
 */
async function ocrWithOcrSpace(buffer, originalName, mimeType, opts) {
  const url = getOcrSpaceUrl();
  const apiKey = getOcrSpaceApiKey();
  const language = getOcrLanguage();

  const form = new FormData();
  form.append("language", language);
  form.append("isOverlayRequired", "false");
  form.append("scale", "true");
  if (opts.isPdf) {
    form.append("filetype", "PDF");
  }

  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, originalName || "upload");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: apiKey,
    },
    body: form,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`OCR.space returned non-JSON (HTTP ${res.status}).`);
    err.code = "OCR_SPACE_BAD_RESPONSE";
    throw err;
  }

  if (!res.ok) {
    const err = new Error(json?.ErrorMessage || json?.ErrorDetails || `OCR.space HTTP ${res.status}`);
    err.code = "OCR_SPACE_HTTP";
    throw err;
  }

  return mapOcrSpaceResponse(json, mimeType);
}

function ocrUploadMiddleware(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "File too large for this server OCR limit.",
        details: `Max ${MAX_FILE_BYTES} bytes. Set OCR_MAX_FILE_BYTES (or OCR_SPACE_MAX_FILE_BYTES) to raise the limit.`,
      });
      return;
    }
    next(err);
  });
}

/**
 * @param {import('express').Express} app
 * @param {string} apiPrefix e.g. "/api/v1"
 */
export function mountOcrRoutes(app, apiPrefix) {
  app.get(`${apiPrefix}/ocr`, ocrAccess, (_req, res) => {
    const usingMistral = Boolean(MISTRAL_API_KEY);
    const key = getOcrSpaceApiKey();
    const usingDemo = !usingMistral && key === DEMO_API_KEY;

    if (usingMistral) {
      res.status(200).json({
        data: {
          resource: "ocr",
          provider: "mistral",
          providerUrl: MISTRAL_OCR_URL,
          model: MISTRAL_OCR_MODEL,
          methods: ["GET", "POST"],
          post: {
            contentType: "multipart/form-data",
            field: "file",
            maxBytes: MAX_FILE_BYTES,
            allowedMimeTypes: ["application/pdf", ...ALLOWED_IMAGE],
            notes: [
              "Mistral OCR: PDFs and images via base64 data URL on the server.",
              "Optional query: ?pages=1,2,3 (1-based; sent as zero-based indices). Omit for full document. Indices past the last page can yield empty OCR text.",
            ],
          },
          configured: true,
          usingDemoKey: false,
          configurationHint: `Using Mistral OCR (${MISTRAL_OCR_MODEL}). Optional: MISTRAL_OCR_URL, MISTRAL_OCR_MODEL, OCR_MAX_FILE_BYTES, MISTRAL_OCR_INCLUDE_RAW=1.`,
        },
      });
      return;
    }

    res.status(200).json({
      data: {
        resource: "ocr",
        provider: "ocr.space",
        providerUrl: "https://ocr.space/ocrapi",
        methods: ["GET", "POST"],
        post: {
          contentType: "multipart/form-data",
          field: "file",
          maxBytes: MAX_FILE_BYTES,
          allowedMimeTypes: ["application/pdf", ...ALLOWED_IMAGE],
          notes: [
            `Free OCR.space tier: about ${FREE_PDF_PAGE_HINT} PDF pages and ~1 MB per file (raise OCR_MAX_FILE_BYTES if you use a PRO key).`,
            "Set MISTRAL_API_KEY to use Mistral OCR instead (recommended).",
            "Or register at https://ocr.space/ocrapi/freekey and set OCR_SPACE_API_KEY.",
          ],
        },
        configured: true,
        usingDemoKey: usingDemo,
        configurationHint: usingDemo
          ? `Using demo API key "${DEMO_API_KEY}". Set MISTRAL_API_KEY (recommended) or OCR_SPACE_API_KEY. Optional: OCR_SPACE_LANGUAGE, OCR_SPACE_API_URL.`
          : "OCR_SPACE_API_KEY is set. Optional: OCR_SPACE_LANGUAGE, OCR_SPACE_API_URL, OCR_MAX_FILE_BYTES.",
      },
    });
  });

  app.post(`${apiPrefix}/ocr`, ocrAccess, ocrUploadMiddleware, async (req, res, next) => {
    try {
      if (!req.file?.buffer) {
        res.status(400).json({ error: "Missing file. Send multipart/form-data with a single field named 'file'." });
        return;
      }

      const mime = (req.file.mimetype || "").toLowerCase();
      const buffer = req.file.buffer;
      const originalName = req.file.originalname || "upload";
      const pagesQuery = req.query?.pages;

      const isPdf = mime === "application/pdf" || originalName.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        const data = MISTRAL_API_KEY
          ? await ocrWithMistral(buffer, mime || "application/pdf", originalName, pagesQuery)
          : await ocrWithOcrSpace(buffer, originalName, mime || "application/pdf", { isPdf: true });
        res.status(200).json({
          data: {
            fileName: originalName,
            ...data,
          },
        });
        return;
      }

      if (ALLOWED_IMAGE.has(mime) || mime.startsWith("image/")) {
        const data = MISTRAL_API_KEY
          ? await ocrWithMistral(buffer, mime, originalName, pagesQuery)
          : await ocrWithOcrSpace(buffer, originalName, mime, { isPdf: false });
        res.status(200).json({
          data: {
            fileName: originalName,
            ...data,
          },
        });
        return;
      }

      res.status(415).json({
        error: "Unsupported media type.",
        details: `Got '${mime}'. Allowed: application/pdf, ${[...ALLOWED_IMAGE].join(", ")}`,
      });
    } catch (err) {
      const msg = String(err?.message ?? err);

      if (err?.code === "MISTRAL_OCR_HTTP" || err?.code === "MISTRAL_OCR_BAD_RESPONSE") {
        res.status(502).json({ error: "Mistral OCR rejected the request.", details: msg });
        return;
      }
      if (err?.code === "MISTRAL_OCR_RATE") {
        res.status(429).json({ error: "Mistral OCR rate limit or quota exceeded.", details: msg });
        return;
      }
      if (err?.code === "MISTRAL_OCR_CONFIG") {
        res.status(503).json({ error: "Mistral OCR is not configured.", details: msg });
        return;
      }

      if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg) || err?.cause?.code === "ECONNREFUSED") {
        res.status(503).json({
          error: MISTRAL_API_KEY ? "Could not reach Mistral OCR API." : "Could not reach OCR.space.",
          details: msg,
        });
        return;
      }
      if (err?.code === "OCR_SPACE_FATAL") {
        res.status(422).json({ error: "OCR.space could not process this file.", details: msg });
        return;
      }
      if (/429|E202|quota|rate limit/i.test(msg)) {
        res.status(429).json({
          error: "OCR provider rate limit or quota exceeded.",
          details: msg,
        });
        return;
      }
      if (err?.code === "OCR_SPACE_HTTP") {
        res.status(502).json({ error: "OCR.space rejected the request.", details: msg });
        return;
      }
      next(err);
    }
  });
}
