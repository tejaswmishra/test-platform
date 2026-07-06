# Test Platform — Project Context

> Internal recruitment + employee training test platform for Samsung.
> Two interfaces: Client (candidates/employees taking tests) and Admin (creating/managing tests).

## Tech Stack

- **Frontend:** Next.js (App Router), TypeScript, no external UI library — custom inline styles
- **Backend:** Express.js (v5), Node.js, ES Modules (`"type": "module"` in package.json)
- **Database:** PostgreSQL hosted on Neon (serverless cloud — accessible from any machine)
- **Auth:** JWT (`jsonwebtoken` on backend, `jose` for Edge-compatible verification in Next.js proxy.ts)
- **File generation:** `exceljs` for Excel template download + results export
- **File upload:** `multer` (memory storage, for parsing bulk question Excel uploads)
- **Process manager (production):** PM2

## Repository

Private GitHub repo: https://github.com/tejaswmishra/test-platform

## Repository Structure

```
test-platform/
├── apps/
│   ├── api/                          ← Express backend
│   │   ├── index.js                  ← entry point, pool config (max:20), mounts all routers
│   │   ├── middleware/
│   │   │   ├── auth.js               ← requireAuth, requireRole
│   │   │   └── antiCheat.js          ← validateAttempt, calculateScore, autoSubmitOnTimeout
│   │   ├── routes/
│   │   │   ├── auth.js               ← POST /auth/login
│   │   │   ├── admin.js              ← all admin routes (see below)
│   │   │   ├── tests.js              ← GET /tests/assigned
│   │   │   └── attempts.js           ← start, answer, status, submit, events, results
│   │   └── db/
│   │       ├── migrate.js            ← creates all tables, run once per fresh DB
│   │       └── seed.js               ← creates default admin account, idempotent
│   └── web/                          ← Next.js frontend
│       ├── proxy.ts                  ← route protection, verifies JWT cookie (root level!)
│       ├── app/
│       │   ├── api/
│       │   │   ├── auth/login/route.ts          ← proxies to Express, sets httpOnly cookie
│       │   │   ├── auth/logout/route.ts         ← deletes cookie
│       │   │   ├── proxy/[...path]/route.ts     ← forwards JSON API calls with Bearer token
│       │   │   └── admin/questions/parse-upload/route.ts  ← dedicated multipart upload route
│       │   ├── login/page.tsx                   ← candidate/employee login (toggle)
│       │   ├── admin/
│       │   │   ├── login/page.tsx               ← separate admin login (dark styling)
│       │   │   ├── dashboard/page.tsx            ← tabbed admin shell
│       │   │   └── components/
│       │   │       ├── sharedStyles.ts
│       │   │       ├── CandidatesTab.tsx
│       │   │       ├── EmployeesTab.tsx
│       │   │       ├── TestsTab.tsx              ← includes CreateTestModal + AssignTestModal
│       │   │       └── ResponsesTab.tsx
│       │   ├── dashboard/page.tsx               ← candidate/employee dashboard
│       │   ├── test/[attemptId]/page.tsx         ← test-taking UI
│       │   └── results/[attemptId]/page.tsx      ← results breakdown (internal tests only)
│       ├── hooks/
│       │   └── useAntiCheat.js
│       └── lib/
│           └── auth.ts
├── .gitignore
└── README.md
```

## Complete Database Schema

### users
`id` UUID PK, `name`, `email` (nullable), `phone` (nullable), `company_id` (nullable), `role` (`candidate`|`employee`|`admin`), `password_hash` (bcrypt), `created_at` TIMESTAMPTZ

### tests
`id` UUID PK, `title`, `description`, `duration_minutes`, `pass_percentage` (default 60), `shuffle_questions` (bool), `is_active` (bool), `test_type` (`internal`|`external`, default `external`), `show_responses_to_employee` (bool, default false), `created_by` FK→users, `created_at` TIMESTAMPTZ
Constraint: `CHECK (NOT (test_type = 'external' AND show_responses_to_employee = true))`

### questions
`id` UUID PK, `test_id` FK→tests (CASCADE DELETE), `question_text`, `option_a/b/c/d`, `correct_option` (char a-d), `marks`, `order_index`, `created_at` TIMESTAMPTZ

### test_assignments
`id` UUID PK, `test_id` FK, `user_id` FK, `assigned_at` TIMESTAMPTZ, `attempt_status` (`pending`|`in_progress`|`submitted`)
Constraint: `UNIQUE(test_id, user_id)`

### attempts
`id` UUID PK, `test_id` FK, `user_id` FK, `started_at` TIMESTAMPTZ, `submitted_at` TIMESTAMPTZ, `score`, `submit_status`, `submit_reason` (`manual`|`tab_switch`|`timeout`|`admin_terminated`|etc), `is_voided` (bool), `question_order` (JSONB — shuffled question ID array), `option_order` (JSONB — per-question option shuffle map), `created_at` TIMESTAMPTZ

