import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppointmentsQuery, useAppointmentTabCountsQuery } from "../hooks/queries/useAppointments";
import { useQueueTicketsQuery } from "../hooks/queries/useQueueTickets";
import { queryKeys } from "../lib/queryKeys";
import { useLocation, useNavigate } from "react-router";
import { getStaffUserId } from "../services/authStore";
import {
  callNextQueueTicket,
  deleteAppointment,
  getCurrentUser,
  getQueueTicketForAppointment,
  issueQueueTicket,
  toISODate,
  updateAppointment,
} from "../services/queueService";
import { updateScheduleSlot } from "../services/scheduleSlotsService";
import { buildNowScheduledAt } from "../utils/scheduleSlots";
import type { ScheduleSlotChoice } from "../utils/scheduleSlots";
import type {
  Appointment,
  AppointmentTab,
  AuthUser,
  QueueTicket,
  Vitals,
} from "../types/domain";
import AnivaxSearchBar from "./AnivaxSearchBar";
import TopNav from "./TopNav";
import CalendarCard from "./CalendarCard";
import VitalsModal from "./VitalsModal";
import VitalsIcon from "./VitalsIcon";
import VaccineInventoryCard from "./VaccineInventoryCard";
import { AppointmentTabBar } from "./AppointmentTabBar";
import RemovePatientAlertFlow, {
  type RemovePatientAlertPhase,
} from "./RemovePatientAlertFlow";
import RescheduleAppointmentModal from "./RescheduleAppointmentModal";
import PatientQueuedAlert from "./PatientQueuedAlert";
import { ScheduleFeedbackOverlay } from "./ScheduleSettingsModal";
import { biteCategoryQueueDisplay } from "../utils/biteCategory";
import { isSeniorCitizen } from "../utils/patientAge";

const PAGE_SIZE = 8;

type ColumnId =
  | "TIME"
  | "TOKEN"
  | "DATE"
  | "PATIENT'S NAME"
  | "AGE/SEX"
  | "ATTENDANT"
  | "CATEGORY"
  | "VITALS"
  | "ACTIONS"
  | "GEAR";

interface ColumnConfig {
  id: ColumnId;
  label: string;
  width: string; // grid track size
  showLabel?: boolean; // whether to render label in header
}

/**
 * Per-tab column layouts. Each tab can declare its own table shape.
 * Adding a new tab is a matter of adding an entry here.
 */
// All columns use `minmax(min, Xfr)` so the table tracks always span the
// full width of the card. The `fr` ratios mirror the proportions in the
// Figma design (PATIENT'S NAME wider than TIME, etc.) and shrink/grow
// together on resize, so columns stay evenly distributed at any width.
const TAB_COLUMNS: Record<AppointmentTab, ColumnConfig[]> = {
  QUEUE: [
    { id: "TOKEN", label: "TOKEN", width: "minmax(95px, 1.2fr)", showLabel: true },
    { id: "TIME", label: "TIME", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "PATIENT'S NAME", label: "PATIENT'S NAME", width: "minmax(150px, 2.1fr)", showLabel: true },
    { id: "AGE/SEX", label: "AGE/SEX", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "ATTENDANT", label: "ATTENDANT", width: "minmax(120px, 1.4fr)", showLabel: true },
    { id: "CATEGORY", label: "CATEGORY", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "VITALS", label: "VITALS", width: "minmax(56px, 0.8fr)", showLabel: true },
    { id: "ACTIONS", label: "ACTIONS", width: "minmax(90px, 1fr)", showLabel: true },
    { id: "GEAR", label: "", width: "minmax(36px, 0.35fr)", showLabel: false },
  ],
  "FOLLOW-UP": [
    { id: "TIME", label: "TIME", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "DATE", label: "DATE", width: "minmax(100px, 1.2fr)", showLabel: true },
    { id: "PATIENT'S NAME", label: "PATIENT'S NAME", width: "minmax(160px, 2.3fr)", showLabel: true },
    { id: "AGE/SEX", label: "AGE/SEX", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "ATTENDANT", label: "ATTENDANT", width: "minmax(140px, 1.55fr)", showLabel: true },
    { id: "CATEGORY", label: "CATEGORY", width: "minmax(80px, 1.2fr)", showLabel: true },
    { id: "ACTIONS", label: "ACTIONS", width: "minmax(100px, 1.1fr)", showLabel: true },
    { id: "GEAR", label: "", width: "minmax(36px, 0.4fr)", showLabel: false },
  ],
  REQUESTS: [
    { id: "TOKEN", label: "TOKEN", width: "minmax(95px, 1.2fr)", showLabel: true },
    { id: "TIME", label: "TIME", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "PATIENT'S NAME", label: "PATIENT'S NAME", width: "minmax(150px, 2.1fr)", showLabel: true },
    { id: "AGE/SEX", label: "AGE/SEX", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "ATTENDANT", label: "ATTENDANT", width: "minmax(120px, 1.4fr)", showLabel: true },
    { id: "CATEGORY", label: "CATEGORY", width: "minmax(70px, 1fr)", showLabel: true },
    { id: "VITALS", label: "VITALS", width: "minmax(56px, 0.8fr)", showLabel: true },
    { id: "ACTIONS", label: "ACTIONS", width: "minmax(90px, 1fr)", showLabel: true },
    { id: "GEAR", label: "", width: "minmax(36px, 0.35fr)", showLabel: false },
  ],
};

