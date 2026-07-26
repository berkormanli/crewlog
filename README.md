# CrewLog

Workforce task, document, support-request & daily effort tracker for consulting teams.

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Fastify + TypeScript + Knex.js + PostgreSQL

## Quick Start

### Prerequisites
- Node.js 20+
- Docker (for the bundled Postgres) OR a local Postgres 14+

### 1. Database

```bash
docker compose up -d postgres
```

Or point `DATABASE_URL` at any Postgres 14+ instance.

### 2. Backend

```bash
cd backend
cp .env.example .env       # edit if needed
npm install
npm run migrate            # runs Knex migrations
npm run seed               # seeds demo tenant/users/projects/tasks/logs
npm run dev                # starts Fastify on http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env       # defaults to http://localhost:4000
npm install
npm run dev                # starts Vite on http://localhost:5173
```

Open http://localhost:5173 and log in.

## Default Logins (seeded)

| Role     | Email                          | Password   |
|----------|--------------------------------|------------|
| admin    | admin@crewlog.local            | Admin123!  |
| manager  | manager.alex@crewlog.local     | Manager123!|
| manager  | manager.sam@crewlog.local      | Manager123!|
| worker   | worker.jordan@crewlog.local    | Worker123! |
| worker   | worker.taylor@crewlog.local    | Worker123! |
| worker   | worker.morgan@crewlog.local    | Worker123! |
| worker   | worker.casey@crewlog.local     | Worker123! |

## Timesheet (weekly grid)

The primary work-log surface. Built as a TimeCamp-style grid:

- **Day view** (default) — one row per `(project, task)` combination logged
  in the visible day, with chronological entries below.
- **Calendar view** — month overview with per-day totals + expected hours.
- Summary cards: selected-day total, activity count, first start, and last end.
- A worker picker (manager+ only) lets a manager view any team member's timesheet.
- Entries outside the backdate window are read-only.
- The Kanban board was removed; the `/tasks` and `/tasks/list` pages now
  carry all task work.

Routes:

- `/logs/timesheet` — day + calendar views (default for everyone).
- `/logs` — read-only monthly history view (edit entries from the Timesheet).

## Activity log (ad-hoc)

The "Log activity" modal supports three modes:

- **Project-bound** — pick a project, optionally a task.
- **Customer-bound** — pick a customer log time against a customer without
  a project (e.g. "1h call with Riverside about Q3 plans").
- **Ad-hoc** — leave both blank and just record the time. Use this for
  generic on-site duties, paperwork, or personal time.

Each entry also captures:

- **Module** — the SAP workstream (MM, SD, WM, EWM, PP, FI/CO,
  ABAP, Basis). Curated per tenant via `/api/v1/work_modules`. Pick
  **Other…** to free-text.
- **Activity type** — the kind of work (Development, Support, Analysis,
  Testing, Meeting, Documentation, Training, Administration, Travel).
  Curated via `/api/v1/work_activity_types` with the same **Other…** fallback.
- **Location** — Office, Home/Remote, Customer Site, or Travel. Curated per
  tenant via `/api/v1/work_locations`. Pick **Other…** to free-text.
- **Time window** — select a 24-hour start and end time in 15-minute
  increments. New logs default to the most recent quarter hour and a
  one-hour window.

All entries are bucketed by `(project, task, customer)` in the day calendar,
with fully ad-hoc (no project, no customer) entries in their own row.

## Timezone

Every user has a timezone (IANA id, e.g. `Europe/Istanbul`). The first
time a user logs in, the timezone is captured automatically in this order:

1. What the browser reports via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
2. An IP-based geolocation lookup against `ipapi.co` (free, no auth).
3. Country→timezone fallback if no city-level result is available.

Users can change their timezone at any time in **Settings → Timezone**.
The current timezone is shown in the Timesheet header.

## Activity feed

`/admin/activity` is a manager+ admin feed that surfaces every recorded action
across the tenant — task create / update / status change, work-log create /
update / delete, project member add / remove, folder / document upload /
archive / delete, task-request create / approve / reject, capacity override
set / clear, customer create / update / delete, user invite / update /
deactivate, and so on.

Each row shows the actor, a one-line summary of what changed (e.g.
“Renamed task” with status / assignee / due-date diff), a relative timestamp,
and a click-through to the underlying record when one is available.
Filters: entity type, action, actor, date range, free-text search. The
underlying `audit_log` table is also written to by the dashboard’s
“recent activity” tile, so the data drives both surfaces.

## Customers

Customers are the businesses / external parties you do projects for. Each project
can be bound to one customer (or left unbound for internal-only work). Managing
customers as a first-class entity lets you:

- Filter projects by customer (`/projects` → "Filter by customer")
- See, on each project card and the project detail header, which customer it belongs to
- See, on `/customers/:id`, the full list of projects for that customer

`/customers` is the list page (manager+ can add/edit/delete); everyone can view.

## Task workflow

Tasks move through the first Efor workflow:

```
Backlog → To do → In progress → Waiting → Review → QA → Done
```

New manager-created tasks start in **Backlog**. Approved worker requests start
in **To do**, ready for the requester to act on.

