/**
 * Secure storage for tokens and a fast cache for queue state.
 *
 * Refresh tokens go to the OS keychain (Keychain on iOS,
 * EncryptedSharedPreferences on Android via `react-native-keychain`).
 * Access tokens and snapshots live in MMKV — encrypted, fast, and
 * survives app restarts but not factory resets.
 */

import * as Keychain from "react-native-keychain";
import { MMKV } from "react-native-mmkv";

import type { SessionUser } from "./types";

const REFRESH_SERVICE = "anivax.refresh";

export const cache = new MMKV({
  id: "anivax-mmkv",
  encryptionKey: "anivax-mmkv-key",
});

const ACCESS_KEY = "auth.access.v1";
const ACCESS_EXP_KEY = "auth.access.exp.v1";
const USER_KEY = "auth.user.v1";

export async function saveSession(payload: {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  user: SessionUser;
}): Promise<void> {
  cache.set(ACCESS_KEY, payload.accessToken);
  cache.set(ACCESS_EXP_KEY, Date.now() + payload.expiresInSeconds * 1000);
  cache.set(USER_KEY, JSON.stringify(payload.user));
  await Keychain.setGenericPassword("refresh", payload.refreshToken, {
    service: REFRESH_SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearSession(): Promise<void> {
  cache.delete(ACCESS_KEY);
  cache.delete(ACCESS_EXP_KEY);
  cache.delete(USER_KEY);
  try {
    await Keychain.resetGenericPassword({ service: REFRESH_SERVICE });
  } catch {
    /* ignore */
  }
}

export function getCachedAccessToken(): string | null {
  const token = cache.getString(ACCESS_KEY);
  if (!token) return null;
  const expiresAt = cache.getNumber(ACCESS_EXP_KEY);
  if (!expiresAt || expiresAt - 5_000 <= Date.now()) return null;
  return token;
}

export async function getCachedRefreshToken(): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: REFRESH_SERVICE,
    });
    if (!credentials) return null;
    return credentials.password;
  } catch {
    return null;
  }
}

export function getCachedUser(): SessionUser | null {
  const raw = cache.getString(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function setCacheValue(key: string, value: unknown): void {
  cache.set(key, JSON.stringify({ value, savedAt: Date.now() }));
}

export function getCacheValue<T = unknown>(
  key: string,
): { value: T; savedAt: number } | null {
  const raw = cache.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
