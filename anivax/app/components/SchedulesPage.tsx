import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useScheduleSlotsQuery } from "../hooks/queries/useScheduleSlots";
import { queryKeys } from "../lib/queryKeys";
import type { AuthUser } from "../types/domain";
import { getStaffUserId } from "../services/authStore";
import {
  createScheduleSlot,
  deleteScheduleSlot,
  updateScheduleSlot,
} from "../services/scheduleSlotsService";
import { getCurrentUser, toISODate } from "../services/queueService";
import TopNav from "./TopNav";
import CalendarCard from "./CalendarCard";
import ScheduleSettingsModal, {
  type ScheduleRow,
  ScheduleFeedbackOverlay,
} from "./ScheduleSettingsModal";
import {
  parseScheduleSlotCount,
  rowToScheduledAtIso,
  scheduleSlotToScheduleRow,
  slotsToCategory,
} from "../utils/scheduleAppointmentRow";
import { findConflictingFollowUpSchedule, toIsoDateLocal } from "../utils/scheduleSlots";

const PAGE_SIZE = 8;

const SCHEDULE_GRID_CLASS =
  "grid-cols-[minmax(80px,_1fr)_minmax(130px,_1.2fr)_minmax(80px,_0.8fr)_minmax(180px,_1.8fr)_minmax(130px,_1.2fr)_minmax(70px,_0.7fr)]";

type SettingsModalState = null | { mode: "add" } | { mode: "edit"; row: ScheduleRow };

type FeedbackState = null | { title: string; variant: "success" | "danger" };

