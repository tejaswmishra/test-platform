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

- [ ] Admin: bulk Excel question upload (template download + parse-upload route — designed in detail early in the conversation, never built; not blocking, manual question entry via the Tests tab form works fine as a substitute)
- [ ] Loading states, empty states, error boundaries — present in dashboard/test page/admin tabs at a basic level, NOT rigorously audited for every edge case (e.g. network failure mid-admin-action)
- [ ] `keyGenerator` fix for `answerLimiter` (currently keys by IP, should key by `req.user.userId` for correctness when many candidates share an office network/IP) — discussed, not yet implemented, low urgency unless actual 500-candidate load testing surfaces it as a real issue
- [ ] Office-PC-specific: local Postgres needs `test_type`, `show_responses_to_employee`, and the `external_never_shows_responses` constraint added (see TODOS below) — these schema changes happened after the last office sync
- [ ] No automated tests exist anywhere (unit/integration) — everything has been manually verified via Thunder Client + browser testing. Worth flagging as a known gap if asked, not necessarily worth building out given the timeline.
- [ ] No deployment/hosting decision made yet for the actual production environment — current setup is local dev (Neon + localhost Express/Next.js). Worth raising with manager/senior now that features are largely complete.

- [x] **Admin UI — FULLY BUILT AND VERIFIED (`/admin/dashboard`, tabbed single-page):**
  - **Tests tab**: create test form (title/description/duration/shuffle/internal-external toggle/show-responses checkbox), inline question builder (click-to-mark-correct UX, live incomplete-question warning), test list table, Assign modal (candidate+employee selection, "registered today" filter, specific-or-all modes)
  - **Candidates tab**: register form, credentials-shown-once modal, table, "today only" filter
  - **Employees tab**: same pattern as candidates, using `company_id` instead of email
  - **Responses tab**: per-test assignment status table, Terminate action (voids in-progress attempt), Allow Restart action (voids attempt + resets assignment to pending), Export to Excel button
  - All four tabs share `sharedStyles.ts` for visual consistency with the candidate-facing pages

- [x] **Excel export — FULLY BUILT, ITERATED ON USER FEEDBACK, VERIFIED:**
  - Single flat sheet (not multi-sheet — simplified per explicit user request)
  - One row per candidate attempt: Name, Email/Company ID, Phone, Score, Submitted At
  - One column PER QUESTION (dynamically generated), header shows full question text (e.g. "Q1: What does...") with wrapped text + tall header row, NOT just "Q1"
  - Each question column shows the candidate's actual selected answer as readable text (e.g. "C) 32"), NOT the correct answer, NOT marks awarded — deliberately simple per user request, no scoring detail mixed into the per-question columns (score is its own separate summary column)

## New backend routes added during admin UI build

- `POST /admin/employees`, `GET /admin/employees` (covered earlier)
- `POST /admin/tests/:id/terminate` — body `{ user_id }`, voids an in-progress attempt, marks submitted with `submit_reason: 'admin_terminated'`, logs to `attempt_events`
- `POST /admin/tests/:id/restart` — body `{ user_id }`, voids ALL existing attempts for that test+user (handles multiple historical attempts), resets `test_assignments.attempt_status` back to `'pending'`. Relies on existing `/attempts/start` resume logic naturally creating a fresh attempt since voided attempts no longer match the `in_progress` resume check — no extra logic needed there.
- `GET /admin/tests/:id/export` — the flat single-sheet Excel export described above. Uses `exceljs`, builds columns dynamically based on question count, response lookup keyed by `${attempt_id}_${question_id}` for O(1) lookups while building rows.

## Known Gotchas / Bugs Already Fixed (continued)

