import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Strings } from './i18n.ts';
import type { Locale } from './types.ts';
import { CourseCe, MyCe, PeopleCe, ceStrings } from './ce.tsx';
import { MyLearning } from './mylearning.tsx';
import { CompletionReport, type Learner } from './report.tsx';
import { Catalog, themeOf, ICONS } from './catalog.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface CourseRow { id: string; status: string; title: string; description: string; lessonCount: number; myStatus: string | null; myProgress: number | null; myDueAt: string | null; canEdit: boolean }
interface LessonRow { id: string; type: string; title: string; required: boolean; done: boolean; locked?: boolean; words?: number | null; questions?: number }
const lessonMin = (l: LessonRow) => (l.type === 'video' ? 3 : l.type === 'quiz' ? Math.max(1, Math.round((l.questions ?? 0) * 0.5)) : Math.max(1, Math.round((l.words ?? 0) / 150)));
interface CourseDetail { id: string; starterKey?: string | null; enrollmentMode?: 'open' | 'approval'; myRequest?: { status: string; decisionNote: string | null } | null; version?: number; sequential?: boolean; resumeLessonId?: string | null; status: string; title: string; description: string; cePack: string | null; ceHours: number | null; ceCategory: string | null; canEdit: boolean; enrollment: { status: string; progressPct: number; dueAt: string | null } | null; certificate: { verificationCode: string; issuedAt: string; url?: string } | null; lessons: LessonRow[]; locales?: { locale: string; title: string; description: string | null }[] }
type View = { k: 'list' } | { k: 'course'; id: string } | { k: 'lesson'; courseId: string; id: string };

const move = <T,>(a: T[], i: number, d: number): T[] => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return b; [b[i], b[j]] = [b[j]!, b[i]!]; return b; };
const Bar = ({ pct }: { pct: number }) => <div class="pbar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>;

export function TrainingView({ call, t, locale, canAuthor, isHeadOffice = false, isAdmin = false }: { call: Call; t: Strings; locale: Locale; canAuthor: boolean; isHeadOffice?: boolean; isAdmin?: boolean }) {
  const k = ceStrings(locale);
  const tabs = isHeadOffice ? (canAuthor || isAdmin ? (['officer', 'courses', 'learning', 'my', 'team'] as const) : (['officer', 'learning', 'my'] as const)) : (canAuthor || isAdmin ? (['courses', 'learning', 'my', 'team'] as const) : (['courses', 'learning', 'my'] as const));
  const [tab, setTab] = useState<string>(tabs[0]);
  const [view, setView] = useState<View>({ k: 'list' });
  const label: Record<string, string> = { learning: locale === 'fr-CA' ? 'Mon apprentissage' : 'My learning', courses: k.courses, my: k.my, team: k.team, officer: k.officer };
  return (
    <div class="train">
      {(view.k === 'list' || tab !== 'courses') && <div class="tpad" style={{ paddingBottom: 0 }}><div class="seg" role="tablist">{tabs.map((x) => <button role="tab" aria-selected={tab === x} onClick={() => { setTab(x); setView({ k: 'list' }); }}>{label[x]}</button>)}</div></div>}
      {tab === 'learning' && <MyLearning call={call} locale={locale} canAuthor={canAuthor} onOpen={(id) => { setTab('courses'); setView({ k: 'course', id }); }} />}
      {tab === 'my' && <MyCe call={call} locale={locale} />}
      {tab === 'team' && <PeopleCe call={call} locale={locale} officer={false} />}
      {tab === 'officer' && <PeopleCe call={call} locale={locale} officer={true} />}
      {tab === 'courses' && view.k === 'list' && <CourseList call={call} t={t} locale={locale} canAuthor={canAuthor} onOpen={(id) => setView({ k: 'course', id })} />}
      {tab === 'courses' && view.k === 'course' && <CoursePage key={view.id} id={view.id} call={call} t={t} locale={locale} onBack={() => setView({ k: 'list' })} onLesson={(id) => setView({ k: 'lesson', courseId: (view as { id: string }).id, id })} />}
      {tab === 'courses' && view.k === 'lesson' && <LessonPage key={view.id} id={view.id} call={call} t={t} locale={locale} onBack={() => setView({ k: 'course', id: view.courseId })} onLesson={(id) => setView({ k: 'lesson', courseId: (view as { courseId: string }).courseId, id })} />}
    </div>
  );
}

