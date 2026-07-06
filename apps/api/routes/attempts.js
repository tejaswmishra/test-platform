// apps/api/routes/attempts.js — FULL FILE
// This replaces your earlier attempts.js (the /start route)
// with the complete version including answer-saving and submission.

import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateAttempt, calculateScore } from '../middleware/antiCheat.js';
import rateLimit, {ipKeyGenerator} from 'express-rate-limit';

const router = express.Router();

// Generous limit — this exists as a safety net against bugs or
// scripted abuse, not something normal candidate behavior should
// ever hit. With a 20-30s auto-save interval, legitimate use is
// nowhere near this limit.
const answerLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute window
  max: 20,                // 20 saves per minute per IP is very generous
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req), // Use userId if available, else fallback to IP
  message: { error: 'Too many save requests, please slow down' },
});

router.post('/start', requireAuth, requireRole('candidate', 'employee'), async (req, res) => {
  const { pool } = req.app.locals;
  const userId = req.user.userId;
  const { test_id } = req.body;
 
  if (!test_id) {
    return res.status(400).json({ error: 'test_id is required' });
  }
 
  try {
    const assignment = await pool.query(
      `SELECT * FROM test_assignments WHERE test_id = $1 AND user_id = $2`,
      [test_id, userId]
    );
 
    if (assignment.rows.length === 0) {
      return res.status(403).json({ error: 'This test was not assigned to you' });
    }
 
    const assignmentRow = assignment.rows[0];
 
    if (assignmentRow.attempt_status === 'submitted') {
      return res.status(403).json({ error: 'You have already submitted this test' });
    }
 
    const existingAttempt = await pool.query(
      `SELECT * FROM attempts WHERE test_id = $1 AND user_id = $2 AND submit_status = 'in_progress'`,
      [test_id, userId]
    );
 
    if (existingAttempt.rows.length > 0) {
      const attempt = existingAttempt.rows[0];
      const testResult = await pool.query(`SELECT * FROM tests WHERE id = $1`, [test_id]);
      const test = testResult.rows[0];
      const questions = await getQuestionsInOrder(pool, test_id, attempt.question_order);
      return res.json({
        attempt,
        questions,
        test: { title: test.title, duration_minutes: test.duration_minutes },
        optionOrder: attempt.option_order || {},
        resumed: true,
      });
    }
 
    // ── Fresh start path ───────────────────────────────────────────────
    const testResult = await pool.query(`SELECT * FROM tests WHERE id = $1`, [test_id]);
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }
    const test = testResult.rows[0];
 
    const idsResult = await pool.query(
      `SELECT id FROM questions WHERE test_id = $1 ORDER BY order_index ASC`,
      [test_id]
    );
    let questionOrder = idsResult.rows.map(r => r.id);
 
    // Shuffle question order, same as before
    if (test.shuffle_questions) {
      questionOrder = fisherYatesShuffle(questionOrder);
    }

    const optionOrder = {};
    for (const qId of questionOrder) {
      optionOrder[qId] = fisherYatesShuffle(['a', 'b', 'c', 'd']);
    }
 
    const newAttempt = await pool.query(
      `INSERT INTO attempts (test_id, user_id, started_at, submit_status, question_order, option_order)
       VALUES ($1, $2, NOW(), 'in_progress', $3, $4)
       RETURNING *`,
      [test_id, userId, JSON.stringify(questionOrder), JSON.stringify(optionOrder)]
    );
 
    await pool.query(
      `UPDATE test_assignments SET attempt_status = 'in_progress' WHERE id = $1`,
      [assignmentRow.id]
    );
 
    const questions = await getQuestionsInOrder(pool, test_id, questionOrder);
 
    res.status(201).json({
      attempt: newAttempt.rows[0],
      test: { title: test.title, duration_minutes: test.duration_minutes },
      questions,
      optionOrder,
      resumed: false,
    });
 
  } catch (err) {
    console.error('Start attempt error:', err.message);
    res.status(500).json({ error: 'Failed to start attempt' });
  }
});
 