7. **TypeScript syntax leaking into plain `.js` backend files (fixed):** Accidentally included `: Record<string, any>`, `: any`, `: number` type annotations in `apps/api/routes/admin.js` (a plain Node.js file, not TypeScript). Node's ESM loader crashes immediately on this with `SyntaxError: Missing initializer in const declaration`. Lesson: backend files are plain `.js`, never paste TypeScript-flavored code there even as a copy-paste artifact from a `.tsx` context.
8. **`middleware.ts` → `proxy.ts` rename (Next.js 16):** Next.js renamed the middleware file convention; `middleware.ts` still works but is deprecated. Renamed file to `proxy.ts` and the exported function from `middleware` to `proxy` — everything else (matcher config, JWT verification logic) unchanged.
9. **Proxy route crashed on binary file responses (fixed):** `app/api/proxy/[...path]/route.ts` unconditionally called `expressRes.json()` on every response, which crashed on the Excel export route's binary `.xlsx` bytes (`SyntaxError: Unexpected token 'P', "PK..."` — PK is the ZIP file signature Excel files start with). Fixed by checking `Content-Type` header: if not `application/json`, stream raw bytes through via `arrayBuffer()` instead, preserving `Content-Disposition` so the browser still triggers a proper file download.
10. **Multi-tab/multi-role testing logs you out unexpectedly — NOT a bug, expected cookie behavior.** Logging in as admin in one tab overwrites the SAME `token` cookie a candidate tab was relying on (cookies are domain-scoped, not tab-scoped). Refreshing the candidate tab afterward sends the admin's token, which `requireRole` correctly rejects, bouncing back to login. Fix for testing: use two different browsers, or one normal + one Incognito window, never two tabs of the same browser for two different roles simultaneously. This is not an issue in real usage since admin and candidates are different people on different physical machines.

## Current Overall Status — nearly feature-complete

**Fully working end-to-end:** auth (3 roles), candidate/employee dashboard, full test-taking UI (shuffle, option-shuffle, review flags, pagination, anti-cheat, auto-save+retry, server-side timer), gated results viewing (internal/external test types), and the FULL admin UI (candidates, employees, tests w/ question builder, assignment, responses w/ terminate+restart, Excel export).

**What remains (see "What's NOT Started" above, and TODOS below) is smaller, more "polish and hardening" than "new features."**

## TODOS for next office session (no AI/push access)

Given the project is now feature-complete on both candidate and admin sides, office time should focus on HARDENING and TESTING, not new features.

1. **Sync local Postgres schema with Neon.** Several changes happened since office Postgres was last touched: `test_type`, `show_responses_to_employee` on `tests`, plus the `external_never_shows_responses` constraint. Run in pgAdmin Query Tool:
   ```sql
   ALTER TABLE tests ADD COLUMN IF NOT EXISTS test_type VARCHAR(20) NOT NULL DEFAULT 'external'
     CHECK (test_type IN ('internal', 'external'));
   ALTER TABLE tests ADD COLUMN IF NOT EXISTS show_responses_to_employee BOOLEAN NOT NULL DEFAULT false;
   ALTER TABLE tests ADD CONSTRAINT external_never_shows_responses
     CHECK (NOT (test_type = 'external' AND show_responses_to_employee = true));
   ```

2. **Full regression pass on local Postgres** — login → create test → register candidate/employee → assign → take test as that user → check Responses tab updates → export Excel — confirm everything still works against office's local DB.

3. **Heavy manual QA / edge-case hunting** — genuinely valuable office time:
   - Multiple candidates/employees taking the SAME test simultaneously (several incognito windows) — watch for data crossing between attempts
   - Terminate an attempt WHILE that candidate still has the test open elsewhere — does their next save/submit correctly get rejected?
   - Restart a test, confirm the candidate gets a genuinely NEW shuffle order, not the old one
   - Try assigning a test to zero people — confirm it's blocked cleanly
   - Export Excel for a test with ZERO submitted attempts — confirm no crash

4. **Decide with manager: what's the actual MVP cutoff for demo day?** Use the "What's NOT Started" list above to explicitly separate must-haves from nice-to-haves.

5. **Do NOT start bulk Excel question upload today** — new feature requiring multer + parsing, better suited for an AI-assisted home session.

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