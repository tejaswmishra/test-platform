'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Registration failed');
        setLoading(false);
        return;
      }

      // Token is set as cookie by the API route — go straight to dashboard
      router.push('/dashboard');

    } catch (err) {
      setError('Unable to reach the server. Check your connection.');
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Register for Test</h1>
        <p style={styles.subtitle}>Create your account to begin</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Full Name</label>
            <input
              required
              style={styles.input}
              placeholder="Your full name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              required
              type="email"
              style={styles.input}
              placeholder="you@example.com"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Phone Number</label>
            <input
              required
              style={styles.input}
              placeholder="10-digit mobile number"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              required
              type="password"
              style={styles.input}
              placeholder="At least 6 characters"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Confirm Password</label>
            <input
              required
              type="password"
              style={styles.input}
              value={form.confirmPassword}
              onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? 'Creating account...' : 'Register & Continue'}
          </button>

          <p style={styles.loginLink}>
            Already registered?{' '}
            <span
              onClick={() => router.push('/login')}
              style={{ color: '#1D4ED8', cursor: 'pointer', fontWeight: 500 }}
            >
              Sign in here
            </span>
          </p>
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
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: '40px 36px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
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
  loginLink: {
    textAlign: 'center',
    fontSize: 13,
    color: '#6B7280',
    margin: 0,
  },
};