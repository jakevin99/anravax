import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useAdminPatientsQuery,
  useRecyclePatientsQuery,
  type ApiPatientRecord,
} from "../hooks/queries/useAdminPatients";
import { useStaffDirectoryQuery } from "../hooks/queries/useStaffDirectory";
import { useNavigate } from "react-router";
import { getApiBaseUrl, rawFetch } from "../services/apiClient";
import { notifyDataChanged } from "../services/dataSync";
import {
  deletePatient,
  permanentlyDeleteRecycledPatient,
  restorePatient,
  type RecyclePatientListItem,
} from "../services/queueService";
import RemovePatientAlertFlow, {
  type RemovePatientAlertPhase,
} from "./RemovePatientAlertFlow";
import {
  clearSession,
  getCurrentUserSync,
  patchSessionUser,
} from "../services/authStore";
const API_BASE = getApiBaseUrl();

const LOGO_SRC = "/images/LONG-GO%201.png";

const adminModalFieldClass =
  "box-border h-10 w-full rounded-lg border border-[#C7CED2] bg-white px-3 text-sm text-anivax-ink outline-none focus:border-anivax-admin-teal focus:ring-2 focus:ring-anivax-admin-teal/25";

type AdminSection = "patients" | "staffs" | "activities" | "recycle";

interface PatientRow {
  id: string;
  name: string;
  ageSex: string;
  birthday: string;
  dateRegistered: string;
}

interface RecycleRow {
  id: string;
  name: string;
  ageSex: string;
  deletedAt: string;
  purgeAfter: string;
  daysUntilPurge: number;
}

interface StaffRow {
  id: string;
  name: string;
  roles: string;
  dateRegistered: string;
  firstName: string;
  lastName: string;
  username: string;
  roleId: number;
}

interface RoleRow {
  id: number;
  name: string;
}

interface NewStaffFormState {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  roleId: string;
}

interface AdminCredentialsFormState {
  currentPassword: string;
  newUsername: string;
  newPassword: string;
}