### responses
`id` UUID PK, `attempt_id` FK, `question_id` FK, `selected_option` (char a-d, NULLABLE), `marked_for_review` (bool, default false), `answered_at` TIMESTAMPTZ
Constraint: `UNIQUE(attempt_id, question_id)`

### attempt_events
`id` UUID PK, `attempt_id` FK, `event_type`, `occurred_at` TIMESTAMPTZ, `metadata` JSONB

## All Backend Routes

### Auth
- `POST /auth/login` — body: `{ userType, email|company_id, password }` → returns JWT + user

### Admin (all require `requireAuth + requireRole('admin')`)
- `POST /admin/candidates` — creates candidate with temp password
- `GET /admin/candidates` — lists all candidates
- `POST /admin/employees` — creates employee with company_id + temp password
- `GET /admin/employees` — lists all employees
- `POST /admin/tests` — creates test + questions in a single DB transaction
- `GET /admin/tests` — lists all tests with question count
- `GET /admin/tests/:id` — single test with full questions (includes correct_option — admin only)
- `POST /admin/tests/:id/assign` — body: `{ mode: 'specific'|'all', user_ids?, roles? }`
- `GET /admin/tests/:id/assignments` — who's assigned, with attempt_status
- `POST /admin/tests/:id/terminate` — body: `{ user_id }` — voids in-progress attempt
- `POST /admin/tests/:id/restart` — body: `{ user_id }` — voids all attempts, resets to pending
- `GET /admin/tests/:id/export` — streams .xlsx file (flat sheet, one row per candidate, Q1/Q2... columns)
- `GET /admin/question-template` — streams blank .xlsx template for bulk upload
- `POST /admin/questions/parse-upload` — multer file upload, parses + validates, returns preview (does NOT save to DB)

### Candidate/Employee
- `GET /tests/assigned` — returns `{ pending, inProgress, completed }` arrays, each item includes `can_view_results` boolean
- `POST /attempts/start` — body: `{ test_id }` — starts or resumes attempt, returns questions (no correct_option), optionOrder, test metadata
- `PATCH /attempts/:id/answer` — body: `{ question_id, selected_option, marked_for_review? }` — rate limited (20/min per userId)
- `GET /attempts/:id/answers` — all saved answers for this attempt
- `GET /attempts/:id/status` — 4-state status list for pagination grid
- `POST /attempts/:id/submit` — body: `{ reason }` — scores + closes attempt
- `POST /attempts/:id/events` — logs cheat event (skips validateAttempt intentionally)
- `GET /attempts/:id/results` — full breakdown, gated: internal + show_responses_to_employee=true + role=employee only

## Key Architectural Decisions

1. **JWT payload identical for all 3 roles** — `{ userId, role, name }`. Role enforcement via `requireRole` middleware, not separate auth systems.

2. **Server-side timer is source of truth.** `validateAttempt` middleware recalculates elapsed time from `started_at` on every write request. Auto-submits and scores right in the middleware if expired, before route handler runs.

3. **Candidates never receive `correct_option`.** `getQuestionsInOrder` helper explicitly excludes it. Admin routes include it.

4. **Per-candidate question AND option shuffle, both saved once at attempt creation.** `question_order` = shuffled question ID array. `option_order` = `{ questionId: ['c','a','d','b'] }` map. Both saved to `attempts` row permanently. Resume always reads saved order — never reshuffles mid-attempt. Frontend translates clicked display position back to original letter before sending to backend — scoring logic never needs to know shuffling exists.

5. **Anti-cheat is split across frontend + backend deliberately:**
   - Frontend (`useAntiCheat` hook): `visibilitychange`, `blur`/`focus`, `beforeunload` listeners detect tab-switches and call `/attempts/:id/submit`
   - Backend (`validateAttempt`): gatekeeper on every write — ownership, status, timer. Fires regardless of frontend behavior.
   - `/attempts/:id/events` deliberately skips `validateAttempt` — audit log should record even if attempt already closed.

6. **httpOnly cookie auth bridged to Bearer tokens via proxy.**
   - `/api/auth/login/route.ts` — sets httpOnly cookie, browser JS never sees raw JWT
   - `/api/proxy/[...path]/route.ts` — all JSON API calls go here, reads cookie, attaches Bearer header to Express request
   - `/api/admin/questions/parse-upload/route.ts` — DEDICATED upload route, bypasses generic proxy entirely. Generic proxy buffers body as text which corrupts multipart streams ("Unexpected end of form"). This route streams `req.body` directly to Express with the original Content-Type header (including boundary string) preserved.

7. **Admin login is a separate page (`/admin/login`).** Not linked from public candidate login page. Distinct dark visual styling.