export default function SchedulesPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [showUnauthorizedAlert, setShowUnauthorizedAlert] = useState(false);
  const [settingsModal, setSettingsModal] = useState<SettingsModalState>(null);
  /** Set when opening edit modal so save still knows edit vs add after the modal closes. */
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const dateISO = toISODate(selectedDate);
  const {
    data: schedulePage,
    isLoading,
    isFetching,
  } = useScheduleSlotsQuery({
    date: dateISO,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = useMemo(
    () => (schedulePage?.items ?? []).map(scheduleSlotToScheduleRow),
    [schedulePage?.items],
  );
  const totalPages = Math.max(1, schedulePage?.totalPages ?? 1);
  const loading = isLoading || isFetching;

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  /** Schedules UI: only Program Coordinator may add/edit/delete (API still REST + role-gated). */
  const canModifySchedules = useMemo(() => {
    const role = (user?.role ?? "").toUpperCase();
    return role === "PROGRAM COORDINATOR" || role === "ADMIN";
  }, [user]);

  const addedByLabel = useMemo(() => {
    if (!user) return "—";
    const cred =
      user.role === "PROGRAM COORDINATOR"
        ? "PC"
        : user.role === "RHU STAFF"
          ? "RHU"
          : user.role === "ENCODER"
            ? "ENC"
            : "ADM";
    return `${user.firstName} ${user.lastName}, ${cred}`;
  }, [user]);

  const openAddSchedule = () => {
    if (!canModifySchedules) {
      setShowUnauthorizedAlert(true);
      return;
    }
    setEditingScheduleId(null);
    setSettingsModal({ mode: "add" });
  };

  const openEditSchedule = (row: ScheduleRow) => {
    if (!canModifySchedules) {
      setShowUnauthorizedAlert(true);
      return;
    }
    setEditingScheduleId(row.id);
    setSettingsModal({ mode: "edit", row });
  };

  const refreshRows = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.scheduleSlots.all });

  const handleScheduleSave = async (row: ScheduleRow) => {
    const sessionUserId = readSessionNumericUserId();
    if (!sessionUserId) {
      setFeedback({ title: "SESSION EXPIRED", variant: "danger" });
      return;
    }

    if (!row.dateIso || !row.time24) {
      setFeedback({ title: "INVALID DATE/TIME", variant: "danger" });
      return;
    }

    const scheduledAtIso = rowToScheduledAtIso(row);
    if (!scheduledAtIso) {
      setFeedback({ title: "INVALID DATE/TIME", variant: "danger" });
      return;
    }

    try {
      const slotCount = parseScheduleSlotCount(row.slots);
      if (slotCount == null) {
        setFeedback({ title: "INVALID SLOT COUNT", variant: "danger" });
        return;
      }

      const isEdit = editingScheduleId != null && editingScheduleId === row.id;
      const conflict = await findConflictingFollowUpSchedule(
        row.dateIso,
        row.time24,
        isEdit ? row.id : undefined,
      );
      if (conflict) {
        setFeedback({ title: "DUPLICATE SCHEDULE", variant: "danger" });
        return;
      }

      if (isEdit) {
        await updateScheduleSlot(row.id, {
          scheduledAt: scheduledAtIso,
          category: slotsToCategory(row.slots),
          status: "SCHEDULED",
          attendantUserId: sessionUserId,
          slotUsed: 0,
          slotTotal: slotCount,
        });
      } else {
        await createScheduleSlot({
          attendantUserId: sessionUserId,
          scheduledAt: scheduledAtIso,
          category: slotsToCategory(row.slots),
          status: "SCHEDULED",
          slotUsed: 0,
          slotTotal: slotCount,
        });
      }
      setEditingScheduleId(null);
      setFeedback({ title: "SCHEDULE SAVED", variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/already exists|409/i.test(msg)) {
        setFeedback({ title: "DUPLICATE SCHEDULE", variant: "danger" });
        return;
      }
      if (/403|forbidden|authority/i.test(msg)) {
        setFeedback({ title: "NOT AUTHORIZED", variant: "danger" });
        return;
      }
      if (/401|session|expired/i.test(msg)) {
        setFeedback({ title: "SESSION EXPIRED", variant: "danger" });
        return;
      }
      setFeedback({ title: "SAVE FAILED", variant: "danger" });
    }
  };

  const handleScheduleDelete = async (id: string) => {
    try {
      await deleteScheduleSlot(id);
      setFeedback({ title: "SCHEDULE DELETED", variant: "danger" });
    } catch {
      setFeedback({ title: "DELETE FAILED", variant: "danger" });
    }
  };

  return (
    <main className="flex min-h-screen w-full flex-col bg-anivax-page">
      <TopNav user={user} />

      <div className="box-border grid w-full flex-1 grid-cols-1 gap-4 self-stretch px-4 py-4 min-[1180px]:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] min-[1180px]:gap-6 min-[1180px]:px-8 min-[1180px]:py-6">
        <aside className="flex flex-col gap-6 min-[1180px]:gap-6">
          <CalendarCard
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            calendarResource="schedule-slots"
          />
        </aside>

        <section className="flex flex-col gap-4">
          <div className="flex min-h-[520px] flex-col gap-4 rounded-md bg-white px-4 py-4 shadow-anivax-card min-[1180px]:gap-5 min-[1180px]:px-6 min-[1180px]:py-5">
            <div className="flex flex-wrap items-center justify-between gap-4 gap-y-3">
              <div className="flex min-w-0 items-center gap-3 min-[1180px]:gap-3.5">
                <SchedulesHeadingCalendarIcon />
                <h2 className="m-0 text-2xl font-extrabold tracking-wide text-anivax-teal min-[1180px]:text-[28px]">
                  SCHEDULES
                </h2>
              </div>
              <button
                type="button"
                onClick={openAddSchedule}
                className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-anivax-mint px-4 text-xs font-bold tracking-wide text-white shadow-anivax-btn transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
              >
                + ADD SCHEDULE
              </button>
            </div>

            <div className="overflow-x-auto">
              <div
                className="schedules-data-table flex min-w-[780px] flex-col"
                onMouseDown={schedulesDataTableMouseDown}
              >
                <TableHeader />
                {loading ? (
                  <EmptyState text="Loading schedules..." />
                ) : rows.length === 0 ? (
                  <EmptyState text="No schedules found." />
                ) : (
                  rows.map((row) => (
                    <ScheduleTableRow
                      key={row.id}
                      row={row}
                      onOpenSettings={() => openEditSchedule(row)}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="mt-auto min-[1180px]:pt-1">
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          </div>
        </section>
      </div>

      {showUnauthorizedAlert && (
        <UnauthorizedAlert onClose={() => setShowUnauthorizedAlert(false)} />
      )}

      <ScheduleSettingsModal
        open={settingsModal !== null}
        mode={settingsModal?.mode ?? "add"}
        initialRow={settingsModal?.mode === "edit" ? settingsModal.row : null}
        defaultCalendarDate={selectedDate}
        addedByLabel={addedByLabel}
        onClose={() => {
          setSettingsModal(null);
          setEditingScheduleId(null);
        }}
        onSave={handleScheduleSave}
        onDelete={handleScheduleDelete}
      />

      {feedback ? (
        <ScheduleFeedbackOverlay
          title={feedback.title}
          variant={feedback.variant}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}
    </main>
  );
}

function readSessionNumericUserId(): number | null {
  return getStaffUserId();
}

function schedulesDataTableMouseDown(e: React.MouseEvent<HTMLDivElement>) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest("button, a, input, select, textarea, label")) return;
  e.preventDefault();
}

function TableHeader() {
  return (
    <div
      className={`schedules-table-header grid h-11 items-center rounded bg-anivax-table-head px-5 text-[13px] font-bold tracking-wide text-black ${SCHEDULE_GRID_CLASS}`}
    >
      <span className="text-center">TIME</span>
      <span className="text-center">DATE</span>
      <span className="text-center">SLOTS</span>
      <span className="text-center">ADDED BY:</span>
      <span>DATE ADDED</span>
      <span className="text-center">ACTIONS</span>
    </div>
  );
}

function ScheduleTableRow({
  row,
  onOpenSettings,
}: {
  row: ScheduleRow;
  onOpenSettings: () => void;
}) {
  return (
    <div
      className={`group schedules-table-row grid h-11 items-center px-5 text-[13px] font-medium text-anivax-body ${SCHEDULE_GRID_CLASS}`}
    >
      <span className="text-center transition-colors duration-150 group-hover:text-anivax-teal">
        {row.time}
      </span>
      <span className="text-center transition-colors duration-150 group-hover:text-anivax-teal">
        {row.date}
      </span>
      <SlotsCell slots={row.slots} />
      <span className="text-center transition-colors duration-150 group-hover:text-anivax-teal">
        {row.addedBy}
      </span>
      <span className="transition-colors duration-150 group-hover:text-anivax-teal">{row.dateAdded}</span>
      <span className="flex justify-center">
        <button
          type="button"
          aria-label="Schedule settings"
          onClick={onOpenSettings}
          className="inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0 text-anivax-muted transition-colors hover:text-anivax-teal"
        >
          <SettingsIcon />
        </button>
      </span>
    </div>
  );
}

function SlotsCell({ slots }: { slots: string }) {
  return (
    <span className="text-center transition-colors duration-150 group-hover:text-anivax-teal">
      {slots}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm font-semibold text-anivax-body">
      {text}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="flex items-center justify-center gap-3.5 pt-2 text-[13px]">
      <button
        type="button"
        onClick={() => canPrev && onChange(page - 1)}
        disabled={!canPrev}
        className={`flex items-center gap-1.5 border-none bg-transparent px-2 py-1 text-[13px] font-semibold transition-colors ${
          canPrev
            ? "cursor-pointer text-anivax-ink hover:text-anivax-teal"
            : "cursor-not-allowed text-anivax-ink/50"
        }`}
      >
        <ArrowLeft /> PREV
      </button>
      <PageBubble n={page} active />
      <button
        type="button"
        onClick={() => canNext && onChange(page + 1)}
        disabled={!canNext}
        className={`flex items-center gap-1.5 border-none bg-transparent px-2 py-1 text-[13px] font-semibold transition-colors ${
          canNext
            ? "cursor-pointer text-anivax-ink hover:text-anivax-teal"
            : "cursor-not-allowed text-anivax-ink/50"
        }`}
      >
        NEXT <ArrowRight />
      </button>
    </div>
  );
}

function PageBubble({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-transform ${
        active ? "bg-anivax-green-border text-anivax-page" : "bg-transparent text-anivax-ink"
      }`}
    >
      {n}
    </span>
  );
}

function ArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M9 3L5 7l4 4M5 7h7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5 3l4 4-4 4M9 7H2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Calendar glyph beside the SCHEDULES title (matches sidebar card icon style). */
function SchedulesHeadingCalendarIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-anivax-teal"
    >
      <rect x="2.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 8.5h17" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 2.5v4M15 2.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Same gear as queue tab row options (`QueuePage` `SettingsIcon`). */
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  );
}

function UnauthorizedAlert({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/15 backdrop-blur-[1px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(560px,calc(100vw-40px))] rounded-lg border-2 border-anivax-teal bg-white px-5 pb-9 pt-8 text-center shadow-anivax-card"
      >
        <div className="mx-auto mb-6 flex h-[74px] w-[74px] items-center justify-center rounded-full border-[5px] border-[#C21A4A] text-[42px] font-bold leading-none text-[#C21A4A]">
          !
        </div>
        <p className="m-0 text-[34px] font-extrabold tracking-wide text-[#111]">UNAUTHORIZED USER</p>
      </div>
    </div>
  );
}
