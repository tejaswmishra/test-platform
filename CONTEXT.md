# Test Platform — Project Context

> Internal recruitment + employee training test platform for Samsung.
> Two interfaces: Client (candidates/employees taking tests) and Admin (creating/managing tests).

## Tech Stack

- **Frontend:** Next.js (App Router), TypeScript, no external UI library — custom inline styles
- **Backend:** Express.js (v5), Node.js, ES Modules (`"type": "module"` in package.json)
- **Database:** PostgreSQL, hosted on Neon (serverless, cloud — accessible from any machine)
- **Auth:** JWT (`jsonwebtoken` on backend, `jose` for Edge-compatible verification in Next.js middleware)
- **File generation:** `exceljs` for bulk question upload + results export
- **File upload:** `multer` (memory storage, for parsing Excel uploads)

## Repository Structure

```
test-platform/
├── apps/
│   ├── api/                  ← Express backend
│   │   ├── index.js          ← entry point, mounts all routers
│   │   ├── middleware/
│   │   │   ├── auth.js       ← requireAuth, requireRole
│   │   │   └── antiCheat.js  ← validateAttempt, calculateScore, autoSubmitOnTimeout
│   │   ├── routes/
│   │   │   ├── auth.js       ← POST /auth/login
│   │   │   ├── admin.js      ← candidates, tests, assign, assignments (all admin-only)
│   │   │   ├── tests.js      ← GET /tests/assigned (candidate dashboard data)
│   │   │   └── attempts.js   ← start, answer, status, submit, events
│   │   └── db/
│   │       ├── migrate.js    ← creates all tables, run once per fresh DB
│   │       └── seed.js       ← creates default admin account, idempotent
│   └── web/                  ← Next.js frontend
│       ├── middleware.ts     ← route protection, verifies JWT cookie (root level!)
│       ├── app/
│       │   ├── api/
│       │   │   ├── auth/login/route.ts   ← proxies to Express, sets httpOnly cookie
│       │   │   ├── auth/logout/route.ts  ← deletes cookie
│       │   │   └── proxy/[...path]/route.ts ← forwards all other API calls, attaches Bearer token from cookie
│       │   ├── login/page.tsx           ← candidate/employee login (toggle)
│       │   ├── admin/login/page.tsx     ← separate admin login (different styling, not linked publicly)
│       │   ├── dashboard/page.tsx       ← candidate/employee dashboard
│       │   └── test/[attemptId]/        ← NOT YET BUILT — test-taking UI
│       └── lib/auth.ts       ← getCurrentUser() server helper, apiFetch() client helper
├── .gitignore
└── README.md
```

## Database Schema (current state)

### users
- `id` UUID PK, `name`, `email` (nullable), `phone` (nullable), `company_id` (nullable), `role` (`candidate`|`employee`|`admin`), `password_hash` (bcrypt)
- Candidates/admin login via email. Employees login via company_id.

### tests
- `id` UUID PK, `title`, `description`, `duration_minutes`, `pass_percentage` (default 60), `shuffle_questions` (bool), `is_active` (bool), `created_by` FK→users

### questions
- `id` UUID PK, `test_id` FK→tests (CASCADE DELETE), `question_text`, `option_a/b/c/d`, `correct_option` (char a-d), `marks`, `order_index`
- Questions belong to exactly ONE test — no shared question bank (deliberate decision)

### test_assignments
- `id` UUID PK, `test_id` FK, `user_id` FK, `assigned_at`, `attempt_status` (`pending`|`in_progress`|`submitted`)
- UNIQUE(test_id, user_id) — prevents duplicate assignment

### attempts
- `id` UUID PK, `test_id` FK, `user_id` FK, `started_at` (TIMESTAMPTZ), `submitted_at` (TIMESTAMPTZ), `score`, `submit_status`, `submit_reason` (`manual`|`tab_switch`|`timeout`|etc), `is_voided`, `question_order` (JSONB array of question UUIDs — the per-candidate shuffle order)
- **IMPORTANT:** all timestamp columns are `TIMESTAMPTZ`, not `TIMESTAMP`. We hit a real bug early on where plain `TIMESTAMP` columns caused JS `Date` parsing to misinterpret timezone, breaking the server-side timer. Never use plain `TIMESTAMP` for anything time-sensitive in this project.

### responses
- `id` UUID PK, `attempt_id` FK, `question_id` FK, `selected_option` (char a-d, NULLABLE), `marked_for_review` (bool, default false), `answered_at`
- UNIQUE(attempt_id, question_id)
- A row existing with `selected_option = null` but `marked_for_review = true` represents "marked for review, not yet answered" — this is why selected_option had its NOT NULL constraint dropped.
- A row NOT existing at all = question untouched entirely.

### attempt_events
- `id` UUID PK, `attempt_id` FK, `event_type` (`manual_submitted`|`auto_submitted`|`tab_switch`|etc), `occurred_at`, `metadata` (JSONB)
- Audit trail — append-only log of everything that happened during an attempt.

## Key Architectural Decisions (and why)

1. **JWT payload is identical shape for all 3 roles** (`userId`, `role`, `name`). Role-based access is enforced via `requireRole(...roles)` middleware, not separate auth systems.

2. **Server-side timer is the source of truth, never trust frontend.** `validateAttempt` middleware recalculates elapsed time from `started_at` on every request to `/answer` and `/submit`. If expired, it auto-submits and scores right there in the middleware, before the route handler even runs.

3. **Candidates never receive `correct_option` in any API response.** The `getQuestionsInOrder` helper explicitly excludes it. Admin-only routes (`GET /admin/tests/:id`) do include it.

