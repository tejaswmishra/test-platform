'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import CandidatesTab from '../components/CandidatesTab';
import EmployeesTab from '../components/EmployeesTab';
import TestsTab from '../components/TestsTab';
import ResponsesTab from '../components/ResponsesTab';

type Tab = 'candidates' | 'employees' | 'tests' | 'responses';

export default function AdminDashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('tests');

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'tests', label: 'Tests' },
    { key: 'candidates', label: 'Candidates' },
    { key: 'employees', label: 'Employees' },
    { key: 'responses', label: 'Responses' },
  ];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.adminBadge}>ADMIN</span>
          <h1 style={styles.headerTitle}>Test Platform</h1>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </header>

      <nav style={styles.tabBar}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={activeTab === t.key ? styles.tabActive : styles.tabInactive}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {activeTab === 'tests' && <TestsTab />}
        {activeTab === 'candidates' && <CandidatesTab />}
        {activeTab === 'employees' && <EmployeesTab />}
        {activeTab === 'responses' && <ResponsesTab />}
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 32px',
    backgroundColor: '#111827',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  adminBadge: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: '#93C5FD',
    backgroundColor: 'rgba(59,130,246,0.15)',
    padding: '4px 10px',
    borderRadius: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#F9FAFB',
    margin: 0,
  },
  logoutBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid #374151',
    backgroundColor: 'transparent',
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  tabBar: {
    display: 'flex',
    gap: 4,
    padding: '0 32px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
  },
  tabActive: {
    padding: '14px 18px',
    border: 'none',
    borderBottom: '2px solid #1D4ED8',
    backgroundColor: 'transparent',
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  tabInactive: {
    padding: '14px 18px',
    border: 'none',
    borderBottom: '2px solid transparent',
    backgroundColor: 'transparent',
    color: '#6B7280',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  main: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '32px',
  },
};
