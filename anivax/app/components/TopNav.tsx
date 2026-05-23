import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { fetchJson } from "../services/apiClient";
import { clearSession, getRefreshToken } from "../services/authStore";
import type { AuthUser } from "../types/domain";

const NAV_ITEMS: { label: string; to: string }[] = [
  { label: "HOME", to: "/queue" },
  { label: "SCHEDULES", to: "/schedules" },
  { label: "DASHBOARD", to: "/dashboard" },
  { label: "RECORDS", to: "/queue/records" },
];

/** HOME is `/queue` only — not other `/queue/...` routes (e.g. records). */
function isNavItemActive(pathname: string, to: string): boolean {
  if (to === "/queue") {
    return pathname === "/queue" || pathname === "/queue/";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

const LOGO_SRC = "/images/LONG-GO%201.png";

interface TopNavProps {
  user?: AuthUser | null;
}

export default function TopNav({ user }: TopNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const signOut = async () => {
    setMenuOpen(false);
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await fetchJson("/auth/logout", {
          method: "POST",
          body: { refreshToken },
        });
      } catch {
        /* offline / already-revoked is fine — we still clear local state */
      }
    }
    clearSession();
    navigate("/");
  };

  return (
    <>
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 w-full items-center justify-center border-b border-black/6 bg-anivax-sky min-[900px]:h-20">
      <div className="box-border flex h-full w-full max-w-[1920px] items-center px-4 min-[900px]:px-8">
        <Link
          to="/queue"
          className="group mr-6 flex h-16 shrink-0 items-center min-[900px]:h-20 min-[1180px]:mr-14"
        >
          <img
            src={LOGO_SRC}
            alt="Anivax"
            draggable={false}
            className="h-20 w-auto object-contain select-none transition-transform duration-200 ease-out group-hover:scale-[1.02] min-[900px]:h-[110px]"
          />
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-6 min-[1180px]:gap-12">
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(location.pathname, item.to);
            return (
              <Link
                key={item.label}
                to={item.to}
                className={`relative whitespace-nowrap text-sm font-bold tracking-wide no-underline transition-colors duration-150 min-[1180px]:text-lg ${
                  active
                    ? "text-anivax-teal after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-anivax-teal"
                    : "text-anivax-muted hover:text-anivax-teal"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="User menu"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent bg-transparent py-1.5 pl-2 pr-1 transition-colors hover:border-black/10 hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-anivax-teal min-[1180px]:gap-2.5"
          >
            <span className="max-w-[140px] truncate text-xs font-bold tracking-wide text-black min-[1180px]:text-sm">
              {user
                ? `${user.firstName.toUpperCase()} ${user.lastName.toUpperCase()}`
                : "GUEST"}
            </span>
            <ChevronDown
              className={`shrink-0 text-black transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 min-w-[200px] overflow-hidden rounded-lg border border-black/10 bg-white py-1 shadow-lg ring-1 ring-black/5 transition-opacity duration-150"
            >
              <div className="border-b border-black/5 px-3 py-2 text-xs text-anivax-body">
                Signed in as{" "}
                <span className="font-semibold text-anivax-ink">
                  {user ? user.firstName : "Guest"}
                </span>
              </div>
              <button
                type="button"
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-anivax-teal transition-colors hover:bg-anivax-sky/40"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/queue");
                }}
              >
                Queue home
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-anivax-danger transition-colors hover:bg-red-50"
                onClick={signOut}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
    {/* Reserves space so page content sits below the fixed bar */}
    <div className="h-16 w-full shrink-0 min-[900px]:h-20" aria-hidden="true" />
    </>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 5l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
