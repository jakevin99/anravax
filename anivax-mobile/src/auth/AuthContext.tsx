import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import client, { setOnSessionLost } from "@/api/client";
import {
  clearSession,
  getCachedAccessToken,
  getCachedUser,
  saveSession,
} from "./storage";
import type { SessionPayload, SessionUser } from "./types";

type AuthState = {
  user: SessionUser | null;
  bootstrapping: boolean;
  requestOtp: (phone: string) => Promise<{ devOtp?: string }>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(getCachedUser);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    setOnSessionLost(() => setUser(null));
    return () => setOnSessionLost(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = getCachedAccessToken();
        const cached = getCachedUser();
        if (token && cached) {
          setUser(cached);
        }
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const requestOtp = useCallback(
    async (phone: string): Promise<{ devOtp?: string }> => {
      const res = await client.post<{ data: { devOtp?: string } }>(
        "/auth/patient/otp/request",
        { phone },
      );
      return { devOtp: res.data?.data?.devOtp };
    },
    [],
  );

  const verifyOtp = useCallback(async (phone: string, otp: string): Promise<void> => {
    const res = await client.post<{ data: SessionPayload }>(
      "/auth/patient/otp/verify",
      { phone, otp },
    );
    const data = res.data?.data;
    if (!data) throw new Error("Invalid response.");
    await saveSession({
      accessToken: data.accessToken,
      expiresInSeconds: data.expiresInSeconds,
      refreshToken: data.refreshToken,
      user: data.user,
    });
    setUser(data.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await client.post("/auth/logout", { refreshToken: undefined });
    } catch {
      /* offline is fine — we still clear local state */
    }
    await clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, bootstrapping, requestOtp, verifyOtp, signOut }),
    [user, bootstrapping, requestOtp, verifyOtp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
