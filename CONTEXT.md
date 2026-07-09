# SProbe — Samsung Assessment Portal
# Project Context v2

> Enterprise recruitment and employee training test platform for Samsung.
> This is a PRODUCTION-GRADE system — reliability, security, and data integrity are paramount.
> Any failure reflects on Samsung's brand directly.

---

## Platform Name
**SProbe** (Samsung + Probe) — internal working name, subject to approval.

---

## Tech Stack
- **Frontend:** Next.js (App Router), TypeScript, custom inline styles
- **Backend:** Express.js (v5), Node.js ES Modules
- **Database:** PostgreSQL — LOCAL instance on office LAN (NOT Neon cloud — network is restricted)
- **Auth:** JWT (jsonwebtoken backend, jose frontend), httpOnly cookies
- **Process manager:** PM2 in cluster mode (one process per CPU core)
- **Reverse proxy:** Nginx (in front of Node — handles static files, connection queuing)
- **Encryption:** AES-256-GCM for question text at rest (NOT bcrypt — bcrypt is one-way, wrong for this)

---

## Infrastructure Reality
- **Network:** Closed office LAN. Nothing leaves the building. No cloud services reachable.
- **Database:** Local PostgreSQL on a dedicated PC on the LAN (separate from app server)
- **NOT Kubernetes** — wrong tool for this scale. PM2 cluster + Nginx achieves the same resilience with far less complexity on modest hardware.
- **Recommended setup:** 2 PCs — one for Express+Next.js (PM2 cluster), one for PostgreSQL
- **Scale target:** 500 concurrent candidates during recruitment sessions

---

## Roles (4 total)

### admin
- Full access to everything
- Creates recruiter accounts (must have @samsung.com email + company ID)
- Views all responses, all tests, all users
- Can edit any test regardless of who created it

### recruiter
- Company employee (@samsung.com email + company ID required)
- Can create tests and edit/delete ONLY their own tests (ownership enforced server-side)
- Cannot manage users (no access to candidates/employees list)
- Cannot view other recruiters' test responses
- Future: will be able to assign tests to candidates

### employee
- Takes internal training tests
- Sees analytics dashboard (skills overview, level, history)
- Can view results for internal tests where show_responses_to_employee = true

### candidate
- Self-registers on test day (name, email, phone, own password)
- Takes external recruitment tests
- Simple dashboard — no analytics, no score visibility
- Test assigned by admin/recruiter after registration

---

## Complete Database Schema

### users
id UUID PK, name, email (nullable), phone (nullable), company_id (nullable),
role ('candidate'|'employee'|'admin'|'recruiter'),
password_hash (bcrypt), created_at TIMESTAMPTZ

### tests
id UUID PK, title, description, duration_minutes, pass_percentage (default 60),
shuffle_questions (bool), is_active (bool),
test_type ('internal'|'external', default 'external'),
show_responses_to_employee (bool, default false),
created_by FK→users, created_at TIMESTAMPTZ
Constraint: CHECK (NOT (test_type = 'external' AND show_responses_to_employee = true))

### questions
id UUID PK, test_id FK→tests (CASCADE DELETE),
question_text TEXT (AES-256-GCM ENCRYPTED),
option_a TEXT (ENCRYPTED), option_b TEXT (ENCRYPTED),
option_c TEXT (ENCRYPTED), option_d TEXT (ENCRYPTED),
correct_option CHAR(1) (ENCRYPTED),
topic VARCHAR(100),  ← NOT shown to candidates, admin analytics only
difficulty ('beginner'|'intermediate'|'advanced'),
marks INT, order_index INT, created_at TIMESTAMPTZ

### test_assignments
id UUID PK, test_id FK, user_id FK, assigned_at TIMESTAMPTZ,
attempt_status ('pending'|'in_progress'|'submitted')
Constraint: UNIQUE(test_id, user_id)

### attempts
id UUID PK, test_id FK, user_id FK,
started_at TIMESTAMPTZ, submitted_at TIMESTAMPTZ,
score INT, submit_status, submit_reason,
is_voided BOOL, question_order JSONB, option_order JSONB,
session_token UUID,  ← single session enforcement
created_at TIMESTAMPTZ

### responses
id UUID PK, attempt_id FK, question_id FK,
selected_option CHAR(1) NULLABLE, marked_for_review BOOL,
answered_at TIMESTAMPTZ
Constraint: UNIQUE(attempt_id, question_id)

### attempt_events
id UUID PK, attempt_id FK, event_type, occurred_at TIMESTAMPTZ, metadata JSONB

---

## Security Requirements

