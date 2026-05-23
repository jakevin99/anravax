# Anivax — Health Information System

Web application and REST API for clinic staff managing animal-bite (PEP) workflows: queue, appointments, patient records, vaccination history, and administration. A companion patient app lives in [`../anivax-mobile`](../anivax-mobile).

## Stack

- **Frontend:** React 19, React Router 7 (SSR), Tailwind CSS 4, TanStack Query
- **Backend:** Express 5, SQLite (`server/data/anivax.sqlite`)
- **Auth:** JWT access + refresh tokens; staff roles and API authorities

## Staff roles

| Role | After login | Primary duties |
|------|-------------|----------------|
| **ADMIN** | Admin Dashboard (`/admin`) | Staff accounts, clinic-wide patient list |
| **ENCODER** | Queue (`/queue`) | Front desk: queue, records, personal info only in history |
| **PROGRAM COORDINATOR** | Queue (`/queue`) | Encoder duties + schedule management + full clinical history |

Default administrator (first install only): username `admin`, password `admin123` — change before production use.

Authority model (API): `SCHEDULES_READ`, `SCHEDULES_WRITE`, `USERS_READ`, `USERS_WRITE`. ADMIN bypasses authority checks in middleware.

See [docs/STAFF-ROLES-USER-MANUAL.md](docs/STAFF-ROLES-USER-MANUAL.md) for procedures and troubleshooting.

## Web routes

| Path | Purpose |
|------|---------|
| `/` | Staff login |
| `/admin` | Admin dashboard (ADMIN only) |
| `/queue` | Daily queue (HOME) |
| `/schedules` | Appointment / capacity calendar |
| `/dashboard` | Statistics and charts |
| `/queue/records` | Patient registry |
| `/queue/records/:patientId/history` | Retrieve / print history |
| `/queue/new-consultation`, `/queue/consultation-ocr` | Consultation intake + PDF OCR |
| `/queue/create-profile/:patientId?` | Patient profile |
| `/queue/schedule-appointment` | Book visit |
| `/retrieve/:appointmentId` | Retrieve flow |

## Quick start (development)

Run the API and the web dev server in **two terminals**.

```bash
cd anivax
npm install
```

**Terminal 1 — API** (default `http://localhost:4000/api/v1`):

```bash
npm run api:start
```

**Terminal 2 — Web UI** (default `http://localhost:5173`):

```bash
npm run dev
```

Copy environment variables from [`.env.example`](.env.example) to `.env` and set at least `JWT_SECRET`. The UI reads `VITE_API_BASE_URL` (defaults to `http://localhost:4000/api/v1` if unset).

Optional demo patient data:

```bash
npm run api:seed-profiles
```

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | React Router dev server (port 5173) |
| `npm run api:start` | Express API only (port `API_PORT`, default 4000) |
| `npm run build` | Production client + server bundle |
| `npm start` | Combined API + SSR (`server-entry.js`, port `PORT` or 3000) |
| `npm run api:backup` | SQLite backup to `server/data/backups` |
| `npm run api:seed-profiles` | Seed sample patient profiles |
| `npm run typecheck` | Route types + TypeScript |

## API overview

Base URL: `/api/v1` (e.g. `http://localhost:4000/api/v1` in development).

| Area | Examples |
|------|----------|
| Health | `GET /health` |
| Staff auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` |
| Admin account | `PATCH /auth/admin/password`, `PATCH /auth/admin/username` |
| Users / roles / authorities | CRUD under `/users`, `/roles`, `/authorities` |
| Clinical | `/appointments`, `/schedule-slots`, `/patients`, `/patient-registry`, `/dashboard` |
| Patient (mobile) | `/auth/patient/otp/*`, `/patients/me`, `/queue-tickets/me`, `/dose-schedules/me`, `/files` |
| OCR | `POST /ocr` (consultation PDF; Mistral or OCR.space) |

Full route map: [server/docs/REST-clinical-expansion.md](server/docs/REST-clinical-expansion.md).

### Consultation PDF OCR

1. **Recommended:** set `MISTRAL_API_KEY`. Optional: `MISTRAL_OCR_MODEL`, `MISTRAL_OCR_URL`, `OCR_MAX_FILE_BYTES`.
2. **Fallback:** `OCR_SPACE_API_KEY` or the public demo key (strict limits).

Never commit secrets; use `.env` locally and your host’s secret store in production.

## Production

Build and run a single process that serves both API and SSR:

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t anivax .
docker run -p 3000:3000 --env-file .env anivax
```

Set `PORT`, `JWT_SECRET`, and other variables from `.env.example`. Persist `server/data/` (SQLite and uploads) with a volume.

## Configuration

See [`.env.example`](.env.example) for all supported variables. Common ones:

- `JWT_SECRET` — required for tokens
- `VITE_API_BASE_URL` — frontend API origin (build-time for production client)
- `API_PORT` / `PORT` — API-only vs combined server ports
- `MISTRAL_API_KEY` / `OCR_SPACE_API_KEY` — OCR
- `FEATURE_PATIENT_AUTH`, `FEATURE_PUSH_NOTIFICATIONS`, `FEATURE_AUDIT_LOG` — feature flags
- `SMS_PROVIDER`, `SEMAPHORE_*` — patient OTP SMS (default `stub` logs OTP in dev)

## Data and backups

- SQLite database: `server/data/anivax.sqlite` (created on first API start)
- Uploads: `server/data/uploads` (`FILES_DIR`)
- Backups: `npm run api:backup` → `server/data/backups`

Both `server/data/` and `.env` are gitignored.

## Related documentation

- [Staff roles user manual](docs/STAFF-ROLES-USER-MANUAL.md)
- [REST clinical API expansion](server/docs/REST-clinical-expansion.md)
- [Patient mobile app](../anivax-mobile/README.md)
