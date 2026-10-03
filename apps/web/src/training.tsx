import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Strings } from './i18n.ts';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface CourseRow { id: string; status: string; title: string; description: string; lessonCount: number; myStatus: string | null; myProgress: number | null; myDueAt: string | null; canEdit: boolean }
interface LessonRow { id: string; type: string; title: string; required: boolean; done: boolean }
interface CourseDetail { id: string; status: string; title: string; description: string; canEdit: boolean; enrollment: { status: string; progressPct: number; dueAt: string | null } | null; certificate: { verificationCode: string; issuedAt: string } | null; lessons: LessonRow[]; locales?: { locale: string; title: string; description: string | null }[] }
type View = { k: 'list' } | { k: 'course'; id: string } | { k: 'lesson'; courseId: string; id: string };

const move = <T,>(a: T[], i: number, d: number): T[] => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return b; [b[i], b[j]] = [b[j]!, b[i]!]; return b; };
const Bar = ({ pct }: { pct: number }) => <div class="pbar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>;

export function TrainingView({ call, t, locale, canAuthor }: { call: Call; t: Strings; locale: Locale; canAuthor: boolean }) {
  const [view, setView] = useState<View>({ k: 'list' });
  return (
    <div class="train">
      {view.k === 'list' && <CourseList call={call} t={t} locale={locale} canAuthor={canAuthor} onOpen={(id) => setView({ k: 'course', id })} />}
      {view.k === 'course' && <CoursePage key={view.id} id={view.id} call={call} t={t} locale={locale} onBack={() => setView({ k: 'list' })} onLesson={(id) => setView({ k: 'lesson', courseId: (view as { id: string }).id, id })} />}
      {view.k === 'lesson' && <LessonPage key={view.id} id={view.id} call={call} t={t} locale={locale} onBack={() => setView({ k: 'course', id: view.courseId })} />}
    </div>
  );
}

function CourseList({ call, t, locale, canAuthor, onOpen }: { call: Call; t: Strings; locale: Locale; canAuthor: boolean; onOpen: (id: string) => void }) {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const load = useCallback(() => { call('GET', `/v1/courses?locale=${locale}`).then((r) => setCourses(r.courses), (e) => setErr((e as Error).message)); }, [call, locale]);
  useEffect(load, [load]);
  const create = async (e: Event) => {
    e.preventDefault();
    try { const r = await call('POST', '/v1/courses', { title: title.trim(), locale }); onOpen(r.id); } catch (x) { setErr((x as Error).message); }
  };
  if (!courses) return <div class="msg">{err || t.loading}</div>;
  const mine = courses.filter((c) => c.myStatus);
  const others = courses.filter((c) => !c.myStatus);
  const card = (c: CourseRow) => (
    <button class="ccard" key={c.id} onClick={() => onOpen(c.id)}>
      <b>{c.title}</b>
      {c.status === 'draft' && <span class="tag">{t.draft}</span>}
      <span class="muted">{c.description}</span>
      {c.myStatus && <><Bar pct={c.myProgress ?? 0} /><small>{c.myStatus === 'completed' ? `✓ ${t.completed}` : `${Math.round(c.myProgress ?? 0)}%`}{c.myDueAt && c.myStatus !== 'completed' ? ` · ${t.due} ${new Date(c.myDueAt).toLocaleDateString(locale)}` : ''}</small></>}
      {!c.myStatus && <small>{t.lessons(c.lessonCount)}</small>}
    </button>
  );
  return (
    <div class="tpad">
      <div class="bar" style={{ padding: 0, border: 0 }}>
        <h1>{t.training}</h1><span class="spacer" />
        {canAuthor && <button class="btn" onClick={() => setAdding(true)}>+ {t.newCourse}</button>}
      </div>
      {err && <div class="err">{err}</div>}
      {adding && (
        <form class="erow" onSubmit={create}>
          <input autofocus placeholder={t.courseTitle} aria-label={t.courseTitle} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <button class="btn" disabled={!title.trim()}>{t.create}</button><button type="button" class="btn quiet" onClick={() => setAdding(false)}>{t.cancel}</button>
        </form>
      )}
      {courses.length === 0 && <div class="msg">{t.noCourses}</div>}
      {mine.length > 0 && <><h3>{t.myLearning}</h3><div class="cgrid">{mine.map(card)}</div></>}
      {others.length > 0 && <><h3>{t.allCourses}</h3><div class="cgrid">{others.map(card)}</div></>}
    </div>
  );
}