### Question Encryption
- All question text, options, and correct_option stored AES-256-GCM encrypted in DB
- Encryption key in .env as QUESTION_ENCRYPTION_KEY (32-byte hex)
- Decrypt at read time in Express, never store plaintext
- Candidates NEVER receive correct_option in any response (existing rule, maintained)

### Single Session Enforcement
- attempts.session_token generated on /attempts/start, returned to client
- Client sends X-Session-Token header on every write request
- If token mismatch → 409 SESSION_CONFLICT error
- Prevents same attempt being active in two browser windows simultaneously

### DevTools and Right-click Prevention
- Disabled on test page only (not on login/dashboard)
- Blocks: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, right-click context menu
- Lives in useAntiCheat.js, active only when isActive=true
- This is friction, not true security — real security is server-side (correct_option never sent)

### Recruiter Access Control
- requireTestOwnership middleware: admins bypass, recruiters only touch their own tests
- @samsung.com email validation at recruiter creation time
- Recruiters cannot access /admin/candidates, /admin/employees, or any responses routes

---

## Question Topic Tags
- questions.topic (VARCHAR 100) — e.g. "AI Tools", "Test Automation", "Data Engineering", "Gen AI"
- questions.difficulty ('beginner'|'intermediate'|'advanced')
- Topics NEVER sent to candidates in any API response
- Admin analytics query groups responses by topic to show accuracy per topic
- Used for employee skill level calculation

---

## Employee Skill Level Algorithm
Based on average score percentage across ALL completed internal tests:
- Beginner: avg < 50%
- Intermediate: avg 50-79%
- Advanced: avg >= 80%
Computed at query time, no stored column needed.

---

## Employee Dashboard UI (3-tab layout)

### Header
- SProbe logo + platform name (left)
- Tab navigation: Dashboard | Level Tests | Test History (center)
- User name + sign out (right)

### Tab 1: Dashboard
Skills Overview card (top):
- Tests taken | Avg score | Current level (Beginner/Intermediate/Advanced)
- Defaults: 0 tests, 0%, Beginner if no tests completed
- Visual skill breakdown by topic (bar chart per topic accuracy)

Pending/Assigned Tests section (middle):
- Cards for tests yet to be taken

Completed Tests section (bottom):
- Filter bar: Status (Pass/Fail), Skill/Topic, Level, Test Name, Date range (from→to)
- Table of completed tests with all filter fields
- Copyright footer

### Tab 2: Level Tests
- Tests organized by difficulty level
- Shows which level the employee is currently at
- Recommended next tests based on weak topics

### Tab 3: Test History
- Full history with detailed per-test analytics
- View Results button for eligible tests

---

## Candidate Dashboard (unchanged — simple)
- Pending tests → Start Test button
- In-progress → Resume Test button
- Completed → "Submitted" label only (no scores, no results)
- No analytics, no skill tracking

---

## Bulk Question Import (Paste Format)
Admin pastes questions in this exact format into a textarea:

```
Q1. What is HTML?
a) Hyper Text Markup Language      b) jsjs
c) ahah.         d) hahaha
correct option : a)

Q2. What does CSS stand for?
a) Cascading Style Sheets
b) Computer Style Sheets
c) Creative Style System
d) Colorful Style Sheets
correct option : a)
```

Parser splits on Q\d+\. boundaries, extracts options by splitting on b)/c)/d) boundaries
within the options block, extracts correct_option from "correct option : x)" line.
All parsing client-side via regex, no LLM, no file upload, no DRM issues.
After parsing, questions shown in preview. Admin confirms → POST /admin/tests fires
with parsed questions in body, same as manual entry.

---

## What's Fully Built (from v1)

### Backend
- Auth (login for candidate/employee/admin), JWT, bcrypt passwords
- requireAuth + requireRole middleware
- validateAttempt anti-cheat middleware (ownership, status, timer)
- Admin: CRUD candidates, CRUD employees, create/edit/delete tests + questions
- Admin: assign tests, view assignments, terminate/restart attempts
- Admin: Excel export (flat sheet, Q1/Q2... columns with full question text)
- Candidate self-registration (POST /auth/register)
- GET /auth/me — returns logged-in user info
- Test-taking: start/resume (with shuffle), save answers, review flags, status, submit+score
- Internal/external test type with 3-layer visibility enforcement
- Results route (gated: internal + show_responses + role=employee only)
- Rate limiting on /answer (userId-keyed, 20/min)