// PATCH /attempts/:attemptId/answer
// Body: { 
//   "question_id": "uuid", 
//   "selected_option": "a" | "b" | "c" | "d" | null,
//   "marked_for_review": true | false   // optional, defaults to unchanged
// }
router.patch(
  '/:attemptId/answer',
  requireAuth,
  answerLimiter,
  requireRole('candidate', 'employee'),
  validateAttempt,
  async (req, res) => {
    const { pool } = req.app.locals;
    const { attemptId } = req.params;
    const { question_id, selected_option, marked_for_review } = req.body;
 
    if (!question_id) {
      return res.status(400).json({ error: 'question_id is required' });
    }
 
    if (selected_option !== undefined && selected_option !== null &&
        !['a', 'b', 'c', 'd'].includes(selected_option)) {
      return res.status(400).json({ error: 'selected_option must be a, b, c, d, or null' });
    }
 
    try {
      // Check if a row already exists for this question in this attempt
      const existing = await pool.query(
        `SELECT * FROM responses WHERE attempt_id = $1 AND question_id = $2`,
        [attemptId, question_id]
      );
 
      const isClearingAnswer = selected_option === null;
      const reviewFlag = marked_for_review ?? existing.rows[0]?.marked_for_review ?? false;
 
      // If clearing the answer AND not marked for review, delete the row
      // entirely — this preserves the "no row = untouched" meaning for
      // the simple case, same as before.
      if (isClearingAnswer && !reviewFlag) {
        await pool.query(
          `DELETE FROM responses WHERE attempt_id = $1 AND question_id = $2`,
          [attemptId, question_id]
        );
        return res.json({ saved: true, cleared: true });
      }
 
      // Otherwise upsert — covers: normal answer, marking for review
      // with or without an answer, and clearing an answer while KEEPING
      // the review flag (row must persist in that case)
      const finalSelectedOption = isClearingAnswer ? null : (selected_option ?? existing.rows[0]?.selected_option ?? null);
 
      await pool.query(
        `INSERT INTO responses (attempt_id, question_id, selected_option, marked_for_review)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET 
           selected_option = $3, 
           marked_for_review = $4,
           answered_at = NOW()`,
        [attemptId, question_id, finalSelectedOption, reviewFlag]
      );
 
      res.json({ saved: true, cleared: false });
 
    } catch (err) {
      console.error('Save answer error:', err.message);
      res.status(500).json({ error: 'Failed to save answer' });
    }
  }
);
 

// GET /attempts/:attemptId/answers
// Returns all saved answers for this attempt — used when candidate
// refreshes the page mid-test, so the UI can restore their selections.
router.get(
  '/:attemptId/answers',
  requireAuth,
  requireRole('candidate', 'employee'),
  validateAttempt,
  async (req, res) => {
    const { pool } = req.app.locals;
    const { attemptId } = req.params;

    try {
      const result = await pool.query(
        `SELECT question_id, selected_option FROM responses WHERE attempt_id = $1`,
        [attemptId]
      );
      res.json({ answers: result.rows });
    } catch (err) {
      console.error('Get answers error:', err.message);
      res.status(500).json({ error: 'Failed to fetch answers' });
    }
  }
);

// GET /attempts/:attemptId/status
// Returns the 4-state status for EVERY question in the attempt's order —
// this is exactly what powers the pagination number grid on the frontend.
// One single call gives you everything needed to color every question number.
router.get(
  '/:attemptId/status',
  requireAuth,
  requireRole('candidate', 'employee'),
  validateAttempt,
  async (req, res) => {
    const { pool } = req.app.locals;
    const { attemptId } = req.params;
    const attempt = req.attempt; // attached by validateAttempt
 
    try {
      const responsesResult = await pool.query(
        `SELECT question_id, selected_option, marked_for_review 
         FROM responses WHERE attempt_id = $1`,
        [attemptId]
      );
 
      const responseMap = Object.fromEntries(
        responsesResult.rows.map(r => [r.question_id, r])
      );
 
      const questionOrder = attempt.question_order || [];
 
      const statusList = questionOrder.map((questionId, index) => {
        const response = responseMap[questionId];
 
        let status = 'not_attempted'; // gray
        if (response) {
          const hasAnswer = response.selected_option !== null;
          const review = response.marked_for_review;
 
          if (hasAnswer && review) status = 'review_attempted';      // yellow
          else if (!hasAnswer && review) status = 'review_unattempted'; // purple
          else if (hasAnswer) status = 'attempted';                   // green
        }
 
        return { question_id: questionId, question_number: index + 1, status };
      });
 
      res.json({ statusList });
 
    } catch (err) {
      console.error('Get status error:', err.message);
      res.status(500).json({ error: 'Failed to fetch question status' });
    }
  }
);
 

// POST /attempts/:attemptId/submit
// Body: { "reason": "manual" | "tab_switch" | "new_window" | "page_close" }
// validateAttempt still runs here too — even a manual submit must pass
// ownership/status checks. Timeout is handled separately inside the
// middleware itself before this handler is even reached.
router.post(
  '/:attemptId/submit',
  requireAuth,
  requireRole('candidate', 'employee'),
  validateAttempt,
  async (req, res) => {
    const { pool } = req.app.locals;
    const { attemptId } = req.params;
    const { reason = 'manual' } = req.body;
    const attempt = req.attempt; // attached by validateAttempt

    try {
      const score = await calculateScore(pool, attemptId);

      await pool.query(
        `UPDATE attempts 
         SET submit_status = 'submitted', submitted_at = NOW(), 
             submit_reason = $1, score = $2
         WHERE id = $3`,
        [reason, score, attemptId]
      );

      await pool.query(
        `UPDATE test_assignments SET attempt_status = 'submitted'
         WHERE test_id = $1 AND user_id = $2`,
        [attempt.test_id, attempt.user_id]
      );

      const eventType = reason === 'manual' ? 'manual_submitted' : 'auto_submitted';
      await pool.query(
        `INSERT INTO attempt_events (attempt_id, event_type, metadata) 
         VALUES ($1, $2, $3)`,
        [attemptId, eventType, JSON.stringify({ reason })]
      );

      res.json({ success: true, score, redirect: '/dashboard' });

    } catch (err) {
      console.error('Submit attempt error:', err.message);
      res.status(500).json({ error: 'Failed to submit attempt' });
    }
  }
);