8. **Internal vs External test types — 3-layer enforcement:**
   - DB constraint: `CHECK (NOT (test_type = 'external' AND show_responses_to_employee = true))`
   - Creation-time: `POST /admin/tests` rejects invalid combination with 400
   - Access-time: `GET /attempts/:id/results` re-checks `test_type`, `show_responses_to_employee`, AND `req.user.role === 'employee'` — candidates can never see results even if assigned to an internal test

9. **Connection pool sized for 500 concurrent candidates.** `pg.Pool({ max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 })`. Frontend auto-save every 20s (not per-click) keeps simultaneous writes manageable.

10. **Rate limiter keys by userId, not IP.** `keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req)`. `requireAuth` runs BEFORE `answerLimiter` in the middleware chain so `req.user` exists. Uses `ipKeyGenerator` helper (not raw `req.ip`) to avoid IPv6 bypass and suppress the ERR_ERL_KEY_GEN_IPV6 warning.

11. **Terminate keeps data, Restart voids attempts.** Terminate: marks in-progress attempt as `submitted + is_voided=true + submit_reason='admin_terminated'`. Restart: voids ALL existing attempts for that test+user, resets `test_assignments.attempt_status` to `'pending'`. Resume logic in `/attempts/start` naturally creates a fresh attempt since voided attempts don't match the `submit_status='in_progress'` check.

12. **Dashboard LEFT JOIN uses subquery to get only the latest non-voided attempt.** Prevents duplicate rows in `completed` array when a user has multiple historical attempts (after restart+recompletion). React key collision (`Encountered two children with the same key`) was the symptom.

13. **Bulk upload does NOT save to DB.** `POST /admin/questions/parse-upload` only parses and validates, returning a preview. Admin confirms in the UI, then the normal `POST /admin/tests` is called with those questions in the body — same path as manual entry.

## What's Fully Built and Verified

### Backend
- [x] Auth (all 3 roles), JWT issuance, bcrypt password hashing
- [x] requireAuth + requireRole middleware
- [x] validateAttempt anti-cheat middleware (ownership, status, server-side timer, auto-submit)
- [x] Admin: create candidates/employees, create tests (transaction), assign tests, view assignments
- [x] Admin: terminate attempt, allow restart
- [x] Admin: Excel export (flat sheet, dynamic question columns with full question text)
- [x] Admin: question template download, bulk upload parse + validate (preview only, no DB save)
- [x] Candidate/employee: view assigned tests, start/resume attempts, save/clear answers, review flags, question status, submit + scoring
- [x] Internal/external test types with 3-layer visibility enforcement
- [x] Results route gated by test_type + show_responses_to_employee + role=employee
- [x] Rate limiting on /answer route (userId-keyed, 20/min)
- [x] Seed script for default admin

### Frontend
- [x] `/login` — candidate/employee toggle
- [x] `/admin/login` — separate dark-styled page
- [x] `/dashboard` — pending/in-progress/completed cards, conditional View Results button
- [x] `/test/[attemptId]` — full test-taking UI: shuffled options, 4-color pagination grid, timer, Previous/Next/Clear/Mark for Review/Submit, auto-save (20s interval + flush on navigation + retry on failure)
- [x] `/results/[attemptId]` — full breakdown for eligible employees
- [x] `/admin/dashboard` — 4-tab UI: Tests, Candidates, Employees, Responses
- [x] Tests tab: create form (internal/external toggle, question builder with click-to-select-correct UX, Manual/Bulk Upload tab switcher), test list, Assign modal with today-filter
- [x] Candidates/Employees tabs: register forms, credentials modal, tables, today-filter
- [x] Responses tab: status table, Terminate/Restart actions, Export Excel button
- [x] Dedicated upload route (`/api/admin/questions/parse-upload/route.ts`) streaming multipart directly to Express
- [x] Generic proxy handles binary responses (Excel download) correctly via arrayBuffer passthrough
- [x] `useAntiCheat` hook: visibilitychange, blur/focus with popup detection, beforeunload

## What's NOT Done

- [ ] **Deployment** — being set up this week (see below)
- [ ] No automated tests — all verification done manually via Thunder Client + browser
- [ ] Bulk upload does not support adding questions to an EXISTING test — only at creation time (deliberate scope decision)

## Known Bugs Fixed