function CourseList({ call, t, locale, canAuthor, onOpen }: { call: Call; t: Strings; locale: Locale; canAuthor: boolean; onOpen: (id: string) => void }) {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [starters, setStarters] = useState<{ key: string; title: Record<string, string>; description: Record<string, string>; courseId: string | null }[]>([]);
  const [showStarters, setShowStarters] = useState(false);
  const addStarter = async (key: string) => { try { const r = await call('POST', '/v1/courses/starter', { key }); onOpen(r.id); } catch (x) { setErr((x as Error).message); } };
  const dedupe = async () => {
    const fr = locale === 'fr-CA'; setErr('');
    try {
      const p = await call('POST', '/v1/courses/duplicates', { apply: false });
      if (p.toArchive === 0 && p.blocked === 0) { alert(fr ? 'Aucun doublon trouvé.' : 'No duplicate courses found.'); return; }
      const msg = fr ? `${p.toArchive} copie(s) en double seront archivées (la version la plus utilisée est conservée).${p.blocked ? ` ${p.blocked} copie(s) avec des apprenants inscrits seront laissées telles quelles.` : ''} Continuer ?`
        : `${p.toArchive} duplicate cop${p.toArchive === 1 ? 'y' : 'ies'} will be archived (the most-used version is kept).${p.blocked ? ` ${p.blocked} cop${p.blocked === 1 ? 'y' : 'ies'} with learners enrolled will be left alone.` : ''} Continue?`;
      if (p.toArchive > 0 && confirm(msg)) { await call('POST', '/v1/courses/duplicates', { apply: true }); load(); }
      else if (p.toArchive === 0) alert(msg.replace(/ Continue\?| Continuer \?/, ''));
    } catch (x) { setErr((x as Error).message); }
  };
  const openStarters = () => { setShowStarters(true); call('GET', '/v1/courses/starter').then((r) => setStarters(r.courses), (e) => setErr((e as Error).message)); };
  const load = useCallback(() => { call('GET', `/v1/courses?locale=${locale}`).then((r) => setCourses(r.courses), (e) => setErr((e as Error).message)); }, [call, locale]);
  useEffect(load, [load]);
  const create = async (e: Event) => {
    e.preventDefault();
    try { const r = await call('POST', '/v1/courses', { title: title.trim(), locale }); onOpen(r.id); } catch (x) { setErr((x as Error).message); }
  };
  if (!courses) return <div class="msg">{err || t.loading}</div>;
  return (
    <div class="tpad xl">
      <div class="bar" style={{ padding: 0, border: 0 }}>
        <h1>{t.training}</h1><span class="spacer" />
        {canAuthor && <button class="btn quiet" onClick={openStarters}>{t.starterCourse}</button>}
        {canAuthor && <button class="btn quiet" onClick={() => void dedupe()}>{locale === 'fr-CA' ? 'Retirer les doublons' : 'Remove duplicates'}</button>}
        {canAuthor && <button class="btn" onClick={() => setAdding(true)}>+ {t.newCourse}</button>}
      </div>
      {err && <div class="err">{err}</div>}
      {adding && (
        <form class="erow" onSubmit={create}>
          <input autofocus placeholder={t.courseTitle} aria-label={t.courseTitle} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <button class="btn" disabled={!title.trim()}>{t.create}</button><button type="button" class="btn quiet" onClick={() => setAdding(false)}>{t.cancel}</button>
        </form>
      )}
      {showStarters && (
        <div class="tpad"><small class="muted">{t.starterHint}</small>
          {starters.map((s) => { const k = locale === 'fr-CA' ? 'fr' : 'en'; return <div class="erow" key={s.key}><span><b>{s.title[k]}</b><br /><span class="muted">{s.description[k]}</span></span>{s.courseId ? <button class="btn quiet" onClick={() => onOpen(s.courseId!)}>{t.starterAdded}</button> : <button class="btn" onClick={() => addStarter(s.key)}>{t.addStarter}</button>}</div>; })}
          <button class="btn quiet" onClick={() => setShowStarters(false)}>{t.cancel}</button>
        </div>
      )}
      {courses.length === 0 && <div class="msg">{t.noCourses}</div>}
      {courses.length > 0 && <Catalog courses={courses as any} locale={locale} onOpen={onOpen} />}
    </div>
  );
}