// POST /attempts/:attemptId/events
// Logs a cheat-detection event WITHOUT requiring validateAttempt —
// we still want to log a tab-switch even if the attempt got submitted
// a split second earlier by another request. This is the audit trail.
router.post(
  '/:attemptId/events',
  requireAuth,
  requireRole('candidate', 'employee'),
  async (req, res) => {
    const { pool } = req.app.locals;
    const { attemptId } = req.params;
    const { event_type } = req.body;

    if (!event_type) {
      return res.status(400).json({ error: 'event_type is required' });
    }

    try {
      await pool.query(
        `INSERT INTO attempt_events (attempt_id, event_type) VALUES ($1, $2)`,
        [attemptId, event_type]
      );
      res.json({ logged: true });
    } catch (err) {
      console.error('Log event error:', err.message);
      res.status(500).json({ error: 'Failed to log event' });
    }
  }
);

// GET /attempts/:attemptId/results
// Returns the full breakdown (question, candidate's answer, correct answer)
// ONLY if this attempt belongs to an internal test with show_responses_to_employee = true.
// This is the actual enforcement point — even if someone crafts a request
// directly to this URL, the server checks the rule again here.
router.get(
  '/:attemptId/results',
  requireAuth,
  requireRole('candidate', 'employee'),
  async (req, res) => {
    const { pool } = req.app.locals;
    const { attemptId } = req.params;
    const userId = req.user.userId;
 
    try {
      const attemptResult = await pool.query(
        `SELECT a.*, t.title, t.test_type, t.show_responses_to_employee
         FROM attempts a
         JOIN tests t ON t.id = a.test_id
         WHERE a.id = $1`,
        [attemptId]
      );
 
      if (attemptResult.rows.length === 0) {
        return res.status(404).json({ error: 'Attempt not found' });
      }
 
      const attempt = attemptResult.rows[0];
 
      // Ownership check — same pattern as validateAttempt
      if (attempt.user_id !== userId) {
        return res.status(403).json({ error: 'This is not your attempt' });
      }
 
      // Must be submitted before results can be viewed
      if (attempt.submit_status !== 'submitted') {
        return res.status(403).json({ error: 'This attempt is not yet submitted' });
      }
 
      // THE ACTUAL RULE — enforced here, not just hidden in the UI
      if (attempt.test_type !== 'internal' || !attempt.show_responses_to_employee || req.user.role !== 'employee') {
        return res.status(403).json({ error: 'Results are not available for this test' });
      }
 
      const responsesResult = await pool.query(
        `SELECT q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
                q.correct_option, q.marks, r.selected_option
         FROM questions q
         LEFT JOIN responses r ON r.question_id = q.id AND r.attempt_id = $1
         WHERE q.test_id = $2
         ORDER BY q.order_index ASC`,
        [attemptId, attempt.test_id]
      );
 
      res.json({
        test_title: attempt.title,
        score: attempt.score,
        total_marks: responsesResult.rows.reduce((sum, q) => sum + q.marks, 0),
        breakdown: responsesResult.rows.map(q => ({
          question_text: q.question_text,
          options: { a: q.option_a, b: q.option_b, c: q.option_c, d: q.option_d },
          your_answer: q.selected_option,
          correct_answer: q.correct_option,
          is_correct: q.selected_option === q.correct_option,
          marks: q.marks,
        })),
      });
 
    } catch (err) {
      console.error('Get results error:', err.message);
      res.status(500).json({ error: 'Failed to fetch results' });
    }
  }
);
 
// Standard Fisher-Yates shuffle — unbiased, O(n), the correct way to
// shuffle an array (never use .sort(() => Math.random() - 0.5), it's biased)
function fisherYatesShuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
 
// Fetches questions (no correct_option, as always) and returns them
// ordered according to the saved question_order array — not by order_index.
async function getQuestionsInOrder(pool, testId, questionOrder) {
  const result = await pool.query(
    `SELECT id, question_text, option_a, option_b, option_c, option_d, marks
     FROM questions
     WHERE test_id = $1`,
    [testId]
  );
 
  // Re-order the fetched rows to match question_order exactly,
  // since SQL doesn't guarantee row order matching an array of IDs
  const byId = Object.fromEntries(result.rows.map(q => [q.id, q]));
  return questionOrder.map(id => byId[id]).filter(Boolean);
}

export default router;