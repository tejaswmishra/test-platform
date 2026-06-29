import express from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

// POST /admin/candidates
// Admin pre-registers a candidate before the recruitment test day.
// Generates a temporary password and returns it so admin can share it.
router.post('/candidates', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { name, email, phone } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'name, email and phone are all required' });
  }

  try {
    // Check for duplicate email first — gives a clean error instead of a DB constraint crash
    const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Generate a simple temporary password
    const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, phone, role, password_hash)
       VALUES ($1, $2, $3, 'candidate', $4)
       RETURNING id, name, email, phone, role, created_at`,
      [name, email, phone, passwordHash]
    );

    res.status(201).json({
      candidate: result.rows[0],
      tempPassword, // admin shares this manually with the candidate for now
    });

  } catch (err) {
    console.error('Create candidate error:', err.message);
    res.status(500).json({ error: 'Failed to create candidate' });
  }
});

// GET /admin/candidates
// Lists all candidates - useful for admin to see who's registered
router.get('/candidates', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;

  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, created_at 
       FROM users WHERE role = 'candidate' 
       ORDER BY created_at DESC`
    );
    res.json({ candidates: result.rows });
  } catch (err) {
    console.error('List candidates error:', err.message);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

// Update your existing POST /admin/tests route in apps/api/routes/admin.js
// Only the destructured fields and the INSERT query change — question
// insertion logic stays exactly the same.

router.post('/tests', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const {
    title,
    description,
    duration_minutes,
    pass_percentage = 60,
    shuffle_questions = false,
    test_type = 'external',          
    show_responses_to_employee = false, 
    questions,
  } = req.body;

  if (!title || !duration_minutes) {
    return res.status(400).json({ error: 'title and duration_minutes are required' });
  }

  if (!['internal', 'external'].includes(test_type)) {
    return res.status(400).json({ error: 'test_type must be "internal" or "external"' });
  }

  // Enforce the business rule server-side too, not just at the DB constraint level —
  // this gives a clean 400 error instead of a raw DB constraint violation message
  if (test_type === 'external' && show_responses_to_employee) {
    return res.status(400).json({ error: 'External tests cannot show responses to candidates' });
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'At least one question is required' });
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question_text || !q.option_a || !q.option_b || !q.option_c || !q.option_d) {
      return res.status(400).json({ error: `Question ${i + 1} is missing text or options` });
    }
    if (!['a', 'b', 'c', 'd'].includes(q.correct_option)) {
      return res.status(400).json({ error: `Question ${i + 1} has an invalid correct_option` });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const testResult = await client.query(
      `INSERT INTO tests 
        (title, description, duration_minutes, pass_percentage, shuffle_questions, 
         test_type, show_responses_to_employee, created_by, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
       RETURNING *`,
      [title, description || null, duration_minutes, pass_percentage, shuffle_questions,
       test_type, show_responses_to_employee, req.user.userId]
    );
    const test = testResult.rows[0];

    const insertedQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qResult = await client.query(
        `INSERT INTO questions 
          (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, marks, order_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, question_text, marks, order_index`,
        [test.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.marks || 1, i]
      );
      insertedQuestions.push(qResult.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      test,
      questions: insertedQuestions,
      total_marks: insertedQuestions.reduce((sum, q) => sum + q.marks, 0),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create test error:', err.message);
    res.status(500).json({ error: 'Failed to create test, no changes were saved' });
  } finally {
    client.release();
  }
});
 
