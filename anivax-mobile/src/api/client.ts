/**
 * Single axios instance for the whole app.
 *
 * - Injects `Authorization: Bearer <accessToken>` from MMKV on every request.
 * - On 401, swaps the keychain refresh token for a new pair and retries once.
 *   If that fails, clears the session and the AuthContext drops the user
 *   back to the LoginPhoneScreen.
 */

import axios, { AxiosError, AxiosRequestConfig } from "axios";

import { API_BASE_URL } from "@/config/env";
import {
  clearSession,
  getCachedAccessToken,
  getCachedRefreshToken,
  saveSession,
} from "@/auth/storage";
import type { SessionPayload } from "@/auth/types";

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { Accept: "application/json" },
});

let refreshPromise: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setOnSessionLost(fn: (() => void) | null): void {
  onSessionLost = fn;
}

async function refreshOnce(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const refresh = await getCachedRefreshToken();
      if (!refresh) return false;
      const res = await axios.post<{ data: SessionPayload }>(
        `${API_BASE_URL}/auth/refresh`,
        { refreshToken: refresh },
        { headers: { "Content-Type": "application/json" } },
      );
      const data = res.data?.data;
      if (!data) return false;
      await saveSession({
        accessToken: data.accessToken,
        expiresInSeconds: data.expiresInSeconds,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      return true;
    } catch {
      await clearSession();
      onSessionLost?.();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

client.interceptors.request.use((config) => {
  const token = getCachedAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as
      | (AxiosRequestConfig & { _retry?: boolean })
      | undefined;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      original.url !== "/auth/refresh"
    ) {
      original._retry = true;
      const ok = await refreshOnce();
      if (ok) {
        return client.request(original);
      }
    }
    return Promise.reject(error);
  },
);

export default client;
