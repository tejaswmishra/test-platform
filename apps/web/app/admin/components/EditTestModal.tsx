// New component: apps/web/app/admin/components/EditTestModal.tsx
// Import and use this in TestsTab.tsx — add an "Edit" button per test row
// that sets editingTest state, then renders this modal.

'use client';

import { useEffect, useState } from 'react';
import { sharedStyles as s } from './sharedStyles';

interface Question {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  marks: number;
  order_index: number;
}

interface Test {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  pass_percentage: number;
  shuffle_questions: boolean;
  test_type: string;
  show_responses_to_employee: boolean;
}

export default function EditTestModal({
  testId,
  onClose,
  onSaved,
}: {
  testId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'metadata' | 'questions'>('metadata');
  const [saving, setSaving] = useState(false);
  const [blockReason, setBlockReason] = useState('');

  // Metadata form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [passPercentage, setPassPercentage] = useState(60);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [testType, setTestType] = useState<'internal' | 'external'>('external');
  const [showResponses, setShowResponses] = useState(false);

  // Question editing state
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadTest();
  }, [testId]);

  async function loadTest() {
    setLoading(true);
    try {
      const res = await fetch(`/api/proxy/admin/tests/${testId}`);
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setBlockReason(data.error);
        }
        return;
      }

      setTest(data.test);
      setQuestions(data.questions || []);
      setTitle(data.test.title);
      setDescription(data.test.description || '');
      setDurationMinutes(data.test.duration_minutes);
      setPassPercentage(data.test.pass_percentage);
      setShuffleQuestions(data.test.shuffle_questions);
      setTestType(data.test.test_type);
      setShowResponses(data.test.show_responses_to_employee);

    } catch (err) {
      console.error('Failed to load test', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveMetadata() {
    setSaving(true);
    try {
      const res = await fetch(`/api/proxy/admin/tests/${testId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          description,
          duration_minutes: durationMinutes,
          pass_percentage: passPercentage,
          shuffle_questions: shuffleQuestions,
          test_type: testType,
          show_responses_to_employee: testType === 'internal' ? showResponses : false,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to save');
        return;
      }

      onSaved();
      alert('Test details updated successfully.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteQuestion(questionId: string) {
    if (!confirm('Delete this question? This cannot be undone.')) return;
    const res = await fetch(`/api/proxy/admin/tests/${testId}/questions/${questionId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to delete');
      return;
    }
    setQuestions(prev => prev.filter(q => q.id !== questionId));
  }

  async function handleSaveQuestion(questionId: string, patch: Partial<Question>) {
    const res = await fetch(`/api/proxy/admin/tests/${testId}/questions/${questionId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to save question');
      return;
    }
    setQuestions(prev => prev.map(q => q.id === questionId ? data.question : q));
    setEditingQuestionId(null);
  }

  async function handleAddQuestion(newQ: Omit<Question, 'id' | 'order_index'>) {
    const res = await fetch(`/api/proxy/admin/tests/${testId}/questions`, {
      method: 'POST',
      body: JSON.stringify(newQ),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to add question');
      return;
    }
    setQuestions(prev => [...prev, data.question]);
    setShowAddForm(false);
  }

  if (loading) {
    return (
      <div style={s.modal} onClick={onClose}>
        <div style={s.modalContent} onClick={e => e.stopPropagation()}>
          <p style={s.emptyState}>Loading test...</p>
        </div>
      </div>
    );
  }

  if (blockReason) {
    return (
      <div style={s.modal} onClick={onClose}>
        <div style={s.modalContent} onClick={e => e.stopPropagation()}>
          <h3 style={s.sectionTitle}>Cannot Edit Test</h3>
          <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: 16, margin: '16px 0' }}>
            <p style={{ color: '#991B1B', fontSize: 13, margin: 0 }}>⚠ {blockReason}</p>
          </div>
          <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
            Go to the Responses tab, terminate any in-progress attempts, then try editing again.
          </p>
          <button onClick={onClose} style={s.primaryBtn}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={{ ...s.modalContent, maxWidth: 740 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={s.sectionTitle}>Edit Test</h3>
          <button onClick={onClose} style={{ ...s.secondaryBtn, padding: '6px 12px' }}>✕</button>
        </div>

        {/* Section toggle */}
        <div style={{ display: 'flex', backgroundColor: '#F3F4F6', borderRadius: 6, padding: 3, gap: 2, marginBottom: 20 }}>
          {(['metadata', 'questions'] as const).map(section => (
            <button
              key={section}
              type="button"
              onClick={() => setActiveSection(section)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 4, border: 'none',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                backgroundColor: activeSection === section ? '#FFFFFF' : 'transparent',
                color: activeSection === section ? '#111827' : '#6B7280',
                boxShadow: activeSection === section ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                textTransform: 'capitalize',
              }}
            >
              {section === 'metadata' ? 'Test Details' : `Questions (${questions.length})`}
            </button>
          ))}
        </div>

        {/* Test Details section */}
        {activeSection === 'metadata' && (
          <div>
            <div style={s.field}>
              <label style={s.label}>Title</label>
              <input style={s.input} value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Description</label>
              <input style={s.input} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
              <div style={{ ...s.field, flex: 1, marginBottom: 0 }}>
                <label style={s.label}>Duration (minutes)</label>
                <input type="number" style={s.input} value={durationMinutes}
                  onChange={e => setDurationMinutes(Number(e.target.value))} min={1} />
              </div>
              <div style={{ ...s.field, flex: 1, marginBottom: 0 }}>
                <label style={s.label}>Pass Percentage (%)</label>
                <input type="number" style={s.input} value={passPercentage}
                  onChange={e => setPassPercentage(Number(e.target.value))} min={0} max={100} />
              </div>
              <div style={{ ...s.field, flex: 1, marginBottom: 0 }}>
                <label style={s.label}>Test Type</label>
                <select style={s.input} value={testType}
                  onChange={e => setTestType(e.target.value as 'internal' | 'external')}>
                  <option value="external">External (Recruitment)</option>
                  <option value="internal">Internal (Employee Training)</option>
                </select>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
              <input type="checkbox" checked={shuffleQuestions}
                onChange={e => setShuffleQuestions(e.target.checked)} />
              Shuffle question order per candidate
            </label>
            {testType === 'internal' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 13 }}>
                <input type="checkbox" checked={showResponses}
                  onChange={e => setShowResponses(e.target.checked)} />
                Allow employees to view score and answer breakdown after submitting
              </label>
            )}
            <button onClick={handleSaveMetadata} disabled={saving} style={s.primaryBtn}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Questions section */}
        {activeSection === 'questions' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {questions.map((q, idx) => (
                editingQuestionId === q.id
                  ? <QuestionEditForm
                      key={q.id}
                      question={q}
                      index={idx}
                      onSave={patch => handleSaveQuestion(q.id, patch)}
                      onCancel={() => setEditingQuestionId(null)}
                    />
                  : <QuestionRow
                      key={q.id}
                      question={q}
                      index={idx}
                      onEdit={() => setEditingQuestionId(q.id)}
                      onDelete={() => handleDeleteQuestion(q.id)}
                    />
              ))}
            </div>

            {showAddForm
              ? <QuestionEditForm
                  index={questions.length}
                  onSave={handleAddQuestion}
                  onCancel={() => setShowAddForm(false)}
                  isNew
                />
              : <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  style={{ ...s.secondaryBtn, width: '100%', marginTop: 12 }}
                >
                  + Add Question
                </button>
            }
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionRow({ question, index, onEdit, onDelete }: {
  question: Question; index: number;
  onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '12px 14px', backgroundColor: '#FAFAFA' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#111827', margin: '0 0 6px 0' }}>
            Q{index + 1}: {question.question_text}
          </p>
          <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>
            Correct: ({question.correct_option.toUpperCase()}) {question[`option_${question.correct_option}` as keyof Question]}
            {' · '}{question.marks} mark{question.marks !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onEdit} style={{ ...s.secondaryBtn, padding: '5px 10px', fontSize: 12 }}>Edit</button>
          <button onClick={onDelete} style={{ ...s.dangerBtn, padding: '5px 10px' }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function QuestionEditForm({ question, index, onSave, onCancel, isNew }: {
  question?: Question; index: number;
  onSave: (data: any) => void; onCancel: () => void; isNew?: boolean;
}) {
  const [form, setForm] = useState({
    question_text: question?.question_text || '',
    option_a: question?.option_a || '',
    option_b: question?.option_b || '',
    option_c: question?.option_c || '',
    option_d: question?.option_d || '',
    correct_option: question?.correct_option || null as string | null,
    marks: question?.marks || 1,
  });

  return (
    <div style={{ border: '2px solid #1D4ED8', borderRadius: 8, padding: 14, backgroundColor: '#F8FAFF' }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: '#1D4ED8', margin: '0 0 10px 0' }}>
        {isNew ? 'New Question' : `Editing Q${index + 1}`}
      </p>
      <input
        style={{ ...s.input, width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
        placeholder="Question text"
        value={form.question_text}
        onChange={e => setForm({ ...form, question_text: e.target.value })}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        {(['a', 'b', 'c', 'd'] as const).map(letter => (
          <div
            key={letter}
            onClick={() => setForm({ ...form, correct_option: letter })}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
              borderRadius: 6, cursor: 'pointer',
              border: form.correct_option === letter ? '2px solid #059669' : '1px solid #D1D5DB',
              backgroundColor: form.correct_option === letter ? '#F0FDF4' : '#FFFFFF',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 12, color: '#6B7280' }}>{letter.toUpperCase()}</span>
            <input
              style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, backgroundColor: 'transparent' }}
              placeholder={`Option ${letter.toUpperCase()}`}
              value={form[`option_${letter}` as keyof typeof form] as string}
              onChange={e => setForm({ ...form, [`option_${letter}`]: e.target.value })}
              onClick={e => e.stopPropagation()}
            />
            {form.correct_option === letter && <span style={{ fontSize: 11, color: '#059669' }}>✓</span>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <label style={{ fontSize: 12, color: '#6B7280' }}>Marks:</label>
        <input
          type="number" min={1} style={{ ...s.input, width: 60, padding: '4px 8px' }}
          value={form.marks}
          onChange={e => setForm({ ...form, marks: Number(e.target.value) })}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onCancel} style={s.secondaryBtn}>Cancel</button>
        <button
          type="button"
          disabled={!form.question_text || !form.option_a || !form.option_b || !form.option_c || !form.option_d || !form.correct_option}
          onClick={() => onSave(form)}
          style={s.primaryBtn}
        >
          {isNew ? 'Add Question' : 'Save Question'}
        </button>
      </div>
    </div>
  );
}
