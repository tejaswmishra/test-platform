// apps/web/app/dashboard/page.tsx
// Replace your existing dashboard/page.tsx entirely with this version.
// Candidates see the existing simple card layout unchanged.
// Employees see a full analytics dashboard instead.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Shared interfaces ─────────────────────────────────────────────

interface AssignedTest {
  assignment_id: string;
  test_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  attempt_status: string;
  score?: number;
  attempt_id?: string;
  can_view_results?: boolean;
}

interface AnalyticsSummary {
  total_completed: number;
  average_percentage: number;
  best_percentage: number;
  pass_rate: number;
}

interface TestBreakdown {
  attempt_id: string;
  test_id: string;
  title: string;
  score: number;
  total_marks: number;
  percentage: number;
  passed: boolean;
  submitted_at: string;
  submit_reason: string;
  can_view_results: boolean;
}

// ── Main Dashboard Page ───────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  fetch('/api/proxy/tests/assigned')
    .then(r => r.json())
    .then(async (data) => {
      const allRows = [
        ...(data.pending || []),
        ...(data.inProgress || []),
        ...(data.completed || []),
      ];

      if (allRows.length > 0 && allRows[0].role) {
        setRole(allRows[0].role);
      } else {
        // No tests assigned yet — need /auth/me to get role
        const meRes = await fetch('/api/proxy/auth/me');
        const me = await meRes.json();
        setRole(me.role);
      }
    })
    .finally(() => setLoading(false));  // now fires after BOTH branches complete
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    sessionStorage.removeItem('userRole');
    router.push('/login');
  }

  if (loading) return <div style={styles.loadingPage}>Loading...</div>;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>
          {role === 'employee' ? 'My Learning Dashboard' : 'My Dashboard'}
        </h1>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </header>
      <main style={styles.main}>
        {role === 'employee'
          ? <EmployeeDashboard router={router} />
          : <CandidateDashboard router={router} />
        }
      </main>
    </div>
  );
}

// ── Candidate Dashboard (unchanged simple layout) ─────────────────

function CandidateDashboard({ router }: { router: any }) {
  const [pending, setPending] = useState<AssignedTest[]>([]);
  const [inProgress, setInProgress] = useState<AssignedTest[]>([]);
  const [completed, setCompleted] = useState<AssignedTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => { loadDashboard(); }, []);

  async function loadDashboard() {
    try {
      const res = await fetch('/api/proxy/tests/assigned');
      const data = await res.json();
      setPending(data.pending || []);
      setInProgress(data.inProgress || []);
      setCompleted(data.completed || []);
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
      if (!res.ok) { alert(data.error || 'Could not start the test'); return; }
      router.push(`/test/${data.attempt.id}?testId=${testId}`);
    } finally {
      setStartingId(null);
    }
  }

  if (loading) return <p style={styles.emptyState}>Loading your tests...</p>;

  return (
    <div>
      {pending.length === 0 && inProgress.length === 0 && completed.length === 0 && (
        <p style={styles.emptyState}>No tests have been assigned to you yet.</p>
      )}
      {inProgress.length > 0 && (
        <Section title="Continue where you left off">
          {inProgress.map(t => (
            <TestCard key={t.assignment_id} test={t} actionLabel="Resume Test"
              onAction={() => handleStartTest(t.test_id)}
              loading={startingId === t.test_id} accentColor="#D97706" router={router} />
          ))}
        </Section>
      )}
      {pending.length > 0 && (
        <Section title="Available Tests">
          {pending.map(t => (
            <TestCard key={t.assignment_id} test={t} actionLabel="Start Test"
              onAction={() => handleStartTest(t.test_id)}
              loading={startingId === t.test_id} accentColor="#1D4ED8" router={router} />
          ))}
        </Section>
      )}
      {completed.length > 0 && (
        <Section title="Completed">
          {completed.map(t => (
            <TestCard key={t.assignment_id} test={t} completed accentColor="#059669" router={router} />
          ))}
        </Section>
      )}
    </div>
  );
}

// ── Employee Analytics Dashboard ──────────────────────────────────

