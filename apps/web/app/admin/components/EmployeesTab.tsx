'use client';

import { useEffect, useState } from 'react';
import { sharedStyles as s } from './sharedStyles';

interface Employee {
  id: string;
  name: string;
  company_id: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export default function EmployeesTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', company_id: '', email: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const [newCredentials, setNewCredentials] = useState<{ company_id: string; tempPassword: string } | null>(null);

  useEffect(() => {
    loadEmployees();
  }, []);

  async function loadEmployees() {
    setLoading(true);
    try {
      const res = await fetch('/api/proxy/admin/employees');
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch (err) {
      console.error('Failed to load employees', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/proxy/admin/employees', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to create employee');
        return;
      }

      setNewCredentials({ company_id: data.employee.company_id, tempPassword: data.tempPassword });
      setForm({ name: '', company_id: '', email: '', phone: '' });
      setShowForm(false);
      loadEmployees();
    } catch (err) {
      alert('Unable to reach the server.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={s.sectionTitle}>Employees</h2>
          <p style={s.sectionDesc}>Existing employees who take internal training tests.</p>
        </div>
        <button onClick={() => setShowForm(true)} style={s.primaryBtn}>
          + Add Employee
        </button>
      </div>

      <div style={s.card}>
        {loading ? (
          <p style={s.emptyState}>Loading...</p>
        ) : employees.length === 0 ? (
          <p style={s.emptyState}>No employees added yet.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Company ID</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>Added</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td style={s.td}>{e.name}</td>
                  <td style={s.td}>{e.company_id}</td>
                  <td style={s.td}>{e.email || '—'}</td>
                  <td style={s.td}>{new Date(e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div style={s.modal} onClick={() => setShowForm(false)}>
          <div style={s.modalContent} onClick={(ev) => ev.stopPropagation()}>
            <h3 style={s.sectionTitle}>Add New Employee</h3>
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
                <label style={s.label}>Company ID</label>
                <input
                  required
                  style={s.input}
                  value={form.company_id}
                  onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                  placeholder="e.g. SEC12345"
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Email (optional)</label>
                <input
                  type="email"
                  style={s.input}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Phone (optional)</label>
                <input
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
                  {creating ? 'Creating...' : 'Add Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {newCredentials && (
        <div style={s.modal} onClick={() => setNewCredentials(null)}>
          <div style={s.modalContent} onClick={(ev) => ev.stopPropagation()}>
            <h3 style={s.sectionTitle}>Employee Added</h3>
            <p style={s.sectionDesc}>
              Share these credentials with the employee now — the password will not be shown again.
            </p>
            <div style={{ backgroundColor: '#F9FAFB', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: 13 }}><strong>Company ID:</strong> {newCredentials.company_id}</p>
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