/** Tailwind grid template per queue tab (replaces runtime gridTemplateColumns). */
const QUEUE_TAB_GRID_CLASS: Record<AppointmentTab, string> = {
  QUEUE:
    "grid-cols-[minmax(95px,_1.2fr)_minmax(70px,_1fr)_minmax(150px,_2.1fr)_minmax(70px,_1fr)_minmax(120px,_1.4fr)_minmax(70px,_1fr)_minmax(56px,_0.8fr)_minmax(90px,_1fr)_minmax(36px,_0.35fr)]",
  "FOLLOW-UP":
    "grid-cols-[minmax(70px,_1fr)_minmax(100px,_1.2fr)_minmax(160px,_2.3fr)_minmax(70px,_1fr)_minmax(140px,_1.55fr)_minmax(80px,_1.2fr)_minmax(100px,_1.1fr)_minmax(36px,_0.4fr)]",
  REQUESTS:
    "grid-cols-[minmax(95px,_1.2fr)_minmax(70px,_1fr)_minmax(150px,_2.1fr)_minmax(70px,_1fr)_minmax(120px,_1.4fr)_minmax(70px,_1fr)_minmax(56px,_0.8fr)_minmax(90px,_1fr)_minmax(36px,_0.35fr)]",
};

export default function QueuePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<AppointmentTab>("QUEUE");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({ query: "", date: "" });
  const [vitalsTarget, setVitalsTarget] = useState<Appointment | null>(null);
  const [ticketsByAppt, setTicketsByAppt] = useState<Record<string, QueueTicket>>({});
  const [callNextBusy, setCallNextBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Appointment | null>(null);
  const [removePhase, setRemovePhase] = useState<RemovePatientAlertPhase | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [scheduleFeedback, setScheduleFeedback] = useState<{
    title: string;
    variant: "success" | "danger";
  } | null>(null);
  const [patientQueuedAlertOpen, setPatientQueuedAlertOpen] = useState(false);
  const [patientQueuedAlertTitle, setPatientQueuedAlertTitle] = useState(
    "PATIENT HAS BEEN QUEUED",
  );
  const dateISO = filters.date || toISODate(selectedDate);
  const appointmentParams = {
    tab: activeTab,
    date: dateISO,
    lastName: filters.query.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const {
    data = null,
    isLoading,
    isFetching,
  } = useAppointmentsQuery(appointmentParams);
  const loading = isLoading || isFetching;

  const { data: tabCountsData } = useAppointmentTabCountsQuery(dateISO);
  const tabCounts = tabCountsData ?? null;

  const { data: queueTickets = [] } = useQueueTicketsQuery(dateISO, activeTab === "QUEUE");

  useEffect(() => {
    if (activeTab !== "QUEUE") {
      setTicketsByAppt({});
      return;
    }
    const map: Record<string, QueueTicket> = {};
    for (const t of queueTickets) map[t.appointmentId] = t;
    setTicketsByAppt(map);
  }, [activeTab, queueTickets]);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  useEffect(() => {
    const navState = location.state as {
      queueFocusDate?: string;
      queueActiveTab?: AppointmentTab;
    } | null;
    const iso = navState?.queueFocusDate;
    if (navState?.queueActiveTab) {
      setActiveTab(navState.queueActiveTab);
      setPage(1);
    }
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      if (navState?.queueActiveTab) navigate(".", { replace: true, state: {} });
      return;
    }
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return;
    setSelectedDate(new Date(y, m - 1, d, 12, 0, 0, 0));
    navigate(".", { replace: true, state: {} });
  }, [location.state, navigate]);

  const onSearchQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPage(1);
    setFilters((f) => ({ ...f, query: e.target.value }));
  };

  const handleRetrieve = (id: string) => {
    navigate(`/retrieve/${encodeURIComponent(id)}`, {
      state: {
        queueActiveTab: activeTab,
        queueFocusDate: filters.date || toISODate(selectedDate),
      },
    });
  };

  const handleRetrieveRecord = (patientId: string) => {
    navigate(`/queue/create-profile/${encodeURIComponent(patientId)}`, {
      state: {
        cancelReturnTo: "queue",
        queueActiveTab: activeTab,
        queueFocusDate: filters.date || toISODate(selectedDate),
      },
    });
  };

  const handleRequestRemove = (appt: Appointment) => {
    setRemoveTarget(appt);
    setRemovePhase("confirm");
  };

  const dismissRemoveFlow = () => {
    setRemovePhase(null);
    setRemoveTarget(null);
    setRemoveBusy(false);
  };

  const handleRemoveConfirmNo = () => {
    if (removeBusy) return;
    setRemovePhase("canceled");
  };

  const handleRemoveConfirmYes = () => {
    void handleConfirmRemove();
  };

  const handleRequestReschedule = (appt: Appointment) => {
    setRescheduleTarget(appt);
  };

  const handleAcceptAppointment = async (appt: Appointment) => {
    const apptId = appt.id;
    const dateISO = filters.date || toISODate(selectedDate);
    try {
      const attendantUserId = getStaffUserId();
      const scheduledAt = buildNowScheduledAt();
      await updateAppointment(apptId, {
        tab: "QUEUE",
        status: "IN_QUEUE",
        scheduledAt,
        ...(attendantUserId != null ? { attendantUserId } : {}),
      });
      let ticket = await getQueueTicketForAppointment(apptId);
      if (!ticket) {
        ticket = await issueQueueTicket(apptId);
      }
      const tokenPosition = ticket?.position ?? null;

      setPatientQueuedAlertTitle(
        tokenPosition != null
          ? `PATIENT QUEUED — TOKEN #${tokenPosition}`
          : "PATIENT HAS BEEN QUEUED",
      );
      setPatientQueuedAlertOpen(true);
      setActiveTab("QUEUE");
      setPage(1);
    } catch (err) {
      setScheduleFeedback({
        title: err instanceof Error ? err.message : "ACCEPT FAILED",
        variant: "danger",
      });
    }
  };

  const refreshAppointments = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });

  const handleRescheduleConfirm = async (slot: ScheduleSlotChoice) => {
    const appt = rescheduleTarget;
    if (!appt || rescheduleBusy) return;

    const scheduledAtIso = slot.scheduledAt;
    const sameSlot =
      new Date(appt.scheduledAt).getTime() === new Date(scheduledAtIso).getTime();
    const slotUsed = sameSlot
      ? (appt.slotUsed ?? slot.used)
      : Math.min(slot.total, slot.used + 1);
    const slotTotal = slot.total;
    const apptId = appt.id;

    setRescheduleBusy(true);
    try {
      const attendantUserId = getStaffUserId();
      await updateAppointment(apptId, {
        scheduledAt: scheduledAtIso,
        slotUsed,
        slotTotal,
        ...(attendantUserId != null ? { attendantUserId } : {}),
      });
      if (slot.scheduleAppointmentId && !sameSlot) {
        try {
          await updateScheduleSlot(slot.scheduleAppointmentId, { slotUsed });
        } catch {
          /* appointment moved; slot counter resyncs on reload */
        }
      }
      setRescheduleTarget(null);
      setScheduleFeedback({ title: "APPOINTMENT RESCHEDULED", variant: "success" });
    } catch (err) {
      setScheduleFeedback({
        title: err instanceof Error ? err.message : "RESCHEDULE FAILED",
        variant: "danger",
      });
    } finally {
      setRescheduleBusy(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget || removeBusy) return;
    setRemoveBusy(true);
    const removedId = removeTarget.id;
    try {
      await deleteAppointment(removedId);
      if (vitalsTarget?.id === removedId) setVitalsTarget(null);
      setTicketsByAppt((prev) => {
        const next = { ...prev };
        delete next[removedId];
        return next;
      });
      await refreshAppointments();
      setRemovePhase("success");
    } catch (err) {
      setScheduleFeedback({
        title: err instanceof Error ? err.message : "COULD NOT REMOVE PATIENT",
        variant: "danger",
      });
      setRemovePhase("confirm");
    } finally {
      setRemoveBusy(false);
    }
  };

  const handleCallNext = async () => {
    if (callNextBusy) return;
    setCallNextBusy(true);
    try {
      const dateISO = filters.date || toISODate(selectedDate);
      const ticket = await callNextQueueTicket(dateISO);
      if (ticket) {
        setTicketsByAppt((prev) => ({ ...prev, [ticket.appointmentId]: ticket }));
      }
    } finally {
      setCallNextBusy(false);
    }
  };

  const handleSaveVitals = async (appointmentId: string, vitals: Vitals) => {
    await updateAppointment(appointmentId, { vitals });
    // NOTE: don't close the modal here. VitalsModal owns its own flow
    // (Confirm -> Success -> close) and will call onClose() when the user
    // dismisses the "CHANGES SAVED" notice.
  };

  return (
    <main className="flex min-h-screen w-full flex-col bg-anivax-page">
      <TopNav user={user} />

      <div className="flex w-full shrink-0 justify-end bg-anivax-page px-4 py-2.5 min-[900px]:px-8">
        <AnivaxSearchBar
          value={filters.query}
          onChange={onSearchQueryChange}
          ariaLabel="Search appointments by last name"
          placeholder="Search by last name…"
        />
      </div>

      <div className="box-border grid min-h-0 w-full flex-1 grid-cols-1 items-stretch gap-5 self-stretch px-4 py-5 min-[1180px]:grid-cols-[minmax(300px,420px)_minmax(0,1fr)] min-[1180px]:gap-8 min-[1180px]:px-8 min-[1180px]:py-6">
        <aside className="flex flex-col gap-5 min-[1180px]:h-full min-[1180px]:min-h-0 min-[1180px]:gap-6">
          <CalendarCard
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            calendarResource="appointments"
          />
          <div className="flex min-h-0 min-[1180px]:flex-1 min-[1180px]:flex-col">
            <VaccineInventoryCard />
          </div>
        </aside>

        <section className="flex min-h-0 flex-col min-[1180px]:h-full min-[1180px]:min-h-0">
          <div className="flex min-h-0 flex-col bg-white shadow-[4px_4px_4px_rgb(0_0_0/0.25)] min-[1180px]:h-full min-[1180px]:flex-1">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] px-4 py-4 shadow-[4px_4px_4px_rgb(0_0_0/0.12)] min-[1180px]:flex-nowrap min-[1180px]:px-7 min-[1180px]:py-5">
              <div className="min-w-0 flex-1">
                <AppointmentTabBar
                  activeTab={activeTab}
                  tabCounts={tabCounts ?? undefined}
                  onChange={(t) => {
                    setActiveTab(t);
                    setPage(1);
                  }}
                />
              </div>
              <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 min-[1180px]:ml-auto min-[1180px]:w-auto">
                {activeTab === "QUEUE" ? (
                  <button
                    type="button"
                    onClick={handleCallNext}
                    disabled={callNextBusy}
                    className="flex h-[30px] cursor-pointer items-center justify-center gap-1.5 rounded border-none bg-[#7C5CFC] px-3 text-[10px] font-bold uppercase tracking-wide text-white shadow-[0_4px_4px_rgb(0_0_0/0.25)] transition-[transform,box-shadow,opacity] hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {callNextBusy ? "Calling…" : "Call next"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigate("/queue/new-consultation")}
                  className="flex h-[30px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded border-none bg-[#3EB489] px-4 text-[10px] font-bold uppercase tracking-wide text-white shadow-[0_4px_4px_rgb(0_0_0/0.25)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md active:translate-y-0"
                >
                  <span
                    className="inline-flex h-[1em] w-[1em] shrink-0 -translate-y-px items-center justify-center text-[17px] font-extrabold leading-none tracking-normal normal-case"
                    aria-hidden
                  >
                    +
                  </span>
                  <span className="inline-flex items-center leading-none">NEW CONSULTATION</span>
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-0 pb-4 pt-0 min-[1180px]:pb-6">
              <div className="min-h-0 flex-1 overflow-x-auto">
                <div
                  className="queue-data-table flex min-w-[880px] flex-col"
                  onMouseDown={queueDataTableMouseDown}
                >
                  <TableHeader columns={TAB_COLUMNS[activeTab]} tab={activeTab} />
                  <div>
                    {loading ? (
                      <EmptyState label="Loading appointments..." />
                    ) : !data || data.items.length === 0 ? (
                      <EmptyState label="No appointments found." />
                    ) : (
                      data.items.map((appt) => (
                        <AppointmentRow
                          key={appt.id}
                          appointment={appt}
                          tab={activeTab}
                          columns={TAB_COLUMNS[activeTab]}
                          ticket={ticketsByAppt[appt.id] ?? null}
                          onRetrieve={handleRetrieve}
                          onRetrieveRecord={handleRetrieveRecord}
                          onOpenVitals={setVitalsTarget}
                          onRequestRemove={handleRequestRemove}
                          onRequestReschedule={handleRequestReschedule}
                          onAcceptAppointment={handleAcceptAppointment}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-auto flex justify-center px-4 pt-4 min-[1180px]:px-8">
                <Pagination
                  page={data?.page ?? 1}
                  totalPages={data?.totalPages ?? 1}
                  onChange={setPage}
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {vitalsTarget && (
        <VitalsModal
          appointment={vitalsTarget}
          onClose={() => setVitalsTarget(null)}
          onSave={handleSaveVitals}
        />
      )}

      <RemovePatientAlertFlow
        phase={removeTarget ? removePhase : null}
        busy={removeBusy}
        onConfirmYes={handleRemoveConfirmYes}
        onConfirmNo={handleRemoveConfirmNo}
        onDismissResult={dismissRemoveFlow}
      />

      <RescheduleAppointmentModal
        open={rescheduleTarget != null}
        appointment={rescheduleTarget}
        scheduleDay={selectedDate}
        busy={rescheduleBusy}
        onClose={() => setRescheduleTarget(null)}
        onConfirm={(slot) => void handleRescheduleConfirm(slot)}
      />

      <PatientQueuedAlert
        open={patientQueuedAlertOpen}
        onClose={() => setPatientQueuedAlertOpen(false)}
        title={patientQueuedAlertTitle}
        titleClassName="text-anivax-ink"
      />

      {scheduleFeedback ? (
        <ScheduleFeedbackOverlay
          title={scheduleFeedback.title}
          variant={scheduleFeedback.variant}
          onDismiss={() => setScheduleFeedback(null)}
        />
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Sub-components                                */
/* -------------------------------------------------------------------------- */

function queueDataTableMouseDown(e: React.MouseEvent<HTMLDivElement>) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest("button, a, input, select, textarea, label")) return;
  e.preventDefault();
}

function TableHeader({ columns, tab }: { columns: ColumnConfig[]; tab: AppointmentTab }) {
  return (
    <div
      className={`queue-table-header grid h-10 items-center justify-items-center bg-anivax-table-head px-5 text-center min-[1180px]:px-7 ${QUEUE_TAB_GRID_CLASS[tab]}`}
    >
      {columns.map((c) => (
        <div key={c.id} className="w-full text-sm font-bold tracking-wide text-black">
          {c.showLabel ? c.label : ""}
        </div>
      ))}
    </div>
  );
}

function AppointmentRow({
  appointment,
  tab,
  columns,
  ticket,
  onRetrieve,
  onRetrieveRecord,
  onOpenVitals,
  onRequestRemove,
  onRequestReschedule,
  onAcceptAppointment,
}: {
  appointment: Appointment;
  tab: AppointmentTab;
  columns: ColumnConfig[];
  ticket: QueueTicket | null;
  onRetrieve: (id: string) => void;
  onRetrieveRecord: (patientId: string) => void;
  onOpenVitals: (appt: Appointment) => void;
  onRequestRemove: (appt: Appointment) => void;
  onRequestReschedule: (appt: Appointment) => void;
  onAcceptAppointment: (appt: Appointment) => void;
}) {
  const scheduled = new Date(appointment.scheduledAt);
  const time = scheduled.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const timeMatch = time.match(/^(.+?)\s*(AM|PM)$/i);
  const timeMain = timeMatch ? timeMatch[1].trim() : time;
  const timeSuffix = timeMatch ? timeMatch[2].toUpperCase() : "";
  const date = scheduled
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
  const fullName = formatPatientName(appointment);

  const renderCell = (col: ColumnConfig) => {
    switch (col.id) {
      case "TOKEN":
        return ticket ? (
          <span className="inline-flex flex-col items-center text-xs leading-tight">
            <span className="font-bold tabular-nums text-anivax-ink">
              {ticket.position}
            </span>
            <span
              className={`mt-0.5 inline-flex w-fit rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
                ticket.status === "WAITING"
                  ? "bg-slate-100 text-slate-700"
                  : ticket.status === "CALLED"
                    ? "bg-amber-100 text-amber-800"
                    : ticket.status === "SERVING"
                      ? "bg-anivax-teal/15 text-anivax-teal"
                      : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {ticket.status === "WAITING"
                ? `${ticket.peopleAhead} ahead`
                : ticket.status}
            </span>
          </span>
        ) : (
          <span className="text-xs text-anivax-muted">—</span>
        );
      case "TIME":
        return (
          <span className="tabular-nums text-anivax-body transition-colors duration-150 group-hover:text-anivax-teal">
            <span>{timeMain}</span>
            {timeSuffix ? (
              <>
                {" "}
                <span>{timeSuffix}</span>
              </>
            ) : null}
          </span>
        );
      case "DATE":
        return (
          <span className="transition-colors duration-150 group-hover:text-anivax-teal">{date}</span>
        );
      case "PATIENT'S NAME":
        return (
          <span className="font-semibold transition-colors duration-150 group-hover:text-anivax-teal">
            {fullName}
          </span>
        );
      case "AGE/SEX": {
        const senior = appointment.patient ? isSeniorCitizen(appointment.patient) : false;
        return (
          <span className="inline-flex items-center gap-1 transition-colors duration-150 group-hover:text-anivax-teal">
            <span className="tabular-nums">
              {appointment.patient
                ? `${appointment.patient.ageYears}/${appointment.patient.sex}`
                : "—"}
            </span>
            {senior ? (
              <span
                className="inline-flex rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-800"
                title="Senior citizen (60+)"
              >
                SC
              </span>
            ) : null}
          </span>
        );
      }
      case "ATTENDANT":
        return (
          <span className="transition-colors duration-150 group-hover:text-anivax-teal">
            {appointment.attendant.firstName} {appointment.attendant.lastName},{" "}
            {appointment.attendant.credential}
          </span>
        );
      case "CATEGORY":
        return (
          <span
            className="transition-colors duration-150 group-hover:text-anivax-teal"
            title={
              appointment.biteCategory == null
                ? "Set on Doctor's Order (Retrieve)"
                : undefined
            }
          >
            {biteCategoryQueueDisplay(appointment.biteCategory)}
          </span>
        );
      case "VITALS":
        return (
          <button
            type="button"
            aria-label={`Record vitals for ${fullName}`}
            onClick={() => onOpenVitals(appointment)}
            className="inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0 transition-opacity hover:opacity-80"
          >
            <VitalsIcon />
          </button>
        );
      case "ACTIONS":
        return (
          <button
            type="button"
            onClick={() => onRetrieve(appointment.id)}
            className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-xs font-bold uppercase tracking-wide text-anivax-admin-teal transition-[opacity,transform] hover:translate-x-0.5 hover:opacity-90"
          >
            <EditIcon /> Retrieve
          </button>
        );
      case "GEAR":
        return (
          <QueueRowGearMenu
            onAcceptAppointment={
              tab === "REQUESTS" ? () => void onAcceptAppointment(appointment) : undefined
            }
            onReschedule={() => onRequestReschedule(appointment)}
            onRetrieveRecord={() => {
              if (appointment.patient?.id) onRetrieveRecord(appointment.patient.id);
            }}
            onRemove={() => onRequestRemove(appointment)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`group queue-table-row grid h-10 items-center justify-items-center px-5 text-center text-sm font-medium text-anivax-body min-[1180px]:px-7 ${QUEUE_TAB_GRID_CLASS[tab]}`}
    >
      {columns.map((c) => (
        <div key={c.id} className="flex w-full items-center justify-center">
          {renderCell(c)}
        </div>
      ))}
    </div>
  );
}

function QueueRowGearMenu({
  onAcceptAppointment,
  onReschedule,
  onRetrieveRecord,
  onRemove,
}: {
  onAcceptAppointment?: () => void;
  onReschedule: () => void;
  onRetrieveRecord: () => void;
  onRemove: () => void;
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
      <button
        type="button"
        aria-label="Row options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0 text-[#7C5CFC] transition-colors hover:text-[#6346d4]"
      >
        <SettingsIcon />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-md border border-black/10 bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {onAcceptAppointment ? (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAcceptAppointment();
              }}
              className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-anivax-teal transition-colors hover:bg-anivax-sky/40"
            >
              Accept Appointment
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onReschedule();
            }}
            className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-anivax-ink transition-colors hover:bg-anivax-sky/40"
          >
            Reschedule Appointment
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRetrieveRecord();
            }}
            className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-anivax-ink transition-colors hover:bg-anivax-sky/40"
          >
            Retrieve Record
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRemove();
            }}
            className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-anivax-danger transition-colors hover:bg-red-50"
          >
            Remove Patient
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatPatientName(a: Appointment): string {
  const p = a.patient;
  if (!p) return "—";
  const { lastName, firstName, middleName } = p;
  const middle = middleName ? ` ${middleName}` : "";
  return `${lastName.toUpperCase()}, ${firstName.toUpperCase()}${middle.toUpperCase()}`;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm font-semibold text-anivax-body">
      {label}
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => canPrev && onChange(page - 1)}
        disabled={!canPrev}
        className={`flex items-center gap-2 border-none bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
          canPrev
            ? "cursor-pointer text-[#757575] hover:text-anivax-ink"
            : "cursor-not-allowed text-[#757575]/50"
        }`}
      >
        <ArrowLeft /> Prev
      </button>
      <PageBubble n={page} active />
      <button
        type="button"
        onClick={() => canNext && onChange(page + 1)}
        disabled={!canNext}
        className={`flex items-center gap-2 border-none bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
          canNext
            ? "cursor-pointer text-[#757575] hover:text-anivax-ink"
            : "cursor-not-allowed text-[#1e1e1e]/50"
        }`}
      >
        Next <ArrowRight />
      </button>
    </div>
  );
}

function PageBubble({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 min-w-[30px] items-center justify-center rounded-full px-1.5 text-xs font-bold transition-transform ${
        active ? "bg-[#2E8C6C] text-[#F5F5F5]" : "bg-transparent text-anivax-ink"
      }`}
    >
      {n}
    </span>
  );
}

/**
 * "Square-pen" glyph used for the RETRIEVE action: a notepad outline
 * with a pencil emerging from the top-right corner.
 */
function EditIcon({ className }: { className?: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Toothed gear / cog used for the per-row settings affordance.
 */
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
