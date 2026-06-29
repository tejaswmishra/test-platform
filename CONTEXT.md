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

9. **Connection pool sizing matters for the 500-concurrent-candidate target.** `pg.Pool({ max: 20, ... })` — not unlimited, not default. Combined with frontend auto-save every 20s (not per-keystroke), this keeps simultaneous DB writes manageable on modest server hardware. Node's event loop itself handles many concurrent I/O-bound connections fine even on weak hardware; the database connection pool is the actual constraint to tune.

10. **Option order is shuffled per-candidate too, same pattern as question order.** `attempts.option_order` is a JSONB map of `{ questionId: ['c','a','d','b'] }` — generated once at attempt creation, saved permanently, reused on resume. Critically, the frontend ALWAYS translates a clicked option back to its ORIGINAL letter before sending it to the backend — so `responses.selected_option` and all scoring logic never need to know shuffling exists at all. Shuffling is a presentation-only concern, fully contained in the browser.

11. **Rate limiting applies ONLY to `/attempts/:id/answer`, never to `/submit` or `/events`.** Submit is a single critical action — rate-limiting it risks blocking a legitimate submission. The `answerLimiter` (20 req/min per IP) exists purely as a safety net against bugs/abuse, not something normal debounced auto-save (every 20s) should ever approach. Frontend treats a 429 the same as any other save failure — retries with backoff, never silently drops the pending answer.

## What's Done (backend — fully tested)

- [x] Auth: login for all 3 roles, JWT issuance
- [x] requireAuth + requireRole middleware
- [x] Admin: create candidates (temp password), create test+questions (transaction), assign test (specific or all), view assignments
- [x] Candidate: view assigned tests, start/resume attempt (with shuffle), save/clear answer, mark for review, question status list, submit + scoring
- [x] validateAttempt anti-cheat middleware (ownership, status, server-timer with auto-submit)
- [x] Seed script for default admin

## What's Done (frontend — built AND verified working in browser)

- [x] `/login` page — candidate/employee toggle, calls `/api/auth/login`, redirects to `/dashboard`
- [x] `/admin/login` page — separate dark-styled page, not linked publicly
- [x] `/dashboard` page — fetches `/tests/assigned`, renders pending/in-progress/completed sections, "Start Test" navigates to `/test/[attemptId]?testId=...`
- [x] `middleware.ts` — verifies JWT cookie via `jose`, redirects to correct login page based on route + role
- [x] `app/api/auth/login/route.ts` — proxies to Express, sets httpOnly cookie
- [x] `app/api/auth/logout/route.ts` — deletes cookie
- [x] `app/api/proxy/[...path]/route.ts` — forwards all other API calls, attaches Bearer token from cookie
- [x] `hooks/useAntiCheat.js` — visibilitychange/blur/focus/beforeunload listeners
- [x] **Results page (`/results/[attemptId]`) — FULLY BUILT AND VERIFIED:**
  - Shows score + percentage + full question-by-question breakdown (your answer vs correct answer, color coded)
  - Access gated by `test_type === 'internal' && show_responses_to_employee === true`
  - Dashboard conditionally renders "View Results" button vs plain "Submitted" label per `can_view_results` flag
  - Direct URL access to a disallowed attempt's results CONFIRMED blocked server-side (403), not just hidden in UI

## Architectural Decision — Internal vs External Tests (added after initial build)

**Requirement:** Two test types exist. `external` (recruitment/new joinees) — candidates NEVER see score or responses, hardcoded, not configurable. `internal` (employee training) — admin can optionally enable `show_responses_to_employee`, and if enabled, employees see a FULL breakdown (their answer + correct answer per question) after submitting.

**Schema:** `tests.test_type` (`'internal'|'external'`, default `'external'`), `tests.show_responses_to_employee` (boolean, default `false`).

**Three-layer enforcement, deliberately redundant — this is the pattern to follow for any future business/fairness rule, not just this feature:**
1. **DB constraint** — `CHECK (NOT (test_type = 'external' AND show_responses_to_employee = true))`. Physically impossible to store the invalid combination.
2. **Creation-time validation** — `POST /admin/tests` rejects the invalid combination with a clean 400 before it ever reaches the DB constraint.
3. **Access-time validation** — `GET /attempts/:id/results` re-checks `test_type` and `show_responses_to_employee` fresh from the DB on every request, regardless of what the frontend shows or hides. Never trust "the button wasn't rendered" as the only protection.

