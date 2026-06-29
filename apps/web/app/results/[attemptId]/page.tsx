'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface ResultItem {
  question_text: string;
  options: { a: string; b: string; c: string; d: string };
  your_answer: string | null;
  correct_answer: string;
  is_correct: boolean;
  marks: number;
}

interface ResultsData {
  test_title: string;
  score: number;
  total_marks: number;
  breakdown: ResultItem[];
}

export default function ResultsPage() {
  const router = useRouter();
  const params = useParams();
  const attemptId = params.attemptId as string;

  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadResults() {
      try {
        const res = await fetch(`/api/proxy/attempts/${attemptId}/results`);
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || 'Could not load results');
          return;
        }

        setData(json);
      } catch (err) {
        setError('Unable to reach the server.');
      } finally {
        setLoading(false);
      }
    }
    loadResults();
  }, [attemptId]);

  if (loading) {
    return <div style={styles.loadingPage}>Loading your results...</div>;
  }

  if (error || !data) {
    return (
      <div style={styles.loadingPage}>
        <div>
          <p style={{ marginBottom: 16 }}>{error || 'Results not available'}</p>
          <button onClick={() => router.push('/dashboard')} style={styles.backBtn}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const percentage = Math.round((data.score / data.total_marks) * 100);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <button onClick={() => router.push('/dashboard')} style={styles.backBtn}>
          ← Back to Dashboard
        </button>
      </header>

      <main style={styles.main}>
        <div style={styles.scoreCard}>
          <h1 style={styles.testTitle}>{data.test_title}</h1>
          <div style={styles.scoreRow}>
            <div>
              <span style={styles.scoreBig}>{data.score}</span>
              <span style={styles.scoreOutOf}> / {data.total_marks}</span>
            </div>
            <div style={styles.percentageBadge}>{percentage}%</div>
          </div>
        </div>

        <h2 style={styles.sectionTitle}>Question Breakdown</h2>

        <div style={styles.breakdownList}>
          {data.breakdown.map((item, idx) => (
            <div key={idx} style={styles.questionCard}>
              <div style={styles.questionHeader}>
                <span style={styles.questionNumber}>Question {idx + 1}</span>
                <span style={{
                  ...styles.resultBadge,
                  backgroundColor: item.is_correct ? '#D1FAE5' : '#FEE2E2',
                  color: item.is_correct ? '#065F46' : '#991B1B',
                }}>
                  {item.is_correct ? `Correct (+${item.marks})` : 'Incorrect'}
                </span>
              </div>

              <p style={styles.questionText}>{item.question_text}</p>

              <div style={styles.optionsList}>
                {(['a', 'b', 'c', 'd'] as const).map((letter) => {
                  const isYourAnswer = item.your_answer === letter;
                  const isCorrectAnswer = item.correct_answer === letter;

                  let rowStyle: React.CSSProperties = { ...styles.optionRow };
                  if (isCorrectAnswer) rowStyle = { ...rowStyle, ...styles.optionCorrect };
                  if (isYourAnswer && !isCorrectAnswer) rowStyle = { ...rowStyle, ...styles.optionWrong };

                  return (
                    <div key={letter} style={rowStyle}>
                      <span style={styles.optionLetter}>{letter.toUpperCase()}</span>
                      <span>{item.options[letter]}</span>
                      {isYourAnswer && <span style={styles.tag}>Your answer</span>}
                      {isCorrectAnswer && <span style={styles.tag}>Correct answer</span>}
                    </div>
                  );
                })}
                {!item.your_answer && (
                  <p style={styles.notAnsweredNote}>You did not answer this question.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
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
    textAlign: 'center',
  },
  header: {
    padding: '20px 32px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
  },
  backBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid #D1D5DB',
    backgroundColor: '#FFFFFF',
    color: '#374151',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  main: {
    maxWidth: 760,
    margin: '0 auto',
    padding: '32px',
  },
  scoreCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    padding: '28px',
    marginBottom: 32,
  },
  testTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#111827',
    margin: '0 0 16px 0',
  },
  scoreRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scoreBig: {
    fontSize: 36,
    fontWeight: 700,
    color: '#111827',
  },
  scoreOutOf: {
    fontSize: 18,
    color: '#9CA3AF',
  },
  percentageBadge: {
    fontSize: 16,
    fontWeight: 700,
    color: '#1D4ED8',
    backgroundColor: '#EFF6FF',
    padding: '8px 16px',
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 14,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  breakdownList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  questionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    padding: '20px',
  },
  questionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  questionNumber: {
    fontSize: 12,
    fontWeight: 600,
    color: '#6B7280',
  },
  resultBadge: {
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 6,
  },
  questionText: {
    fontSize: 15,
    fontWeight: 500,
    color: '#111827',
    marginBottom: 14,
    lineHeight: 1.5,
  },
  optionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #E5E7EB',
    fontSize: 13,
    color: '#374151',
  },
  optionCorrect: {
    backgroundColor: '#F0FDF4',
    border: '1px solid #86EFAC',
  },
  optionWrong: {
    backgroundColor: '#FEF2F2',
    border: '1px solid #FCA5A5',
  },
  optionLetter: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    backgroundColor: '#F3F4F6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  tag: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: 600,
    color: '#6B7280',
  },
  notAnsweredNote: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
    margin: '4px 0 0 0',
  },
};
