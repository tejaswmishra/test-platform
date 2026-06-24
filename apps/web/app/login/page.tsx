'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [userType, setUserType] = useState<'candidate' | 'employee'>('candidate');
  const [email, setEmail] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const body =
      userType === 'employee'
        ? { userType, company_id: companyId, password }
        : { userType, email, password };

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      router.push('/dashboard');

    } catch (err) {
      setError('Unable to reach the server. Check your connection.');
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Test Platform</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        {/* Toggle between Candidate and Employee */}
        <div style={styles.toggleRow}>
          <button
            type="button"
            onClick={() => setUserType('candidate')}
            style={userType === 'candidate' ? styles.toggleActive : styles.toggleInactive}
          >
            New Joinee
          </button>
          <button
            type="button"
            onClick={() => setUserType('employee')}
            style={userType === 'employee' ? styles.toggleActive : styles.toggleInactive}
          >
            Employee
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {userType === 'candidate' ? (
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                placeholder="you@example.com"
              />
            </div>
          ) : (
            <div style={styles.field}>
              <label style={styles.label}>Company ID</label>
              <input
                type="text"
                required
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                style={styles.input}
                placeholder="e.g. SEC12345"
              />
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F6F8',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: '40px 36px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
    border: '1px solid #E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 600,
    color: '#111827',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 6,
    marginBottom: 28,
  },
  toggleRow: {
    display: 'flex',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
    marginBottom: 24,
  },
  toggleActive: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 6,
    border: 'none',
    backgroundColor: '#FFFFFF',
    color: '#111827',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  },
  toggleInactive: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6B7280',
    fontWeight: 500,
    fontSize: 14,
    cursor: 'pointer',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #D1D5DB',
    fontSize: 14,
    outline: 'none',
  },
  error: {
    fontSize: 13,
    color: '#DC2626',
    margin: 0,
    backgroundColor: '#FEF2F2',
    padding: '8px 12px',
    borderRadius: 6,
  },
  submitBtn: {
    marginTop: 8,
    padding: '11px 0',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#1D4ED8',
    color: '#FFFFFF',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
};