function CoursePage({ id, call, t, locale, onBack, onLesson }: { id: string; call: Call; t: Strings; locale: Locale; onBack: () => void; onLesson: (id: string) => void }) {
  const [c, setC] = useState<CourseDetail | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [nodes, setNodes] = useState<{ id: string; name: string; type: string }[]>([]);
  const [team, setTeam] = useState<{ userId: string; displayName: string | null; email: string; status: string; progressPct: number; dueAt: string | null }[] | null>(null);
  const [lt, setLt] = useState('');
  const [lType, setLType] = useState('richtext');
  const [assignNode, setAssignNode] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const load = useCallback(() => { call('GET', `/v1/courses/${id}?locale=${locale}`).then(setC, (e) => setErr((e as Error).message)); }, [call, id, locale]);
  useEffect(load, [load]);
  useEffect(() => { if (c?.canEdit) call('GET', '/v1/org/nodes').then((r) => { setNodes(r.nodes); }, () => undefined); }, [call, c?.canEdit]);
  const act = async (fn: () => Promise<unknown>, ok = t.saved) => { setErr(''); setNote(''); try { await fn(); setNote(ok); load(); } catch (e) { setErr((e as Error).message); } };
  if (!c) return <div class="msg">{err || t.loading}</div>;
  const en = c.locales?.find((l) => l.locale === 'en');
  return (
    <div class="tpad">
      <button class="link" onClick={onBack}>← {t.training}</button>
      <h1>{c.title} {c.status === 'draft' && <span class="tag">{t.draft}</span>}</h1>
      <p class="muted">{c.description}</p>
      {c.enrollment && <><Bar pct={c.enrollment.progressPct} /><small>{c.enrollment.status === 'completed' ? `✓ ${t.completed}` : `${Math.round(c.enrollment.progressPct)}%`}{c.enrollment.dueAt && c.enrollment.status !== 'completed' ? ` · ${t.due} ${new Date(c.enrollment.dueAt).toLocaleDateString(locale)}` : ''}</small></>}
      {c.certificate && <p class="ok">🎓 {t.certificate}: <b>{c.certificate.verificationCode}</b> · {new Date(c.certificate.issuedAt).toLocaleDateString(locale)}</p>}
      {err && <div class="err">{err}</div>}{note && <div class="ok">{note}</div>}

      <h3>{t.lessonsTitle}</h3>
      {c.lessons.length === 0 && <p class="muted">{t.noLessons}</p>}
      {c.lessons.map((l, i) => (
        <div class="lrow" key={l.id}>
          <button class="lbtn" onClick={() => onLesson(l.id)}><span class={`dot${l.done ? ' on' : ''}`}>{l.done ? '✓' : i + 1}</span><span>{l.title}</span><span class="tag">{t.lessonTypes[l.type] ?? l.type}</span>{!l.required && <span class="tag">{t.optional}</span>}</button>
          {c.canEdit && <>
            <button class="ib" aria-label={t.moveUp} disabled={i === 0} onClick={() => void act(() => call('PUT', `/v1/courses/${id}/lessons/order`, { lessonIds: move(c.lessons, i, -1).map((x) => x.id) }))}>↑</button>
            <button class="ib" aria-label={t.moveDown} disabled={i === c.lessons.length - 1} onClick={() => void act(() => call('PUT', `/v1/courses/${id}/lessons/order`, { lessonIds: move(c.lessons, i, 1).map((x) => x.id) }))}>↓</button>
            <button class="ib danger" aria-label={t.remove} onClick={() => { if (confirm(t.confirmLesson(l.title))) void act(() => call('DELETE', `/v1/lessons/${l.id}`)); }}>✕</button>
          </>}
        </div>
      ))}

      {c.canEdit && (
        <>
          <form class="erow" onSubmit={(e) => { e.preventDefault(); const title = lt.trim(); if (!title) return; setLt(''); void act(() => call('POST', `/v1/courses/${id}/lessons`, { title, type: lType, locale })); }}>
            <input placeholder={t.addLesson} aria-label={t.addLesson} value={lt} onInput={(e) => setLt((e.target as HTMLInputElement).value)} />
            <select aria-label={t.type} value={lType} onChange={(e) => setLType((e.target as HTMLSelectElement).value)}>{Object.entries(t.lessonTypes).map(([k, v]) => <option value={k}>{v}</option>)}</select>
            <button class="btn quiet" disabled={!lt.trim()}>+</button>
          </form>

          <h3>{t.courseSettings}</h3>
          <label for="ct">{t.courseTitle} ({locale})</label>
          <input id="ct" class="wide" defaultValue={c.title} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== c.title) void act(() => call('PATCH', `/v1/courses/${id}`, { title: v, locale })); }} />
          <label for="cd">{t.description} ({locale})</label>
          <textarea id="cd" class="wide" rows={2} defaultValue={c.description} onBlur={(e) => { const v = (e.target as HTMLTextAreaElement).value; if (v !== c.description) void act(() => call('PATCH', `/v1/courses/${id}`, { description: v, locale })); }} />
          <div class="actions">
            {c.status !== 'published'
              ? <button class="btn" onClick={() => void act(() => call('PATCH', `/v1/courses/${id}`, { status: 'published' }), t.published)}>{t.publish}</button>
              : <button class="btn quiet" onClick={() => void act(() => call('PATCH', `/v1/courses/${id}`, { status: 'draft' }))}>{t.unpublish}</button>}
          </div>

          {c.status === 'published' && (
            <>
              <h3>{t.assign}</h3>
              <form class="erow" onSubmit={(e) => { e.preventDefault(); if (!assignNode) return; void act(async () => { const r = await call('POST', `/v1/courses/${id}/assignments`, { nodeId: assignNode, ...(assignDue ? { dueAt: new Date(`${assignDue}T23:59:00`).toISOString() } : {}) }); setNote(t.assigned(r.enrolled)); }, ''); }}>
                <select aria-label={t.assignTo} value={assignNode} onChange={(e) => setAssignNode((e.target as HTMLSelectElement).value)}>
                  <option value="">{t.assignTo}…</option>{nodes.map((n) => <option value={n.id}>{n.name}</option>)}
                </select>
                <input type="date" aria-label={t.dueDate} value={assignDue} onInput={(e) => setAssignDue((e.target as HTMLInputElement).value)} style={{ flex: '0 0 150px' }} />
                <button class="btn quiet" disabled={!assignNode}>{t.assign}</button>
              </form>
              <h3>{t.teamProgress}</h3>
              {!team && <button class="btn quiet" onClick={() => void call('GET', `/v1/courses/${id}/progress`).then((r) => setTeam(r.learners), (e) => setErr((e as Error).message))}>{t.showProgress}</button>}
              {team && (
                <table>
                  <thead><tr><th>{t.name}</th><th>{t.stage}</th><th>%</th><th>{t.due}</th></tr></thead>
                  <tbody>{team.map((m) => <tr key={m.userId}><td>{m.displayName ?? m.email}</td><td>{t.enrollStatus[m.status] ?? m.status}</td><td>{Math.round(m.progressPct)}%</td><td>{m.dueAt ? new Date(m.dueAt).toLocaleDateString(locale) : ''}</td></tr>)}</tbody>
                </table>
              )}
            </>
          )}
          {en && <small class="muted">{t.langHint}</small>}
        </>
      )}
    </div>
  );
}