// GET /admin/tests
router.get('/tests', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
 
  try {
    const result = await pool.query(`
      SELECT t.*, COUNT(q.id) as question_count
      FROM tests t
      LEFT JOIN questions q ON q.test_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `);
    res.json({ tests: result.rows });
  } catch (err) {
    console.error('List tests error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});
 
// GET /admin/tests/:id
router.get('/tests/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { id } = req.params;
 
  try {
    const testResult = await pool.query(`SELECT * FROM tests WHERE id = $1`, [id]);
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }
 
    const questionsResult = await pool.query(
      `SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index ASC`,
      [id]
    );
 
    res.json({
      test: testResult.rows[0],
      questions: questionsResult.rows,
    });
  } catch (err) {
    console.error('Get test error:', err.message);
    res.status(500).json({ error: 'Failed to fetch test' });
  }
});
 

router.post('/tests/:id/assign', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { id: testId } = req.params;
  const { mode, user_ids, roles } = req.body;
 
  if (!mode || !['specific', 'all'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "specific" or "all"' });
  }
 
  try {
    // Confirm the test actually exists before assigning anything to it
    const testCheck = await pool.query(`SELECT id FROM tests WHERE id = $1`, [testId]);
    if (testCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }
 
    let targetUserIds = [];
 
    if (mode === 'specific') {
      if (!Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({ error: 'user_ids must be a non-empty array for mode "specific"' });
      }
      targetUserIds = user_ids;
 
    } else {
      // mode === 'all' — fetch every user matching the given roles
      const targetRoles = Array.isArray(roles) && roles.length > 0 ? roles : ['candidate'];
      const usersResult = await pool.query(
        `SELECT id FROM users WHERE role = ANY($1)`,
        [targetRoles]
      );
      targetUserIds = usersResult.rows.map(u => u.id);
    }
 
    if (targetUserIds.length === 0) {
      return res.status(400).json({ error: 'No matching users found to assign this test to' });
    }
 
    // Insert assignments — ON CONFLICT DO NOTHING means if a candidate is
    // already assigned this test, we just skip them silently instead of erroring
    const insertedAssignments = [];
    for (const userId of targetUserIds) {
      const result = await pool.query(
        `INSERT INTO test_assignments (test_id, user_id, attempt_status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (test_id, user_id) DO NOTHING
         RETURNING id, user_id`,
        [testId, userId]
      );
      if (result.rows[0]) insertedAssignments.push(result.rows[0]);
    }
 
    // Mark the test as active now that it has been assigned to someone
    await pool.query(`UPDATE tests SET is_active = true WHERE id = $1`, [testId]);
 
    res.status(201).json({
      message: `Test assigned to ${insertedAssignments.length} user(s)`,
      newly_assigned: insertedAssignments.length,
      already_assigned_skipped: targetUserIds.length - insertedAssignments.length,
    });
 
  } catch (err) {
    console.error('Assign test error:', err.message);
    res.status(500).json({ error: 'Failed to assign test' });
  }
});
 
// GET /admin/tests/:id/assignments
// See who a test has been assigned to, and their current status
router.get('/tests/:id/assignments', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { id: testId } = req.params;
 
  try {
    const result = await pool.query(
      `SELECT ta.id as assignment_id, ta.attempt_status, ta.assigned_at,
              u.id as user_id, u.name, u.email, u.company_id, u.role
       FROM test_assignments ta
       JOIN users u ON u.id = ta.user_id
       WHERE ta.test_id = $1
       ORDER BY ta.assigned_at DESC`,
      [testId]
    );
    res.json({ assignments: result.rows });
  } catch (err) {
    console.error('Get assignments error:', err.message);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});


// Add these three routes to apps/api/routes/admin.js

// POST /admin/tests/:id/terminate
// Body: { user_id }
// Marks a specific user's attempt as submitted+voided, so it no longer
// counts but the record is kept for audit purposes (not deleted).
router.post('/tests/:id/terminate', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { id: testId } = req.params;
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE attempts 
       SET submit_status = 'submitted', submitted_at = NOW(), 
           submit_reason = 'admin_terminated', is_voided = true
       WHERE test_id = $1 AND user_id = $2 AND submit_status = 'in_progress'
       RETURNING *`,
      [testId, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active attempt found for this user' });
    }

    await pool.query(
      `UPDATE test_assignments SET attempt_status = 'submitted' WHERE test_id = $1 AND user_id = $2`,
      [testId, user_id]
    );

    await pool.query(
      `INSERT INTO attempt_events (attempt_id, event_type) VALUES ($1, 'admin_terminated')`,
      [result.rows[0].id]
    );

    res.json({ success: true, attempt: result.rows[0] });

  } catch (err) {
    console.error('Terminate attempt error:', err.message);
    res.status(500).json({ error: 'Failed to terminate attempt' });
  }
});

// POST /admin/tests/:id/restart
// Body: { user_id }
// Voids the existing attempt (keeps it for record) and resets the
// assignment back to 'pending' so the user can start fresh.
router.post('/tests/:id/restart', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { id: testId } = req.params;
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    // Void ALL existing attempts for this test+user (covers edge case of
    // multiple historical attempts), without deleting any data
    await pool.query(
      `UPDATE attempts SET is_voided = true 
       WHERE test_id = $1 AND user_id = $2`,
      [testId, user_id]
    );

    const result = await pool.query(
      `UPDATE test_assignments SET attempt_status = 'pending' 
       WHERE test_id = $1 AND user_id = $2
       RETURNING *`,
      [testId, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No assignment found for this user on this test' });
    }

    res.json({ success: true });

  } catch (err) {
    console.error('Restart attempt error:', err.message);
    res.status(500).json({ error: 'Failed to restart attempt' });
  }
});


// Add this to apps/api/routes/admin.js
// First install: npm install exceljs (you likely already have this from earlier)

import ExcelJS from 'exceljs';

// GET /admin/tests/:id/export
router.get('/tests/:id/export', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { id: testId } = req.params;

  try {
    const testResult = await pool.query(`SELECT title FROM tests WHERE id = $1`, [testId]);
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const rows = await pool.query(`
      SELECT 
        u.name, u.email, u.phone, u.company_id, u.role,
        a.id as attempt_id, a.score, a.submitted_at, 
        a.submit_reason, a.started_at, a.is_voided,
        r.question_id, r.selected_option,
        q.question_text, q.correct_option, q.marks
      FROM attempts a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN responses r ON r.attempt_id = a.id
      LEFT JOIN questions q ON q.id = r.question_id
      WHERE a.test_id = $1
      ORDER BY a.submitted_at DESC NULLS LAST, u.name
    `, [testId]);

    const workbook = new ExcelJS.Workbook();

    // ── Sheet 1: Summary ──────────────────────────────
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Name', key: 'name', width: 22 },
      { header: 'Email / Company ID', key: 'identifier', width: 26 },
      { header: 'Role', key: 'role', width: 12 },
      { header: 'Score', key: 'score', width: 10 },
      { header: 'Percentage', key: 'pct', width: 12 },
      { header: 'Submit Reason', key: 'submit_reason', width: 18 },
      { header: 'Voided', key: 'is_voided', width: 10 },
      { header: 'Submitted At', key: 'submitted_at', width: 22 },
    ];
    summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A56DB' } };

    const attemptMap: Record<string, any> = {};
    for (const row of rows.rows) {
      if (!attemptMap[row.attempt_id]) {
        const totalMarks = rows.rows
          .filter((r: any) => r.attempt_id === row.attempt_id && r.marks)
          .reduce((sum: number, r: any) => sum + r.marks, 0);

        attemptMap[row.attempt_id] = {
          name: row.name,
          identifier: row.email || row.company_id || '—',
          role: row.role,
          score: row.score ?? '—',
          pct: totalMarks > 0 && row.score != null ? `${((row.score / totalMarks) * 100).toFixed(1)}%` : '—',
          submit_reason: row.submit_reason || '—',
          is_voided: row.is_voided ? 'Yes' : 'No',
          submitted_at: row.submitted_at ? new Date(row.submitted_at).toLocaleString() : 'Not submitted',
        };
      }
    }
    Object.values(attemptMap).forEach((r) => summary.addRow(r));

    // ── Sheet 2: Detailed Responses ───────────────────
    const detail = workbook.addWorksheet('Detailed Responses');
    detail.columns = [
      { header: 'Candidate', key: 'name', width: 22 },
      { header: 'Question', key: 'question_text', width: 45 },
      { header: 'Selected', key: 'selected', width: 12 },
      { header: 'Correct', key: 'correct', width: 12 },
      { header: 'Result', key: 'result', width: 10 },
    ];
    detail.getRow(1).font = { bold: true };

    for (const row of rows.rows) {
      if (!row.question_id) continue; // skip rows with no responses at all
      const isCorrect = row.selected_option === row.correct_option;
      detail.addRow({
        name: row.name,
        question_text: row.question_text,
        selected: row.selected_option ? row.selected_option.toUpperCase() : 'Not answered',
        correct: row.correct_option?.toUpperCase(),
        result: isCorrect ? 'Correct' : 'Incorrect',
      });
    }

    const safeTitle = testResult.rows[0].title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}-results.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Failed to export results' });
  }
});


export default router;