function patientAgeYears(birthDate: string): number {
  const d = new Date(birthDate + "T12:00:00");
  if (Number.isNaN(d.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? age : 0;
}

function mapApiPatientToPatientRow(p: ApiPatientRecord): PatientRow {
  const mid = p.middle_name?.trim();
  const initial = mid ? ` ${mid.charAt(0).toUpperCase()}.` : "";
  const regSource = p.created_at || p.registered_at;
  const dateRegistered = regSource
    ? new Date(regSource.includes("T") ? regSource : `${String(regSource).replace(" ", "T")}Z`)
        .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        .toUpperCase()
    : "—";
  return {
    id: p.id,
    name: `${p.last_name.toUpperCase()}, ${p.first_name.toUpperCase()}${initial}`,
    ageSex: `${patientAgeYears(p.birth_date)} | ${p.sex}`,
    birthday: new Date(p.birth_date + "T12:00:00")
      .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      .toUpperCase(),
    dateRegistered,
  };
}

function formatAdminDateTime(iso: string): string {
  const normalized = iso.includes("T") ? iso : `${String(iso).replace(" ", "T")}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

function mapRecycleItemToRow(item: RecyclePatientListItem): RecycleRow {
  const mid = item.middleName?.trim();
  const initial = mid ? ` ${mid.charAt(0).toUpperCase()}.` : "";
  return {
    id: item.id,
    name: `${item.lastName.toUpperCase()}, ${item.firstName.toUpperCase()}${initial}`,
    ageSex: `${patientAgeYears(item.birthDate)} | ${item.sex}`,
    deletedAt: formatAdminDateTime(item.deletedAt),
    purgeAfter: formatAdminDateTime(item.purgeAfter),
    daysUntilPurge: item.daysUntilPurge,
  };
}

function readSessionRole(): "ADMIN" | "RHU STAFF" | null {
  const user = getCurrentUserSync();
  if (!user) return null;
  const role = (user.role ?? "").toUpperCase();
  return role === "ADMIN" ? "ADMIN" : "RHU STAFF";
}

function readSessionUsername(): string {
  return getCurrentUserSync()?.username ?? "";
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const [sessionRole] = useState<"ADMIN" | "RHU STAFF" | null>(() => readSessionRole());
  const [section, setSection] = useState<AdminSection>("patients");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [apiError, setApiError] = useState("");
  const [sessionUsername, setSessionUsername] = useState(() => readSessionUsername());
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [addStaffSubmitting, setAddStaffSubmitting] = useState(false);
  const [addStaffError, setAddStaffError] = useState("");
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [credentialsSubmitting, setCredentialsSubmitting] = useState(false);
  const [credentialsError, setCredentialsError] = useState("");
  const [credentialsForm, setCredentialsForm] = useState<AdminCredentialsFormState>({
    currentPassword: "",
    newUsername: "",
    newPassword: "",
  });
  const [newStaffForm, setNewStaffForm] = useState<NewStaffFormState>({
    firstName: "",
    lastName: "",
    username: "",
    password: "",
    roleId: "",
  });
  const [showEditStaffModal, setShowEditStaffModal] = useState(false);
  const [editStaffSubmitting, setEditStaffSubmitting] = useState(false);
  const [editStaffError, setEditStaffError] = useState("");
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffForm, setEditStaffForm] = useState<NewStaffFormState>({
    firstName: "",
    lastName: "",
    username: "",
    password: "",
    roleId: "",
  });
  const [deletePatientTarget, setDeletePatientTarget] = useState<PatientRow | null>(null);
  const [deletePatientPhase, setDeletePatientPhase] = useState<RemovePatientAlertPhase | null>(
    null,
  );
  const [deletePatientBusy, setDeletePatientBusy] = useState(false);
  const [deletePatientError, setDeletePatientError] = useState("");
  const [recycleRetentionDays, setRecycleRetentionDays] = useState(30);
  const [recycleActionBusy, setRecycleActionBusy] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<RecycleRow | null>(
    null,
  );
  const [permanentDeletePhase, setPermanentDeletePhase] = useState<
    RemovePatientAlertPhase | null
  >(null);
  const {
    data: adminPatients = [],
    isLoading: patientsLoading,
    isError: patientsError,
  } = useAdminPatientsQuery(section === "patients");

  const {
    data: recycleData,
    isLoading: recycleLoading,
    isError: recycleError,
  } = useRecyclePatientsQuery(section === "recycle");

  const {
    data: staffDirectory,
    isLoading: staffLoading,
    isError: staffError,
  } = useStaffDirectoryQuery();

  const patientRows = useMemo(
    () => adminPatients.map(mapApiPatientToPatientRow),
    [adminPatients],
  );

  const recycleRows = useMemo(() => {
    if (!recycleData?.items) return [];
    return recycleData.items.map((item) => mapRecycleItemToRow(item));
  }, [recycleData?.items]);

  const staffRows = staffDirectory?.staff ?? [];

  useEffect(() => {
    if (recycleData?.retentionDays != null) {
      setRecycleRetentionDays(recycleData.retentionDays);
    }
  }, [recycleData?.retentionDays]);

  useEffect(() => {
    if (patientsError || recycleError || staffError) {
      setApiError("Failed to load data from the server.");
    }
  }, [patientsError, recycleError, staffError]);

  /** Open sidenav on wide viewports so first paint matches the admin layout; sidenav stays an overlay (no content shift). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const applyViewport = () => {
      const desktop = media.matches;
      setIsDesktopViewport(desktop);
      setSidebarOpen(desktop);
    };
    applyViewport();
    media.addEventListener("change", applyViewport);
    return () => media.removeEventListener("change", applyViewport);
  }, []);

  useEffect(() => {
    if (sessionRole === null) {
      navigate("/", { replace: true });
      return;
    }
    if (sessionRole !== "ADMIN") navigate("/queue", { replace: true });
  }, [sessionRole, navigate]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, closeSidebar]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patientRows;
    return patientRows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.ageSex.toLowerCase().includes(q),
    );
  }, [search, patientRows]);

  const filteredRecycle = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recycleRows;
    return recycleRows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.ageSex.toLowerCase().includes(q),
    );
  }, [search, recycleRows]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staffRows;
    return staffRows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.roles.toLowerCase().includes(q),
    );
  }, [search, staffRows]);

  useEffect(() => {
    if (staffDirectory?.roles) {
      setRoles(staffDirectory.roles);
    }
  }, [staffDirectory?.roles]);

  useEffect(() => {
    if (roles.length > 0 && !newStaffForm.roleId) {
      setNewStaffForm((prev) => ({ ...prev, roleId: String(roles[0].id) }));
    }
  }, [roles, newStaffForm.roleId]);

  const resetNewStaffForm = () => {
    setNewStaffForm({
      firstName: "",
      lastName: "",
      username: "",
      password: "",
      roleId: roles[0] ? String(roles[0].id) : "",
    });
    setAddStaffError("");
    setAddStaffSubmitting(false);
  };

  const openAddStaffModal = () => {
    resetNewStaffForm();
    setShowAddStaffModal(true);
  };

  const closeAddStaffModal = () => {
    setShowAddStaffModal(false);
    setAddStaffError("");
    setAddStaffSubmitting(false);
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addStaffSubmitting) return;
    setAddStaffError("");

    const firstName = newStaffForm.firstName.trim();
    const lastName = newStaffForm.lastName.trim();
    const username = newStaffForm.username.trim();
    const password = newStaffForm.password.trim();
    const roleId = Number(newStaffForm.roleId);

    if (!firstName || !lastName || !username || !password || !Number.isInteger(roleId)) {
      setAddStaffError("Please complete all required fields.");
      return;
    }
    if (password.length < 6) {
      setAddStaffError("Password must be at least 6 characters.");
      return;
    }

    setAddStaffSubmitting(true);
    const response = await rawFetch(`${API_BASE}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        username,
        passwordHash: password,
        roleId,
        isActive: true,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setAddStaffError(payload.error ?? "Failed to create staff.");
      setAddStaffSubmitting(false);
      return;
    }
    notifyDataChanged("staff");
    closeAddStaffModal();
  };

  const openEditStaffModal = (row: StaffRow) => {
    setEditingStaffId(row.id);
    setEditStaffForm({
      firstName: row.firstName,
      lastName: row.lastName,
      username: row.username,
      password: "",
      roleId: String(row.roleId),
    });
    setEditStaffError("");
    setEditStaffSubmitting(false);
    setShowEditStaffModal(true);
  };

  const closeEditStaffModal = () => {
    setShowEditStaffModal(false);
    setEditingStaffId(null);
    setEditStaffError("");
    setEditStaffSubmitting(false);
  };

  const handleRequestDeletePatient = (row: PatientRow) => {
    setDeletePatientError("");
    setDeletePatientTarget(row);
    setDeletePatientPhase("confirm");
  };

  const dismissDeletePatientFlow = () => {
    setDeletePatientPhase(null);
    setDeletePatientTarget(null);
    setDeletePatientBusy(false);
    setDeletePatientError("");
  };

  const handleDeletePatientConfirmNo = () => {
    if (deletePatientBusy) return;
    setDeletePatientPhase("canceled");
  };

  const handleDeletePatientConfirmYes = () => {
    void handleConfirmDeletePatient();
  };

  const handleRestoreRecycle = async (row: RecycleRow) => {
    if (recycleActionBusy) return;
    setRecycleActionBusy(true);
    setApiError("");
    try {
      await restorePatient(row.id);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Could not restore patient.");
    } finally {
      setRecycleActionBusy(false);
    }
  };

  const handleRequestPermanentDelete = (row: RecycleRow) => {
    setPermanentDeleteTarget(row);
    setPermanentDeletePhase("confirm");
  };

  const dismissPermanentDeleteFlow = () => {
    setPermanentDeletePhase(null);
    setPermanentDeleteTarget(null);
  };

  const handlePermanentDeleteConfirmYes = async () => {
    const row = permanentDeleteTarget;
    if (!row || recycleActionBusy) return;
    setRecycleActionBusy(true);
    setApiError("");
    try {
      await permanentlyDeleteRecycledPatient(row.id);
      setPermanentDeletePhase("success");
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Could not permanently delete patient.",
      );
      setPermanentDeletePhase("confirm");
    } finally {
      setRecycleActionBusy(false);
    }
  };

  const handleConfirmDeletePatient = async () => {
    const row = deletePatientTarget;
    if (!row || deletePatientBusy) return;
    setDeletePatientBusy(true);
    setDeletePatientError("");
    try {
      await deletePatient(row.id);
      setDeletePatientPhase("success");
    } catch (err) {
      setDeletePatientError(
        err instanceof Error ? err.message : "Could not delete patient record.",
      );
      setDeletePatientPhase("confirm");
    } finally {
      setDeletePatientBusy(false);
    }
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editStaffSubmitting || !editingStaffId) return;
    setEditStaffError("");

    const firstName = editStaffForm.firstName.trim();
    const lastName = editStaffForm.lastName.trim();
    const username = editStaffForm.username.trim();
    const password = editStaffForm.password.trim();
    const roleId = Number(editStaffForm.roleId);

    if (!firstName || !lastName || !username || !Number.isInteger(roleId)) {
      setEditStaffError("Please complete all required fields.");
      return;
    }
    if (password && password.length < 6) {
      setEditStaffError("Password must be at least 6 characters.");
      return;
    }

    if (!/^u_[A-Za-z0-9]{6}$/.test(editingStaffId)) {
      setEditStaffError("Invalid staff id.");
      return;
    }

    setEditStaffSubmitting(true);
    const body: Record<string, string | number> = {
      firstName,
      lastName,
      username,
      roleId,
    };
    if (password) {
      body.passwordHash = password;
    }
    const response = await rawFetch(
      `${API_BASE}/users/${encodeURIComponent(editingStaffId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setEditStaffError(payload.error ?? "Failed to update staff.");
      setEditStaffSubmitting(false);
      return;
    }
    notifyDataChanged("staff");
    closeEditStaffModal();
  };

  const openCredentialsModal = () => {
    setCredentialsError("");
    setCredentialsSubmitting(false);
    setCredentialsForm({
      currentPassword: "",
      newUsername: "",
      newPassword: "",
    });
    setShowCredentialsModal(true);
  };

  const closeCredentialsModal = () => {
    setShowCredentialsModal(false);
    setCredentialsError("");
    setCredentialsSubmitting(false);
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (credentialsSubmitting) return;
    setCredentialsError("");

    const currentPassword = credentialsForm.currentPassword.trim();
    const newUsername = credentialsForm.newUsername.trim();
    const newPassword = credentialsForm.newPassword.trim();

    if (!currentPassword) {
      setCredentialsError("Current password is required.");
      return;
    }
    if (!newUsername && !newPassword) {
      setCredentialsError("Enter a new username or new password.");
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setCredentialsError("New password must be at least 6 characters.");
      return;
    }

    setCredentialsSubmitting(true);
    const activeUsername = sessionUsername || "admin";

    try {
      if (newUsername) {
        const res = await rawFetch(`${API_BASE}/auth/admin/username`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: activeUsername,
            currentPassword,
            newUsername,
          }),
        });
        const payload = (await res.json()) as {
          data?: { username?: string };
          error?: string;
        };
        if (!res.ok) {
          setCredentialsError(payload.error ?? "Failed to change username.");
          setCredentialsSubmitting(false);
          return;
        }
        const updatedUsername = payload.data?.username ?? newUsername;
        patchSessionUser({ username: updatedUsername });
        setSessionUsername(updatedUsername);
      }

      if (newPassword) {
        const res = await rawFetch(`${API_BASE}/auth/admin/password`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: newUsername || activeUsername,
            currentPassword,
            newPassword,
          }),
        });
        const payload = (await res.json()) as { error?: string };
        if (!res.ok) {
          setCredentialsError(payload.error ?? "Failed to change password.");
          setCredentialsSubmitting(false);
          return;
        }
      }

      closeCredentialsModal();
      window.alert("Credentials updated.");
    } catch {
      setCredentialsError("Unable to update credentials. Please ensure the API server is running.");
    } finally {
      setCredentialsSubmitting(false);
    }
  };

  const title =
    section === "patients"
      ? "PATIENTS"
      : section === "staffs"
        ? "STAFFS"
        : section === "activities"
          ? "ACTIVITIES"
          : "RECYCLE BIN";

  if (sessionRole === null || sessionRole !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-anivax-page text-anivax-body">
        Checking access…
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full overflow-hidden bg-anivax-page">
      {/* Full-viewport scrim: sidenav floats above main content (true overlay, all breakpoints) */}
      <button
        type="button"
        aria-hidden={!(sidebarOpen && !isDesktopViewport)}
        aria-label={sidebarOpen && !isDesktopViewport ? "Close menu" : undefined}
        onClick={closeSidebar}
        className={`fixed inset-0 z-40 border-0 bg-black/40 p-0 transition-opacity duration-200 ${
          sidebarOpen && !isDesktopViewport
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      />

      {/* When sidenav is closed, show the same control as a handle (still opens the overlay panel) */}
      {!sidebarOpen && (
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setSidebarOpen(true)}
          className="fixed left-0 top-5 z-50 flex h-14 w-14 cursor-pointer items-center justify-center border-0 bg-anivax-page pl-1 shadow-[4px_0_4px_rgba(0,0,0,0.15)] transition-opacity duration-200 [border-radius:0_50%_50%_0]"
        >
          <HamburgerIcon />
        </button>
      )}

      {/* Sidenav slides over the page (never pushes main content — margin is not applied to the main column) */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[216px] flex-col bg-white shadow-[4px_0_4px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!sidebarOpen}
      >
        <div className="flex shrink-0 items-center justify-start border-b border-anivax-page px-3 pb-1 pt-3">
          <button
            type="button"
            aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((o) => !o)}
            className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-anivax-page"
          >
            <HamburgerIcon />
          </button>
        </div>

        <div className="border-b border-anivax-page px-0 pb-3 pt-2 text-center shadow-md">
          <img
            src={LOGO_SRC}
            alt=""
            draggable={false}
            className="mx-auto h-auto w-[120px] object-contain"
          />
          <div className="mt-2 text-base font-extrabold tracking-widest text-black">ADMIN</div>
        </div>

        <nav className="flex-1 pt-2">
          <SidebarLink
            label="PATIENTS"
            active={section === "patients"}
            onClick={() => {
              setSection("patients");
              closeSidebar();
            }}
            icon={<IconPeople active={section === "patients"} />}
          />
          <SidebarLink
            label="STAFFS"
            active={section === "staffs"}
            onClick={() => {
              setSection("staffs");
              closeSidebar();
            }}
            icon={<IconPeoplePair active={section === "staffs"} />}
          />
          <SidebarLink
            label="ACTIVITIES"
            active={section === "activities"}
            onClick={() => {
              setSection("activities");
              closeSidebar();
            }}
            icon={<IconClock active={section === "activities"} />}
          />
          <SidebarLink
            label="RECYCLE BIN"
            active={section === "recycle"}
            onClick={() => {
              setSection("recycle");
              closeSidebar();
            }}
            icon={<IconTrash active={section === "recycle"} />}
          />
        </nav>
      </aside>

      <div className="relative z-10 flex min-h-screen w-full min-w-0 flex-1 flex-col">
        {/* In-canvas scrim: must stay BELOW the header in this stacking context. A sibling
            overlay after this column used z-20 while the column was z-10, which trapped
            the profile menu underneath and made Credentials / Logout clicks a no-op. */}
        {profileOpen && (
          <button
            type="button"
            aria-label="Close profile menu"
            onClick={() => setProfileOpen(false)}
            className="fixed inset-0 z-[15] cursor-default border-none bg-transparent"
          />
        )}
        <header className="relative z-40 flex h-[101px] shrink-0 items-center gap-4 bg-anivax-sky px-5">
          <div className="flex-1" />

          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((o) => !o)}
              className="flex cursor-pointer items-center gap-2.5 border-none bg-transparent px-3 py-2"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-anivax-page">
                <UserGlyph />
              </span>
              <span className="text-sm font-extrabold tracking-wide text-black">PROFILE</span>
              <ChevronDown />
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full z-[80] mt-1.5 min-w-[180px] rounded-md border border-anivax-page bg-white shadow-anivax-card">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    openCredentialsModal();
                  }}
                  className="w-full cursor-pointer border-none bg-transparent px-3.5 py-3 text-left text-sm font-semibold text-anivax-body transition-colors hover:bg-anivax-page/80"
                >
                  Credentials
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    clearSession();
                    navigate("/", { replace: true });
                  }}
                  className="w-full cursor-pointer border-none bg-transparent px-3.5 py-3 text-left text-sm font-semibold text-anivax-body transition-colors hover:bg-anivax-page/80"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="relative z-[1] flex-1 overflow-auto px-5 pb-10 pt-6 min-[1180px]:px-7">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <h1 className="m-0 text-3xl font-extrabold tracking-wide text-anivax-admin-teal min-[1180px]:text-4xl">
              {title}
            </h1>

            <div className="flex flex-wrap items-center gap-3">
              <SearchBar value={search} onChange={setSearch} />
              <SortButton />
              {section === "staffs" && (
                <button
                  type="button"
                  onClick={openAddStaffModal}
                  className="cursor-pointer whitespace-nowrap rounded border-none bg-anivax-green-border px-4 py-2.5 text-[13px] font-extrabold tracking-wide text-white transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
                >
                  + ADD NEW USER
                </button>
              )}
            </div>
          </div>
          {(apiError || deletePatientError) && (
            <div className="mb-2 font-semibold text-red-700">
              {deletePatientError || apiError}
            </div>
          )}

          {section === "patients" && (
            <DataCard>
              {patientsLoading ? (
                <div className="p-6 text-anivax-body">Loading patients...</div>
              ) : (
                <PatientsTable
                  rows={filteredPatients}
                  onDeletePatient={handleRequestDeletePatient}
                />
              )}
              <PaginationFooter />
            </DataCard>
          )}
          {section === "staffs" && (
            <DataCard>
              {staffLoading ? (
                <div className="p-6 text-anivax-body">Loading staffs...</div>
              ) : (
                <StaffTable rows={filteredStaff} onEditStaff={openEditStaffModal} />
              )}
              <PaginationFooter />
            </DataCard>
          )}
          {section === "activities" && (
            <DataCard>
              <div className="p-12 text-center text-anivax-body">No records yet.</div>
            </DataCard>
          )}
          {section === "recycle" && (
            <DataCard>
              <p className="border-b border-black/6 px-4 py-3 text-[13px] text-anivax-body">
                Deleted patients are kept for {recycleRetentionDays} days, then permanently
                removed. Restore returns them to the active registry.
              </p>
              {recycleLoading ? (
                <div className="p-6 text-anivax-body">Loading recycle bin...</div>
              ) : filteredRecycle.length === 0 ? (
                <div className="p-12 text-center text-anivax-body">Recycle bin is empty.</div>
              ) : (
                <RecycleTable
                  rows={filteredRecycle}
                  busy={recycleActionBusy}
                  onRestore={handleRestoreRecycle}
                  onPermanentDelete={handleRequestPermanentDelete}
                />
              )}
              <PaginationFooter />
            </DataCard>
          )}
        </div>
      </div>

      {showAddStaffModal && (
        <AddStaffModal
          form={newStaffForm}
          roles={roles}
          submitting={addStaffSubmitting}
          error={addStaffError}
          onChange={(key, value) =>
            setNewStaffForm((prev) => ({
              ...prev,
              [key]: value,
            }))
          }
          onClose={closeAddStaffModal}
          onSubmit={handleCreateStaff}
        />
      )}
      {showEditStaffModal && (
        <EditStaffModal
          form={editStaffForm}
          roles={roles}
          submitting={editStaffSubmitting}
          error={editStaffError}
          onChange={(key, value) =>
            setEditStaffForm((prev) => ({
              ...prev,
              [key]: value,
            }))
          }
          onClose={closeEditStaffModal}
          onSubmit={handleUpdateStaff}
        />
      )}
      <RemovePatientAlertFlow
        phase={deletePatientTarget ? deletePatientPhase : null}
        busy={deletePatientBusy}
        variant="registry"
        patientName={deletePatientTarget?.name}
        patientId={deletePatientTarget?.id}
        recycleRetentionDays={recycleRetentionDays}
        onConfirmYes={handleDeletePatientConfirmYes}
        onConfirmNo={handleDeletePatientConfirmNo}
        onDismissResult={dismissDeletePatientFlow}
      />

      <RemovePatientAlertFlow
        phase={permanentDeleteTarget ? permanentDeletePhase : null}
        busy={recycleActionBusy}
        variant="recyclePermanent"
        patientName={permanentDeleteTarget?.name}
        patientId={permanentDeleteTarget?.id}
        onConfirmYes={() => void handlePermanentDeleteConfirmYes()}
        onConfirmNo={() => {
          if (!recycleActionBusy) setPermanentDeletePhase("canceled");
        }}
        onDismissResult={dismissPermanentDeleteFlow}
      />

      {showCredentialsModal && (
        <AdminCredentialsModal
          form={credentialsForm}
          submitting={credentialsSubmitting}
          error={credentialsError}
          onChange={(key, value) =>
            setCredentialsForm((prev) => ({
              ...prev,
              [key]: value,
            }))
          }
          onClose={closeCredentialsModal}
          onSubmit={handleCredentialsSubmit}
        />
      )}
    </div>
  );
}

