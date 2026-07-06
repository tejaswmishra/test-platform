import express from 'express';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import multer from 'multer';
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

// Replace your existing GET /admin/tests/:id/export route in
// apps/api/routes/admin.js with this simplified version.
// Single sheet, one row per candidate, one column per question.

// Replace your existing GET /admin/tests/:id/export route in
// apps/api/routes/admin.js with this simplified version.
// Single sheet, one row per candidate, one column per question.

router.get('/tests/:id/export', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { id: testId } = req.params;

  try {
    const testResult = await pool.query(`SELECT title FROM tests WHERE id = $1`, [testId]);
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    // Get all questions for this test, in their original order —
    // this defines the column order (Q1, Q2, Q3...)
    const questionsResult = await pool.query(
      `SELECT id, question_text, option_a, option_b, option_c, option_d, order_index
       FROM questions WHERE test_id = $1 ORDER BY order_index ASC`,
      [testId]
    );
    const questions = questionsResult.rows;

    // Get every attempt for this test, with their candidate info
    const attemptsResult = await pool.query(
      `SELECT a.id as attempt_id, a.score, a.submitted_at, a.submit_reason,
              u.name, u.email, u.phone, u.company_id, u.role
       FROM attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.test_id = $1
       ORDER BY a.submitted_at DESC NULLS LAST, u.name`,
      [testId]
    );

    // Get ALL responses for this test in one query, keyed by attempt+question
    // so we can look up "what did attempt X answer for question Y" quickly
    const responsesResult = await pool.query(
      `SELECT r.attempt_id, r.question_id, r.selected_option
       FROM responses r
       JOIN attempts a ON a.id = r.attempt_id
       WHERE a.test_id = $1`,
      [testId]
    );

    const responseLookup = {};
    for (const r of responsesResult.rows) {
      responseLookup[`${r.attempt_id}_${r.question_id}`] = r.selected_option;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Results');

    // Build columns dynamically: fixed candidate info columns,
    // then one column per question (Q1, Q2, Q3...)
    const fixedColumns = [
      { header: 'Name', key: 'name', width: 22 },
      { header: 'Email / Company ID', key: 'identifier', width: 26 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Score', key: 'score', width: 10 },
      { header: 'Submitted At', key: 'submitted_at', width: 22 },
    ];

    const questionColumns = questions.map((q, idx) => ({
      header: `Q${idx + 1}: ${q.question_text}`,
      key: `q_${q.id}`,
      width: 35,
    }));

    sheet.columns = [...fixedColumns, ...questionColumns];

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A56DB' } };
    sheet.getRow(1).alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(1).height = 60;

    // One row per candidate attempt
    for (const attempt of attemptsResult.rows) {
      const rowData = {
        name: attempt.name,
        identifier: attempt.email || attempt.company_id || '—',
        phone: attempt.phone || '—',
        score: attempt.score ?? '—',
        submitted_at: attempt.submitted_at
          ? new Date(attempt.submitted_at).toLocaleString()
          : 'Not submitted',
      };

      // Fill in each question column with the candidate's selected option text
      for (const q of questions) {
        const selected = responseLookup[`${attempt.attempt_id}_${q.id}`];
        rowData[`q_${q.id}`] = selected
          ? `${selected.toUpperCase()}) ${q[`option_${selected}`]}`
          : 'Not answered';
      }

      sheet.addRow(rowData);
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


// Add this to apps/api/routes/admin.js, alongside your existing
// POST /candidates and GET /candidates routes.

// POST /admin/employees
// Admin creates an employee account, using company_id instead of email
// as the login identifier — mirrors POST /candidates closely, but for
// the employee role.
router.post('/employees', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;
  const { name, company_id, email, phone } = req.body;

  if (!name || !company_id) {
    return res.status(400).json({ error: 'name and company_id are required' });
  }

  try {
    const existing = await pool.query(`SELECT id FROM users WHERE company_id = $1`, [company_id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An employee with this company_id already exists' });
    }

    const tempPassword = Math.random().toString(36).slice(-8).toUpperCase();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const result = await pool.query(
      `INSERT INTO users (name, company_id, email, phone, role, password_hash)
       VALUES ($1, $2, $3, $4, 'employee', $5)
       RETURNING id, name, company_id, email, phone, role, created_at`,
      [name, company_id, email || null, phone || null, passwordHash]
    );

    res.status(201).json({
      employee: result.rows[0],
      tempPassword,
    });

  } catch (err) {
    console.error('Create employee error:', err.message);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// GET /admin/employees
router.get('/employees', requireAuth, requireRole('admin'), async (req, res) => {
  const { pool } = req.app.locals;

  try {
    const result = await pool.query(
      `SELECT id, name, company_id, email, phone, created_at 
       FROM users WHERE role = 'employee' 
       ORDER BY created_at DESC`
    );
    res.json({ employees: result.rows });
  } catch (err) {
    console.error('List employees error:', err.message);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});


// Add both routes to apps/api/routes/admin.js
// Also add this import at the top of admin.js if not already there:
// import multer from 'multer';
// import ExcelJS from 'exceljs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'), false);
    }
  },
});

// GET /admin/question-template
// Downloads a pre-filled sample Excel template showing admin
// exactly what format to use when bulk uploading questions.
router.get('/question-template', requireAuth, requireRole('admin'), async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Questions');

  ws.columns = [
    { header: 'question_text', key: 'question_text', width: 50 },
    { header: 'option_a',      key: 'option_a',      width: 25 },
    { header: 'option_b',      key: 'option_b',      width: 25 },
    { header: 'option_c',      key: 'option_c',      width: 25 },
    { header: 'option_d',      key: 'option_d',      width: 25 },
    { header: 'correct_option', key: 'correct_option', width: 14 },
    { header: 'marks',         key: 'marks',          width: 8  },
  ];

  // Style header row
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A56DB' } };

  // One sample row so admin immediately understands the format
  ws.addRow({
    question_text: 'What does HTML stand for?',
    option_a: 'Hyper Text Markup Language',
    option_b: 'High Tech Modern Language',
    option_c: 'Hyper Transfer Markup Language',
    option_d: 'Home Tool Markup Language',
    correct_option: 'a',
    marks: 1,
  });

  // Add dropdown validation on correct_option column so Excel
  // itself guides admin to pick only valid values
  ws.getColumn(6).eachCell({ includeEmpty: false }, (cell, rowNum) => {
    if (rowNum === 1) return;
    cell.dataValidation = {
      type: 'list',
      formulae: ['"a,b,c,d"'],
      showErrorMessage: true,
      errorTitle: 'Invalid option',
      error: 'Must be exactly: a, b, c, or d (lowercase)',
    };
  });

  res.setHeader('Content-Disposition', 'attachment; filename="question-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
  res.end();
});

// POST /admin/questions/parse-upload
// Accepts an uploaded .xlsx file, parses every row, validates each one,
// and returns a PREVIEW of parsed questions plus any errors found.
// Does NOT save anything to the database — that happens only when
// admin confirms and the full POST /admin/tests is called with these
// questions in the body, exactly like the manual flow.
router.post(
  '/questions/parse-upload',
  requireAuth,
  requireRole('admin'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);
      const ws = wb.worksheets[0];

      const questions = [];
      const errors = [];

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return; // skip header

        // row.values is 1-indexed, index 0 is undefined
        const [, question_text, option_a, option_b, option_c, option_d,
               correct_option, marks] = row.values;

        // Skip completely empty rows silently
        if (!question_text && !option_a && !option_b) return;

        const rowErrors = [];

        if (!question_text || String(question_text).trim() === '') {
          rowErrors.push('Question text is empty');
        }
        if (!option_a || String(option_a).trim() === '') rowErrors.push('Option A is empty');
        if (!option_b || String(option_b).trim() === '') rowErrors.push('Option B is empty');
        if (!option_c || String(option_c).trim() === '') rowErrors.push('Option C is empty');
        if (!option_d || String(option_d).trim() === '') rowErrors.push('Option D is empty');

        const correctStr = correct_option ? String(correct_option).trim().toLowerCase() : '';
        if (!['a', 'b', 'c', 'd'].includes(correctStr)) {
          rowErrors.push(`correct_option must be a, b, c, or d — got "${correct_option ?? 'empty'}"`);
        }

        const marksNum = Number(marks);
        if (!marks || isNaN(marksNum) || marksNum < 1) {
          rowErrors.push('marks must be a number ≥ 1');
        }

        if (rowErrors.length > 0) {
          errors.push({ row: rowNum, errors: rowErrors });
        } else {
          questions.push({
            question_text: String(question_text).trim(),
            option_a: String(option_a).trim(),
            option_b: String(option_b).trim(),
            option_c: String(option_c).trim(),
            option_d: String(option_d).trim(),
            correct_option: correctStr,
            marks: marksNum,
          });
        }
      });

      res.json({
        questions,        // valid parsed questions — ready to use in POST /admin/tests
        errors,           // row-level validation errors to show admin
        total: questions.length,
        errorCount: errors.length,
      });

    } catch (err) {
      console.error('Parse upload error:', err.message);
      res.status(500).json({ error: 'Failed to parse the uploaded file. Make sure it is a valid .xlsx file.' });
    }
  }
);


export default router;