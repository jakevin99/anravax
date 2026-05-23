/**
 * Queue ticket REST routes.
 *
 *   GET    /api/v1/queue-tickets?date=YYYY-MM-DD              (staff)
 *   GET    /api/v1/queue-tickets/me                            (patient)
 *   GET    /api/v1/queue-tickets/:appointmentId                (staff)
 *   POST   /api/v1/queue-tickets                               (staff)  body: { appointmentId }
 *   POST   /api/v1/queue-tickets/call-next                     (staff)  body: { date? }
 *   PATCH  /api/v1/queue-tickets/:appointmentId                (staff)  body: { status }
 */

import { get } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import {
  callNextTicket,
  computePeopleAhead,
  dayIsoFromScheduledAt,
  getTicketByAppointment,
  getTicketsForDay,
  issueTicket,
  mapTicketRow,
  rollingAverageServiceMinutes,
  setTicketStatus,
} from "./services/queue.js";

const staffRead = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_READ" });
const staffWrite = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_WRITE" });
const patientOnly = requireAuth({ actorKinds: ["patient"] });

function todayIso() {
  const d = new Date();
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function expandTicket(ticket) {
  if (!ticket) return null;
  const peopleAhead = await computePeopleAhead(ticket);
  const avg = await rollingAverageServiceMinutes(ticket.day_iso);
  const eta = ticket.status === "WAITING" ? Math.round(peopleAhead * avg) : 0;
  return mapTicketRow(ticket, peopleAhead, eta);
}

export function mountQueueTicketsRoutes(app, API_PREFIX) {
  app.get(`${API_PREFIX}/queue-tickets`, staffRead, async (req, res, next) => {
    try {
      const date = req.query.date ? String(req.query.date) : todayIso();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "Query 'date' must be YYYY-MM-DD." });
        return;
      }
      const rows = await getTicketsForDay(date);
      const items = [];
      for (const r of rows) {
        items.push(await expandTicket(r));
      }
      res.status(200).json({ data: { items } });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    `${API_PREFIX}/queue-tickets/me`,
    patientOnly,
    async (req, res, next) => {
      try {
        const today = todayIso();
        const ticket = await get(
          `
          SELECT qt.*
          FROM queue_tickets qt
          JOIN appointments a ON a.id = qt.appointment_id
          WHERE a.patient_id = ?
            AND qt.day_iso = ?
            AND qt.status IN ('WAITING','CALLED','SERVING')
          ORDER BY qt.position ASC
          LIMIT 1
        `,
          [String(req.actor.id), today],
        );
        if (!ticket) {
          res.status(200).json({ data: null });
          return;
        }
        res.status(200).json({ data: await expandTicket(ticket) });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    `${API_PREFIX}/queue-tickets/:appointmentId`,
    staffRead,
    async (req, res, next) => {
      try {
        const ticket = await getTicketByAppointment(req.params.appointmentId);
        if (!ticket) {
          res.status(404).json({ error: "Ticket not found." });
          return;
        }
        res.status(200).json({ data: await expandTicket(ticket) });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(`${API_PREFIX}/queue-tickets`, staffWrite, async (req, res, next) => {
    try {
      const appointmentId = req.body?.appointmentId;
      if (!appointmentId) {
        res.status(400).json({ error: "Field 'appointmentId' is required." });
        return;
      }
      const ticket = await issueTicket(String(appointmentId));
      res.status(201).json({ data: await expandTicket(ticket) });
    } catch (error) {
      if (error?.code === "NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post(
    `${API_PREFIX}/queue-tickets/call-next`,
    staffWrite,
    async (req, res, next) => {
      try {
        const date = req.body?.date ? String(req.body.date) : todayIso();
        const ticket = await callNextTicket(date);
        if (!ticket) {
          res.status(200).json({ data: null, info: "Queue is empty." });
          return;
        }
        res.status(200).json({ data: await expandTicket(ticket) });
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    `${API_PREFIX}/queue-tickets/:appointmentId`,
    staffWrite,
    async (req, res, next) => {
      try {
        const status = req.body?.status;
        if (!status) {
          res.status(400).json({ error: "Field 'status' is required." });
          return;
        }
        const ticket = await setTicketStatus(req.params.appointmentId, status);
        if (!ticket) {
          res.status(404).json({ error: "Ticket not found." });
          return;
        }
        res.status(200).json({ data: await expandTicket(ticket) });
      } catch (error) {
        if (error?.code === "INVALID_STATUS") {
          res.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );
}

export { dayIsoFromScheduledAt };
