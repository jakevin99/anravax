import { useEffect, useMemo, useState } from "react";
import type { Appointment } from "../types/domain";
import {
  findSlotIndexForScheduledAt,
  formatSlotCountDisplay,
  isSlotFull,
  loadVaccinationScheduleSlots,
  type ScheduleSlotChoice,
} from "../utils/scheduleSlots";

interface RescheduleAppointmentModalProps {
  open: boolean;
  appointment: Appointment | null;
  /** Calendar day whose slots are listed (queue page selected date). */
  scheduleDay: Date;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (slot: ScheduleSlotChoice) => void;
}

/**
 * Vaccination Date picker — same table UX as queue-schedule-appointment.
 */
export default function RescheduleAppointmentModal({
  open,
  appointment,
  scheduleDay,
  busy = false,
  onClose,
  onConfirm,
}: RescheduleAppointmentModalProps) {
  const [slots, setSlots] = useState<ScheduleSlotChoice[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editInProgress, setEditInProgress] = useState(false);

  useEffect(() => {
    if (!open || !appointment) return;
    let active = true;
    setSlotsLoading(true);
    setEditInProgress(false);
    loadVaccinationScheduleSlots({ day: scheduleDay })
      .then((next) => {
        if (!active) return;
        setSlots(next);
        setSelectedIndex(findSlotIndexForScheduledAt(next, appointment.scheduledAt));
      })
      .catch(() => {
        if (!active) return;
        setSlots([]);
        setSelectedIndex(0);
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, appointment, scheduleDay]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  const selected = slots[selectedIndex] ?? slots[0];
  const selectedAt = selected?.scheduledAt ?? appointment?.scheduledAt ?? new Date().toISOString();
  const selectedFull = selected ? isSlotFull(selected) : true;

  const footerDateLabel = useMemo(() => {
    const d = new Date(selectedAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const weekday =
      day.getTime() === today.getTime()
        ? "TODAY"
        : d.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
    const datePart = d
      .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      .toUpperCase();
    const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return { weekday, datePart, timePart };
  }, [selectedAt]);

  if (!open || !appointment) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-vaccination-date-title"
      className="fixed inset-0 z-[1140] flex items-center justify-center bg-[rgb(217_217_217/0.45)] p-4 backdrop-blur-[2px]"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(90vh,640px)] w-full max-w-[520px] flex-col overflow-hidden rounded-lg bg-white shadow-anivax-card ring-1 ring-black/5"
      >
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <h2
            id="reschedule-vaccination-date-title"
            className="m-0 flex-1 text-center text-[13px] font-extrabold tracking-wide text-anivax-ink min-[480px]:text-sm min-[1360px]:text-[15px]"
          >
            Vaccination Date
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lg font-bold text-anivax-ink transition-colors hover:bg-anivax-page disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[280px] border-collapse text-left text-[11px] min-[480px]:text-xs">
            <thead>
              <tr className="border-b border-black/10">
                <th className="px-3 py-2 font-extrabold tracking-wide text-[#7c5cfb] min-[480px]:px-4 min-[480px]:py-2.5">
                  Date
                </th>
                <th className="px-3 py-2 font-extrabold tracking-wide text-[#7c5cfb] min-[480px]:px-4 min-[480px]:py-2.5">
                  Time
                </th>
                <th className="px-3 py-2 font-extrabold tracking-wide text-[#7c5cfb] min-[480px]:px-4 min-[480px]:py-2.5">
                  Slots
                </th>
                <th className="px-3 py-2 min-[480px]:px-4 min-[480px]:py-2.5" />
              </tr>
            </thead>
            <tbody>
              {slotsLoading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-xs font-semibold text-anivax-muted"
                  >
                    Loading schedules…
                  </td>
                </tr>
              ) : slots.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-xs font-semibold text-anivax-muted"
                  >
                    No schedules for this day. Add them on the Schedules page.
                  </td>
                </tr>
              ) : null}
              {!slotsLoading &&
                slots.map((slot, idx) => {
                const full = isSlotFull(slot);
                const rowSelected = selectedIndex === idx;
                const slotLocked = !editInProgress && !rowSelected;
                return (
                  <tr
                    key={`${slot.scheduledAt}-${idx}`}
                    className={`border-b border-black/6 ${rowSelected ? "bg-anivax-sky/25" : idx % 2 === 1 ? "bg-[#fafafa]" : ""}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-bold uppercase min-[480px]:px-4 min-[480px]:py-3">
                      {slot.labelDate}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold min-[480px]:px-4 min-[480px]:py-3">
                      {slot.labelTime.replace(" ", "\u00A0")}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2.5 font-bold min-[480px]:px-4 min-[480px]:py-3 ${
                        full ? "text-black" : "text-anivax-danger"
                      }`}
                    >
                      {formatSlotCountDisplay(slot)}
                    </td>
                    <td className="px-3 py-2 text-right min-[480px]:px-4 min-[480px]:py-2.5">
                      <button
                        type="button"
                        disabled={slotLocked || (full && !rowSelected)}
                        onClick={() => setSelectedIndex(idx)}
                        className={`inline-flex h-7 min-w-[72px] items-center justify-center rounded px-2 text-[10px] font-bold tracking-wide transition min-[480px]:h-8 min-[480px]:min-w-[80px] min-[480px]:px-2.5 min-[480px]:text-[11px] ${
                          rowSelected
                            ? "bg-black text-white shadow-sm"
                            : full
                              ? "cursor-not-allowed bg-anivax-registry-upload-bg text-anivax-muted"
                              : "bg-anivax-teal text-white shadow-sm hover:brightness-110"
                        }`}
                      >
                        {rowSelected ? "SELECTED" : "SELECT"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-black/10 bg-anivax-sky/90 px-3 py-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between min-[480px]:px-4 min-[480px]:py-3.5">
          <p className="min-w-0 text-center text-[10px] font-bold uppercase leading-snug text-anivax-ink min-[520px]:text-left min-[480px]:text-[11px] min-[480px]:text-xs">
            {editInProgress ? (
              <span className="text-anivax-ink">EDIT IN PROGRESS</span>
            ) : (
              <>
                <span className="text-anivax-ink">Appointment date: </span>
                <span className="text-anivax-danger underline decoration-anivax-danger underline-offset-2">
                  {footerDateLabel.weekday}, {footerDateLabel.datePart}
                </span>
                <span className="text-anivax-ink"> | {footerDateLabel.timePart}</span>
              </>
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!editInProgress) {
                setEditInProgress(true);
                return;
              }
              if (selected && !selectedFull) onConfirm(selected);
            }}
            className="h-8 shrink-0 self-center rounded-md border-none bg-black px-4 text-[10px] font-bold tracking-wide text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 min-[520px]:self-auto min-[480px]:h-9 min-[480px]:px-5 min-[480px]:text-[11px]"
          >
            {busy ? "…" : editInProgress ? "SAVE" : "EDIT"}
          </button>
        </div>
      </div>
    </div>
  );
}