## Task requests

Workers can request work without needing manager approval upfront:

- On `/tasks` (My Tasks), every worker sees a **Request task** button. Clicking it
  opens a modal where they describe the work, pick a project, set priority,
  difficulty, and due date, then submit.
- The same page shows the worker's request history inline ("My requests") with
  status badges (Pending review, Approved, Rejected, Cancelled). Pending ones can
  be edited or cancelled by the owner.
- Managers review at `/tasks/requests` with status filter tabs (Pending / Approved
  / Rejected / Cancelled / All). Approving **creates a real `tasks` row** assigned
  to the requester, links it back to the request, and lets the manager attach a
  note. Rejecting closes the request with an optional note.

### Backdate window (policy)

Workers may only log time for **today** or up to **`BACKDATE_WINDOW_DAYS`** (default `2`) in the past. Managers+ can edit / log anything. Out-of-window POSTs return:

```json
{ "error": { "code": "out_of_window", "message": "You can only log time for today or up to 2 day(s) in the past", "details": { "windowDays": 2 } } }
```

Change the window:

```bash
# .env (backend)
BACKDATE_WINDOW_DAYS=3
```

### Actual-hours reporting

The user-facing Timesheet reports actual effort only; it does not compare
people against expected-hour targets. The existing `default_daily_hours` and
`daily_capacity` storage/API are retained temporarily for backward
compatibility, but they are not exposed by the current UI.

## Fireflies.ai + LLM seams

The schema and HTTP routes for ingesting meeting transcripts and emitting LLM-driven action proposals are in place. They are **disabled by default** until you opt in.

Enable:

```bash
# .env (backend)
FIREFLIES_ENABLED=true
FIREFLIES_WEBHOOK_SECRET=<hex secret used for HMAC-SHA256 signature verification>
LLM_PROVIDER=stub       # 'stub' | 'openai' | 'anthropic'
LLM_API_KEY=...
```

Endpoints (when enabled):

- `POST /api/v1/integrations/fireflies/webhook` — public, HMAC-signed. Ingests a fireflies-shaped payload (`meetingId`, `title`, `transcriptText`, `participants[]`, `hostEmail`, `startedAt`, `endedAt`). Resolves tenant by `hostEmail`. Returns `202 { accepted, meetingId }`.
- `GET  /api/v1/meetings` — manager+ list of ingested meetings.
- `GET  /api/v1/meetings/:id` — meeting + participants + proposals.
- `POST /api/v1/meetings/:id/dispatch` — manager+ runs the LLM dispatcher. The default `stub` scans the transcript for keyword patterns (`done / tamamlandı`, `tomorrow / yarın`, `<n> hours / saat`, `create / new / yeni`) and inserts `meeting_action_proposals` rows. Swap `dispatchLLM` in `backend/src/modules/meetings/routes.ts` for an OpenAI / Anthropic call to upgrade.
- `POST /api/v1/meeting-proposals/:id/apply` — manager+ applies a proposal (writes a work_log, creates a task, etc.).
- `POST /api/v1/meeting-proposals/:id/reject` — manager+ rejects.
- `GET  /api/v1/integrations/settings` / `PUT /api/v1/integrations/settings` — read / write per-tenant integration config (provider, enabled, API key, webhook secret).

All proposal actions are auditable: `meeting_action_proposals.status` flips through `pending → applied` / `failed` / `rejected`, with `applied_error` set on failure and `reviewed_by` + `reviewed_at` set when a human approves.

## Scripts

### Backend
- `npm run dev` — Fastify dev server with hot reload
- `npm run migrate` — Apply Knex migrations
- `npm run migrate:rollback` — Rollback last batch
- `npm run seed` — Seed demo data (idempotent — wipes & re-seeds)
- `npm run typecheck` — tsc --noEmit
- `npm run smoke` — Run `scripts/smoke.sh` end-to-end curl tests
- `npm run build` — Compile to `dist/`

### Frontend
- `npm run dev` — Vite dev server
- `npm run build` — Type-check + production build
- `npm run preview` — Preview production build

## Architecture

```
crewlog/
├── backend/                # Fastify API
│   ├── src/
│   │   ├── server.ts
│   │   ├── config.ts
│   │   ├── db/             # Knex instance
│   │   ├── modules/        # Feature modules: auth, users, projects,
│   │   │                   #   tasks, documents, work-logs, dashboard
│   │   ├── lib/            # jwt, password, mailer, storage, errors
│   │   └── middleware/     # auth, rbac, tenant, error handler
│   ├── migrations/
│   ├── seeds/
│   ├── scripts/            # smoke tests
│   └── uploads/            # local document storage (gitignored)
└── frontend/               # React SPA
    └── src/
        ├── api/            # typed fetchers
        ├── components/
        ├── features/       # per-feature UI (tasks, logs, documents, ...)
        ├── hooks/
        ├── lib/
        ├── pages/
        ├── routes/         # routing & guards
        ├── stores/         # zustand stores
        ├── types/
        └── App.tsx
```

## Environment Variables

See `backend/.env.example` and `frontend/.env.example` for the full list.

## License

MIT — internal demo project.