interface QuizQ { id: string; type: string; prompt: string; options: { key: string; text: string }[]; correct?: string[] }
interface LessonDetail { id: string; courseId: string; type: string; title: string; body: { text?: string; url?: string }; required: boolean; done: boolean; canEdit: boolean; quiz?: { passMark: number | null; maxAttempts: number | null; attempts: { scorePct: number; passed: boolean }[]; questions: QuizQ[] } }

function LessonPage({ id, call, t, locale, onBack }: { id: string; call: Call; t: Strings; locale: Locale; onBack: () => void }) {
  const [l, setL] = useState<LessonDetail | null>(null);
  const [err, setErr] = useState('');
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<{ scorePct: number; passed: boolean; results: { questionId: string; correct: boolean }[] } | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => { call('GET', `/v1/lessons/${id}?locale=${locale}`).then((r) => { setL(r); setText(r.body?.text ?? ''); setUrl(r.body?.url ?? ''); }, (e) => setErr((e as Error).message)); }, [call, id, locale]);
  useEffect(load, [load]);
  if (!l) return <div class="msg">{err || t.loading}</div>;
  const complete = async () => { try { await call('POST', `/v1/lessons/${id}/complete`); load(); } catch (e) { setErr((e as Error).message); } };
  const submit = async () => { setErr(''); try { const r = await call('POST', `/v1/lessons/${id}/quiz/attempt`, { answers }); setResult(r); load(); } catch (e) { setErr((e as Error).message); } };
  const pick = (q: QuizQ, key: string) => setAnswers((a) => {
    const cur = a[q.id] ?? [];
    return { ...a, [q.id]: q.type === 'multi' ? (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]) : [key] };
  });
  const isVideoFile = /\.(mp4|webm)(\?|$)/i.test(l.body.url ?? '');
  return (
    <div class="tpad narrow">
      <button class="link" onClick={onBack}>← {t.backToCourse}</button>
      <h1>{l.title} {l.done && <span class="ok">✓</span>}</h1>
      {err && <div class="err">{err}</div>}
      {l.type === 'richtext' && <div class="prose">{(l.body.text ?? '').split(/\n{2,}/).map((p) => <p>{p}</p>)}</div>}
      {l.type === 'link' && l.body.url && <p><a href={l.body.url} target="_blank" rel="noopener noreferrer">{l.body.url}</a></p>}
      {l.type === 'video' && l.body.url && (isVideoFile ? <video controls src={l.body.url} style={{ width: '100%', borderRadius: '8px' }} /> : <p><a href={l.body.url} target="_blank" rel="noopener noreferrer">▶ {t.watchVideo}</a></p>)}
      {l.type !== 'quiz' && !l.done && <div class="actions"><button class="btn" onClick={complete}>{t.markDone}</button></div>}

      {l.type === 'quiz' && l.quiz && (
        <>
          <p class="muted">{t.passMark(l.quiz.passMark ?? 0)}{l.quiz.maxAttempts ? ` · ${t.attemptsMax(l.quiz.maxAttempts)}` : ''}</p>
          {l.quiz.attempts.length > 0 && <p class="muted">{t.lastScore}: {l.quiz.attempts[0]!.scorePct}%</p>}
          {l.quiz.questions.length === 0 && <p class="muted">{t.noQuestions}</p>}
          {l.quiz.questions.map((q, n) => (
            <fieldset class="q" key={q.id}>
              <legend>{n + 1}. {q.prompt}{q.type === 'multi' && <small class="muted"> ({t.pickAll})</small>}</legend>
              {q.options.map((o) => (
                <label class="opt"><input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={q.id} checked={(answers[q.id] ?? []).includes(o.key)} onChange={() => pick(q, o.key)} /> {o.text}{l.canEdit && q.correct?.includes(o.key) && <small class="ok"> ✓</small>}</label>
              ))}
              {result && <small class={result.results.find((r) => r.questionId === q.id)?.correct ? 'ok' : 'overdue'}>{result.results.find((r) => r.questionId === q.id)?.correct ? t.right : t.wrong}</small>}
            </fieldset>
          ))}
          {l.quiz.questions.length > 0 && <div class="actions"><button class="btn" onClick={submit} disabled={Object.keys(answers).length === 0}>{t.submitQuiz}</button></div>}
          {result && <p class={result.passed ? 'ok' : 'overdue'}><b>{result.scorePct}%</b> · {result.passed ? t.passed : t.notPassed}</p>}
        </>
      )}

      {l.canEdit && l.type !== 'quiz' && (
        <>
          <div class="actions"><button class="btn quiet" onClick={() => setEditing((v) => !v)}>{t.edit}</button></div>
          {editing && (
            <div>
              {l.type === 'richtext' && <><label for="lt">{t.lessonText}</label><textarea id="lt" class="wide" rows={8} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} /></>}
              {(l.type === 'link' || l.type === 'video') && <><label for="lu">https://</label><input id="lu" class="wide" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></>}
              <div class="actions"><button class="btn" onClick={async () => { try { await call('PATCH', `/v1/lessons/${id}`, { locale, ...(l.type === 'richtext' ? { text } : { url }) }); setEditing(false); load(); } catch (e) { setErr((e as Error).message); } }}>{t.saveBtn}</button></div>
            </div>
          )}
        </>
      )}
      {l.canEdit && l.type === 'quiz' && <QuizEditor lessonId={id} call={call} t={t} locale={locale} existing={l.quiz?.questions ?? []} onSaved={load} />}
    </div>
  );
}

