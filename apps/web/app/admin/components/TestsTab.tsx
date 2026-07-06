'use client';

import { useEffect, useState } from 'react';
import { sharedStyles as s } from './sharedStyles';

interface TestSummary {
  id: string;
  title: string;
  duration_minutes: number;
  question_count: string;
  test_type: string;
  is_active: boolean;
  created_at: string;
}

interface QuestionDraft {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'a' | 'b' | 'c' | 'd' | null;
  marks: number;
}

const emptyQuestion = (): QuestionDraft => ({
  question_text: '', option_a: '', option_b: '', option_c: '', option_d: '',
  correct_option: null, marks: 1,
});

export default function TestsTab() {
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [assigningTestId, setAssigningTestId] = useState<string | null>(null);

  useEffect(() => {
    loadTests();
  }, []);

  async function loadTests() {
    setLoading(true);
    try {
      const res = await fetch('/api/proxy/admin/tests');
      const data = await res.json();
      setTests(data.tests || []);
    } catch (err) {
      console.error('Failed to load tests', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={s.sectionTitle}>Tests</h2>
          <p style={s.sectionDesc}>Create and assign recruitment or training tests.</p>
        </div>
        <button onClick={() => setShowCreateForm(true)} style={s.primaryBtn}>
          + Create Test
        </button>
      </div>

      <div style={s.card}>
        {loading ? (
          <p style={s.emptyState}>Loading...</p>
        ) : tests.length === 0 ? (
          <p style={s.emptyState}>No tests created yet.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Title</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Questions</th>
                <th style={s.th}>Duration</th>
                <th style={s.th}>Status</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <td style={s.td}>{t.title}</td>
                  <td style={s.td}>
                    <span style={{
                      ...s.badge,
                      backgroundColor: t.test_type === 'internal' ? '#EFF6FF' : '#F3F4F6',
                      color: t.test_type === 'internal' ? '#1D4ED8' : '#374151',
                    }}>
                      {t.test_type}
                    </span>
                  </td>
                  <td style={s.td}>{t.question_count}</td>
                  <td style={s.td}>{t.duration_minutes} min</td>
                  <td style={s.td}>
                    <span style={{
                      ...s.badge,
                      backgroundColor: t.is_active ? '#D1FAE5' : '#F3F4F6',
                      color: t.is_active ? '#065F46' : '#6B7280',
                    }}>
                      {t.is_active ? 'Active' : 'Draft'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <button onClick={() => setAssigningTestId(t.id)} style={s.secondaryBtn}>
                      Assign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreateForm && (
        <CreateTestModal
          onClose={() => setShowCreateForm(false)}
          onCreated={() => { setShowCreateForm(false); loadTests(); }}
        />
      )}

      {assigningTestId && (
        <AssignTestModal
          testId={assigningTestId}
          onClose={() => setAssigningTestId(null)}
        />
      )}
    </div>
  );
}

// Replace ONLY the CreateTestModal function in your existing TestsTab.tsx.
// Everything else in that file (TestsTab, QuestionEditor, AssignTestModal,
// checkRowStyle) stays exactly the same — do not touch those.

function CreateTestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [testType, setTestType] = useState<'internal' | 'external'>('external');
  const [showResponses, setShowResponses] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [saving, setSaving] = useState(false);

  // Bulk upload state
  const [inputMode, setInputMode] = useState<'manual' | 'bulk'>('manual');
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<QuestionDraft[] | null>(null);
  const [uploadErrors, setUploadErrors] = useState<{ row: number; errors: string[] }[]>([]);

  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  const incompleteCount = questions.filter(
    (q) => !q.question_text || !q.option_a || !q.option_b || !q.option_c || !q.option_d || !q.correct_option
  ).length;

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, emptyQuestion()]);
  }

  function removeQuestion(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleDownloadTemplate() {
    window.open('/api/proxy/admin/question-template', '_blank');
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadPreview(null);
    setUploadErrors([]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Note: don't set Content-Type manually for FormData — browser sets it
      // automatically with the correct multipart boundary string
      const res = await fetch('/api/admin/questions/parse-upload', {
        method: 'POST',
        body: formData,
    });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to parse file');
        return;
      }

      setUploadPreview(data.questions);
      setUploadErrors(data.errors);

      // If all questions parsed cleanly, immediately use them as the
      // working question list so the admin can confirm and submit
      if (data.errors.length === 0 && data.questions.length > 0) {
        setQuestions(data.questions);
      }

    } catch (err) {
      alert('Unable to reach the server.');
    } finally {
      setUploading(false);
      // Reset the file input so the same file can be re-uploaded if edited
      e.target.value = '';
    }
  }

  function handleConfirmBulk() {
    if (!uploadPreview || uploadPreview.length === 0) return;
    setQuestions(uploadPreview);
    setInputMode('manual'); // switch back to manual so admin can review/edit
    setUploadPreview(null);
    setUploadErrors([]);
  }

  async function handleSubmit() {
    if (incompleteCount > 0) {
      alert(`${incompleteCount} question(s) are incomplete — fill in all options and select a correct answer.`);
      return;
    }
    if (questions.length === 0) {
      alert('Add at least one question before creating the test.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/proxy/admin/tests', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          duration_minutes: durationMinutes,
          shuffle_questions: shuffleQuestions,
          test_type: testType,
          show_responses_to_employee: testType === 'internal' ? showResponses : false,
          questions,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to create test');
        return;
      }

      onCreated();
    } catch (err) {
      alert('Unable to reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={{ ...s.modalContent, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={s.sectionTitle}>Create Test</h3>

        {/* Test metadata */}
        <div style={s.field}>
          <label style={s.label}>Title</label>
          <input style={s.input} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div style={s.field}>
          <label style={s.label}>Description (optional)</label>
          <input style={s.input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
          <div style={{ ...s.field, flex: 1, marginBottom: 0 }}>
            <label style={s.label}>Duration (minutes)</label>
            <input
              type="number"
              style={s.input}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              min={1}
            />
          </div>
          <div style={{ ...s.field, flex: 1, marginBottom: 0 }}>
            <label style={s.label}>Test Type</label>
            <select
              style={s.input}
              value={testType}
              onChange={(e) => setTestType(e.target.value as 'internal' | 'external')}
            >
              <option value="external">External (Recruitment)</option>
              <option value="internal">Internal (Employee Training)</option>
            </select>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
          <input type="checkbox" checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} />
          Shuffle question order per candidate
        </label>
        {testType === 'internal' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 13 }}>
            <input type="checkbox" checked={showResponses} onChange={(e) => setShowResponses(e.target.checked)} />
            Allow employees to view score and answer breakdown after submitting
          </label>
        )}

        {/* Question input section */}
        <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: 0 }}>Questions</h4>

            {/* Manual / Bulk Upload toggle */}
            <div style={{ display: 'flex', backgroundColor: '#F3F4F6', borderRadius: 6, padding: 3, gap: 2 }}>
              <button
                type="button"
                onClick={() => setInputMode('manual')}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  backgroundColor: inputMode === 'manual' ? '#FFFFFF' : 'transparent',
                  color: inputMode === 'manual' ? '#111827' : '#6B7280',
                  boxShadow: inputMode === 'manual' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => setInputMode('bulk')}
                style={{
                  padding: '5px 12px', borderRadius: 4, border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  backgroundColor: inputMode === 'bulk' ? '#FFFFFF' : 'transparent',
                  color: inputMode === 'bulk' ? '#111827' : '#6B7280',
                  boxShadow: inputMode === 'bulk' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                Bulk Upload
              </button>
            </div>
          </div>

          {/* Summary line — always visible regardless of mode */}
          {questions.length > 0 && (
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 12px 0' }}>
              {questions.length} question(s) · {totalMarks} total marks
              {incompleteCount > 0 && (
                <span style={{ color: '#DC2626', marginLeft: 8 }}>⚠ {incompleteCount} incomplete</span>
              )}
            </p>
          )}

          {/* Manual mode */}
          {inputMode === 'manual' && (
            <>
              {questions.map((q, idx) => (
                <QuestionEditor
                  key={idx}
                  index={idx}
                  question={q}
                  onChange={(patch) => updateQuestion(idx, patch)}
                  onRemove={() => removeQuestion(idx)}
                  canRemove={questions.length > 1}
                />
              ))}
              <button type="button" onClick={addQuestion} style={{ ...s.secondaryBtn, width: '100%', marginTop: 8 }}>
                + Add Question
              </button>
            </>
          )}

          {/* Bulk upload mode */}
          {inputMode === 'bulk' && (
            <div style={{ padding: '16px', backgroundColor: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
              <p style={{ fontSize: 13, color: '#374151', margin: '0 0 12px 0' }}>
                Download the template, fill it in with your questions, then upload it back.
              </p>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button type="button" onClick={handleDownloadTemplate} style={s.secondaryBtn}>
                  ↓ Download Template
                </button>
                <label style={{ ...s.primaryBtn, cursor: 'pointer', display: 'inline-block' }}>
                  {uploading ? 'Parsing...' : '↑ Upload Filled File'}
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              {/* Row-level errors */}
              {uploadErrors.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', margin: '0 0 6px 0' }}>
                    {uploadErrors.length} row(s) had errors and were skipped:
                  </p>
                  <div style={{ maxHeight: 120, overflowY: 'auto', backgroundColor: '#FEF2F2', borderRadius: 6, padding: 10 }}>
                    {uploadErrors.map((e, i) => (
                      <p key={i} style={{ fontSize: 12, color: '#991B1B', margin: '0 0 4px 0' }}>
                        Row {e.row}: {e.errors.join(', ')}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Parsed preview */}
              {uploadPreview !== null && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#065F46', margin: '0 0 8px 0' }}>
                    ✓ {uploadPreview.length} question(s) parsed successfully
                  </p>
                  <div style={{ maxHeight: 160, overflowY: 'auto', backgroundColor: '#F0FDF4', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                    {uploadPreview.map((q, i) => (
                      <p key={i} style={{ fontSize: 12, color: '#166534', margin: '0 0 4px 0' }}>
                        Q{i + 1}: {q.question_text}
                      </p>
                    ))}
                  </div>
                  {uploadPreview.length > 0 && (
                    <button type="button" onClick={handleConfirmBulk} style={s.primaryBtn}>
                      Use these {uploadPreview.length} question(s)
                    </button>
                  )}
                </div>
              )}

              {/* If questions were already confirmed from a previous upload */}
              {uploadPreview === null && questions.length > 0 && questions[0].question_text !== '' && (
                <p style={{ fontSize: 12, color: '#059669', margin: 0 }}>
                  ✓ {questions.length} question(s) loaded from upload. Switch to Manual tab to review or edit them.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 24, borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
          <button type="button" onClick={onClose} style={s.secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving || !title} style={s.primaryBtn}>
            {saving ? 'Creating...' : 'Create Test'}
          </button>
        </div>
      </div>
    </div>
  );
}


function QuestionEditor({
  index, question, onChange, onRemove, canRemove,
}: {
  index: number;
  question: QuestionDraft;
  onChange: (patch: Partial<QuestionDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 14, marginBottom: 10, backgroundColor: '#FAFAFA' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Question {index + 1}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} style={{ ...s.dangerBtn, padding: '2px 8px' }}>
            Remove
          </button>
        )}
      </div>

      <input
        style={{ ...s.input, width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
        placeholder="Question text"
        value={question.question_text}
        onChange={(e) => onChange({ question_text: e.target.value })}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        {(['a', 'b', 'c', 'd'] as const).map((letter) => (
          <div
            key={letter}
            onClick={() => onChange({ correct_option: letter })}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
              borderRadius: 6, cursor: 'pointer',
              border: question.correct_option === letter ? '2px solid #059669' : '1px solid #D1D5DB',
              backgroundColor: question.correct_option === letter ? '#F0FDF4' : '#FFFFFF',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 12, color: '#6B7280' }}>{letter.toUpperCase()}</span>
            <input
              style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, backgroundColor: 'transparent' }}
              placeholder={`Option ${letter.toUpperCase()}`}
              value={question[`option_${letter}` as const]}
              onChange={(e) => onChange({ [`option_${letter}`]: e.target.value } as Partial<QuestionDraft>)}
              onClick={(e) => e.stopPropagation()}
            />
            {question.correct_option === letter && <span style={{ fontSize: 11, color: '#059669' }}>✓</span>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: '#6B7280' }}>Marks:</label>
        <input
          type="number"
          style={{ ...s.input, width: 60, padding: '4px 8px' }}
          value={question.marks}
          onChange={(e) => onChange({ marks: Number(e.target.value) })}
          min={1}
        />
      </div>
    </div>
  );
}

// ── Assign Test Modal ──────────────────────────────────────────────
function AssignTestModal({ testId, onClose }: { testId: string; onClose: () => void }) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [todayOnly, setTodayOnly] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [cRes, eRes] = await Promise.all([
          fetch('/api/proxy/admin/candidates'),
          fetch('/api/proxy/admin/employees'),
        ]);
        const cData = await cRes.json();
        const eData = await eRes.json();
        setCandidates(cData.candidates || []);
        setEmployees(eData.employees || []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const today = new Date().toDateString();
  const visibleCandidates = todayOnly
    ? candidates.filter((c) => new Date(c.created_at).toDateString() === today)
    : candidates;

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleAssign() {
    if (selectedIds.length === 0) {
      alert('Select at least one person to assign this test to.');
      return;
    }
    setAssigning(true);
    try {
      const res = await fetch(`/api/proxy/admin/tests/${testId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'specific', user_ids: selectedIds }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to assign test');
        return;
      }

      alert(`Assigned to ${data.newly_assigned} user(s).`);
      onClose();
    } catch (err) {
      alert('Unable to reach the server.');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={{ ...s.modalContent, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={s.sectionTitle}>Assign Test</h3>
        <p style={s.sectionDesc}>Select candidates or employees to assign this test to.</p>

        {loading ? (
          <p style={s.emptyState}>Loading...</p>
        ) : (
          <>
            {candidates.length > 0 && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
                  <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} />
                  Show only candidates registered today
                </label>

                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', margin: '12px 0 6px 0' }}>CANDIDATES</h4>
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 16 }}>
                  {visibleCandidates.length === 0 ? (
                    <p style={{ ...s.emptyState, padding: 16 }}>No candidates match this filter.</p>
                  ) : (
                    visibleCandidates.map((c) => (
                      <label key={c.id} style={checkRowStyle}>
                        <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggle(c.id)} />
                        <span>{c.name}</span>
                        <span style={{ color: '#9CA3AF', marginLeft: 'auto', fontSize: 12 }}>{c.email}</span>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}

            {employees.length > 0 && (
              <>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', margin: '12px 0 6px 0' }}>EMPLOYEES</h4>
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 16 }}>
                  {employees.map((emp) => (
                    <label key={emp.id} style={checkRowStyle}>
                      <input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => toggle(emp.id)} />
                      <span>{emp.name}</span>
                      <span style={{ color: '#9CA3AF', marginLeft: 'auto', fontSize: 12 }}>{emp.company_id}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={s.secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={handleAssign} disabled={assigning} style={s.primaryBtn}>
            {assigning ? 'Assigning...' : `Assign to ${selectedIds.length} selected`}
          </button>
        </div>
      </div>
    </div>
  );
}

const checkRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
  borderBottom: '1px solid #F3F4F6', fontSize: 13, cursor: 'pointer',
};
