'use client';

import { useEffect, useState } from 'react';
import { sharedStyles as s } from './sharedStyles';

interface TestSummary {
  id: string;
  title: string;
}

interface Assignment {
  assignment_id: string;
  user_id: string;
  name: string;
  email: string | null;
  company_id: string | null;
  role: string;
  attempt_status: string;
}

export default function ResponsesTab() {
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string>('');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadTests() {
      const res = await fetch('/api/proxy/admin/tests');
      const data = await res.json();
      setTests(data.tests || []);
      if (data.tests?.length > 0) setSelectedTestId(data.tests[0].id);
    }
    loadTests();
  }, []);

  useEffect(() => {
    if (selectedTestId) loadAssignments(selectedTestId);
  }, [selectedTestId]);

  async function loadAssignments(testId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/proxy/admin/tests/${testId}/assignments`);
      const data = await res.json();
      setAssignments(data.assignments || []);
    } catch (err) {
      console.error('Failed to load assignments', err);
    } finally {
      setLoading(false);
    }
  }

  function statusBadgeStyle(status: string): React.CSSProperties {
    const map: Record<string, { bg: string; color: string }> = {
      pending: { bg: '#F3F4F6', color: '#6B7280' },
      in_progress: { bg: '#FEF3CD', color: '#92400E' },
      submitted: { bg: '#D1FAE5', color: '#065F46' },
    };
    const c = map[status] || map.pending;
    return { ...s.badge, backgroundColor: c.bg, color: c.color };
  }

  async function handleExport() {
    window.open(`/api/proxy/admin/tests/${selectedTestId}/export`, '_blank');
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={s.sectionTitle}>Responses</h2>
          <p style={s.sectionDesc}>View candidate and employee progress per test.</p>
        </div>
        <button onClick={handleExport} disabled={!selectedTestId} style={s.primaryBtn}>
          Export to Excel
        </button>
      </div>

      <div style={s.field}>
        <label style={s.label}>Select Test</label>
        <select
          style={{ ...s.input, maxWidth: 320 }}
          value={selectedTestId}
          onChange={(e) => setSelectedTestId(e.target.value)}
        >
          {tests.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>

      <div style={s.card}>
        {loading ? (
          <p style={s.emptyState}>Loading...</p>
        ) : assignments.length === 0 ? (
          <p style={s.emptyState}>No one has been assigned this test yet.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Identifier</th>
                <th style={s.th}>Role</th>
                <th style={s.th}>Status</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.assignment_id}>
                  <td style={s.td}>{a.name}</td>
                  <td style={s.td}>{a.email || a.company_id}</td>
                  <td style={s.td}>{a.role}</td>
                  <td style={s.td}>
                    <span style={statusBadgeStyle(a.attempt_status)}>
                      {a.attempt_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={s.td}>
                    {a.attempt_status !== 'pending' && (
                      <RowActions
                        testId={selectedTestId}
                        userId={a.user_id}
                        onDone={() => loadAssignments(selectedTestId)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RowActions({ testId, userId, onDone }: { testId: string; userId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function handleRestart() {
    if (!confirm('Allow this person to restart the test? Their previous attempt will be voided.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/admin/tests/${testId}/restart`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to restart');
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function handleTerminate() {
    if (!confirm('Terminate this attempt? This cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/admin/tests/${testId}/terminate`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to terminate');
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={handleRestart} disabled={busy} style={s.secondaryBtn}>
        Allow Restart
      </button>
      <button onClick={handleTerminate} disabled={busy} style={s.dangerBtn}>
        Terminate
      </button>
    </div>
  );
}