1. `TIMESTAMP` → `TIMESTAMPTZ` — server-side timer miscalculated by hours due to timezone parsing
2. Timer `00:00` on resume — resume branch of `/attempts/start` wasn't returning `test.duration_minutes`
3. TypeScript annotations in `.js` backend file — Node crashed with `SyntaxError: Missing initializer`
4. `middleware.ts` → `proxy.ts` rename — Next.js 16 deprecation
5. Generic proxy crashed on Excel binary response — was calling `.json()` on binary bytes; fixed with `arrayBuffer()` passthrough
6. `.env` in wrong folder — must be `apps/api/.env`, not repo root
7. Duplicate key React error after restart+recompletion — LEFT JOIN was returning multiple attempt rows; fixed with subquery getting only latest non-voided attempt
8. Rate limiter IPv6 warning — replaced `req.ip` with `ipKeyGenerator(req)` from express-rate-limit
9. "Unexpected end of form" on file upload — generic proxy was buffering multipart body as text, corrupting the stream; fixed with dedicated `/api/admin/questions/parse-upload/route.ts` that streams `req.body` directly
10. Candidates could see internal test results — `can_view_results` and results route both missing `role === 'employee'` check

## Environment Variables

### apps/api/.env
```
DATABASE_URL=<neon pooled connection string>
JWT_SECRET=<32+ char secret, must match web exactly>
PORT=5000
CLIENT_URL=http://localhost:3000  (dev) | http://<SERVER_IP>:3000 (prod)
SEED_ADMIN_EMAIL=admin@samsung.com
SEED_ADMIN_PASSWORD=<your password>
SEED_ADMIN_NAME=Samsung Admin
```

### apps/web/.env.local
```
NEXT_PUBLIC_API_URL=http://localhost:5000  (dev) | http://<SERVER_IP>:5000 (prod)
API_URL=http://localhost:5000  (dev) | http://localhost:5000 (prod — same machine, localhost is correct)
JWT_SECRET=<MUST match api JWT_SECRET exactly>
```

## Deployment Plan (Windows Office Server, LAN-only)

### One-time server setup
```bash
# 1. Install Node.js LTS from nodejs.org
# 2. Install Git from git-scm.com
# 3. Clone the repo
git clone https://github.com/tejaswmishra/test-platform.git
cd test-platform

# 4. Install dependencies
cd apps/api && npm install
cd ../web && npm install

# 5. Create .env files (see Environment Variables above, use SERVER_IP)
# 6. Run database migration (Neon — already has schema, just verify)
cd apps/api && node db/migrate.js
# 7. Seed admin account
node db/seed.js

# 8. Build Next.js for production
cd ../web && npm run build
# Fix any build errors before proceeding

# 9. Install PM2
npm install -g pm2

# 10. Start both processes
cd ../api && pm2 start index.js --name "test-platform-api"
cd ../web && pm2 start npm --name "test-platform-web" -- start

# 11. Save + configure auto-start on boot
pm2 save
pm2 startup  # run the command it prints

# 12. Open firewall ports (Windows Defender Firewall → Inbound Rules)
# Port 3000 TCP — "Test Platform Web"
# Port 5000 TCP — "Test Platform API"
```

### Verify deployment
From another machine on the LAN: `http://<SERVER_IP>:3000` should show login page.

### Updating the deployment after code changes
```bash
git pull origin main
cd apps/api && npm install   # if new packages added
cd ../web && npm install && npm run build
pm2 restart all
```

## Office TODO for Tomorrow

### Priority 1 — Run production build check AT HOME TONIGHT first
```bash
cd apps/web
npm run build
```
Fix any TypeScript/build errors before going to the server. Much easier to debug at home with AI access than on the server under time pressure.

### Priority 2 — Server setup (in this exact order)
1. Install Node.js LTS on the server
2. Install Git on the server
3. Clone the repo
4. `npm install` in both `apps/api` and `apps/web`
5. Create both `.env` files with the SERVER_IP (not localhost)
6. `node db/migrate.js` — confirm tables exist on Neon (should already be there)
7. `node db/seed.js` — creates production admin account
8. `npm run build` in `apps/web` — must succeed with zero errors
9. Install PM2 globally
10. Start both processes with PM2
11. `pm2 save` + run the `pm2 startup` command
12. Open ports 3000 and 5000 in Windows Firewall
13. Test from another LAN machine

### Priority 3 — Full smoke test on production
- Login as admin → create a test → register a candidate → assign → take test as that candidate → check Responses tab → export Excel
- Confirm anti-cheat fires correctly (tab switch)
- Confirm timer works correctly

### Things that can go wrong and how to fix them
- **Build errors** — TypeScript strict mode surfaces issues dev mode tolerates. Fix the specific file/line the build output points to.
- **PM2 not found after install** — close and reopen terminal (PATH needs refresh)
- **Port already in use** — another process is on 3000 or 5000. `netstat -ano | findstr :3000` to find and kill it.
- **Candidates can't reach the server** — firewall ports not open, or they're using the wrong IP. Confirm with `ipconfig` on the server to get the exact LAN IP.
- **`pm2 startup` doesn't work on Windows** — PM2's startup command works differently on Windows. Alternative: create a Windows Task Scheduler task to run `pm2 resurrect` on login/startup.