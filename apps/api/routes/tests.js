import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /tests/assigned
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
    const completed = result.rows.filter(r => r.attempt_status === 'submitted');

    res.json({ pending, inProgress, completed });

  } catch (err) {
    console.error('Get assigned tests error:', err.message);
    res.status(500).json({ error: 'Failed to fetch assigned tests' });
  }
});

export default router;