function CoursePage({ id, call, t, locale, onBack, onLesson }: { id: string; call: Call; t: Strings; locale: Locale; onBack: () => void; onLesson: (id: string) => void }) {
  const [c, setC] = useState<CourseDetail | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [nodes, setNodes] = useState<{ id: string; name: string; type: string }[]>([]);
  const [team, setTeam] = useState<Learner[] | null>(null);
  const [lt, setLt] = useState('');
  const [lType, setLType] = useState('richtext');
  const [assignNode, setAssignNode] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const [assignRole, setAssignRole] = useState(''); const [assignDays, setAssignDays] = useState(''); const [pv, setPv] = useState('');
  const [reqs, setReqs] = useState<{ id: string; name: string; note: string | null }[]>([]);
  const loadReqs = useCallback(() => { call('GET', `/v1/course-requests?courseId=${id}`).then((r) => setReqs(r.requests), () => undefined); }, [call, id]);
  const load = useCallback(() => { call('GET', `/v1/courses/${id}?locale=${locale}`).then(setC, (e) => setErr((e as Error).message)); }, [call, id, locale]);
  useEffect(load, [load]);
  useEffect(() => { if (c?.canEdit) loadReqs(); }, [c?.canEdit, loadReqs]);
  useEffect(() => { if (c?.canEdit) call('GET', '/v1/org/nodes').then((r) => { setNodes(r.nodes); }, () => undefined); }, [call, c?.canEdit]);
  const act = async (fn: () => Promise<unknown>, ok = t.saved) => { setErr(''); setNote(''); try { await fn(); setNote(ok); load(); } catch (e) { setErr((e as Error).message); } };
  if (!c) return <div class="msg">{err || t.loading}</div>;
  const en = c.locales?.find((l) => l.locale === 'en');
  return (
    <div class="cp">
      {(() => {
        const th = themeOf({ title: c.title, starterKey: c.starterKey } as any);
        const mins = c.lessons.reduce((n, l) => n + lessonMin(l), 0);
        const doneN = c.lessons.filter((l) => l.done).length;
        const fr = locale === 'fr-CA';
        const inP = c.enrollment && c.enrollment.status !== 'completed';
        return <>
          <div class="cp-hero">
            <button class="link cp-back" onClick={onBack}>← {t.training}</button>
            <h1>{c.title}</h1>
            <p class="cp-lead">{c.description}</p>
            <div class="cp-meta">
              {c.status === 'draft' && <span class="cc-tag dr">{fr ? 'BROUILLON' : 'DRAFT'}</span>}
              {(c.version ?? 0) > 0 && <span class="cc-tag dr">v{c.version}</span>}
              {c.enrollment?.dueAt && c.enrollment.status !== 'completed' && <span class="cc-tag req">{fr ? 'OBLIGATOIRE' : 'REQUIRED'}</span>}
              {c.enrollment?.dueAt && c.enrollment.status !== 'completed' && <span>{t.due} {new Date(c.enrollment.dueAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>}
              <span>⏱ {mins} min</span><span>{t.lessons(c.lessons.length)}</span><span>EN · FR</span>
              {c.ceHours ? <span>{fr ? 'FC' : 'CE'} {c.ceHours} h</span> : null}
            </div>
          </div>
          <div class="cp-grid">
            <aside class="cp-side">
              <div class="cp-cover" style={{ background: `linear-gradient(135deg,${th.a},${th.b})` }}><svg viewBox="0 0 100 100" aria-hidden="true">{ICONS[th.icon]}</svg>{c.resumeLessonId && <button class="cp-play" aria-label={fr ? 'Commencer' : 'Start'} onClick={() => onLesson(c.resumeLessonId!)}>▶</button>}</div>
              <div class="cp-sb">
                {c.enrollment && <div class="cp-prog"><b>{c.enrollment.status === 'completed' ? `✓ ${t.completed}` : `${Math.round(c.enrollment.progressPct)}% ${fr ? 'terminé' : 'complete'}`}</b>{c.enrollment.status !== 'completed' && <span> · {fr ? 'leçon' : 'lesson'} {Math.min(doneN + 1, c.lessons.length)} / {c.lessons.length}</span>}<Bar pct={c.enrollment.progressPct} /></div>}
                {c.resumeLessonId && <button class="cp-cta" onClick={() => onLesson(c.resumeLessonId!)}>{inP && c.enrollment!.progressPct > 0 ? (fr ? 'Continuer le cours' : 'Continue course') : (fr ? 'Commencer le cours' : 'Start course')}</button>}
                {c.certificate && <div class="cp-cert">🎓 {t.certificate}: <b>{c.certificate.verificationCode}</b><br />{new Date(c.certificate.issuedAt).toLocaleDateString(locale)}{c.certificate.url && <> · <a href={c.certificate.url} target="_blank" rel="noopener noreferrer">{ceStrings(locale).certOpen}</a> · <a href={`${c.certificate.url}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a></>}</div>}
                <ul class="cp-facts">
                  <li>▣ {t.lessons(c.lessons.filter((l) => l.type !== 'quiz').length)}{c.lessons.some((l) => l.type === 'quiz') ? (fr ? ' et un quiz' : ' and a quiz') : ''}</li>
                  {c.lessons.some((l) => l.type === 'quiz') && <li>✓ {fr ? 'Note de passage et reprises selon le quiz' : 'Pass mark and retries set by the quiz'}</li>}
                  <li>◷ {fr ? 'À votre rythme' : 'Self-paced'}</li><li>🎓 {fr ? 'Certificat de réussite' : 'Certificate of completion'}</li>
                </ul>
              </div>
            </aside>
            <div class="cp-main">
      {c.canEdit && c.status === 'published' && <p class="muted">{locale === 'fr-CA' ? 'Cette formation est publiée, donc ses leçons sont verrouillées. Annulez la publication, modifiez, puis publiez de nouveau pour créer une nouvelle version.' : 'This course is published, so its lessons are locked. Unpublish it, make your changes, then publish again to release a new version.'}</p>}
      {err && <div class="err">{err}</div>}{note && <div class="ok">{note}</div>}

      {!c.canEdit && !c.enrollment && c.enrollmentMode === 'approval' && c.status === 'published' && (() => {
        const fr = locale === 'fr-CA', r = c.myRequest;
        if (r?.status === 'pending') return <p class="muted" role="status">{fr ? 'Votre demande est en attente d’approbation.' : 'Your request is waiting for approval.'}</p>;
        return <div class="actions">
          {r?.status === 'declined' && <p class="overdue">{fr ? 'Votre demande a été refusée' : 'Your request was declined'}{r.decisionNote ? ` : ${r.decisionNote}` : ''}</p>}
          <button class="btn" onClick={() => { const n = prompt(fr ? 'Un mot pour votre gestionnaire (facultatif)' : 'A note for your manager (optional)') ?? ''; void act(() => call('POST', `/v1/courses/${id}/request`, n.trim() ? { note: n.trim() } : {}), fr ? 'Demande envoyée.' : 'Request sent.'); }}>{fr ? 'Demander à suivre cette formation' : 'Ask to join this course'}</button>
        </div>;
      })()}
      <h2 class="cp-h">{t.lessonsTitle}</h2>
      <div class="cp-acc">
      {c.lessons.length === 0 && <p class="muted">{t.noLessons}</p>}
      {c.lessons.map((l, i) => (
        <div class="lrow" key={l.id}>
          <button class={`lbtn${l.id === c.resumeLessonId ? ' cur' : ''}`} disabled={l.locked} aria-disabled={l.locked} title={l.locked ? (locale === 'fr-CA' ? 'Terminez d’abord les leçons précédentes' : 'Finish the earlier lessons first') : undefined} onClick={() => onLesson(l.id)}><span class={`dot${l.done ? ' on' : ''}`}>{l.locked ? '🔒' : l.done ? '✓' : i + 1}</span><span class="lt">{l.title}</span>{!l.required && <span class="tag">{t.optional}</span>}<span class="lm">{l.type === 'quiz' ? `❓ ${t.lessonTypes.quiz}` : l.type === 'video' ? `▶ ${lessonMin(l)} min` : `▤ ${lessonMin(l)} min`}</span></button>
          {c.canEdit && c.status !== 'published' && <>
            <button class="ib" aria-label={t.moveUp} disabled={i === 0} onClick={() => void act(() => call('PUT', `/v1/courses/${id}/lessons/order`, { lessonIds: move(c.lessons, i, -1).map((x) => x.id) }))}>↑</button>
            <button class="ib" aria-label={t.moveDown} disabled={i === c.lessons.length - 1} onClick={() => void act(() => call('PUT', `/v1/courses/${id}/lessons/order`, { lessonIds: move(c.lessons, i, 1).map((x) => x.id) }))}>↓</button>
            <button class="ib danger" aria-label={t.remove} onClick={() => { if (confirm(t.confirmLesson(l.title))) void act(() => call('DELETE', `/v1/lessons/${l.id}`)); }}>✕</button>
          </>}
        </div>
      ))}
      </div>

      {c.canEdit && (
        <>
          {c.status !== 'published' && <form class="erow" onSubmit={(e) => { e.preventDefault(); const title = lt.trim(); if (!title) return; setLt(''); void act(() => call('POST', `/v1/courses/${id}/lessons`, { title, type: lType, locale })); }}>
            <input placeholder={t.addLesson} aria-label={t.addLesson} value={lt} onInput={(e) => setLt((e.target as HTMLInputElement).value)} />
            <select aria-label={t.type} value={lType} onChange={(e) => setLType((e.target as HTMLSelectElement).value)}>{Object.entries(t.lessonTypes).map(([k, v]) => <option value={k}>{v}</option>)}</select>
            <button class="btn quiet" disabled={!lt.trim()}>+</button>
          </form>}

          <h3>{t.courseSettings}</h3>
          <label for="ct">{t.courseTitle} ({locale})</label>
          <input id="ct" class="wide" defaultValue={c.title} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== c.title) void act(() => call('PATCH', `/v1/courses/${id}`, { title: v, locale })); }} />
          <label for="cd">{t.description} ({locale})</label>
          <textarea id="cd" class="wide" rows={2} defaultValue={c.description} onBlur={(e) => { const v = (e.target as HTMLTextAreaElement).value; if (v !== c.description) void act(() => call('PATCH', `/v1/courses/${id}`, { description: v, locale })); }} />
          <label class="opt"><input type="checkbox" checked={c.enrollmentMode === 'approval'} onChange={(e) => void act(() => call('PATCH', `/v1/courses/${id}`, { enrollmentMode: (e.target as HTMLInputElement).checked ? 'approval' : 'open' }))} /> {locale === 'fr-CA' ? 'Les personnes doivent demander l’accès (approbation requise)' : 'People must ask to join (needs approval)'}</label>
          {reqs.length > 0 && <div><h3>{locale === 'fr-CA' ? 'Demandes en attente' : 'Waiting for your answer'}</h3>{reqs.map((q) => <div class="lrow" key={q.id}><span style={{ flex: 1 }}>{q.name}{q.note ? ` — ${q.note}` : ''}</span>
            <button class="btn quiet" onClick={() => void act(async () => { await call('POST', `/v1/course-requests/${q.id}/decision`, { decision: 'approve' }); loadReqs(); })}>{locale === 'fr-CA' ? 'Approuver' : 'Approve'}</button>
            <button class="btn quiet" onClick={() => { const n = prompt(locale === 'fr-CA' ? 'Raison (facultatif)' : 'Reason (optional)') ?? ''; void act(async () => { await call('POST', `/v1/course-requests/${q.id}/decision`, { decision: 'decline', ...(n.trim() ? { note: n.trim() } : {}) }); loadReqs(); }); }}>{locale === 'fr-CA' ? 'Refuser' : 'Decline'}</button></div>)}</div>}
          {c.status !== 'published' && <label class="opt"><input type="checkbox" checked={!!c.sequential} onChange={(e) => void act(() => call('PATCH', `/v1/courses/${id}`, { sequential: (e.target as HTMLInputElement).checked }))} /> {locale === 'fr-CA' ? 'Étape par étape : les leçons obligatoires se suivent dans l’ordre' : 'Step by step: required lessons must be done in order'}</label>}
          <div class="actions">
            {c.status !== 'published'
              ? <button class="btn" onClick={() => void act(() => call('PATCH', `/v1/courses/${id}`, { status: 'published' }), t.published)}>{t.publish}</button>
              : <button class="btn quiet" onClick={() => void act(() => call('PATCH', `/v1/courses/${id}`, { status: 'draft' }))}>{t.unpublish}</button>}
            {c.status !== 'published' && <button class="btn quiet danger" onClick={() => { if (confirm(locale === 'fr-CA' ? 'Archiver ce cours ? Il disparaîtra de la liste. Les attestations déjà émises restent valides.' : 'Archive this course? It will disappear from the list. Certificates already issued stay valid.')) void call('PATCH', `/v1/courses/${id}`, { status: 'archived' }).then(onBack, (e) => setErr((e as Error).message)); }}>{locale === 'fr-CA' ? 'Archiver le cours' : 'Archive course'}</button>}
          </div>

          <CourseCe call={call} locale={locale} courseId={id} value={c} onSaved={load} />
          {c.status === 'published' && (
            <>
              <h3>{t.assign}</h3>
              {(() => {
                const L = locale === 'fr-CA';
                const roles: [string, string][] = [['', L ? 'Tout le monde' : 'Everyone'], ['learner', L ? 'Apprenants' : 'Learners'], ['member', L ? 'Membres' : 'Members'], ['trainer', L ? 'Formateurs' : 'Trainers'], ['manager', L ? 'Gestionnaires' : 'Managers'], ['admin', L ? 'Administrateurs' : 'Administrators']];
                const rule = () => ({ nodeId: assignNode, ...(assignRole ? { role: assignRole } : {}), ...(assignDue ? { dueAt: new Date(`${assignDue}T23:59:00`).toISOString() } : assignDays ? { dueInDays: Number(assignDays) } : {}) });
                const names = (r: { sample: { name: string }[]; willEnrol: number }) => (r.sample.length ? `${L ? ' : ' : ': '}${r.sample.map((x) => x.name).join(', ')}${r.willEnrol > r.sample.length ? '…' : ''}` : '');
                return <>
                  <form class="erow" onSubmit={(e) => { e.preventDefault(); if (!assignNode) return; void act(async () => { const r = await call('POST', `/v1/courses/${id}/assignments`, rule()); setPv(''); setNote(t.assigned(r.enrolled)); }, ''); }}>
                    <select aria-label={t.assignTo} value={assignNode} onChange={(e) => { setAssignNode((e.target as HTMLSelectElement).value); setPv(''); }}>
                      <option value="">{t.assignTo}…</option>{nodes.map((n) => <option value={n.id}>{n.name}</option>)}
                    </select>
                    <select aria-label={L ? 'Qui' : 'Who'} value={assignRole} onChange={(e) => { setAssignRole((e.target as HTMLSelectElement).value); setPv(''); }}>{roles.map(([v, l]) => <option value={v}>{l}</option>)}</select>
                    <input type="date" aria-label={t.dueDate} value={assignDue} onInput={(e) => { setAssignDue((e.target as HTMLInputElement).value); if ((e.target as HTMLInputElement).value) setAssignDays(''); }} style={{ flex: '0 0 150px' }} />
                    <input type="number" min={1} max={730} placeholder={L ? 'ou jours après l’inscription' : 'or days after joining'} aria-label={L ? 'Jours après l’inscription' : 'Days after joining'} value={assignDays} disabled={!!assignDue} onInput={(e) => setAssignDays((e.target as HTMLInputElement).value)} style={{ flex: '0 0 190px' }} />
                    <button class="btn quiet" type="button" disabled={!assignNode} onClick={() => void call('POST', `/v1/courses/${id}/assignments/preview`, rule()).then((r) => setPv(L ? `${r.willEnrol} seraient inscrits (${r.alreadyEnrolled} déjà inscrits)${names(r)}` : `${r.willEnrol} would be enrolled (${r.alreadyEnrolled} already enrolled)${names(r)}`), (e) => setErr((e as Error).message))}>{L ? 'Aperçu' : 'Preview'}</button>
                    <button class="btn quiet" disabled={!assignNode}>{t.assign}</button>
                  </form>
                  {pv && <p class="muted" role="status">{pv}</p>}
                </>;
              })()}
              <h3>{t.teamProgress}</h3>
              {!team && <button class="btn quiet" onClick={() => void call('GET', `/v1/courses/${id}/progress`).then((r) => setTeam(r.learners), (e) => setErr((e as Error).message))}>{t.showProgress}</button>}
              {team && <CompletionReport learners={team} courseTitle={c.title} locale={locale} />}
            </>
          )}
          {en && <small class="muted">{t.langHint}</small>}
        </>
      )}
            </div>
          </div>
        </>;
      })()}
    </div>
  );
}

interface QuizQ { id: string; type: string; prompt: string; options: { key: string; text: string }[]; correct?: string[] }
interface LessonDetail { id: string; courseId: string; type: string; title: string; body: { text?: string; url?: string }; required: boolean; done: boolean; canEdit: boolean; quiz?: { bankSize?: number; draw?: number | null; baseDraw?: number | null; passMark: number | null; maxAttempts: number | null; baseMaxAttempts?: number | null; cooldownMinutes?: number | null; status?: { allowed: boolean; reason: string | null; left: number | null; nextAt: string | null }; attempts: { scorePct: number; passed: boolean }[]; questions: QuizQ[] } }

function LessonPage({ id, call, t, locale, onBack, onLesson }: { id: string; call: Call; t: Strings; locale: Locale; onBack: () => void; onLesson: (id: string) => void }) {
  const [l, setL] = useState<LessonDetail | null>(null);
  const [outline, setOutline] = useState<CourseDetail | null>(null);
  const [err, setErr] = useState('');
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<{ scorePct: number; passed: boolean; results: { questionId: string; correct: boolean }[] } | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [rules, setRules] = useState<{ pass: string; max: string; wait: string; draw: string } | null>(null);
  const [learners, setLearners] = useState<{ userId: string; displayName: string | null; email: string }[] | null>(null);
  const [grantTo, setGrantTo] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(() => { call('GET', `/v1/lessons/${id}?locale=${locale}`).then((r) => { setL(r); setText(r.body?.text ?? ''); setUrl(r.body?.url ?? ''); }, (e) => setErr((e as Error).message)); }, [call, id, locale]);
  useEffect(load, [load]);
  const cid = l?.courseId;
  useEffect(() => { if (cid) call('GET', `/v1/courses/${cid}?locale=${locale}`).then(setOutline, () => {}); }, [call, cid, locale, l?.done]);
  if (!l) return <div class="msg">{err || t.loading}</div>;
  const complete = async () => { try { await call('POST', `/v1/lessons/${id}/complete`); load(); } catch (e) { setErr((e as Error).message); } };
  const submit = async () => { setErr(''); try { const r = await call('POST', `/v1/lessons/${id}/quiz/attempt`, { answers }); setResult(r); load(); } catch (e) { setErr((e as Error).message); } };
  const pick = (q: QuizQ, key: string) => setAnswers((a) => {
    const cur = a[q.id] ?? [];
    return { ...a, [q.id]: q.type === 'multi' ? (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]) : [key] };
  });
  const isVideoFile = /\.(mp4|webm)(\?|$)/i.test(l.body.url ?? '');
  const fr = locale === 'fr-CA';
  const ls = outline?.lessons ?? [];
  const idx = ls.findIndex((x) => x.id === id);
  const prev = idx > 0 ? ls[idx - 1] : undefined;
  const next = idx >= 0 ? ls[idx + 1] : undefined;
  const th = themeOf({ title: outline?.title ?? '', starterKey: outline?.starterKey } as any);
  const goNext = async () => { if (l.type !== 'quiz' && !l.done) await complete(); if (next && !next.locked) onLesson(next.id); };
  const nav = outline && (
    <div class="lp-nav">
      <button class="btn quiet" disabled={!prev || prev.locked} onClick={() => prev && onLesson(prev.id)}>← {fr ? 'Précédent' : 'Previous'}</button>
      <span class="lp-mid">
        {l.type !== 'quiz' && !l.done && <button class="btn quiet" onClick={complete}>✓ {t.markDone}</button>}
        {l.done && <span class="ok">✓ {fr ? 'Terminé' : 'Done'}</span>}
      </span>
      <button class="btn" disabled={(!next || next.locked) && (l.type === 'quiz' || l.done)} onClick={() => void goNext()}>{next ? (l.type !== 'quiz' && !l.done ? (fr ? 'Terminer et continuer' : 'Complete and continue') : (fr ? 'Leçon suivante' : 'Next lesson')) : (fr ? 'Terminer' : 'Finish')} →</button>
    </div>
  );
  return (
    <div class="tpad xl lp">
      <div class="lp-main">
      <button class="link" onClick={onBack}>← {t.backToCourse}</button>
      <div class="lp-hero" style={{ background: `linear-gradient(120deg,${th.a},${th.b})` }}>
        <svg class="lp-ico" viewBox="0 0 100 100" aria-hidden="true">{ICONS[th.icon]}</svg>
        <small class="lp-kick">{idx >= 0 ? (fr ? `Leçon ${idx + 1} sur ${ls.length}` : `Lesson ${idx + 1} of ${ls.length}`) : (fr ? 'Leçon' : 'Lesson')}</small>
        <h1>{l.title}{l.done && <span class="lp-ok">✓ {fr ? 'Terminé' : 'Done'}</span>}</h1>
        <div class="lp-chips"><span>{l.type === 'video' ? (fr ? '▶ Vidéo' : '▶ Video') : l.type === 'quiz' ? (fr ? '❓ Test' : '❓ Quiz') : (fr ? '📖 Lecture' : '📖 Reading')}</span>{idx >= 0 && <span>⏱ {lessonMin(ls[idx]!)} min</span>}{l.type === 'video' && /pii-guide-\d-en\.mp4/.test(l.body.url ?? '') && <span>🔊 {fr ? 'Narration' : 'Narrated'}</span>}{l.type === 'video' && /pii-guide-\d-fr\.mp4/.test(l.body.url ?? '') && <span>💬 {fr ? 'Sous-titres' : 'Captions'}</span>}{l.required && <span>{fr ? 'Obligatoire' : 'Required'}</span>}</div>
      </div>
      {err && <div class="err">{err}</div>}
      {l.type === 'richtext' && <div class="prose lp-card">{(l.body.text ?? '').split(/\n{2,}/).map((p) => <p>{p}</p>)}</div>}
      {l.type === 'video' && l.body.text && <details class="prose"><summary>{t.transcript}</summary>{l.body.text.split(/\n{2,}/).map((p) => <p>{p}</p>)}</details>}
      {l.type === 'link' && l.body.url && <p><a href={l.body.url} target="_blank" rel="noopener noreferrer">{l.body.url}</a></p>}
      {l.type === 'video' && l.body.url && (isVideoFile ? <video controls src={l.body.url} style={{ width: '100%', borderRadius: '8px' }} /> : <p><a href={l.body.url} target="_blank" rel="noopener noreferrer">▶ {t.watchVideo}</a></p>)}

      {l.type === 'quiz' && l.quiz && (
        <>
          <p class="muted">{t.passMark(l.quiz.passMark ?? 0)}{l.quiz.maxAttempts ? ` · ${t.attemptsMax(l.quiz.maxAttempts)}` : ''}</p>
          {l.quiz.attempts.length > 0 && <p class="muted">{t.lastScore}: {l.quiz.attempts[0]!.scorePct}%</p>}
          {l.quiz.status && !l.canEdit && (() => {
            const st = l.quiz!.status!, fr = locale === 'fr-CA';
            const msg = st.reason === 'passed' ? (fr ? 'Vous avez réussi ce test.' : 'You have passed this quiz.')
              : st.reason === 'no_attempts_left' ? (fr ? 'Il ne reste aucune tentative.' : 'No attempts left.')
              : st.reason === 'cooldown' ? (fr ? `Vous pourrez réessayer le ${new Date(st.nextAt!).toLocaleString(locale)}.` : `You can try again at ${new Date(st.nextAt!).toLocaleString(locale)}.`)
              : st.left !== null ? (fr ? `Tentatives restantes : ${st.left}` : `Attempts left: ${st.left}`) : '';
            return msg ? <p class={st.allowed ? 'muted' : 'overdue'} role="status">{msg}</p> : null;
          })()}
          {l.quiz.draw && !l.canEdit && <p class="muted">{fr ? `Chaque essai pose ${l.quiz.draw} questions tirées d’une banque de ${l.quiz.bankSize}.` : `Each attempt asks ${l.quiz.draw} questions drawn from a bank of ${l.quiz.bankSize}.`}</p>}
          {l.canEdit && l.quiz.baseDraw && <p class="muted">{fr ? `Aperçu éditeur : toute la banque (${l.quiz.bankSize}) s’affiche ; chaque apprenant reçoit ${l.quiz.baseDraw} questions au hasard.` : `Editor preview: the whole bank (${l.quiz.bankSize}) is shown; each learner gets ${l.quiz.baseDraw} random questions.`}</p>}
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
          {l.quiz.questions.length > 0 && <div class="actions"><button class="btn" onClick={submit} disabled={Object.keys(answers).length === 0 || (!l.canEdit && l.quiz.status?.allowed === false)}>{t.submitQuiz}</button></div>}
          {result && (() => {
            const total = result.results.length, right = result.results.filter((r) => r.correct).length, pass = l.quiz!.passMark ?? 0;
            const C = 2 * Math.PI * 42, off = C * (1 - Math.min(100, result.scorePct) / 100);
            const left = l.quiz!.status?.left;
            return (
              <div class={`qr ${result.passed ? 'pass' : 'fail'}`} role="status">
                <svg viewBox="0 0 100 100" class="qr-ring" aria-hidden="true"><circle cx="50" cy="50" r="42" class="bg" /><circle cx="50" cy="50" r="42" class="fg" stroke-dasharray={C} stroke-dashoffset={off} transform="rotate(-90 50 50)" /><text x="50" y="57" text-anchor="middle">{Math.round(result.scorePct)}%</text></svg>
                <div class="qr-t">
                  <b>{result.passed ? (fr ? 'Réussi !' : 'You passed!') : (fr ? 'Pas encore réussi' : 'Not passed yet')}</b>
                  <span>{fr ? `${right} bonnes réponses sur ${total} · note de passage ${pass} %` : `${right} of ${total} correct · pass mark ${pass}%`}</span>
                  {!result.passed && <span>{fr ? 'Relisez les leçons, puis réessayez.' : 'Review the lessons, then try again.'}{left != null && left >= 0 ? (fr ? ` Tentatives restantes : ${left}.` : ` Attempts left: ${left}.`) : ''}</span>}
                  <div class="qr-a">
                    {!result.passed && <button class="btn quiet" onClick={() => { setResult(null); setAnswers({}); }}>{fr ? 'Réessayer' : 'Try again'}</button>}
                    {result.passed && next && !next.locked && <button class="btn" onClick={() => onLesson(next.id)}>{fr ? 'Leçon suivante' : 'Next lesson'} →</button>}
                    {result.passed && !next && <button class="btn" onClick={onBack}>{fr ? 'Retour au cours' : 'Back to the course'}</button>}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {l.canEdit && l.type === 'quiz' && l.quiz && (() => {
        const fr = locale === 'fr-CA';
        const r = rules ?? { pass: String(l.quiz!.passMark ?? 70), max: String(l.quiz!.baseMaxAttempts ?? ''), wait: String(l.quiz!.cooldownMinutes ?? ''), draw: String(l.quiz!.baseDraw ?? '') };
        const set = (k: 'pass' | 'max' | 'wait' | 'draw') => (e: Event) => setRules({ ...r, [k]: (e.target as HTMLInputElement).value });
        const save = async () => {
          setErr(''); setNote('');
          try {
            await call('PATCH', `/v1/lessons/${id}`, { passMark: Number(r.pass), maxAttempts: r.max.trim() ? Number(r.max) : null, cooldownMinutes: r.wait.trim() ? Number(r.wait) : null, quizDraw: r.draw.trim() ? Number(r.draw) : null });
            setRules(null); setNote(fr ? 'Enregistré.' : 'Saved.'); load();
          } catch (e) { setErr((e as Error).message); }
        };
        const openGrant = () => call('GET', `/v1/courses/${l.courseId}/progress`).then((x) => setLearners(x.learners), (e) => setErr((e as Error).message));
        const grant = async () => { try { await call('POST', `/v1/lessons/${id}/quiz/extra-attempts`, { userId: grantTo, extra: 1 }); setNote(fr ? 'Une tentative de plus accordée.' : 'One more attempt given.'); } catch (e) { setErr((e as Error).message); } };
        return (
          <fieldset class="q">
            <legend>{fr ? 'Règles du test' : 'Quiz rules'}</legend>
            <div class="erow">
              <label>{fr ? 'Note de passage (%)' : 'Pass mark (%)'} <input type="number" min={0} max={100} value={r.pass} onInput={set('pass')} style={{ width: '5em' }} /></label>
              <label>{fr ? 'Tentatives max.' : 'Max attempts'} <input type="number" min={1} max={50} placeholder={fr ? 'illimité' : 'unlimited'} value={r.max} onInput={set('max')} style={{ width: '6em' }} /></label>
              <label>{fr ? 'Attente entre les essais (min)' : 'Wait between tries (min)'} <input type="number" min={1} max={10080} placeholder={fr ? 'aucune' : 'none'} value={r.wait} onInput={set('wait')} style={{ width: '6em' }} /></label>
              <label>{fr ? 'Questions par essai (banque)' : 'Questions per attempt (bank)'} <input type="number" min={1} max={100} placeholder={fr ? 'toutes' : 'all'} value={r.draw} onInput={set('draw')} style={{ width: '6em' }} /></label>
              <button class="btn quiet" onClick={() => void save()}>{t.saveBtn}</button>
            </div>
            {l.quiz!.baseMaxAttempts ? (
              <div class="erow">
                {!learners && <button class="btn quiet" onClick={() => void openGrant()}>{fr ? 'Accorder une tentative de plus…' : 'Give a learner another attempt…'}</button>}
                {learners && <><select aria-label={fr ? 'Apprenant' : 'Learner'} value={grantTo} onChange={(e) => setGrantTo((e.target as HTMLSelectElement).value)}><option value="">{fr ? 'Choisir…' : 'Choose…'}</option>{learners.map((m) => <option value={m.userId}>{m.displayName ?? m.email}</option>)}</select>
                  <button class="btn" disabled={!grantTo} onClick={() => void grant()}>{fr ? 'Accorder' : 'Give'}</button></>}
              </div>
            ) : null}
            {note && <small class="ok" role="status">{note}</small>}
          </fieldset>
        );
      })()}

      {l.canEdit && l.type !== 'quiz' && (
        <>
          <div class="actions"><button class="btn quiet" onClick={() => setEditing((v) => !v)}>{t.edit}</button></div>
          {editing && (
            <div>
              {l.type === 'richtext' && <><label for="lt">{t.lessonText}</label><textarea id="lt" class="wide" rows={8} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
                <div class="actions"><button class="btn quiet" disabled={aiBusy} onClick={async () => { const topic = prompt(ceStrings(locale).aiTopic, l.title); if (!topic) return; setAiBusy(true); setErr(''); try { const r = await call('POST', '/v1/lessons/draft', { topic, locale, ...(text.trim() ? { notes: text.slice(0, 5000) } : {}) }); setText(r.text); } catch (e) { setErr((e as Error).message); } setAiBusy(false); }}>{aiBusy ? ceStrings(locale).aiBusy : `✨ ${ceStrings(locale).aiLesson}`}</button><small class="muted">{ceStrings(locale).aiNote}</small></div></>}
              {(l.type === 'link' || l.type === 'video') && <><label for="lu">https://</label><input id="lu" class="wide" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></>}
              <div class="actions"><button class="btn" onClick={async () => { try { await call('PATCH', `/v1/lessons/${id}`, { locale, ...(l.type === 'richtext' ? { text } : { url }) }); setEditing(false); load(); } catch (e) { setErr((e as Error).message); } }}>{t.saveBtn}</button></div>
            </div>
          )}
        </>
      )}
      {l.canEdit && l.type === 'quiz' && <QuizEditor lessonId={id} call={call} t={t} locale={locale} existing={l.quiz?.questions ?? []} onSaved={load} />}
      {nav}
      </div>
      {outline && (
        <aside class="lp-side" aria-label={fr ? 'Contenu du cours' : 'Course content'}>
          <b class="lp-t">{outline.title}</b>
          <Bar pct={outline.enrollment?.progressPct ?? 0} />
          <small class="muted">{Math.round(outline.enrollment?.progressPct ?? 0)}% {fr ? 'terminé' : 'complete'}</small>
          <ol class="lp-list">
            {ls.map((x, n) => (
              <li><button class={`lp-i${x.id === id ? ' cur' : ''}`} disabled={x.locked} aria-current={x.id === id ? 'true' : undefined} onClick={() => onLesson(x.id)}>
                <span class={`lp-d${x.done ? ' on' : ''}`}>{x.done ? '✓' : n + 1}</span><span class="lp-n">{x.title}</span><span class="lm">{x.type === 'video' ? '▶ ' : ''}{lessonMin(x)} min</span>
              </button></li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}

function QuizEditor({ lessonId, call, t, locale, existing, onSaved }: { lessonId: string; call: Call; t: Strings; locale: Locale; existing: QuizQ[]; onSaved: () => void }) {
  interface Draft { prompt: string; type: string; options: string[]; correct: number[] }
  const [qs, setQs] = useState<Draft[]>(existing.map((q) => ({ prompt: q.prompt, type: q.type, options: q.options.map((o) => o.text), correct: (q.correct ?? []).map(Number) })));
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [aiBusy, setAiBusy] = useState(false); const [aiNote, setAiNote] = useState(false);
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
            <button class="btn quiet" disabled={aiBusy} onClick={async () => { setMsg(''); setAiBusy(true); try { const r = await call('POST', `/v1/lessons/${lessonId}/quiz/draft`, { locale }); setQs((cur) => [...cur, ...(r.questions as Draft[])]); setAiNote(true); } catch (e) { setMsg((e as Error).message); } setAiBusy(false); }}>{aiBusy ? ceStrings(locale).aiBusy : `✨ ${ceStrings(locale).aiQuiz}`}</button>
            <button class="btn" onClick={save} disabled={qs.length === 0 || qs.some((q) => !q.prompt.trim() || q.options.some((o) => !o.trim()) || q.correct.length === 0)}>{t.saveBtn}</button>
          </div>
          {aiNote && <p class="muted">⚠ {ceStrings(locale).aiNote}</p>}
          {msg && <p class={msg === t.saved ? 'ok' : 'err'}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
