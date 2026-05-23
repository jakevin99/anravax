/**
 * Browser-side session helper.
 *
 * - Access token lives in `sessionStorage` so it dies with the tab; the
 *   refresh token sits in `localStorage` so the user can come back tomorrow
 *   without logging in again.
 * - `useAuth()` is a tiny hook for components that just want the current
 *   user without each one wiring up its own state.
 *
 * The browser still owns the refresh token because the API server is
 * cross-origin in dev. When the API moves behind the same origin in prod
 * the refresh token can be promoted to an httpOnly cookie set by `/auth/login`.
 */

import { useEffect, useState } from "react";

import type { AuthUser } from "../types/domain";

export type StoredSession = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: string;
  user: SessionUser;
};

export type SessionUser = {
  id: number | string;
  username?: string | null;
  firstName: string;
  lastName: string;
  role: string;
  authorities?: string[];
  phone?: string | null;
  kind?: "staff" | "patient";
};

const ACCESS_KEY = "anivax.session.access";
const REFRESH_KEY = "anivax.session.refresh";

const listeners = new Set<() => void>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore listener errors */
    }
  });
}

export function setSession(payload: {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: string;
  user: SessionUser;
}): void {
  if (!isBrowser()) return;
  const expiresAt = Date.now() + payload.expiresInSeconds * 1000;
  const access: StoredSession = {
    accessToken: payload.accessToken,
    expiresAt,
    refreshToken: payload.refreshToken,
    refreshExpiresAt: payload.refreshExpiresAt,
    user: payload.user,
  };
  try {
    window.sessionStorage.setItem(ACCESS_KEY, JSON.stringify(access));
    window.localStorage.setItem(
      REFRESH_KEY,
      JSON.stringify({
        refreshToken: payload.refreshToken,
        refreshExpiresAt: payload.refreshExpiresAt,
        user: payload.user,
      }),
    );
  } catch {
    /* quota errors get swallowed; auth still works for this tab */
  }
  notify();
}

export function getStoredSession(): StoredSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(ACCESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getRefreshOnlySession():
  | { refreshToken: string; refreshExpiresAt: string; user: SessionUser }
  | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(REFRESH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  const session = getStoredSession();
  if (!session) return null;
  if (session.expiresAt - 5_000 <= Date.now()) return null;
  return session.accessToken;
}

export function getRefreshToken(): string | null {
  const stored = getStoredSession();
  if (stored?.refreshToken) return stored.refreshToken;
  return getRefreshOnlySession()?.refreshToken ?? null;
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function getCurrentUserSync(): SessionUser | null {
  return getStoredSession()?.user ?? getRefreshOnlySession()?.user ?? null;
}

/** Numeric staff user id from session (for APIs that expect a number). */
export function getStaffUserId(): number | null {
  const id = getCurrentUserSync()?.id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string") {
    const m = id.match(/^u_(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Merge fields into the persisted session user (e.g. after admin username change). */
export function patchSessionUser(patch: Partial<SessionUser>): void {
  if (!isBrowser()) return;
  const stored = getStoredSession();
  if (stored) {
    const remainingSec = Math.max(60, Math.floor((stored.expiresAt - Date.now()) / 1000));
    setSession({
      accessToken: stored.accessToken,
      expiresInSeconds: remainingSec,
      refreshToken: stored.refreshToken,
      refreshExpiresAt: stored.refreshExpiresAt,
      user: { ...stored.user, ...patch },
    });
    return;
  }
  const refreshOnly = getRefreshOnlySession();
  if (!refreshOnly) return;
  try {
    window.localStorage.setItem(
      REFRESH_KEY,
      JSON.stringify({
        ...refreshOnly,
        user: { ...refreshOnly.user, ...patch },
      }),
    );
    notify();
  } catch {
    /* ignore */
  }
}

/**
 * Map the persisted session user to the legacy `AuthUser` shape used across
 * the existing pages. Keeps `getCurrentUser()` in queueService stable.
 */
export function toAuthUser(u: SessionUser): AuthUser {
  const role = (u.role || "RHU STAFF").toUpperCase();
  const allowed: AuthUser["role"][] = [
    "RHU STAFF",
    "ADMIN",
    "ENCODER",
    "PROGRAM COORDINATOR",
  ];
  const safeRole = (allowed.includes(role as AuthUser["role"])
    ? role
    : "RHU STAFF") as AuthUser["role"];
  const id =
    typeof u.id === "number" ? `u_${u.id}` : u.id ? `u_${u.id}` : "u_guest";
  return {
    id,
    firstName: u.firstName,
    lastName: u.lastName,
    role: safeRole,
  };
}

export function useAuth(): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(getCurrentUserSync);
  useEffect(() => {
    const onChange = () => setUser(getCurrentUserSync());
    listeners.add(onChange);
    if (isBrowser()) {
      window.addEventListener("storage", onChange);
    }
    return () => {
      listeners.delete(onChange);
      if (isBrowser()) {
        window.removeEventListener("storage", onChange);
      }
    };
  }, []);
  return user;
}

/** Subscribe to session changes (used by the apiClient refresh flow). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