function AdminCredentialsModal({
  form,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  form: AdminCredentialsFormState;
  submitting: boolean;
  error: string;
  onChange: (key: keyof AdminCredentialsFormState, value: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="flex w-[min(520px,calc(100vw-32px))] flex-col gap-3.5 rounded-xl bg-white px-5 pb-4 pt-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[22px] font-extrabold tracking-wide text-anivax-admin-teal">
            CREDENTIALS
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border-none bg-transparent text-[22px] leading-none text-anivax-body hover:text-black"
            aria-label="Close credentials form"
          >
            ×
          </button>
        </div>

        <FormField label="Current password">
          <input
            type="password"
            value={form.currentPassword}
            onChange={(e) => onChange("currentPassword", e.target.value)}
            placeholder="Required"
            className={adminModalFieldClass}
          />
        </FormField>

        <FormField label="New username">
          <input
            value={form.newUsername}
            onChange={(e) => onChange("newUsername", e.target.value)}
            placeholder="Optional"
            className={adminModalFieldClass}
          />
        </FormField>

        <FormField label="New password">
          <input
            type="password"
            value={form.newPassword}
            onChange={(e) => onChange("newPassword", e.target.value)}
            placeholder="Optional (min 6 chars)"
            className={adminModalFieldClass}
          />
        </FormField>

        {error && <div className="text-[13px] font-semibold text-red-700">{error}</div>}

        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 min-w-[90px] cursor-pointer rounded-lg border border-[#C7CED2] bg-white text-[13px] font-bold text-anivax-body transition-colors hover:bg-anivax-page"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`h-9 min-w-[120px] rounded-lg border-none bg-anivax-green-border text-[13px] font-extrabold text-white ${
              submitting ? "cursor-not-allowed opacity-75" : "cursor-pointer hover:opacity-95"
            }`}
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddStaffModal({
  form,
  roles,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  form: NewStaffFormState;
  roles: RoleRow[];
  submitting: boolean;
  error: string;
  onChange: (key: keyof NewStaffFormState, value: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="flex w-[min(560px,calc(100vw-32px))] flex-col gap-3.5 rounded-xl bg-white px-5 pb-4 pt-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[22px] font-extrabold tracking-wide text-anivax-admin-teal">
            ADD NEW USER
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border-none bg-transparent text-[22px] leading-none text-anivax-body hover:text-black"
            aria-label="Close add user form"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="First name">
            <input
              value={form.firstName}
              onChange={(e) => onChange("firstName", e.target.value)}
              className={adminModalFieldClass}
            />
          </FormField>
          <FormField label="Last name">
            <input
              value={form.lastName}
              onChange={(e) => onChange("lastName", e.target.value)}
              className={adminModalFieldClass}
            />
          </FormField>
          <FormField label="Username">
            <input
              value={form.username}
              onChange={(e) => onChange("username", e.target.value)}
              className={adminModalFieldClass}
            />
          </FormField>
          <FormField label="Role">
            <select
              value={form.roleId}
              onChange={(e) => onChange("roleId", e.target.value)}
              className={adminModalFieldClass}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Password">
          <input
            type="password"
            value={form.password}
            onChange={(e) => onChange("password", e.target.value)}
            placeholder="Minimum 6 characters"
            className={adminModalFieldClass}
          />
        </FormField>

        {error && <div className="text-[13px] font-semibold text-red-700">{error}</div>}

        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 min-w-[90px] cursor-pointer rounded-lg border border-[#C7CED2] bg-white text-[13px] font-bold text-anivax-body transition-colors hover:bg-anivax-page"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`h-9 min-w-[120px] rounded-lg border-none bg-anivax-green-border text-[13px] font-extrabold text-white ${
              submitting ? "cursor-not-allowed opacity-75" : "cursor-pointer hover:opacity-95"
            }`}
          >
            {submitting ? "Saving..." : "Create User"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold tracking-wide text-anivax-body">{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

function DataCard({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden bg-white shadow-[4px_4px_4px_rgba(0,0,0,0.25)]">{children}</div>;
}

function adminDataTableMouseDown(e: React.MouseEvent<HTMLDivElement>) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest("button, a, input, select, textarea, label")) return;
  e.preventDefault();
}

function RecycleTable({
  rows,
  busy,
  onRestore,
  onPermanentDelete,
}: {
  rows: RecycleRow[];
  busy: boolean;
  onRestore: (row: RecycleRow) => void;
  onPermanentDelete: (row: RecycleRow) => void;
}) {
  const gridClass =
    "grid-cols-[minmax(100px,_0.9fr)_minmax(140px,_1.5fr)_minmax(72px,_0.7fr)_minmax(120px,_1.1fr)_minmax(100px,_0.9fr)_minmax(72px,_0.5fr)_minmax(160px,_1.2fr)]";
  return (
    <div className="admin-data-table" onMouseDown={adminDataTableMouseDown}>
      <div
        className={`admin-table-header grid min-h-10 items-center gap-2 bg-anivax-table-head px-4 text-[13px] font-extrabold tracking-wide text-black ${gridClass}`}
      >
        <span>ID</span>
        <span>NAME</span>
        <span>AGE | SEX</span>
        <span>DELETED</span>
        <span>PERMANENT DELETE</span>
        <span>DAYS LEFT</span>
        <span className="text-center">ACTIONS</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          className={`admin-table-row grid min-h-10 items-center gap-2 px-4 text-[13px] text-anivax-body ${gridClass}`}
        >
          <span className="break-all">{r.id}</span>
          <span>{r.name}</span>
          <span>{r.ageSex}</span>
          <span>{r.deletedAt}</span>
          <span>{r.purgeAfter}</span>
          <span className="font-semibold tabular-nums">{r.daysUntilPurge}</span>
          <span className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onRestore(r)}
              className="cursor-pointer rounded border border-anivax-teal bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-anivax-teal transition-colors hover:bg-anivax-sky/40 disabled:opacity-50"
            >
              Restore
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPermanentDelete(r)}
              className="cursor-pointer rounded border border-anivax-danger bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-anivax-danger transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              Delete now
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function PatientsTable({
  rows,
  onDeletePatient,
}: {
  rows: PatientRow[];
  onDeletePatient: (row: PatientRow) => void;
}) {
  const patientGridClass =
    "grid-cols-[minmax(100px,_0.9fr)_minmax(140px,_1.6fr)_minmax(72px,_0.7fr)_minmax(120px,_1.1fr)_minmax(110px,_1fr)_minmax(72px,_0.5fr)]";
  return (
    <div className="admin-data-table" onMouseDown={adminDataTableMouseDown}>
      <div
        className={`admin-table-header grid min-h-10 items-center gap-2 bg-anivax-table-head px-4 text-[13px] font-extrabold tracking-wide text-black ${patientGridClass}`}
      >
        <span>ID</span>
        <span>NAME</span>
        <span>AGE | SEX</span>
        <span>BIRTHDAY</span>
        <span>DATE REGISTERED</span>
        <span className="text-center">ACTIONS</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          className={`admin-table-row grid min-h-10 items-center gap-2 px-4 text-[13px] text-anivax-body ${patientGridClass}`}
        >
          <span className="break-all">{r.id}</span>
          <span>{r.name}</span>
          <span>{r.ageSex}</span>
          <span>{r.birthday}</span>
          <span>{r.dateRegistered}</span>
          <span className="flex justify-center">
            <PatientRowGearMenu row={r} onDelete={() => onDeletePatient(r)} />
          </span>
        </div>
      ))}
    </div>
  );
}

function PatientRowGearMenu({
  row,
  onDelete,
}: {
  row: PatientRow;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="relative inline-flex" ref={menuRef}>
      <GearActionButton
        ariaLabel={`Options for ${row.name}`}
        onClick={() => setOpen((prev) => !prev)}
      />
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-md border border-black/10 bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-anivax-danger transition-colors hover:bg-red-50"
          >
            Delete patient record
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StaffTable({
  rows,
  onEditStaff,
}: {
  rows: StaffRow[];
  onEditStaff: (row: StaffRow) => void;
}) {
  const staffGridClass =
    "grid-cols-[minmax(100px,_0.9fr)_minmax(160px,_2fr)_minmax(140px,_1.4fr)_minmax(110px,_1fr)_minmax(72px,_0.5fr)]";
  return (
    <div className="admin-data-table" onMouseDown={adminDataTableMouseDown}>
      <div
        className={`admin-table-header grid min-h-10 items-center gap-2 bg-anivax-table-head px-4 text-[13px] font-extrabold tracking-wide text-black ${staffGridClass}`}
      >
        <span>ID</span>
        <span>NAME</span>
        <span>ROLES</span>
        <span>DATE REGISTERED</span>
        <span className="text-center">ACTIONS</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          className={`admin-table-row grid min-h-10 items-center gap-2 px-4 text-[13px] text-anivax-body ${staffGridClass}`}
        >
          <span className="break-all">{r.id}</span>
          <span>{r.name}</span>
          <span>{r.roles}</span>
          <span>{r.dateRegistered}</span>
          <span className="flex justify-center">
            <GearActionButton
              ariaLabel={`Edit staff ${r.name}`}
              onClick={() => onEditStaff(r)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function EditStaffModal({
  form,
  roles,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  form: NewStaffFormState;
  roles: RoleRow[];
  submitting: boolean;
  error: string;
  onChange: (key: keyof NewStaffFormState, value: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[121] flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="flex w-[min(560px,calc(100vw-32px))] flex-col gap-3.5 rounded-xl bg-white px-5 pb-4 pt-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[22px] font-extrabold tracking-wide text-anivax-admin-teal">
            EDIT USER
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border-none bg-transparent text-[22px] leading-none text-anivax-body hover:text-black"
            aria-label="Close edit user form"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="First name">
            <input
              value={form.firstName}
              onChange={(e) => onChange("firstName", e.target.value)}
              className={adminModalFieldClass}
            />
          </FormField>
          <FormField label="Last name">
            <input
              value={form.lastName}
              onChange={(e) => onChange("lastName", e.target.value)}
              className={adminModalFieldClass}
            />
          </FormField>
          <FormField label="Username">
            <input
              value={form.username}
              onChange={(e) => onChange("username", e.target.value)}
              className={adminModalFieldClass}
            />
          </FormField>
          <FormField label="Role">
            <select
              value={form.roleId}
              onChange={(e) => onChange("roleId", e.target.value)}
              className={adminModalFieldClass}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Password (optional)">
          <input
            type="password"
            value={form.password}
            onChange={(e) => onChange("password", e.target.value)}
            placeholder="Leave blank to keep current"
            className={adminModalFieldClass}
          />
        </FormField>

        {error && <div className="text-[13px] font-semibold text-red-700">{error}</div>}

        <div className="mt-1 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 min-w-[90px] cursor-pointer rounded-lg border border-[#C7CED2] bg-white text-[13px] font-bold text-anivax-body transition-colors hover:bg-anivax-page"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`h-9 min-w-[120px] rounded-lg border-none bg-anivax-green-border text-[13px] font-extrabold text-white ${
              submitting ? "cursor-not-allowed opacity-75" : "cursor-pointer hover:opacity-95"
            }`}
          >
            {submitting ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PaginationFooter() {
  return (
    <div className="flex items-center justify-center gap-2 px-4 pb-6 pt-5">
      <span className="flex items-center gap-1.5 text-[13px] text-neutral-500">← Previous</span>
      <span className="flex h-7 w-[30px] items-center justify-center rounded-full bg-anivax-green-border text-[13px] font-extrabold text-anivax-page">
        1
      </span>
      <span className="text-[13px] text-anivax-ink/50">Next →</span>
    </div>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-stretch">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="SEARCH"
        className="box-border h-[30px] w-[220px] max-w-[42vw] rounded-l border border-black border-r-0 bg-white px-3 text-[13px] outline-none focus:ring-2 focus:ring-anivax-admin-teal/25"
      />
      <button
        type="button"
        aria-label="Search"
        className="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-r border border-l-0 border-black bg-anivax-sky p-0 transition-colors hover:bg-anivax-sky/90"
      >
        <SearchGlyph />
      </button>
    </div>
  );
}

function SortButton() {
  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-2 border-none bg-transparent px-0 py-1 transition-opacity hover:opacity-80"
    >
      <FunnelGlyph />
      <span className="text-sm font-extrabold text-black">SORT</span>
    </button>
  );
}

function SidebarLink({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2.5 border-b border-anivax-page px-3 py-2.5 pl-4 text-left transition-colors ${
        active ? "bg-anivax-sidebar-active" : "bg-white hover:bg-anivax-page/50"
      }`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">{icon}</span>
      <span
        className={`text-[13px] font-bold tracking-wide ${
          active ? "text-anivax-mint" : "text-anivax-admin-teal"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function GearActionButton({
  onClick,
  ariaLabel = "Row options",
}: {
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center border-none bg-transparent p-0 text-anivax-muted transition-colors hover:text-anivax-teal ${
        onClick ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-current">
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .66.39 1.26 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.25.61.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.26.39-1.51 1z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
    </button>
  );
}

function IconPeople({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="16"
      viewBox="0 0 20 16"
      fill="none"
      aria-hidden
      className={active ? "text-anivax-mint" : "text-anivax-admin-teal"}
    >
      <path
        d="M14 8a3 3 0 100-6 3 3 0 000 6zM6 8a3 3 0 100-6 3 3 0 000 6zM0 14c0-3 3-5 6-5s6 2 6 5M14 10c2 0 5 1 5 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPeoplePair({ active }: { active: boolean }) {
  return (
    <svg
      width="22"
      height="18"
      viewBox="0 0 22 18"
      fill="none"
      aria-hidden
      className={active ? "text-anivax-mint" : "text-anivax-admin-teal"}
    >
      <path
        d="M8 7a3 3 0 100-6 3 3 0 000 6zm6 1a3 3 0 100-6 3 3 0 000 6zM1 17c0-4 3.5-7 7-7s7 3 7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconClock({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={active ? "text-anivax-mint" : "text-anivax-admin-teal"}
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M10 6v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="20"
      viewBox="0 0 18 20"
      fill="none"
      aria-hidden
      className={active ? "text-anivax-mint" : "text-anivax-admin-teal"}
    >
      <path d="M2 5h14M6 5V3h6v2m-9 4v10h12V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" fill="none" aria-hidden>
      <path d="M2 4h24M2 10h24M2 16h24" stroke="#000" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function UserGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="8" r="4" stroke="#000" strokeWidth="2" />
      <path d="M4 19c1.5-4 5-6 7-6s5.5 2 7 6" stroke="#000" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 5l4 4 4-4" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="4.5" stroke="#000" strokeWidth="2" />
      <path d="M10 10l3 3" stroke="#000" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FunnelGlyph() {
  return (
    <svg width="26" height="22" viewBox="0 0 26 22" fill="none" aria-hidden className="text-anivax-admin-teal">
      <path d="M2 4h22L14 13v6l-4-2v-4L2 4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

