import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("admin", "routes/admin.tsx"),
  route("schedules", "routes/schedules.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("queue/new-consultation", "routes/queue-new-consultation.tsx"),
  route("queue/consultation-ocr", "routes/queue-consultation-ocr.tsx"),
  route("queue/records/:patientId/history", "routes/queue-records-history.tsx"),
  route("queue/records", "routes/queue-records.tsx"),
  route("queue/add-user", "routes/queue-add-user.tsx"),
  route("queue/create-profile/:patientId?", "routes/queue-create-profile.tsx"),
  route("queue/schedule-appointment", "routes/queue-schedule-appointment.tsx"),
  route("queue", "routes/queue.tsx"),
  route("retrieve/:appointmentId", "routes/retrieve.tsx"),
] satisfies RouteConfig;