### Frontend
- /login (candidate/employee toggle), /admin/login (dark theme), /register
- /dashboard (role-aware: employees see analytics, candidates see simple cards)
- /test/[attemptId] (full UI: shuffled questions+options, 4-color pagination, timer, anti-cheat)
- /results/[attemptId] (breakdown for eligible employees)
- /admin/dashboard (4 tabs: Tests, Candidates, Employees, Responses)
- EditTestModal (edit metadata + questions on existing tests)
- Bulk paste import (textarea, regex parser, no file upload needed)

---

## What's NOT Done Yet (build order)

1. **Question encryption (AES-256-GCM)** — schema + encrypt on write + decrypt on read
2. **Single session enforcement** — session_token on attempts table
3. **Recruiter role** — new role, ownership middleware, @samsung.com validation
4. **topic + difficulty columns on questions** — schema + admin UI fields + analytics query
5. **DevTools/right-click prevention** — add to useAntiCheat.js
6. **Admin topic analytics dashboard** — responses grouped by topic per test
7. **Employee dashboard tabs** — Level Tests tab, Test History tab, topic-based filtering
8. **Nginx config** — reverse proxy setup for production
9. **PM2 cluster mode config** — ecosystem.config.js
10. **Local PostgreSQL setup** — replace Neon for production LAN deployment
11. **Recruiter UI in admin panel** — manage recruiters, recruiter sees only their tests

---

## Environment Variables (full list)

### apps/api/.env
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/test_platform
JWT_SECRET=<32+ char secret>
QUESTION_ENCRYPTION_KEY=<64 char hex string for AES-256>
PORT=5000
CLIENT_URL=http://<SERVER_IP>:3000
SEED_ADMIN_EMAIL=admin@samsung.com
SEED_ADMIN_PASSWORD=<strong password>
SEED_ADMIN_NAME=Samsung Admin
```

### apps/web/.env.local
```
NEXT_PUBLIC_API_URL=http://<SERVER_IP>:5000
API_URL=http://localhost:5000
JWT_SECRET=<same as api>
```

---

## Deployment Plan (Office LAN, Windows Servers)

### PC 1 — Database Server
- PostgreSQL 16 installed locally
- Static IP on office LAN
- Only accessible from PC 2 (firewall rule)

### PC 2 — Application Server
- Node.js v20 LTS (NOT v24 — v24 has fetch streaming issues with multipart)
- PM2 in cluster mode: `pm2 start ecosystem.config.js`
- Nginx on port 80 → proxies to Next.js on 3000
- Nginx also proxies /api/* to Express on 5000
- Ports 80 open on Windows Firewall (candidates only need port 80)

### ecosystem.config.js (PM2)
```javascript
module.exports = {
  apps: [
    {
      name: 'sprobe-api',
      script: 'apps/api/index.js',
      instances: 'max',  // one per CPU core
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'sprobe-web',
      script: 'npm',
      args: 'start',
      cwd: 'apps/web',
      instances: 2,
      exec_mode: 'cluster',
    }
  ]
};
```

### Nginx config (basic)
```nginx
server {
  listen 80;
  location / { proxy_pass http://localhost:3000; }
  location /api/ { proxy_pass http://localhost:5000/; }
}
```

---

## Known Bugs Fixed (full list)
1. TIMESTAMP → TIMESTAMPTZ (timer miscalculated by hours)
2. Timer 00:00 on resume (resume branch missing test.duration_minutes)
3. TypeScript annotations in .js backend file (Node crash)
4. middleware.ts → proxy.ts (Next.js 16 deprecation)
5. Generic proxy crashed on Excel binary response (arrayBuffer fix)
6. .env in wrong folder (must be apps/api/.env)
7. Duplicate key React error after restart+recompletion (LEFT JOIN subquery fix)
8. Rate limiter IPv6 warning (ipKeyGenerator helper)
9. "Unexpected end of form" on file upload (dedicated upload route, req.body streaming)
10. Candidates seeing internal test results (missing role=employee check)
11. can_view_results field name mismatch in dashboard interface
12. NASCA DRM encrypts all files saved on office PCs — CSV and XLSX both affected
    Solution: paste-from-textarea approach, no file ever touches disk
13. Node v24 fetch streaming incompatibility — use Node v20 LTS for production

---

## Important Architectural Decisions
1. Correct_option NEVER sent to candidates in any API response
2. Server-side timer is source of truth (not frontend countdown)
3. Question/option shuffle saved once on attempt creation, reused on resume
4. Three-layer enforcement for internal/external test visibility
5. Rate limiter keys by userId not IP (office LAN shares IP addresses)
6. Bulk upload is paste-based (no file) due to NASCA DRM on office machines
7. Local PostgreSQL required (Neon cloud unreachable from office LAN)
8. PM2 cluster + Nginx preferred over Kubernetes for this scale and hardware
