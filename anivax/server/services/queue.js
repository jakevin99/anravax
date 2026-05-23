/**
 * Queue ticket helpers — token issuance, position computation, "call next".
 *
 * The visible token is the queue number for the day (1, 2, 3, …). It is stored
 * in `position` and exposed as `tokenCode` in API responses. `token_code` in the
 * DB uses `dayIso:position` so the global UNIQUE constraint cannot collide across
 * days. Race safety on "call next" is achieved by selecting and updating in a
 * single transaction.
 */

import { all, get, run } from "../db.js";

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function dayIsoFromScheduledAt(scheduledAtIso) {
  return String(scheduledAtIso).slice(0, 10);
}

/** Internal DB key; API exposes `position` as the patient-facing token. */
function makeTokenCode(dayIso, position) {
  return `${dayIso}:${position}`;
}

/**
 * Reassign token positions for a day so they follow appointment `scheduled_at`
 * ascending (earlier acceptance / queue time → lower token number).
 */
export async function renumberTicketsByScheduledTime(dayIso) {
  const rows = await all(
    `
    SELECT qt.appointment_id
    FROM queue_tickets qt
    JOIN appointments a ON a.id = qt.appointment_id
    WHERE qt.day_iso = ?
    ORDER BY datetime(a.scheduled_at) ASC, qt.appointment_id ASC
  `,
    [String(dayIso)],
  );
  if (!rows.length) return;

  await run("BEGIN TRANSACTION");
  try {
    for (const row of rows) {
      await run(
        `UPDATE queue_tickets SET token_code = ? WHERE appointment_id = ?`,
        [`${dayIso}:renum:${row.appointment_id}`, row.appointment_id],
      );
    }
    for (let i = 0; i < rows.length; i++) {
      const position = i + 1;
      await run(
        `UPDATE queue_tickets SET position = ?, token_code = ? WHERE appointment_id = ?`,
        [position, makeTokenCode(dayIso, position), rows[i].appointment_id],
      );
    }
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

/**
 * Idempotent: issuing a ticket for an appointment that already has one
 * returns the existing row (renumbered for the day by scheduled time).
 */
export async function issueTicket(appointmentId) {
  const existing = await get(
    `SELECT * FROM queue_tickets WHERE appointment_id = ?`,
    [String(appointmentId)],
  );
  if (existing) {
    await renumberTicketsByScheduledTime(existing.day_iso);
    return await get(
      `SELECT * FROM queue_tickets WHERE appointment_id = ?`,
      [String(appointmentId)],
    );
  }

  const appointment = await get(
    `SELECT id, scheduled_at, tab FROM appointments WHERE id = ?`,
    [String(appointmentId)],
  );
  if (!appointment) {
    throw Object.assign(new Error("Appointment not found."), { code: "NOT_FOUND" });
  }
  const dayIso = dayIsoFromScheduledAt(appointment.scheduled_at);

  await run("BEGIN TRANSACTION");
  try {
    const maxRow = await get(
      `SELECT MAX(position) AS m FROM queue_tickets WHERE day_iso = ?`,
      [dayIso],
    );
    const position = (maxRow?.m ?? 0) + 1;
    const tokenCode = makeTokenCode(dayIso, position);
    await run(
      `
      INSERT INTO queue_tickets (
        appointment_id, token_code, day_iso, position, status
      ) VALUES (?, ?, ?, ?, 'WAITING')
    `,
      [String(appointmentId), tokenCode, dayIso, position],
    );
    await run("COMMIT");
    await renumberTicketsByScheduledTime(dayIso);
    return await get(
      `SELECT * FROM queue_tickets WHERE appointment_id = ?`,
      [String(appointmentId)],
    );
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

/**
 * Atomically call the next WAITING ticket for the given day.
 * Returns the called ticket, or `null` when nothing was waiting.
 */
export async function callNextTicket(dayIso) {
  await run("BEGIN TRANSACTION");
  try {
    const next = await get(
      `
      SELECT * FROM queue_tickets
      WHERE day_iso = ? AND status = 'WAITING'
      ORDER BY position ASC
      LIMIT 1
    `,
      [String(dayIso)],
    );
    if (!next) {
      await run("COMMIT");
      return null;
    }
    await run(
      `
      UPDATE queue_tickets
      SET status = 'CALLED', called_at = datetime('now')
      WHERE appointment_id = ? AND status = 'WAITING'
    `,
      [next.appointment_id],
    );
    await run("COMMIT");
    return await get(
      `SELECT * FROM queue_tickets WHERE appointment_id = ?`,
      [next.appointment_id],
    );
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

export async function setTicketStatus(appointmentId, status) {
  const validStatuses = ["WAITING", "CALLED", "SERVING", "FINISHED", "CANCELLED"];
  if (!validStatuses.includes(String(status))) {
    throw Object.assign(new Error(`Invalid status '${status}'.`), {
      code: "INVALID_STATUS",
    });
  }
  const stampColumn =
    status === "SERVING"
      ? "served_at"
      : status === "FINISHED"
        ? "finished_at"
        : status === "CALLED"
          ? "called_at"
          : null;
  if (stampColumn) {
    await run(
      `
      UPDATE queue_tickets
      SET status = ?, ${stampColumn} = COALESCE(${stampColumn}, datetime('now'))
      WHERE appointment_id = ?
    `,
      [status, String(appointmentId)],
    );
  } else {
    await run(
      `UPDATE queue_tickets SET status = ? WHERE appointment_id = ?`,
      [status, String(appointmentId)],
    );
  }
  return await get(
    `SELECT * FROM queue_tickets WHERE appointment_id = ?`,
    [String(appointmentId)],
  );
}

export async function getTicketByAppointment(appointmentId) {
  return get(`SELECT * FROM queue_tickets WHERE appointment_id = ?`, [
    String(appointmentId),
  ]);
}

export async function getTicketsForDay(dayIso) {
  return all(
    `
    SELECT * FROM queue_tickets
    WHERE day_iso = ?
    ORDER BY position ASC
  `,
    [String(dayIso)],
  );
}

export async function rollingAverageServiceMinutes(dayIso) {
  const row = await get(
    `
    SELECT AVG(
      (julianday(finished_at) - julianday(called_at)) * 24 * 60
    ) AS avg_minutes
    FROM queue_tickets
    WHERE day_iso = ?
      AND finished_at IS NOT NULL
      AND called_at IS NOT NULL
  `,
    [String(dayIso)],
  );
  const minutes = Number(row?.avg_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 7;
}

export async function computePeopleAhead(ticket) {
  if (!ticket || ticket.status !== "WAITING") return 0;
  const row = await get(
    `
    SELECT COUNT(*) AS n FROM queue_tickets
    WHERE day_iso = ? AND status = 'WAITING' AND position < ?
  `,
    [ticket.day_iso, ticket.position],
  );
  return row?.n ?? 0;
}

export function mapTicketRow(row, peopleAhead, etaMinutes) {
  if (!row) return null;
  return {
    appointmentId: row.appointment_id,
    tokenCode: String(row.position),
    dayIso: row.day_iso,
    position: row.position,
    status: row.status,
    calledAt: row.called_at,
    servedAt: row.served_at,
    finishedAt: row.finished_at,
    peopleAhead,
    etaMinutes,
  };
}

export { pad2 };