function QuizEditor({ lessonId, call, t, locale, existing, onSaved }: { lessonId: string; call: Call; t: Strings; locale: Locale; existing: QuizQ[]; onSaved: () => void }) {
  interface Draft { prompt: string; type: string; options: string[]; correct: number[] }
  const [qs, setQs] = useState<Draft[]>(existing.map((q) => ({ prompt: q.prompt, type: q.type, options: q.options.map((o) => o.text), correct: (q.correct ?? []).map(Number) })));
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (i: number, patch: Partial<Draft>) => setQs((cur) => cur.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const save = async () => {
    setMsg('');
    try { await call('PUT', `/v1/lessons/${lessonId}/quiz`, { locale, questions: qs }); setMsg(t.saved); onSaved(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div>
      <div class="actions"><button class="btn quiet" onClick={() => setOpen((v) => !v)}>{t.editQuiz}</button></div>
      {open && (
        <div>
          {qs.map((q, i) => (
            <fieldset class="q" key={i}>
              <input class="wide" placeholder={t.question} aria-label={t.question} value={q.prompt} onInput={(e) => set(i, { prompt: (e.target as HTMLInputElement).value })} />
              <select aria-label={t.type} value={q.type} onChange={(e) => { const ty = (e.target as HTMLSelectElement).value; set(i, ty === 'true_false' ? { type: ty, options: [t.trueLabel, t.falseLabel], correct: [0] } : { type: ty }); }}>
                <option value="single">{t.single}</option><option value="multi">{t.multi}</option><option value="true_false">{t.trueFalse}</option>
              </select>
              {q.options.map((o, k) => (
                <div class="erow" key={k}>
                  <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={`c${i}`} aria-label={t.correctAnswer} checked={q.correct.includes(k)} onChange={() => set(i, { correct: q.type === 'multi' ? (q.correct.includes(k) ? q.correct.filter((x) => x !== k) : [...q.correct, k]) : [k] })} />
                  <input value={o} disabled={q.type === 'true_false'} onInput={(e) => set(i, { options: q.options.map((x, j) => (j === k ? (e.target as HTMLInputElement).value : x)) })} />
                  {q.type !== 'true_false' && q.options.length > 2 && <button class="ib danger" aria-label={t.remove} onClick={() => set(i, { options: q.options.filter((_, j) => j !== k), correct: q.correct.filter((x) => x !== k).map((x) => (x > k ? x - 1 : x)) })}>✕</button>}
                </div>
              ))}
              <div class="actions">
                {q.type !== 'true_false' && q.options.length < 8 && <button class="btn quiet" onClick={() => set(i, { options: [...q.options, ''] })}>+ {t.option}</button>}
                <button class="btn quiet" onClick={() => setQs((cur) => cur.filter((_, k) => k !== i))}>{t.remove}</button>
              </div>
            </fieldset>
          ))}
          <div class="actions">
            <button class="btn quiet" onClick={() => setQs((cur) => [...cur, { prompt: '', type: 'single', options: ['', ''], correct: [0] }])}>+ {t.question}</button>
            <button class="btn" onClick={save} disabled={qs.length === 0 || qs.some((q) => !q.prompt.trim() || q.options.some((o) => !o.trim()) || q.correct.length === 0)}>{t.saveBtn}</button>
          </div>
          {msg && <p class={msg === t.saved ? 'ok' : 'err'}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
