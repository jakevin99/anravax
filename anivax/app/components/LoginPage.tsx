import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, fetchJson } from "../services/apiClient";
import { setSession, type SessionUser } from "../services/authStore";

const CAT_DOG_SRC = "/images/Cat-Dog1%203.png";
const LOGO_SRC = "/images/LONG-GO%201.png";

type LoginResponse = {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: string;
  user: {
    id: number;
    username: string;
    firstName: string;
    lastName: string;
    role: string;
    authorities?: string[];
  };
};

export default function LoginPage() {
  const navigate = useNavigate();
  /** Match page chrome to login sky so gaps (e.g. html zoom vs viewport) never show as white. */
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.backgroundColor;
    const prevBodyBg = body.style.backgroundColor;
    const sky = "var(--color-anivax-sky, #a8d7e9)";
    html.style.backgroundColor = sky;
    body.style.backgroundColor = sky;
    return () => {
      html.style.backgroundColor = prevHtmlBg;
      body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      const data = await fetchJson<LoginResponse>("/auth/login", {
        method: "POST",
        anonymous: true,
        body: {
          username: username.trim(),
          password,
        },
      });
      const sessionUser: SessionUser = {
        id: data.user.id,
        username: data.user.username,
        firstName: data.user.firstName,
        lastName: data.user.lastName,
        role: data.user.role,
        authorities: data.user.authorities ?? [],
        kind: "staff",
      };
      setSession({
        accessToken: data.accessToken,
        expiresInSeconds: data.expiresInSeconds,
        refreshToken: data.refreshToken,
        refreshExpiresAt: data.refreshExpiresAt,
        user: sessionUser,
      });
      navigate(data.user.role === "ADMIN" ? "/admin" : "/queue");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Login failed. Please check your credentials.";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative isolate min-h-dvh w-full overflow-x-hidden">
      {/* Covers full visual viewport even when content height / global html zoom mismatch 100vh */}
      <div aria-hidden className="fixed inset-0 z-0 bg-anivax-sky" />
      <main className="relative z-10 flex min-h-dvh w-full flex-col overflow-x-hidden bg-anivax-sky lg:flex-row">
        <div className="relative flex min-h-[40vh] flex-1 items-end justify-center overflow-hidden pb-8 pt-10 lg:min-h-dvh lg:items-center lg:justify-end lg:pb-0 lg:pt-0">
        <img
          src={CAT_DOG_SRC}
          alt="Cat and dog"
          draggable={false}
          className="relative z-1 max-h-[min(72vh,640px)] w-auto max-w-[min(100%,520px)] object-contain object-bottom select-none drop-shadow-lg transition-transform duration-500 ease-out hover:scale-[1.02] lg:max-h-[min(88dvh,900px)] lg:max-w-none"
        />
      </div>

        <div className="relative z-2 flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-[max(3rem,env(safe-area-inset-bottom))] pt-2 lg:ml-0 lg:min-h-dvh lg:items-start lg:px-0 lg:py-12 lg:pb-12">
        <div className="w-full max-w-md">
          <img
            src={LOGO_SRC}
            alt="Anivax"
            draggable={false}
            className="mb-6 mx-auto h-16 w-auto object-contain select-none drop-shadow-md transition-transform duration-300 hover:scale-[1.03] sm:h-20 lg:mb-8 lg:h-28"
          />

          <form
            onSubmit={handleSubmit}
            className="w-full rounded-[28px] border border-white/20 bg-anivax-login-card p-8 shadow-anivax-elevated backdrop-blur-md transition-shadow duration-300 hover:shadow-xl sm:p-10 lg:-mt-6"
          >
          <h1 className="mb-8 text-center text-3xl font-extrabold tracking-widest text-black sm:text-4xl">
            LOGIN
          </h1>

          <label className="mb-1 block text-lg font-bold tracking-widest text-anivax-sky">
            USERNAME
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="mb-6 h-[52px] w-full rounded-lg border border-black bg-white px-3.5 text-lg font-medium text-anivax-ink shadow-sm outline-none ring-0 transition-[box-shadow,transform] placeholder:text-anivax-border focus:border-anivax-teal-deep focus:ring-2 focus:ring-anivax-teal-deep/35"
          />

          <label className="mb-1 block text-lg font-bold tracking-widest text-anivax-sky">
            PASSWORD
          </label>
          <div className="relative mb-2">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-[52px] w-full rounded-lg border border-black bg-white py-0 pl-3.5 pr-12 text-lg font-medium text-anivax-ink shadow-sm outline-none transition-[box-shadow,transform] focus:border-anivax-teal-deep focus:ring-2 focus:ring-anivax-teal-deep/35"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-anivax-mint transition-colors hover:bg-white/80 hover:text-anivax-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anivax-teal-deep"
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>

          <a
            href="#"
            className="mb-6 block text-right text-lg font-semibold text-black no-underline transition-colors hover:text-anivax-teal-deep hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anivax-teal-deep"
            onClick={(e) => e.preventDefault()}
          >
            Forgot password?
          </a>

          {errorMessage ? (
            <div
              role="alert"
              className="mb-4 rounded-md bg-red-50 px-3 py-2 text-center text-sm font-semibold text-red-700 ring-1 ring-red-200"
            >
              {errorMessage}
            </div>
          ) : null}

          <div className="flex">
            <button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-lg border border-anivax-teal-deep bg-anivax-teal-deep text-lg font-semibold text-anivax-page shadow-md transition-[transform,box-shadow,opacity] hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {submitting ? "Signing in..." : "Login"}
            </button>
          </div>
          </form>
        </div>
        </div>
      </main>
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 4l16 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
