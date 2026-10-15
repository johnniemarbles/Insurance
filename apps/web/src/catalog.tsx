import { useMemo, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

export interface CatalogCourse {
  id: string; status: string; title: string; description: string; lessonCount: number; canEdit: boolean;
  myStatus: string | null; myProgress: number | null; myDueAt: string | null;
  starterKey?: string | null; words?: number; videos?: number; questions?: number; ceHours?: number | null;
}

type Cat = 'compliance' | 'privacy' | 'service' | 'pii' | 'other';
type Icon = 'money' | 'shield' | 'mail' | 'clock' | 'play' | 'people' | 'chat' | 'star' | 'doc' | 'person' | 'search' | 'book';
interface Theme { a: string; b: string; icon: Icon; cat: Cat }

const T: Record<string, Theme> = {
  'client-money': { a: '#059669', b: '#0d9488', icon: 'money', cat: 'compliance' },
  'privacy-basics': { a: '#6355F6', b: '#0ea5e9', icon: 'shield', cat: 'privacy' },
  'phishing-cyber': { a: '#4f46e5', b: '#7c3aed', icon: 'mail', cat: 'privacy' },
  'eo-basics': { a: '#be123c', b: '#f97316', icon: 'clock', cat: 'compliance' },
  'using-pii-video': { a: '#0f172a', b: '#334155', icon: 'play', cat: 'pii' },
  'broker-onboarding': { a: '#0369a1', b: '#14b8a6', icon: 'people', cat: 'service' },
  'complaints-handling': { a: '#b45309', b: '#f59e0b', icon: 'chat', cat: 'service' },
  'ethics-fair-treatment': { a: '#7e22ce', b: '#db2777', icon: 'star', cat: 'compliance' },
  'records-documentation': { a: '#475569', b: '#64748b', icon: 'doc', cat: 'compliance' },
  'vulnerable-clients': { a: '#0f766e', b: '#22c55e', icon: 'person', cat: 'service' },
  'aml-fraud': { a: '#9f1239', b: '#e11d48', icon: 'search', cat: 'compliance' },
  'claims-handling': { a: '#5246E0', b: '#6366f1', icon: 'shield', cat: 'service' },
  'communications-consent': { a: '#0e7490', b: '#6355F6', icon: 'mail', cat: 'privacy' },
};
const SPARE: [string, string][] = [['#6355F6', '#7c3aed'], ['#0d9488', '#16a34a'], ['#ea580c', '#db2777'], ['#4338ca', '#0ea5e9'], ['#a21caf', '#6366f1']];
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const themeOf = (c: CatalogCourse): Theme => (c.starterKey && T[c.starterKey]) || { a: SPARE[hash(c.title) % SPARE.length]![0], b: SPARE[hash(c.title) % SPARE.length]![1], icon: 'book', cat: 'other' };
export const minutesOf = (c: CatalogCourse) => Math.max(1, Math.round((c.words ?? 0) / 150 + (c.videos ?? 0) * 3 + (c.questions ?? 0) * 0.5));

export const ICONS: Record<Icon, preact.JSX.Element> = {
  money: <><circle cx="55" cy="55" r="34" fill="#fff" opacity=".22" /><circle cx="55" cy="55" r="22" fill="#fff" opacity=".35" /><text x="55" y="64" font-size="26" font-weight="800" fill="#fff" text-anchor="middle">$</text></>,
  shield: <><path d="M50 12l32 12v24c0 22-14 36-32 42C32 84 18 70 18 48V24z" fill="#fff" opacity=".28" /><path d="M36 50l10 10 18-22" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round" /></>,
  mail: <><rect x="14" y="26" width="72" height="50" rx="8" fill="#fff" opacity=".28" /><path d="M14 34l36 24 36-24" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" /><circle cx="78" cy="30" r="12" fill="#fbbf24" /><text x="78" y="35" font-size="16" font-weight="800" fill="#1c1d1f" text-anchor="middle">!</text></>,
  clock: <><circle cx="50" cy="50" r="30" fill="#fff" opacity=".25" /><path d="M50 28v24l14 8" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" /></>,
  play: <><circle cx="52" cy="50" r="32" fill="#fff" opacity=".2" /><path d="M42 34l26 16-26 16z" fill="#fff" /></>,
  people: <><circle cx="38" cy="40" r="14" fill="#fff" opacity=".4" /><circle cx="66" cy="44" r="11" fill="#fff" opacity=".3" /><path d="M14 80c2-18 14-26 24-26s22 8 24 26z" fill="#fff" opacity=".4" /></>,
  chat: <><path d="M18 24h64v40H46L28 80V64H18z" fill="#fff" opacity=".3" /><circle cx="36" cy="44" r="4" fill="#fff" /><circle cx="50" cy="44" r="4" fill="#fff" /><circle cx="64" cy="44" r="4" fill="#fff" /></>,
  star: <path d="M50 16l10 22 24 3-18 16 5 24-21-12-21 12 5-24-18-16 24-3z" fill="#fff" opacity=".35" />,
  doc: <><rect x="22" y="18" width="56" height="66" rx="8" fill="#fff" opacity=".3" /><path d="M34 38h32M34 52h32M34 66h20" stroke="#fff" stroke-width="5" stroke-linecap="round" /></>,
  person: <><circle cx="50" cy="40" r="16" fill="#fff" opacity=".35" /><path d="M20 82c3-20 16-28 30-28s27 8 30 28z" fill="#fff" opacity=".35" /></>,
  search: <><circle cx="44" cy="44" r="22" fill="none" stroke="#fff" stroke-width="7" opacity=".6" /><path d="M60 60l20 20" stroke="#fff" stroke-width="8" stroke-linecap="round" /></>,
  book: <><path d="M20 24c12-4 22-2 30 6v50c-8-8-18-10-30-6zM80 24c-12-4-22-2-30 6v50c8-8 18-10 30-6z" fill="#fff" opacity=".35" /></>,
};

const X = {
  en: { hello: 'Welcome back', heroNone: 'Learn at your own pace', heroSub: (n: number, due: number) => (n ? `${n} course${n === 1 ? '' : 's'} in progress${due ? `, ${due} due soon` : ''}.` : 'Pick a course below to get started.'), cont: (t: string) => `Continue: ${t}`, startFirst: 'Browse courses',
    search: 'Search courses', all: 'All courses', required: 'Required', cats: { compliance: 'Compliance', privacy: 'Privacy & security', service: 'Sales & service', pii: 'Using PII', other: 'Other' } as Record<Cat, string>,
    inprog: 'Continue learning', inprogSub: 'Assigned to you or already started.', rec: 'Courses for you', recSub: 'Open to everyone in your company.', done: 'Completed', drafts: 'Drafts', draftsSub: 'Only people who can edit courses see these. Publish when ready.',
    draft: 'DRAFT', req: 'REQUIRED', due: 'Due', video: 'VIDEO', ce: (h: number) => `CE ${h} h`, min: (m: number) => `${m} min`, lessons: (n: number) => `${n} ${n === 1 ? 'lesson' : 'lessons'}`, none: 'No courses match.',
    start: 'Start', cont2: 'Continue', cert: 'Certificate', edit: 'Edit', review: 'Review & publish', notStarted: 'Not started', complete: 'complete', completed: 'Completed', by: 'PII Training' },
  'fr-CA': { hello: 'Content de vous revoir', heroNone: 'Apprenez à votre rythme', heroSub: (n: number, due: number) => (n ? `${n} cours en cours${due ? `, ${due} à échéance prochaine` : ''}.` : 'Choisissez un cours ci-dessous pour commencer.'), cont: (t: string) => `Continuer : ${t}`, startFirst: 'Parcourir les cours',
    search: 'Rechercher des cours', all: 'Tous les cours', required: 'Obligatoires', cats: { compliance: 'Conformité', privacy: 'Vie privée et sécurité', service: 'Ventes et service', pii: 'Utiliser PII', other: 'Autres' } as Record<Cat, string>,
    inprog: 'Continuer à apprendre', inprogSub: 'Cours qui vous sont assignés ou déjà commencés.', rec: 'Cours pour vous', recSub: 'Ouverts à tous dans votre entreprise.', done: 'Terminés', drafts: 'Brouillons', draftsSub: 'Seules les personnes qui peuvent modifier les cours les voient. Publiez quand c’est prêt.',
    draft: 'BROUILLON', req: 'OBLIGATOIRE', due: 'Échéance', video: 'VIDÉO', ce: (h: number) => `FC ${h} h`, min: (m: number) => `${m} min`, lessons: (n: number) => `${n} ${n === 1 ? 'leçon' : 'leçons'}`, none: 'Aucun cours ne correspond.',
    start: 'Commencer', cont2: 'Continuer', cert: 'Certificat', edit: 'Modifier', review: 'Réviser et publier', notStarted: 'Non commencé', complete: 'terminé', completed: 'Terminé', by: 'Formation PII' },
};

export function Catalog({ courses, locale, onOpen }: { courses: CatalogCourse[]; locale: Locale; onOpen: (id: string) => void }) {
  const x = X[locale];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | 'required' | Cat>('all');
  const [saved, setSaved] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('pii.saved') ?? '[]'); } catch { return []; } });
  const toggle = (id: string) => { const n = saved.includes(id) ? saved.filter((s) => s !== id) : [...saved, id]; setSaved(n); try { localStorage.setItem('pii.saved', JSON.stringify(n)); } catch { /* private window */ } };
  const cats = useMemo(() => [...new Set(courses.map((c) => themeOf(c).cat))], [courses]);
  const shown = courses.filter((c) => {
    if (q && !`${c.title} ${c.description}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (cat === 'required') return Boolean(c.myDueAt) && c.myStatus !== 'completed';
    return cat === 'all' || themeOf(c).cat === cat;
  });
  const inprog = shown.filter((c) => c.status !== 'draft' && c.myStatus && c.myStatus !== 'completed');
  const rec = shown.filter((c) => c.status !== 'draft' && !c.myStatus);
  const done = shown.filter((c) => c.myStatus === 'completed');
  const drafts = shown.filter((c) => c.status === 'draft');
  const all = courses.filter((c) => c.status !== 'draft' && c.myStatus && c.myStatus !== 'completed');
  const next = [...all].sort((a, b) => (a.myDueAt ? 0 : 1) - (b.myDueAt ? 0 : 1) || (b.myProgress ?? 0) - (a.myProgress ?? 0))[0];
  const soon = all.filter((c) => c.myDueAt && new Date(c.myDueAt).getTime() - Date.now() < 14 * 864e5).length;
  const th = next ? themeOf(next) : null;

  const card = (c: CatalogCourse) => {
    const t = themeOf(c), m = minutesOf(c), inP = c.myStatus && c.myStatus !== 'completed', fin = c.myStatus === 'completed';
    return (
      <div class="cc" key={c.id}>
        <button class="cc-main" onClick={() => onOpen(c.id)} aria-label={c.title}>
          <div class="cc-th" style={{ background: `linear-gradient(135deg,${t.a},${t.b})` }}>
            <div class="cc-tags">
              {c.status === 'draft' && <span class="cc-tag dr">{x.draft}</span>}
              {c.myDueAt && !fin && <span class="cc-tag req">{x.req}</span>}
              {c.myDueAt && !fin && <span class="cc-tag">{x.due} {new Date(c.myDueAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>}
              {(c.videos ?? 0) > 0 && <span class="cc-tag">▶ {x.video}</span>}
              {c.starterKey === 'using-pii-video' && <span class="cc-tag">{locale === 'fr-CA' ? '💬 SOUS-TITRES' : '🔊 NARRATED'}</span>}
              {c.ceHours ? <span class="cc-tag ce">{x.ce(c.ceHours)}</span> : null}
            </div>
            <svg viewBox="0 0 100 100" aria-hidden="true">{ICONS[t.icon]}</svg>
          </div>
          <div class="cc-b">
            <h3>{c.title}</h3>
            <div class="cc-by">{x.by}</div>
            <div class="cc-meta"><span>⏱ {x.min(m)}</span><i /><span>{x.lessons(c.lessonCount)}</span><em>EN</em><em>FR</em></div>
            {inP && <div class="cc-bar"><i style={{ width: `${Math.min(100, c.myProgress ?? 0)}%` }} /></div>}
            <div class="cc-cta">
              <span class={fin ? 'ok' : ''}>{fin ? `✓ ${x.completed}` : inP && (c.myProgress ?? 0) > 0 ? `${Math.round(c.myProgress ?? 0)}% ${x.complete}` : inP ? x.notStarted : c.status === 'draft' ? x.review : x.notStarted}</span>
              <b>{fin ? x.cert : inP && (c.myProgress ?? 0) > 0 ? `${x.cont2} →` : inP ? `${x.start} →` : c.status === 'draft' ? `${x.edit} →` : `${x.start} →`}</b>
            </div>
          </div>
        </button>
        <button class={`cc-heart${saved.includes(c.id) ? ' on' : ''}`} aria-pressed={saved.includes(c.id)} aria-label="Save" onClick={() => toggle(c.id)}>{saved.includes(c.id) ? '♥' : '♡'}</button>
      </div>
    );
  };
  const row = (title: string, sub: string, list: CatalogCourse[]) => list.length > 0 && <section class="cat-row"><h2>{title}</h2><p>{sub}</p><div class="cc-grid">{list.map(card)}</div></section>;

  return (
    <div class="catalog">
      <div class="cat-hero">
        <div class="cat-ht">
          <div class="cat-kicker">{x.hello}</div>
          <h1>{next ? next.title : x.heroNone}</h1>
          <p>{x.heroSub(all.length, soon)}</p>
          {next ? <button class="cat-hb" onClick={() => onOpen(next.id)}>{x.cont(next.title)}</button> : null}
        </div>
        {next && th && <div class="cat-hc"><div class="cat-mini"><div style={{ background: `linear-gradient(135deg,${th.a},${th.b})` }} /><b>{next.title}</b><div class="cc-bar"><i style={{ width: `${Math.min(100, next.myProgress ?? 0)}%` }} /></div><small>{Math.round(next.myProgress ?? 0)}% {x.complete}</small></div></div>}
      </div>
      <div class="cat-tools">
        <input class="cat-search" type="search" placeholder={`⌕  ${x.search}`} aria-label={x.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <div class="cat-chips" role="group">
          <button class={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>{x.all}</button>
          <button class={cat === 'required' ? 'on' : ''} onClick={() => setCat('required')}>{x.required}</button>
          {cats.map((k) => <button key={k} class={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{x.cats[k]}</button>)}
        </div>
      </div>
      {row(x.inprog, x.inprogSub, inprog)}
      {row(x.rec, x.recSub, rec)}
      {row(x.done, '', done)}
      {row(x.drafts, x.draftsSub, drafts)}
      {shown.length === 0 && <div class="msg">{x.none}</div>}
    </div>
  );
}