4. **Per-candidate question shuffle happens ONCE, at attempt creation, not on every fetch.** The shuffled order is saved permanently to `attempts.question_order` (a JSONB array of question IDs). Resuming an attempt always re-reads this saved order — it never re-shuffles mid-attempt.

5. **Anti-cheat is split across frontend + backend deliberately:**
   - Frontend (`useAntiCheat` hook, not yet built): browser event listeners (`visibilitychange`, `blur`/`focus`, `beforeunload`) detect tab-switches/window changes and immediately call `/attempts/:id/submit`.
   - Backend (`validateAttempt` middleware): the actual gatekeeper — checks ownership, status, and timer on every write request, regardless of what the frontend does. This means even a tampered frontend can't bypass the rules.
   - `/attempts/:id/events` route deliberately skips `validateAttempt` — we want to log a cheat event even if the attempt was already closed a moment earlier (race condition safety), since it's an audit log, not a gate.

6. **Auth uses httpOnly cookies on the frontend, Bearer tokens on the backend — bridged by a proxy route.** Browser JS never has access to the raw JWT (XSS protection). `app/api/proxy/[...path]/route.ts` reads the cookie server-side and forwards requests to Express with `Authorization: Bearer <token>` attached. ALL frontend API calls go through `/api/proxy/...`, never directly to `localhost:5000`.

7. **Admin login is a separate page (`/admin/login`), not a toggle option on the public login page.** Deliberate security choice — keeps the admin entry point undiscoverable from the candidate-facing surface.

8. **Database hosted on Neon (cloud), not local Postgres.** Enables developing from both home and office machines against the same data, since office PC can't push code but CAN read from the same cloud DB if `.env` is configured there too.

9. **Connection pool sizing matters for the 500-concurrent-candidate target.** `pg.Pool({ max: 20, ... })` — not unlimited, not default. Combined with frontend auto-save every 15-30s (not per-keystroke), this keeps simultaneous DB writes manageable on modest server hardware. Node's event loop itself handles many concurrent I/O-bound connections fine even on weak hardware; the database connection pool is the actual constraint to tune.

## What's Done (backend — fully tested)

- [x] Auth: login for all 3 roles, JWT issuance
- [x] requireAuth + requireRole middleware
- [x] Admin: create candidates (temp password), create test+questions (transaction), assign test (specific or all), view assignments
- [x] Candidate: view assigned tests, start/resume attempt (with shuffle), save/clear answer, mark for review, question status list, submit + scoring
- [x] validateAttempt anti-cheat middleware (ownership, status, server-timer with auto-submit)
- [x] Seed script for default admin

## What's Done (frontend — designed, NOT yet created as files)

- [ ] `/login` page — candidate/employee toggle (code written, not yet saved to project)
- [ ] `/admin/login` page (code written, not yet saved to project)
- [ ] `/dashboard` page (code written, not yet saved to project)
- [ ] `middleware.ts`, cookie-setting login API route, proxy route (all written, not yet saved to project)

## What's NOT Started

- [ ] Test-taking page (`/test/[attemptId]`) — question slides, pagination grid with 4-color status, timer UI, useAntiCheat hook
- [ ] Admin: create test form (manual entry UI)
- [ ] Admin: bulk Excel upload (backend route designed earlier in conversation, not yet built)
- [ ] Admin: responses table view, terminate/reset attempt
- [ ] Excel export of results (backend route designed earlier, not yet built)
- [ ] Loading states, empty states, error boundaries throughout

## Environment Variables

**apps/api/.env**
```
DATABASE_URL=<neon connection string, pooled>
JWT_SECRET=<shared secret, must match web's .env.local exactly>
PORT=5000
CLIENT_URL=http://localhost:3000
SEED_ADMIN_EMAIL=...
SEED_ADMIN_PASSWORD=...
SEED_ADMIN_NAME=...
```

**apps/web/.env.local**
```
NEXT_PUBLIC_API_URL=http://localhost:5000
API_URL=http://localhost:5000
JWT_SECRET=<MUST match api's JWT_SECRET exactly>
```

## Known Gotchas / Bugs Already Fixed

1. **Timezone bug (fixed):** Postgres `TIMESTAMP` (no timezone) columns caused JS `Date` parsing to misread elapsed time by several hours in some code paths. Fixed by migrating all timestamp columns to `TIMESTAMPTZ`. Lesson: always use `TIMESTAMPTZ` for anything timer-related.
2. **`.env` location matters:** must live in `apps/api/.env`, NOT the monorepo root — `dotenv.config()` resolves relative to where `node` is actually run from.
3. **PATCH vs POST, singular vs plural route confusion:** `/attempts/:id/answer` (singular, PATCH) saves one answer. `/attempts/:id/answers` (plural, GET) lists all saved answers. Easy to typo.
4. **bcrypt hashes are one-way** — if a temp password is lost, there is no recovery; must issue a new one.

## Coding Conventions Used So Far

- Express routes always validate input before touching the DB, return early with 400 on bad input.
- All multi-step writes (test+questions creation) use explicit `BEGIN`/`COMMIT`/`ROLLBACK` transactions via `pool.connect()` → `client.query()` → `client.release()`.
- Every route wrapped in try/catch, logs the error server-side, returns a generic `{ error: "..." }` message to the client (never leaks raw DB errors to the frontend).
- `req.app.locals.pool` is how route files access the shared DB connection pool (set once in `index.js`).
- Middleware factory pattern used for `requireRole(...roles)` — returns a middleware function, allows flexible role lists per-route.