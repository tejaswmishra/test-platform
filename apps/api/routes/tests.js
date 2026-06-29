import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /tests/assigned
// Replace your GET /tests/assigned route in apps/api/routes/tests.js
// Now also returns test_type + show_responses_to_employee, so the
// frontend dashboard knows whether to render a "View Results" button
// at all for each completed test.

router.get('/assigned', requireAuth, requireRole('candidate', 'employee'), async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT 
         ta.id as assignment_id,
         ta.attempt_status,
         ta.assigned_at,
         t.id as test_id,
         t.title,
         t.description,
         t.duration_minutes,
         t.test_type,
         t.show_responses_to_employee,
         a.id as attempt_id,
         a.score,
         a.submitted_at,
         a.submit_reason
       FROM test_assignments ta
       JOIN tests t ON t.id = ta.test_id
       LEFT JOIN attempts a ON a.test_id = ta.test_id AND a.user_id = ta.user_id
       WHERE ta.user_id = $1
       ORDER BY ta.assigned_at DESC`,
      [userId]
    );

    const pending = result.rows.filter(r => r.attempt_status === 'pending');
    const inProgress = result.rows.filter(r => r.attempt_status === 'in_progress');

    // For completed tests, decide per-row whether results can be viewed.
    // This is the SAME rule enforced again on the detail route itself —
    // never trust the frontend to respect this on its own.
    const completed = result.rows
      .filter(r => r.attempt_status === 'submitted')
      .map(r => ({
        ...r,
        can_view_results: r.test_type === 'internal' && r.show_responses_to_employee,
      }));

    res.json({ pending, inProgress, completed });

  } catch (err) {
    console.error('Get assigned tests error:', err.message);
    res.status(500).json({ error: 'Failed to fetch assigned tests' });
  }
});

export default router;