'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AssignedTest {
  assignment_id: string;
  test_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  attempt_status: string;
  score?: number;
  attempt_id?: string;
  show_responses_to_employee?: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [pending, setPending] = useState<AssignedTest[]>([]);
  const [inProgress, setInProgress] = useState<AssignedTest[]>([]);
  const [completed, setCompleted] = useState<AssignedTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const res = await fetch('/api/proxy/tests/assigned');
      const data = await res.json();
      setPending(data.pending || []);
      setInProgress(data.inProgress || []);
      setCompleted(data.completed || []);
    } catch (err) {
      console.error('Failed to load dashboard', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartTest(testId: string) {
    setStartingId(testId);
    try {
      const res = await fetch('/api/proxy/attempts/start', {
        method: 'POST',
        body: JSON.stringify({ test_id: testId }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Could not start the test');
        setStartingId(null);
        return;
      }

      router.push(`/test/${data.attempt.id}?testId=${testId}`);

    } catch (err) {
      alert('Unable to reach the server.');
      setStartingId(null);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  if (loading) {
    return <div style={styles.loadingPage}>Loading your dashboard...</div>;
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>My Dashboard</h1>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </header>

      <main style={styles.main}>
        {pending.length === 0 && inProgress.length === 0 && completed.length === 0 && (
          <div style={styles.emptyState}>
            <p>No tests have been assigned to you yet.</p>
          </div>
        )}

        {inProgress.length > 0 && (
          <Section title="Continue where you left off">
            {inProgress.map((t) => (
              <TestCard
                key={t.assignment_id}
                test={t}
                actionLabel="Resume Test"
                onAction={() => handleStartTest(t.test_id)}
                loading={startingId === t.test_id}
                accentColor="#D97706"
              />
            ))}
          </Section>
        )}

        {pending.length > 0 && (
          <Section title="Available Tests">
            {pending.map((t) => (
              <TestCard
                key={t.assignment_id}
                test={t}
                actionLabel="Start Test"
                onAction={() => handleStartTest(t.test_id)}
                loading={startingId === t.test_id}
                accentColor="#1D4ED8"
              />
            ))}
          </Section>
        )}

        {completed.length > 0 && (
          <Section title="Completed">
            {completed.map((t) => (
              <TestCard key={t.assignment_id} test={t} completed accentColor="#059669" router={router} />
            ))}
          </Section>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.cardGrid}>{children}</div>
    </div>
  );
}

function TestCard({
  test,
  actionLabel,
  onAction,
  loading,
  completed,
  accentColor,
  router,
}: {
  test: AssignedTest;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
  completed?: boolean;
  accentColor: string;
  router?: ReturnType<typeof useRouter>;
}) {
  return (
    <div style={{ ...styles.card, borderTopColor: accentColor }}>
      <h3 style={styles.cardTitle}>{test.title}</h3>
      {test.description && <p style={styles.cardDesc}>{test.description}</p>}
      <p style={styles.cardMeta}>{test.duration_minutes} minutes</p>

      {completed ? (
        test.show_responses_to_employee ? (
          <button
            onClick={() => router?.push(`/results/${test.attempt_id}`)}
            style={{ ...styles.actionBtn, backgroundColor: accentColor }}
          >
            View Results
          </button>
        ) : (
          <div style={styles.scoreBox}>
            <span style={styles.scoreLabel}>Status</span>
            <span style={styles.submittedLabel}>Submitted</span>
          </div>
        )
      ) : (
        <button
          onClick={onAction}
          disabled={loading}
          style={{ ...styles.actionBtn, backgroundColor: accentColor }}
        >
          {loading ? 'Starting...' : actionLabel}
        </button>
      )}
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#111827',
    margin: 0,
  },
  logoutBtn: {
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
    maxWidth: 960,
    margin: '0 auto',
    padding: '32px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 0',
    color: '#6B7280',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 14,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: '20px',
    border: '1px solid #E5E7EB',
    borderTop: '3px solid',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#111827',
    margin: 0,
  },
  cardDesc: {
    fontSize: 13,
    color: '#6B7280',
    margin: 0,
  },
  cardMeta: {
    fontSize: 12,
    color: '#9CA3AF',
    margin: '4px 0 8px 0',
  },
  actionBtn: {
    marginTop: 'auto',
    padding: '9px 0',
    borderRadius: 6,
    border: 'none',
    color: '#FFFFFF',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  scoreBox: {
    marginTop: 'auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 8,
    borderTop: '1px solid #F3F4F6',
  },
  scoreLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  submittedLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: 700,
    color: '#059669',
  },
};
