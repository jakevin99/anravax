/**
 * Shared `fetch` wrapper used by every page in `app/`.
 *
 * - Reads `VITE_API_BASE_URL` once and prefixes every request.
 * - Injects `Authorization: Bearer <accessToken>` from the session store.
 * - On 401, attempts a single refresh roundtrip, then retries the request.
 * - Throws a typed `ApiError` so callers can branch on status code.
 *
 * Usage:
 *   const data = await fetchJson<MyResp>("/users");
 *   const created = await fetchJson<MyResp>("/users", {
 *     method: "POST",
 *     body: { firstName, lastName },
 *   });
 */

import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
} from "./authStore";

const FALLBACK_API_BASE = "http://localhost:4000/api/v1";

export function getApiBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== "undefined" &&
    typeof (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL ===
      "string"
      ? (import.meta as { env: Record<string, string> }).env.VITE_API_BASE_URL
      : "";
  return (fromEnv || FALLBACK_API_BASE).replace(/\/+$/, "");
}

export interface FetchJsonInit extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip auto-inject of bearer token (used by /auth/login and refresh). */
  anonymous?: boolean;
  /** Skip the auto refresh-on-401 retry. Used internally to avoid loops. */
  skipRefresh?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

let inflightRefresh: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  inflightRefresh = (async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearSession();
        return false;
      }
      const json = (await res.json()) as {
        data?: {
          accessToken: string;
          expiresInSeconds: number;
          refreshToken: string;
          refreshExpiresAt: string;
          user: {
            id: number | string;
            username?: string | null;
            firstName: string;
            lastName: string;
            role: string;
            authorities?: string[];
            phone?: string | null;
          };
        };
      };
      const data = json.data;
      if (!data) {
        clearSession();
        return false;
      }
      setSession({
        accessToken: data.accessToken,
        expiresInSeconds: data.expiresInSeconds,
        refreshToken: data.refreshToken,
        refreshExpiresAt: data.refreshExpiresAt,
        user: { ...data.user, kind: "staff" },
      });
      return true;
    } catch {
      clearSession();
      return false;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

function buildHeaders(init: FetchJsonInit): Headers {
  const headers = new Headers();
  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body !== undefined && init.body !== null && !isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (!init.anonymous) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      headers.set(k, v);
    }
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET") {
    headers.set("Cache-Control", "no-cache");
    headers.set("Pragma", "no-cache");
  }
  return headers;
}

function buildBody(init: FetchJsonInit): BodyInit | undefined {
  if (init.body === undefined || init.body === null) return undefined;
  if (typeof FormData !== "undefined" && init.body instanceof FormData) {
    return init.body;
  }
  if (typeof init.body === "string") return init.body;
  return JSON.stringify(init.body);
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!text) return null;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export async function rawFetch(
  path: string,
  init: FetchJsonInit = {},
): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `${getApiBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = buildHeaders(init);
  const body = buildBody(init);
  const { anonymous: _a, skipRefresh: _s, ...rest } = init;

  let res = await fetch(url, { ...rest, headers, body });

  if (res.status === 401 && !init.skipRefresh && !init.anonymous) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      const retryHeaders = buildHeaders({ ...init, skipRefresh: true });
      res = await fetch(url, { ...rest, headers: retryHeaders, body });
    }
  }
  return res;
}

export async function fetchJson<T = unknown>(
  path: string,
  init: FetchJsonInit = {},
): Promise<T> {
  const res = await rawFetch(path, init);
  const body = await readBody(res);
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error?: string }).error ?? "")
        : "") ||
      `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, body);
  }
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}
