'use client';

import { useEffect, useState } from 'react';
import { sharedStyles as s } from './sharedStyles';

interface Candidate {
  id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
}

export default function CandidatesTab() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOnlyToday, setShowOnlyToday] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const [newCredentials, setNewCredentials] = useState<{ email: string; tempPassword: string } | null>(null);

  useEffect(() => {
    loadCandidates();
  }, []);

  async function loadCandidates() {
    setLoading(true);
    try {
      const res = await fetch('/api/proxy/admin/candidates');
      const data = await res.json();
      setCandidates(data.candidates || []);
    } catch (err) {
      console.error('Failed to load candidates', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/proxy/admin/candidates', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to create candidate');
        return;
      }

      setNewCredentials({ email: data.candidate.email, tempPassword: data.tempPassword });
      setForm({ name: '', email: '', phone: '' });
      setShowForm(false);
      loadCandidates();
    } catch (err) {
      alert('Unable to reach the server.');
    } finally {
      setCreating(false);
    }
  }

  const today = new Date().toDateString();
  const visibleCandidates = showOnlyToday
    ? candidates.filter((c) => new Date(c.created_at).toDateString() === today)
    : candidates;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={s.sectionTitle}>Candidates</h2>
          <p style={s.sectionDesc}>New joinees registered for recruitment tests.</p>
        </div>
        <button onClick={() => setShowForm(true)} style={s.primaryBtn}>
          + Register Candidate
        </button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13, color: '#374151' }}>
        <input
          type="checkbox"
          checked={showOnlyToday}
          onChange={(e) => setShowOnlyToday(e.target.checked)}
        />
        Show only candidates registered today
      </label>

      <div style={s.card}>
        {loading ? (
          <p style={s.emptyState}>Loading...</p>
        ) : visibleCandidates.length === 0 ? (
          <p style={s.emptyState}>
            {showOnlyToday ? 'No candidates registered today yet.' : 'No candidates registered yet.'}
          </p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>Phone</th>
                <th style={s.th}>Registered</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map((c) => (
                <tr key={c.id}>
                  <td style={s.td}>{c.name}</td>
                  <td style={s.td}>{c.email}</td>
                  <td style={s.td}>{c.phone}</td>
                  <td style={s.td}>{new Date(c.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div style={s.modal} onClick={() => setShowForm(false)}>
          <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.sectionTitle}>Register New Candidate</h3>
            <form onSubmit={handleCreate}>
              <div style={s.field}>
                <label style={s.label}>Name</label>
                <input
                  required
                  style={s.input}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Email</label>
                <input
                  required
                  type="email"
                  style={s.input}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Phone</label>
                <input
                  required
                  style={s.input}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setShowForm(false)} style={s.secondaryBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={creating} style={s.primaryBtn}>
                  {creating ? 'Creating...' : 'Create Candidate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {newCredentials && (
        <div style={s.modal} onClick={() => setNewCredentials(null)}>
          <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.sectionTitle}>Candidate Created</h3>
            <p style={s.sectionDesc}>
              Share these credentials with the candidate now — the password will not be shown again.
            </p>
            <div style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 13 }}><strong>Email:</strong> {newCredentials.email}</p>
              <p style={{ margin: 0, fontSize: 13 }}><strong>Temporary password:</strong> {newCredentials.tempPassword}</p>
            </div>
            <button onClick={() => setNewCredentials(null)} style={s.primaryBtn}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
