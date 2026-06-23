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

router.post('/tests', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const {
    title,
    description,
    duration_minutes,
    pass_percentage = 60,
    shuffle_questions = false,
    questions,
  } = req.body;
 
  if (!title || !duration_minutes) {
    return res.status(400).json({ error: 'title and duration_minutes are required' });
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
        (title, description, duration_minutes, pass_percentage, shuffle_questions, created_by, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING *`,
      [title, description || null, duration_minutes, pass_percentage, shuffle_questions, req.user.userId]
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


export default router;