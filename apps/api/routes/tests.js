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
       LEFT JOIN attempts a ON a.id = (
          SELECT id FROM attempts 
          WHERE test_id = ta.test_id 
          AND user_id = ta.user_id 
          AND is_voided = false
          ORDER BY created_at DESC 
          LIMIT 1
       )
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
        can_view_results: r.test_type === 'internal' && r.show_responses_to_employee && r.role === 'employee',
      }));

    res.json({ pending, inProgress, completed });

  } catch (err) {
    console.error('Get assigned tests error:', err.message);
    res.status(500).json({ error: 'Failed to fetch assigned tests' });
  }
});

// Add this to apps/api/routes/tests.js

// GET /tests/analytics
// Returns aggregated performance data for the logged-in employee.
// Candidates hitting this route get a 403 since requireRole blocks them.
router.get('/analytics', requireAuth, requireRole('employee'), async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.user.userId;

  try {
    // All submitted, non-voided attempts with test details
    const attemptsResult = await pool.query(
      `SELECT 
         a.id as attempt_id,
         a.score,
         a.submitted_at,
         a.submit_reason,
         t.id as test_id,
         t.title,
         t.pass_percentage,
         t.show_responses_to_employee,
         COUNT(q.id) as total_questions,
         SUM(q.marks) as total_marks
       FROM attempts a
       JOIN tests t ON t.id = a.test_id
       JOIN questions q ON q.test_id = t.id
       WHERE a.user_id = $1 
         AND a.submit_status = 'submitted'
         AND a.is_voided = false
       GROUP BY a.id, t.id
       ORDER BY a.submitted_at ASC`,
      [userId]
    );

    const attempts = attemptsResult.rows;

    if (attempts.length === 0) {
      return res.json({
        summary: { total_completed: 0, average_percentage: 0, best_percentage: 0, pass_rate: 0 },
        chart_data: [],
        test_breakdown: [],
      });
    }

    // Calculate per-attempt metrics
    const breakdown = attempts.map(a => {
      const totalMarks = parseInt(a.total_marks) || 0;
      const score = a.score || 0;
      const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
      const passed = percentage >= parseInt(a.pass_percentage);

      return {
        attempt_id: a.attempt_id,
        test_id: a.test_id,
        title: a.title,
        score,
        total_marks: totalMarks,
        percentage,
        passed,
        submitted_at: a.submitted_at,
        submit_reason: a.submit_reason,
        can_view_results: a.show_responses_to_employee,
      };
    });

    // Overall summary
    const totalCompleted = breakdown.length;
    const averagePercentage = Math.round(
      breakdown.reduce((sum, b) => sum + b.percentage, 0) / totalCompleted
    );
    const bestPercentage = Math.max(...breakdown.map(b => b.percentage));
    const passCount = breakdown.filter(b => b.passed).length;
    const passRate = Math.round((passCount / totalCompleted) * 100);

    // Chart data — score percentage per test in chronological order
    // for the bar chart on the frontend
    const chartData = breakdown.map(b => ({
      label: b.title.length > 20 ? b.title.substring(0, 20) + '...' : b.title,
      percentage: b.percentage,
      passed: b.passed,
      submitted_at: b.submitted_at,
    }));

    res.json({
      summary: {
        total_completed: totalCompleted,
        average_percentage: averagePercentage,
        best_percentage: bestPercentage,
        pass_rate: passRate,
      },
      chart_data: chartData,
      test_breakdown: breakdown,
    });

  } catch (err) {
    console.error('Analytics error:', err.message);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;