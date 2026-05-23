# REST API expansion — clinical queue, schedules, registry, history

This document maps **every data-backed feature** in the Anivax app (beyond the existing admin API) to **RESTful resources** under the same base URL as today: `http://localhost:4000/api/v1`.

## Conventions (aligned with existing server)

| Practice | Choice |
|----------|--------|
| Base path | `/api/v1` |
| Success envelope | `{ "data": ... }` (same as `/users`, `/roles`) |
| Errors | `{ "error": "Human message" }` with appropriate status |
| Pagination query | `page`, `page_size` (snake_case in query string; mirrors `Paginated<T>`) |
| Identifiers | Path params use concrete names: `:userId`, `:appointmentId` |
| Verbs | `GET` read, `POST` create, `PATCH` partial update, `PUT` replace where needed, `DELETE` remove |
| Status codes | `200` OK, `201` Created, `204` No Content, `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict |

**Note:** Static JSON responses use **camelCase** for nested clinical objects (`scheduledAt`, `firstName`) so the React app can match `app/types/domain.ts` without a second mapping layer. Admin list endpoints today return SQL-shaped rows (`first_name`); new clinical routes normalize to camelCase in `data`.

---

## 1. Source scan — what the app does today

| Area | UI / module | Current data source | Persist as |
|------|----------------|---------------------|------------|
| Auth | `LoginPage` | `POST /api/v1/auth/login` | Already in DB |
| Admin users / roles | `AdminDashboardPage` | `GET/POST/PATCH/DELETE …/users`, `…/roles`, … | Already in DB |
| Queue tabs & table | `QueuePage` | `queueService.searchAppointments`, `countAppointmentsByTab` | **appointments** (+ **patients**, **users** as attendant) |
| Schedules table | `SchedulesPage` | `searchScheduleSlots`, CRUD on `/schedule-slots` | **schedule-slots** (capacity rows: `FOLLOW-UP`, `patient_id` NULL) |
| Calendar (home) | `CalendarCard` | `GET /appointments/calendar` | Clinical **appointments** only |
| Calendar (schedules) | `CalendarCard` | `GET /schedule-slots/calendar` | Capacity **schedule-slots** only |
| Add-user registry | `AddUserRecordsPage` | `searchPatientRegistry` | **patients** (+ link to default **appointment** or enrollment record) |
| Retrieve / history | `RetrieveHistoryPage` | `getPatientHistory` | **appointments** + **exposure_records** + **doctors_orders** (+ **patients**) |
| Vitals | `QueuePage` / `VitalsModal` | Optimistic local state only | **appointments.vitals_json** or **vitals** table |
| Create profile | `CreateProfilePage` | Not persisted in `queueService` | **POST /patients** then optional **POST /appointments** |
| Schedule settings | `ScheduleSettingsModal` | Local row state | **PATCH /appointments/:id** (slots / time live in appointment or extension table) |

All of the above are candidates for **SQLite (or Postgres) tables** and **HTTP resources** on this server.

---

## 2. Resource model (normalized)

### Core

- **`patients`** — demographics and registry fields (`Patient` in `domain.ts`).
- **`appointments`** — clinical visits only in the API (`QUEUE`, `REQUESTS`, `FOLLOW-UP` **with** `patient_id`). `scheduled_at`, `tab`, `status`, `category`, FK `patient_id`, FK `attendant_user_id` → `users`, optional `vitals_json`.
- **`schedule-slots`** — vaccination **capacity** (same physical table: `FOLLOW-UP` + `patient_id` NULL). Exposed as `/api/v1/schedule-slots` so clients never mix capacity with patient visits.
- **`exposure_records`** — 1:1 with `appointment_id` (PK FK); maps to `ExposureRecord`.
- **`doctors_orders`** — 1:1 with `appointment_id`; store `payload_json` for full `DoctorsOrder` graph.

### Optional / later

- Capacity counters (`slot_used`, `slot_total`) live on schedule-slot rows; booking/reschedule updates them via `PATCH /schedule-slots/:scheduleSlotId`.
- **`audit_logs`** — who changed vitals, orders, etc.
- **`files`** — `uploadedFileUrl` on exposure becomes `POST /files` + FK.

---

## 3. REST routes (proposed + implemented subset)

### Implemented — clinical appointments (`server/appointmentsRoutes.js`)

| Method | Path | Description |
|--------|------|---------------|
| `GET` | `/api/v1/appointments/tab-counts` | Tab totals for a calendar day (patient visits only). |
| `GET` | `/api/v1/appointments/calendar` | Month grid for **clinical** appointments (`year`, `month`). |
| `GET` | `/api/v1/appointments` | List + filters: `tab`, `date`, name search, `page`, `page_size`. Excludes capacity slots. |
| `GET` | `/api/v1/appointments/:appointmentId` | Single appointment with nested `patient` and `attendant`. |
| `GET` | `/api/v1/appointments/:appointmentId/history` | Aggregate for retrieve page (`PatientHistory` shape). |
| `POST` | `/api/v1/appointments` | Create patient visit. `FOLLOW-UP` **requires** `patientId`; capacity → use `/schedule-slots`. |
| `PATCH` | `/api/v1/appointments/:appointmentId` | Partial update. Rejects capacity rows (`409` → use `/schedule-slots`). |
| `DELETE` | `/api/v1/appointments/:appointmentId` | Remove appointment (cascades to exposure / doctors order). |

### Implemented — schedule slots (`server/scheduleSlotsRoutes.js`)

| Method | Path | Description |
|--------|------|---------------|
| `GET` | `/api/v1/schedule-slots/calendar` | Month grid for capacity schedules only. |
| `GET` | `/api/v1/schedule-slots` | Paginated capacity slots (`date`, `page`, `page_size`). |
| `POST` | `/api/v1/schedule-slots` | Create vaccination capacity row (`scheduledAt`, `slotTotal`, …). |
| `GET` | `/api/v1/schedule-slots/:scheduleSlotId` | Single capacity slot. |
| `PATCH` | `/api/v1/schedule-slots/:scheduleSlotId` | Update time, slots, `slotUsed`, status. |
| `DELETE` | `/api/v1/schedule-slots/:scheduleSlotId` | Delete capacity slot. |

### Recommended next routes (not all wired yet)

| Method | Path | Description |
|--------|------|---------------|
| `GET` | `/api/v1/calendar-days` | (Optional alias) Prefer `/appointments/calendar` or `/schedule-slots/calendar`. |
| `GET` | `/api/v1/patient-registry` | Paginated registry rows (patient + default `appointmentId`). |
| `GET` | `/api/v1/patients/matches` | Identity lookup (`first_name`, `last_name`, `birth_date`, optional `exclude_patient_id`) for duplicate checks. |
| `GET` | `/api/v1/patients/:patientId` | Full patient profile. |
| `POST` | `/api/v1/patients` | Register patient (create profile flow). Returns `409` if same name + birth date exists. |
| `PUT` | `/api/v1/patients/:patientId` | Replace demographics (create profile save). Returns `409` on identity conflict with another row. |
| `GET` | `/api/v1/appointments/:appointmentId/exposure` | Exposure sub-resource (optional split from history). |
| `PATCH` | `/api/v1/appointments/:appointmentId/exposure` | Update exposure. |
| `GET` | `/api/v1/appointments/:appointmentId/doctors-order` | JSON payload. |
| `PUT` | `/api/v1/appointments/:appointmentId/doctors-order` | Replace order document. |
| `PATCH` | `/api/v1/appointments/:appointmentId/vitals` | Dedicated vitals patch (alternative to PATCH on parent). |

**Why not RPC-style `/getQueue`?**  
Query parameters on a **collection** (`GET /appointments?tab=QUEUE&date=…`) keep navigation cacheable and cache-friendly, and match how `queueService.searchAppointments` already thinks.

---

## 4. Security (next step)

- Reuse session/JWT after `POST /auth/login`; send `Authorization: Bearer …` or cookie.
- Enforce **PROGRAM COORDINATOR** (or `SCHEDULES_WRITE` authority already seeded in `role_authorities`) on `POST` / `PATCH` / `DELETE` for appointments.
- Return `403` when role lacks authority.

---

## 5. Frontend migration

Replace `queueService` mock implementations with `fetch(\`${API_BASE}/appointments?...\`)` and map errors. Keep `toISODate` and types in `app/types/domain.ts` as the contract; server responses should match those shapes in `data`.
