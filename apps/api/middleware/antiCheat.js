// apps/api/middleware/antiCheat.js

export const validateAttempt = async (req, res, next) => {
  const { pool } = req.app.locals;
  const { attemptId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT a.*, t.duration_minutes
       FROM attempts a
       JOIN tests t ON t.id = a.test_id
       WHERE a.id = $1`,
      [attemptId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    const attempt = result.rows[0];

    if (attempt.user_id !== userId) {
      return res.status(403).json({ error: 'This is not your attempt' });
    }

    if (attempt.submit_status !== 'in_progress') {
      return res.status(403).json({
        error: 'This attempt has already been submitted',
        redirect: '/dashboard',
      });
    }

    const elapsedSeconds = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
    const limitSeconds = attempt.duration_minutes * 60;
    const GRACE_PERIOD_SECONDS = 30;
    console.log('DEBUG started_at raw:', attempt.started_at, typeof attempt.started_at);
    console.log('DEBUG elapsedSeconds:', elapsedSeconds, 'limitSeconds:', limitSeconds);

    if (elapsedSeconds > limitSeconds + GRACE_PERIOD_SECONDS) {
      await autoSubmitOnTimeout(pool, attemptId);
      return res.status(403).json({
        error: 'Time expired, attempt auto-submitted',
        redirect: '/dashboard',
      });
    }

    req.attempt = attempt;
    next();

  } catch (err) {
    console.error('validateAttempt error:', err.message);
    res.status(500).json({ error: 'Failed to validate attempt' });
  }
};

export async function autoSubmitOnTimeout(pool, attemptId) {
  const score = await calculateScore(pool, attemptId);

  await pool.query(
    `UPDATE attempts 
     SET submit_status = 'submitted', submitted_at = NOW(), 
         submit_reason = 'timeout', score = $1
     WHERE id = $2`,
    [score, attemptId]
  );

  await pool.query(
    `UPDATE test_assignments SET attempt_status = 'submitted'
     WHERE test_id = (SELECT test_id FROM attempts WHERE id = $1)
       AND user_id = (SELECT user_id FROM attempts WHERE id = $1)`,
    [attemptId]
  );

  await pool.query(
    `INSERT INTO attempt_events (attempt_id, event_type) VALUES ($1, 'auto_submitted')`,
    [attemptId]
  );
}

export async function calculateScore(pool, attemptId) {
  const result = await pool.query(
    `SELECT r.selected_option, q.correct_option, q.marks
     FROM responses r
     JOIN questions q ON q.id = r.question_id
     WHERE r.attempt_id = $1`,
    [attemptId]
  );

  let score = 0;
  for (const row of result.rows) {
    if (row.selected_option === row.correct_option) {
      score += row.marks;
    }
  }
  return score;
}