**New routes added for this feature:**
- `POST /admin/employees`, `GET /admin/employees` — mirrors the candidate routes but for `role = 'employee'`, using `company_id` instead of `email`. (This was a previously-missing gap — employees were assumed pre-existing but we never built a way to actually create one for testing/demo.)
- `GET /attempts/:attemptId/results` — the gated breakdown route described above.
- `GET /tests/assigned` updated to include `test_type`, `show_responses_to_employee`, and a computed `can_view_results` boolean per completed test, so the dashboard knows what to render without re-deriving the rule itself (though the rule is STILL re-checked server-side on the actual results route, this is just for UI convenience).

## What's NOT Started

- [ ] Admin dashboard/UI entirely — currently NO admin-facing pages exist (`/admin/dashboard`, create-test form, candidate list with "registered today" filter, responses table, terminate/reset buttons)
- [ ] Admin: bulk Excel upload (backend route designed earlier in conversation, not yet built)
- [ ] Excel export of results (backend route designed earlier, not yet built)
- [ ] Loading states, empty states, error boundaries — present in dashboard/test page, NOT yet audited across admin pages (since admin pages don't exist yet)
- [ ] Office-PC-specific: local Postgres needs schema kept in sync with Neon (`option_order` column was added to Neon — confirm it's also run on local Postgres at office, since today's office session predates that schema addition)

## TODOS for today (office, no AI/push access)

1. **First priority — confirm local Postgres has `option_order` column.** Run in pgAdmin Query Tool:
   ```sql
   ALTER TABLE attempts ADD COLUMN IF NOT EXISTS option_order JSONB;
   ```
   This was added AFTER your last office session, so local Postgres is likely missing it. Without this, `/attempts/start` will throw a DB error on this machine specifically.

2. **Re-verify the full candidate flow end-to-end on local Postgres**, same as you just did at home: login → dashboard → start test → answer/mark-for-review/navigate via grid → tab-switch triggers auto-submit → resume restores state correctly. This confirms the frontend work from tonight also works against the office's local DB, not just Neon.

3. **Investigate the timer bug** (see above) — even without AI, you can read through `POST /attempts/start` in `attempts.js` and compare the fresh-start vs resume branches side by side. The fix is likely a one-line addition once you spot it. If you find and fix it, that's a clean win to bring home tonight.

4. **Do NOT attempt to build admin UI today** — that's a larger, multi-file task better tackled with AI assistance at home tonight, not worth starting and abandoning half-built on a machine you can't push from.

5. **Useful offline task: sketch the admin dashboard layout on paper** — what sections exist (candidate list, create test, assign, view responses), roughly how they're organized. This sets up tonight's AI-assisted build session with a clear plan already decided.

6. **Document any NEW bugs found today** in this same style as the timer bug above — symptom, suspected cause, suggested fix path — so tonight's session starts with a clear list rather than vague memory of "something was off."

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
2. **Timer showing 00:00 on resume (fixed):** the RESUME branch of `POST /attempts/start` didn't return the `test` object at all (only `attempt`, `questions`, `optionOrder`), so frontend's `durationMinutes` state had nothing to read on resume. Fixed by also returning `test: { title, duration_minutes }` in the resume branch, mirroring the fresh-start branch.
3. **`.env` location matters:** must live in `apps/api/.env`, NOT the monorepo root — `dotenv.config()` resolves relative to where `node` is actually run from.
4. **PATCH vs POST, singular vs plural route confusion:** `/attempts/:id/answer` (singular, PATCH) saves one answer. `/attempts/:id/answers` (plural, GET) lists all saved answers. Easy to typo.
5. **bcrypt hashes are one-way** — if a temp password is lost, there is no recovery; must issue a new one.
6. **Missing employee-creation route (fixed):** `POST /admin/candidates` only ever created `role='candidate'` rows. There was no way to create an employee for testing until `POST /admin/employees` was added.

## Coding Conventions Used So Far

- Express routes always validate input before touching the DB, return early with 400 on bad input.
- All multi-step writes (test+questions creation) use explicit `BEGIN`/`COMMIT`/`ROLLBACK` transactions via `pool.connect()` → `client.query()` → `client.release()`.
- Every route wrapped in try/catch, logs the error server-side, returns a generic `{ error: "..." }` message to the client (never leaks raw DB errors to the frontend).
- `req.app.locals.pool` is how route files access the shared DB connection pool (set once in `index.js`).
- Middleware factory pattern used for `requireRole(...roles)` — returns a middleware function, allows flexible role lists per-route.