function EmployeeDashboard({ router }: { router: any }) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [breakdown, setBreakdown] = useState<TestBreakdown[]>([]);
  const [pending, setPending] = useState<AssignedTest[]>([]);
  const [inProgress, setInProgress] = useState<AssignedTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [analyticsRes, assignedRes] = await Promise.all([
          fetch('/api/proxy/tests/analytics'),
          fetch('/api/proxy/tests/assigned'),
        ]);
        const analyticsData = await analyticsRes.json();
        const assignedData = await assignedRes.json();

        setSummary(analyticsData.summary);
        setChartData(analyticsData.chart_data || []);
        setBreakdown(analyticsData.test_breakdown || []);
        setPending(assignedData.pending || []);
        setInProgress(assignedData.inProgress || []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleStartTest(testId: string) {
    setStartingId(testId);
    try {
      const res = await fetch('/api/proxy/attempts/start', {
        method: 'POST',
        body: JSON.stringify({ test_id: testId }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Could not start the test'); return; }
      router.push(`/test/${data.attempt.id}?testId=${testId}`);
    } finally {
      setStartingId(null);
    }
  }

  if (loading) return <p style={styles.emptyState}>Loading your dashboard...</p>;

  const maxPercentage = Math.max(...chartData.map((d: any) => d.percentage), 100);

  return (
    <div>
      {/* Pending/in-progress tests first — action items go at top */}
      {(pending.length > 0 || inProgress.length > 0) && (
        <div style={{ marginBottom: 32 }}>
          {inProgress.length > 0 && (
            <Section title="Continue where you left off">
              {inProgress.map(t => (
                <TestCard key={t.assignment_id} test={t} actionLabel="Resume Test"
                  onAction={() => handleStartTest(t.test_id)}
                  loading={startingId === t.test_id} accentColor="#D97706" router={router} />
              ))}
            </Section>
          )}
          {pending.length > 0 && (
            <Section title="Available Tests">
              {pending.map(t => (
                <TestCard key={t.assignment_id} test={t} actionLabel="Start Test"
                  onAction={() => handleStartTest(t.test_id)}
                  loading={startingId === t.test_id} accentColor="#1D4ED8" router={router} />
              ))}
            </Section>
          )}
        </div>
      )}

      {summary && summary.total_completed > 0 ? (
        <>
          {/* Summary cards */}
          <h2 style={styles.sectionTitle}>Performance Overview</h2>
          <div style={styles.summaryGrid}>
            <SummaryCard label="Tests Completed" value={summary.total_completed} unit="" color="#1D4ED8" />
            <SummaryCard label="Average Score" value={summary.average_percentage} unit="%" color="#059669" />
            <SummaryCard label="Best Score" value={summary.best_percentage} unit="%" color="#7C3AED" />
            <SummaryCard label="Pass Rate" value={summary.pass_rate} unit="%" color="#D97706" />
          </div>

          {/* Bar chart */}
          {chartData.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h2 style={styles.sectionTitle}>Score Trend</h2>
              <div style={{ ...styles.card, padding: '24px 24px 16px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 160, overflowX: 'auto' }}>
                  {chartData.map((d: any, i: number) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 60 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: d.passed ? '#059669' : '#DC2626' }}>
                        {d.percentage}%
                      </span>
                      <div
                        style={{
                          width: 40,
                          height: `${Math.max((d.percentage / maxPercentage) * 130, 4)}px`,
                          backgroundColor: d.passed ? '#059669' : '#DC2626',
                          borderRadius: '4px 4px 0 0',
                          opacity: 0.85,
                        }}
                      />
                      <span style={{ fontSize: 10, color: '#6B7280', textAlign: 'center', maxWidth: 56, lineHeight: 1.2 }}>
                        {d.label}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 12, borderTop: '1px solid #F3F4F6' }}>
                  <span style={{ fontSize: 11, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, backgroundColor: '#059669', borderRadius: 2, display: 'inline-block' }} />
                    Passed
                  </span>
                  <span style={{ fontSize: 11, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, backgroundColor: '#DC2626', borderRadius: 2, display: 'inline-block' }} />
                    Did not pass
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Per-test breakdown table */}
          <h2 style={styles.sectionTitle}>Test History</h2>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Test', 'Score', 'Percentage', 'Result', 'Date', ''].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breakdown.map(b => (
                  <tr key={b.attempt_id}>
                    <td style={styles.td}>{b.title}</td>
                    <td style={styles.td}>{b.score}/{b.total_marks}</td>
                    <td style={styles.td}>{b.percentage}%</td>
                    <td style={styles.td}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
                        backgroundColor: b.passed ? '#D1FAE5' : '#FEE2E2',
                        color: b.passed ? '#065F46' : '#991B1B',
                      }}>
                        {b.passed ? 'Passed' : 'Not passed'}
                      </span>
                    </td>
                    <td style={styles.td}>{new Date(b.submitted_at).toLocaleDateString()}</td>
                    <td style={styles.td}>
                      {b.can_view_results && (
                        <button
                          onClick={() => router.push(`/results/${b.attempt_id}`)}
                          style={{ ...styles.viewBtn }}>
                          View Results
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        summary?.total_completed === 0 && (
          <div style={{ ...styles.card, textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontSize: 13 }}>
            Complete your first test to see your performance analytics here.
          </div>
        )
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.cardGrid}>{children}</div>
    </div>
  );
}

function SummaryCard({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${color}`, textAlign: 'center', padding: '20px' }}>
      <p style={{ fontSize: 28, fontWeight: 700, color, margin: '0 0 4px 0' }}>{value}{unit}</p>
      <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>{label}</p>
    </div>
  );
}

function TestCard({ test, actionLabel, onAction, loading, completed, accentColor, router }: {
  test: AssignedTest; actionLabel?: string; onAction?: () => void;
  loading?: boolean; completed?: boolean; accentColor: string; router: any;
}) {
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${accentColor}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={styles.cardTitle}>{test.title}</h3>
      {test.description && <p style={styles.cardDesc}>{test.description}</p>}
      <p style={styles.cardMeta}>{test.duration_minutes} minutes</p>
      {completed ? (
        test.can_view_results
          ? <button onClick={() => router.push(`/results/${test.attempt_id}`)}
              style={{ ...styles.actionBtn, backgroundColor: accentColor }}>
              View Results
            </button>
          : <div style={styles.scoreBox}>
              <span style={styles.scoreLabel}>Status</span>
              <span style={styles.submittedLabel}>Submitted</span>
            </div>
      ) : (
        <button onClick={onAction} disabled={loading}
          style={{ ...styles.actionBtn, backgroundColor: accentColor }}>
          {loading ? 'Starting...' : actionLabel}
        </button>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', backgroundColor: '#F5F6F8', fontFamily: 'system-ui, -apple-system, sans-serif' },
  loadingPage: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #E5E7EB' },
  headerTitle: { fontSize: 18, fontWeight: 600, color: '#111827', margin: 0 },
  logoutBtn: { padding: '8px 16px', borderRadius: 6, border: '1px solid #D1D5DB', backgroundColor: '#FFFFFF', color: '#374151', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  main: { maxWidth: 1000, margin: '0 auto', padding: '32px' },
  emptyState: { textAlign: 'center', padding: '60px 0', color: '#6B7280', fontSize: 14 },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.03em' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 10, border: '1px solid #E5E7EB', padding: '20px' },
  cardTitle: { fontSize: 15, fontWeight: 600, color: '#111827', margin: 0 },
  cardDesc: { fontSize: 13, color: '#6B7280', margin: 0 },
  cardMeta: { fontSize: 12, color: '#9CA3AF', margin: '4px 0 8px 0' },
  actionBtn: { marginTop: 'auto', padding: '9px 0', borderRadius: 6, border: 'none', color: '#FFFFFF', fontWeight: 600, fontSize: 13, cursor: 'pointer', width: '100%' },
  scoreBox: { marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, borderTop: '1px solid #F3F4F6' },
  scoreLabel: { fontSize: 12, color: '#6B7280' },
  submittedLabel: { fontSize: 13, fontWeight: 600, color: '#374151' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', color: '#6B7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid #E5E7EB' },
  td: { padding: '12px', borderBottom: '1px solid #F3F4F6', color: '#374151' },
  viewBtn: { padding: '5px 10px', borderRadius: 5, border: '1px solid #D1D5DB', backgroundColor: '#FFFFFF', color: '#374151', fontSize: 12, cursor: 'pointer' },
};
