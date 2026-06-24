'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAntiCheat } from '@/hooks/useAntiCheat';

interface Question {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  marks: number;
}

interface PendingAnswer {
  questionId: string;
  selectedOption: string | null;
  markedForReview: boolean;
}

type QuestionStatus = 'not_attempted' | 'attempted' | 'review_unattempted' | 'review_attempted';

const STATUS_COLORS: Record<QuestionStatus, string> = {
  not_attempted: '#9CA3AF',       // gray
  attempted: '#059669',            // green
  review_unattempted: '#7C3AED',  // purple
  review_attempted: '#D97706',     // yellow/amber
};

export default function TestPage() {
  const router = useRouter();
  const params = useParams();
  const attemptId = params.attemptId as string;
  const searchParams = useSearchParams();
  const testId = searchParams.get('testId');

  const [questions, setQuestions] = useState<Question[]>([]);
  const [optionOrder, setOptionOrder] = useState<Record<string, string[]>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [warning, setWarning] = useState('');

  // localAnswers: instant UI state, never waits for the network
  const [localAnswers, setLocalAnswers] = useState<Record<string, string | null>>({});
  const [reviewFlags, setReviewFlags] = useState<Record<string, boolean>>({});
  const [statusMap, setStatusMap] = useState<Record<string, QuestionStatus>>({});

  const pendingAnswerRef = useRef<PendingAnswer | null>(null);
  const isActiveRef = useRef(false);

  // ── Load the attempt on mount ─────────────────────────────────────
  useEffect(() => {
    async function loadAttempt() {
      try {
        // We already called /attempts/start from the dashboard before
        // navigating here, but calling it again is safe — it just
        // resumes the existing in-progress attempt with the SAME
        // saved question/option order, never re-shuffling.
        const res = await fetch('/api/proxy/attempts/start', {
          method: 'POST',
          body: JSON.stringify({ test_id: testId }),
        });
        const data = await res.json();

        if (!res.ok) {
          alert(data.error || 'Could not load this test');
          router.push('/dashboard');
          return;
        }

        setQuestions(data.questions);
        setOptionOrder(data.optionOrder || {});
        setDurationMinutes(data.test?.duration_minutes || data.attempt.duration_minutes);
        setStartedAt(data.attempt.started_at);

        // Load any previously saved answers (covers resume / refresh)
        const statusRes = await fetch(`/api/proxy/attempts/${attemptId}/status`);
        const statusData = await statusRes.json();
        const sMap: Record<string, QuestionStatus> = {};
        statusData.statusList?.forEach((s: any) => {
          sMap[s.question_id] = s.status;
        });
        setStatusMap(sMap);

      } catch (err) {
        console.error('Failed to load attempt', err);
      } finally {
        setLoading(false);
        isActiveRef.current = true;
      }
    }
    loadAttempt();
  }, [attemptId, testId, router]);

  // ── Timer — derived from server's started_at, ticks locally ──────
  useEffect(() => {
    if (!startedAt || !durationMinutes) return;

    const tick = () => {
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
      const remaining = Math.max(0, durationMinutes * 60 - elapsed);
      setRemainingSeconds(Math.floor(remaining));

      if (remaining <= 0) {
        handleSubmit('timeout');
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, durationMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save interval — flushes any pending answer every 20s ────
  useEffect(() => {
    const interval = setInterval(() => {
      if (pendingAnswerRef.current) {
        flushPendingAnswer();
      }
    }, 20000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Anti-cheat hook ────────────────────────────────────────────────
  useAntiCheat({
    isActive: isActiveRef.current && !submitting,
    onAutoSubmit: (reason : string) => handleSubmit(reason),
    onPopupWarning: (msg : string) => {
      setWarning(msg);
      setTimeout(() => setWarning(''), 4000);
    },
  });

  // ── Save logic with retry ─────────────────────────────────────────
  async function saveAnswerToServer(answer: PendingAnswer, retryCount = 0): Promise<boolean> {
    try {
      const res = await fetch(`/api/proxy/attempts/${attemptId}/answer`, {
        method: 'PATCH',
        body: JSON.stringify({
          question_id: answer.questionId,
          selected_option: answer.selectedOption,
          marked_for_review: answer.markedForReview,
        }),
      });

      if (!res.ok) {
        if (retryCount < 3) {
          await new Promise(r => setTimeout(r, 2000));
          return saveAnswerToServer(answer, retryCount + 1);
        }
        return false;
      }

      // Update local status map after a confirmed save
      setStatusMap(prev => ({
        ...prev,
        [answer.questionId]: deriveStatus(answer.selectedOption, answer.markedForReview),
      }));

      return true;
    } catch {
      if (retryCount < 3) {
        await new Promise(r => setTimeout(r, 2000));
        return saveAnswerToServer(answer, retryCount + 1);
      }
      return false;
    }
  }

  function deriveStatus(selected: string | null, review: boolean): QuestionStatus {
    if (review && selected) return 'review_attempted';
    if (review && !selected) return 'review_unattempted';
    if (selected) return 'attempted';
    return 'not_attempted';
  }

  async function flushPendingAnswer() {
    const answer = pendingAnswerRef.current;
    if (!answer) return;
    pendingAnswerRef.current = null;
    await saveAnswerToServer(answer);
  }

  // ── User actions ───────────────────────────────────────────────────
  const currentQuestion = questions[currentIndex];

  function handleSelectOption(originalLetter: string) {
    if (!currentQuestion) return;
    setLocalAnswers(prev => ({ ...prev, [currentQuestion.id]: originalLetter }));
    pendingAnswerRef.current = {
      questionId: currentQuestion.id,
      selectedOption: originalLetter,
      markedForReview: reviewFlags[currentQuestion.id] || false,
    };
  }

  function handleClearResponse() {
    if (!currentQuestion) return;
    setLocalAnswers(prev => ({ ...prev, [currentQuestion.id]: null }));
    pendingAnswerRef.current = {
      questionId: currentQuestion.id,
      selectedOption: null,
      markedForReview: reviewFlags[currentQuestion.id] || false,
    };
    flushPendingAnswer(); // clear immediately, don't wait for interval
  }

  function handleToggleReview() {
    if (!currentQuestion) return;
    const newFlag = !reviewFlags[currentQuestion.id];
    setReviewFlags(prev => ({ ...prev, [currentQuestion.id]: newFlag }));
    pendingAnswerRef.current = {
      questionId: currentQuestion.id,
      selectedOption: localAnswers[currentQuestion.id] ?? null,
      markedForReview: newFlag,
    };
    flushPendingAnswer();
  }

  async function navigateTo(index: number) {
    await flushPendingAnswer(); // save current question before leaving it
    setCurrentIndex(index);
  }

  async function handleSubmit(reason: string = 'manual') {
    if (submitting) return;
    setSubmitting(true);
    isActiveRef.current = false; // stop anti-cheat listeners during submit

    await flushPendingAnswer();

    try {
      const res = await fetch(`/api/proxy/attempts/${attemptId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();

      if (reason !== 'manual') {
        alert(`Test auto-submitted (${reason.replace('_', ' ')}). Redirecting to your dashboard.`);
      }

      router.push('/dashboard');
    } catch (err) {
      alert('Could not submit. Please check your connection and try again.');
      setSubmitting(false);
      isActiveRef.current = true;
    }
  }

  if (loading) {
    return <div style={styles.loadingPage}>Loading your test...</div>;
  }

  if (!currentQuestion) {
    return <div style={styles.loadingPage}>No questions found for this test.</div>;
  }

  const shuffledLetters = optionOrder[currentQuestion.id] || ['a', 'b', 'c', 'd'];
  const selectedForCurrent = localAnswers[currentQuestion.id];
  const isMarkedForReview = reviewFlags[currentQuestion.id] || false;

  return (
    <div style={styles.page}>
      {warning && <div style={styles.warningBanner}>⚠ {warning}</div>}

      <header style={styles.header}>
        <span style={styles.headerTitle}>Question {currentIndex + 1} of {questions.length}</span>
        <Timer remainingSeconds={remainingSeconds} />
      </header>

      <div style={styles.mainLayout}>
        {/* ── Question panel ───────────────────────────── */}
        <main style={styles.questionPanel}>
          <p style={styles.questionText}>{currentQuestion.question_text}</p>

          <div style={styles.optionsList}>
            {shuffledLetters.map((originalLetter, displayPos) => (
              <button
                key={originalLetter}
                onClick={() => handleSelectOption(originalLetter)}
                style={{
                  ...styles.optionButton,
                  ...(selectedForCurrent === originalLetter ? styles.optionButtonSelected : {}),
                }}
              >
                <span style={styles.optionLabel}>{String.fromCharCode(65 + displayPos)}</span>
                <span>{currentQuestion[`option_${originalLetter}` as keyof Question]}</span>
              </button>
            ))}
          </div>

          <div style={styles.actionRow}>
            <button
              onClick={() => navigateTo(currentIndex - 1)}
              disabled={currentIndex === 0}
              style={styles.secondaryBtn}
            >
              Previous
            </button>
            <button onClick={handleClearResponse} style={styles.secondaryBtn}>
              Clear Response
            </button>
            <button
              onClick={handleToggleReview}
              style={{ ...styles.secondaryBtn, ...(isMarkedForReview ? styles.reviewActiveBtn : {}) }}
            >
              {isMarkedForReview ? 'Unmark Review' : 'Mark for Review'}
            </button>
            {currentIndex < questions.length - 1 ? (
              <button onClick={() => navigateTo(currentIndex + 1)} style={styles.primaryBtn}>
                Next
              </button>
            ) : (
              <button onClick={() => handleSubmit('manual')} style={styles.submitBtn} disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Test'}
              </button>
            )}
          </div>
        </main>

        {/* ── Pagination grid ──────────────────────────── */}
        <aside style={styles.sidebar}>
          <h3 style={styles.sidebarTitle}>Questions</h3>
          <div style={styles.legend}>
            <LegendItem color={STATUS_COLORS.not_attempted} label="Not attempted" />
            <LegendItem color={STATUS_COLORS.attempted} label="Attempted" />
            <LegendItem color={STATUS_COLORS.review_unattempted} label="Review (unanswered)" />
            <LegendItem color={STATUS_COLORS.review_attempted} label="Review (answered)" />
          </div>
          <div style={styles.questionGrid}>
            {questions.map((q, idx) => {
              const status = statusMap[q.id] || 'not_attempted';
              return (
                <button
                  key={q.id}
                  onClick={() => navigateTo(idx)}
                  style={{
                    ...styles.gridButton,
                    backgroundColor: STATUS_COLORS[status],
                    ...(idx === currentIndex ? styles.gridButtonActive : {}),
                  }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => handleSubmit('manual')}
            style={styles.submitBtnFull}
            disabled={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Test'}
          </button>
        </aside>
      </div>
    </div>
  );
}

function Timer({ remainingSeconds }: { remainingSeconds: number }) {
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const isLow = remainingSeconds < 60;
  return (
    <span style={{ ...styles.timer, color: isLow ? '#DC2626' : '#111827' }}>
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </span>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={styles.legendItem}>
      <span style={{ ...styles.legendDot, backgroundColor: color }} />
      <span style={styles.legendLabel}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#F5F6F8',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  loadingPage: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#6B7280',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  warningBanner: {
    position: 'fixed',
    top: 0, left: 0, right: 0,
    backgroundColor: '#FEF3CD',
    color: '#856404',
    padding: '10px 20px',
    textAlign: 'center',
    fontWeight: 500,
    fontSize: 14,
    zIndex: 1000,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 32px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#111827',
  },
  timer: {
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  mainLayout: {
    display: 'flex',
    maxWidth: 1100,
    margin: '0 auto',
    padding: '32px',
    gap: 24,
  },
  questionPanel: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    padding: '32px',
  },
  questionText: {
    fontSize: 17,
    fontWeight: 500,
    color: '#111827',
    lineHeight: 1.6,
    marginBottom: 28,
  },
  optionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 32,
  },
  optionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 8,
    border: '1px solid #D1D5DB',
    backgroundColor: '#FFFFFF',
    textAlign: 'left',
    fontSize: 14,
    color: '#374151',
    cursor: 'pointer',
  },
  optionButtonSelected: {
    border: '2px solid #1D4ED8',
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
    fontWeight: 600,
  },
  optionLabel: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    backgroundColor: '#F3F4F6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  actionRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  secondaryBtn: {
    padding: '10px 18px',
    borderRadius: 6,
    border: '1px solid #D1D5DB',
    backgroundColor: '#FFFFFF',
    color: '#374151',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  reviewActiveBtn: {
    backgroundColor: '#FEF3CD',
    border: '1px solid #D97706',
    color: '#92400E',
  },
  primaryBtn: {
    padding: '10px 24px',
    borderRadius: 6,
    border: 'none',
    backgroundColor: '#1D4ED8',
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  submitBtn: {
    padding: '10px 24px',
    borderRadius: 6,
    border: 'none',
    backgroundColor: '#059669',
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  submitBtnFull: {
    width: '100%',
    marginTop: 16,
    padding: '12px 0',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#059669',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  sidebar: {
    width: 260,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    padding: '24px',
    height: 'fit-content',
  },
  sidebarTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    margin: '0 0 16px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  legend: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 20,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  legendLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  questionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 8,
  },
  gridButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    border: 'none',
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  gridButtonActive: {
    outline: '2px solid #111827',
    outlineOffset: 2,
  },
};
