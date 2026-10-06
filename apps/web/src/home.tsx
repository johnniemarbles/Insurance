import { ErrorBar } from './errorbar.tsx';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import { stageColor, money } from './theme.ts';
import type { Locale, Pipeline } from './types.ts';
import type { Strings } from './i18n.ts';
import { OverviewPanel, overviewLabels } from './overview.tsx';
import { HomeLearning } from './ce.tsx';
import { LMS } from './features.ts';
import { DashboardPanel } from './dashboard.tsx';
import type { ComposeApi } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface TaskRow { id: string; title: string; dueAt: string | null; boxId: string | null; boxName: string | null; pipelineId: string | null }
interface RecRow { id: string; name: string; pipelineId: string; pipeline: string; stage: string; updatedAt: string; activity?: number }
interface HomeData {
  renewals?: { id: string; name: string; pipelineId: string; pipeline: string; stage: string; renewalDate: string; daysLeft: number; policyType: string | null }[];
  week?: { ring: boolean; goal: number; done: number };
  upcoming: TaskRow[];
  tasks: TaskRow[];
  risks: { id: string; pipelineId: string; pipeline: string; name: string; stage: string; days: number; reasons: string[] }[];
  merges: { id: string; name: string; status: string; total: number; sent: number; failed: number }[];
  recent: RecRow[];
  trending: RecRow[];
  pins: { id: string; name: string; pipelineId: string; pipeline: string }[];
  views: { id: string; name: string; pipelineId: string; pipeline: string; pinned: boolean }[];
  defaultPipeline: string;
}

const K = {
  'en': { open: 'Open', won: 'Won (30 days)', win: 'Win rate', due: 'Due today', ren: 'Renewals (30 days)', stuck: 'Need attention', doNow: 'Do now', empty: 'Nothing is overdue or stuck. You are all caught up.', first: 'Add your first record', first2: 'or import a spreadsheet', activity: 'Team activity', noAct: 'Activity shows up here as your team works.', perf: 'Performance', company: 'Company overview', moved: (n: string) => `moved to ${n}`, created: 'added', note: 'wrote a note', later: 'Upcoming', quick: 'Quick actions' },
  'fr-CA': { open: 'Ouverts', won: 'Gagnés (30 jours)', win: 'Taux de réussite', due: 'À faire aujourd’hui', ren: 'Renouvellements (30 jours)', stuck: 'À surveiller', doNow: 'À faire maintenant', empty: 'Rien n’est en retard ni bloqué. Tout est à jour.', first: 'Ajoutez votre premier dossier', first2: 'ou importez un chiffrier', activity: 'Activité de l’équipe', noAct: 'L’activité s’affiche ici au fil du travail de l’équipe.', perf: 'Performance', company: 'Vue d’ensemble de l’entreprise', moved: (n: string) => `a déplacé vers ${n}`, created: 'a ajouté', note: 'a écrit une note', later: 'À venir', quick: 'Actions rapides' },
};

const X = {
  'en': {
    welcome: (n: string) => (n ? `Welcome, ${n}` : 'Welcome'),
    summary: (due: number, risk: number) => `${due} ${due === 1 ? 'task' : 'tasks'} due today or overdue · ${risk} ${risk === 1 ? 'record needs' : 'records need'} attention`,
    quick: 'Quick access', edit: 'Edit shortcuts', noPins: 'Pin your saved views here for one-click access.',
    newRecord: 'Create record', newTask: 'Create task', merge: 'Start mail merge', import: 'Import',
    recent: 'Recent records', recents: 'Recents', trending: 'Trending', noRecent: 'Records you create or update show up here.', noTrending: 'Nothing busy this week.', ago: 'updated', moves: (n: number) => `${n} ${n === 1 ? 'update' : 'updates'} this week`,
    snapshot: 'Pipeline', openPipe: 'Open pipeline', noStages: 'No pipelines yet.', records: (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`,
    radar: 'Renewals coming up', radarAll: 'See all renewals', noRadar: 'No renewals in the next 45 days.', rLeft: (n: number) => (n < 0 ? `${-n} d overdue` : n === 0 ? 'Today' : `in ${n} d`),
    title: 'My day', due: 'Due today and overdue', noTasks: 'Nothing due. Nice.', later: 'Coming up and no date', noDate: 'No date', attention: 'Needs attention', noRisk: 'Nothing looks stuck.', merges: 'Mail merges in progress', noMerges: 'No merge is running.',
    overdue: 'Overdue', today: 'Today', sent: (a: number, b: number) => `${a} of ${b} sent`, paused: 'paused', days: (n: number) => `${n} days in stage`,
    why: { stalled: 'Stalled', overdue: 'Overdue task', past_close: 'Past close date', no_next_step: 'No next step', unowned: 'No owner' } as Record<string, string>,
    taskTitle: 'What needs doing?', taskFor: 'For which record', taskDue: 'Due', add: 'Add task', cancel: 'Cancel', save: 'Save', saved: 'Task added', pick: 'Choose a record', noneYet: 'Create a record first.',
    greet: (h: number, n: string) => `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${n ? `, ${n}` : ''}`,
    focus: 'Start here', focusEmpty: 'You are all caught up. Nothing is overdue or stuck.', fTask: 'Overdue task', fToday: 'Due today', fRisk: 'Needs attention', fRenew: 'Renewal', fTasks: 'Tasks', fRenewals: 'Renewals',
    emailDay: 'Email me my day', emailDone: 'A draft is open in Gmail. Press Send to email it to yourself.', emailFail: 'Could not open Gmail to write the email', digestSubject: (d: string) => `My day, ${d}`, digestNone: 'Nothing here.',
    editTitle: 'Shortcuts on Home', editHelp: 'Pick up to 12 saved views to show as cards.', noViews: 'You have no saved views yet. Save one from a pipeline first.', close: 'Close',
  },
  'fr-CA': {
    welcome: (n: string) => (n ? `Bienvenue, ${n}` : 'Bienvenue'),
    summary: (due: number, risk: number) => `${due} ${due === 1 ? 'tâche' : 'tâches'} à faire aujourd’hui ou en retard · ${risk} ${risk === 1 ? 'dossier à surveiller' : 'dossiers à surveiller'}`,
    quick: 'Accès rapide', edit: 'Modifier les raccourcis', noPins: 'Épinglez vos vues enregistrées ici pour y accéder d’un clic.',
    newRecord: 'Créer un dossier', newTask: 'Créer une tâche', merge: 'Lancer un publipostage', import: 'Importer',
    recent: 'Dossiers récents', recents: 'Récents', trending: 'Populaires', noRecent: 'Les dossiers que vous créez ou modifiez apparaissent ici.', noTrending: 'Rien de très actif cette semaine.', ago: 'modifié', moves: (n: number) => `${n} ${n === 1 ? 'mise à jour' : 'mises à jour'} cette semaine`,
    snapshot: 'Pipeline', openPipe: 'Ouvrir le pipeline', noStages: 'Aucun pipeline pour l’instant.', records: (n: number) => `${n} ${n === 1 ? 'dossier' : 'dossiers'}`,
    radar: 'Renouvellements à venir', radarAll: 'Voir tous les renouvellements', noRadar: 'Aucun renouvellement dans les 45 prochains jours.', rLeft: (n: number) => (n < 0 ? `${-n} j de retard` : n === 0 ? 'Aujourd’hui' : `dans ${n} j`),
    title: 'Ma journée', due: 'À faire aujourd’hui et en retard', noTasks: 'Rien à faire. Parfait.', later: 'À venir et sans date', noDate: 'Sans date', attention: 'À surveiller', noRisk: 'Rien ne semble bloqué.', merges: 'Publipostages en cours', noMerges: 'Aucun publipostage en cours.',
    overdue: 'En retard', today: 'Aujourd’hui', sent: (a: number, b: number) => `${a} sur ${b} envoyés`, paused: 'en pause', days: (n: number) => `${n} jours dans l’étape`,
    why: { stalled: 'Bloqué', overdue: 'Tâche en retard', past_close: 'Clôture dépassée', no_next_step: 'Aucune prochaine étape', unowned: 'Sans responsable' } as Record<string, string>,
    taskTitle: 'Que faut-il faire?', taskFor: 'Pour quel dossier', taskDue: 'Échéance', add: 'Ajouter la tâche', cancel: 'Annuler', save: 'Enregistrer', saved: 'Tâche ajoutée', pick: 'Choisir un dossier', noneYet: 'Créez d’abord un dossier.',
    greet: (h: number, n: string) => `${h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'}${n ? `, ${n}` : ''}`,
    focus: 'Commencez ici', focusEmpty: 'Tout est à jour. Rien n’est en retard ni bloqué.', fTask: 'Tâche en retard', fToday: 'À faire aujourd’hui', fRisk: 'À surveiller', fRenew: 'Renouvellement', fTasks: 'Tâches', fRenewals: 'Renouvellements',
    emailDay: 'M’envoyer ma journée par courriel', emailDone: 'Un brouillon est ouvert dans Gmail. Appuyez sur Envoyer pour vous l’envoyer.', emailFail: 'Impossible d’ouvrir Gmail pour écrire le courriel', digestSubject: (d: string) => `Ma journée, ${d}`, digestNone: 'Rien.',
    editTitle: 'Raccourcis de l’accueil', editHelp: 'Choisissez jusqu’à 12 vues enregistrées à afficher en cartes.', noViews: 'Vous n’avez pas encore de vue enregistrée. Enregistrez-en une depuis un pipeline.', close: 'Fermer',
  },
};

/** The first page: shortcuts, recent work, one pipeline at a glance, and what needs the person today. */
export function HomePage({ call, t, locale, go, name, isAdmin, currency, compose, meEmail }: { call: Call; t: Strings; locale: Locale; go: (page: string, id?: string) => void; name: string; isAdmin?: boolean; currency?: string; compose?: ComposeApi; meEmail?: string }) {
  const x = X[locale];
  const ol = overviewLabels(locale);
  const [d, setD] = useState<HomeData | null>(null);
  const [err, setErr] = useState('');
  const [pipes, setPipes] = useState<Pipeline[]>([]);
  const [tab, setTab] = useState<'recents' | 'trending'>('recents');
  const [pid, setPid] = useState('');
  const [sum, setSum] = useState<{ stageId: string; count: number; value: number }[] | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [kp, setKp] = useState<{ totals: { openCount: number; openValue: number; won: number; wonValue: number; winRate: number | null } } | null>(null);
  const [feed, setFeed] = useState<{ id: string; kind: string; at: string; boxId: string; boxName: string; actor: string | null; fromStage: string | null; toStage: string | null; body: string | null }[]>([]);
  const load = () => call('GET', '/v1/home').then(setD, (e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
    call('GET', '/v1/dashboard?days=30').then(setKp, () => undefined);
    call('GET', '/v1/newsfeed?scope=all&limit=8').then((r) => setFeed(r.items), () => undefined);
    call('GET', '/v1/pipelines').then((r) => setPipes(r.pipelines as Pipeline[]), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call]);
  useEffect(() => {
    if (pid || !d || pipes.length === 0) return;
    setPid(pipes.some((p) => p.id === d.defaultPipeline) ? d.defaultPipeline : pipes[0]!.id);
  }, [d, pipes, pid]);
  useEffect(() => {
    if (!pid) return;
    setSum(null);
    call('GET', `/v1/pipelines/${pid}/summary`).then((r) => setSum(r.stages), () => setSum([]));
  }, [call, pid]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4000); return () => clearTimeout(id); }, [toast]);
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pipes) p.stages.forEach((s, i) => m.set(`${p.id}|${s.name}`, stageColor(p.colorTheme, s, i)));
    return (pipelineId: string, stage: string) => m.get(`${pipelineId}|${stage}`) ?? '#6b7280';
  }, [pipes]);
  if (err) return <ErrorBar msg={err} retry={t.retry} />;
  if (!d) return <div class="msg">…</div>;
  const late = (iso: string | null) => (iso ? new Date(iso) < new Date(new Date().setHours(0, 0, 0, 0)) : false);
  const openRec = (r: { id: string; pipelineId: string }) => go('pipelines', `${r.pipelineId}::open=${r.id}`);
  const openTask = (k: TaskRow) => (k.pipelineId && k.boxId ? go('pipelines', `${k.pipelineId}::open=${k.boxId}`) : undefined);
  const first = (name || '').split(' ')[0] ?? '';
  const pipe = pipes.find((p) => p.id === pid);
  const rows = tab === 'recents' ? d.recent : d.trending;
  const today = new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
  const actPipe = pid || d.defaultPipeline || pipes[0]?.id || '';
  // Home v2: the three things most worth doing now, in order: overdue work, stuck records, renewals this week, then what is due today.
  type Focus = { key: string; label: string; title: string; sub: string; open: () => void };
  const focus: Focus[] = [
    ...d.tasks.filter((k) => late(k.dueAt)).map((k): Focus => ({ key: `t${k.id}`, label: x.fTask, title: k.title, sub: k.boxName ?? '', open: () => openTask(k) })),
    ...d.risks.map((r): Focus => ({ key: `r${r.id}`, label: x.fRisk, title: r.name, sub: r.reasons.map((w) => x.why[w] ?? w).join(' · '), open: () => openRec(r) })),
    ...(d.renewals ?? []).filter((r) => r.daysLeft <= 7).map((r): Focus => ({ key: `n${r.id}`, label: x.fRenew, title: r.name, sub: x.rLeft(r.daysLeft), open: () => openRec(r) })),
    ...d.tasks.filter((k) => !late(k.dueAt)).map((k): Focus => ({ key: `d${k.id}`, label: x.fToday, title: k.title, sub: k.boxName ?? '', open: () => openTask(k) })),
  ].slice(0, 3);
  const emailDay = async () => {
    if (!compose || !meEmail) return;
    const e = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const list = (h: string, items: string[]) => `<h3>${e(h)}</h3>${items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : `<p>${e(x.digestNone)}</p>`}`;
    const html = `<div style="font-family:system-ui,sans-serif">${list(x.due, d.tasks.map((k) => `${e(k.title)}${k.boxName ? ` <i>(${e(k.boxName)})</i>` : ''}${late(k.dueAt) ? ` <b>${e(x.overdue)}</b>` : ''}`))}${list(x.attention, d.risks.map((r) => `${e(r.name)} <i>(${e(r.pipeline)})</i>: ${e(r.reasons.map((w) => x.why[w] ?? w).join(', '))}`))}${list(x.radar, (d.renewals ?? []).map((r) => `${e(r.name)}: ${e(x.rLeft(r.daysLeft))}`))}</div>`;
    // Review mode leaves the Gmail window open for the person to press Send; the result only arrives once they do or give up.
    setToast(x.emailDone);
    void compose.send({ to: meEmail, subject: x.digestSubject(today), html, review: true }).then((r) => { if (!r.ok && r.error?.startsWith('Could not open')) setToast(x.emailFail); }, () => setToast(x.emailFail));
  };
  const k = K[locale];
  const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);
  const renSoon = (d.renewals ?? []).filter((r) => r.daysLeft <= 30).length;
  const dueToday = d.tasks.length;
  type Row = { key: string; label: string; tone: string; title: string; sub: string; open: () => void };
  const doNow: Row[] = [
    ...d.tasks.filter((t0) => late(t0.dueAt)).map((t0): Row => ({ key: `t${t0.id}`, label: x.fTask, tone: 'warn', title: t0.title, sub: t0.boxName ?? '', open: () => openTask(t0) })),
    ...d.risks.map((r): Row => ({ key: `r${r.id}`, label: x.fRisk, tone: 'warn', title: r.name, sub: r.reasons.map((w) => x.why[w] ?? w).join(' · '), open: () => openRec(r) })),
    ...(d.renewals ?? []).filter((r) => r.daysLeft <= 7).map((r): Row => ({ key: `n${r.id}`, label: x.fRenew, tone: '', title: r.name, sub: x.rLeft(r.daysLeft), open: () => openRec(r) })),
    ...d.tasks.filter((t0) => !late(t0.dueAt)).map((t0): Row => ({ key: `d${t0.id}`, label: x.fToday, tone: '', title: t0.title, sub: t0.boxName ?? '', open: () => openTask(t0) })),
  ].slice(0, 8);
  const brandNew = d.recent.length === 0 && pipes.length > 0;
  const act = (f: (typeof feed)[number]) => (f.kind === 'note' ? k.note : f.toStage && f.fromStage ? k.moved(f.toStage) : f.toStage ? k.created : k.created);
  return (
    <div class="home">
      <div class="hhead">
        <div><h2>{x.greet(new Date().getHours(), first)}</h2><span class="muted">{today}</span></div>
        <span class="spacer" />
        {compose && meEmail && <button class="link" onClick={() => void emailDay()}>{x.emailDay}</button>}
        {d.week?.ring && (() => { const w = d.week; const p = Math.min(100, Math.round((w.done / Math.max(1, w.goal)) * 100)); return (
          <div class="goal" title={`${w.done} / ${w.goal}`}><div class="ring" role="img" aria-label={`${w.done} / ${w.goal}`} style={{ '--p': p } as any}><span>{w.done}/{w.goal}</span></div></div>
        ); })()}
      </div>

      <div class="qbar" role="toolbar" aria-label={k.quick}>
        <button class="qchip act" onClick={() => actPipe && go('pipelines', `${actPipe}::new`)}>＋ {x.newRecord}</button>
        <button class="qchip act" onClick={() => setTaskOpen(true)}>✓ {x.newTask}</button>
        <button class="qchip act" onClick={() => go('merges')}>✉ {x.merge}</button>
        <button class="qchip act" onClick={() => actPipe && go('pipelines', `${actPipe}::import`)}>⇪ {x.import}</button>
        {d.pins.map((v) => <button class="qchip" key={v.id} onClick={() => go('pipelines', `${v.pipelineId}:${v.id}`)} title={v.pipeline}>▤ {v.name}</button>)}
        <button class="link" onClick={() => setEditOpen(true)}>{x.edit}</button>
      </div>

      <div class="kstrip">
        <button class="ktile" onClick={() => go('pipelines')}><b>{kp ? kp.totals.openCount : '…'}</b><span>{k.open}</span><small>{kp ? money(kp.totals.openValue, currency ?? 'CAD', locale) : ''}</small></button>
        <button class="ktile" onClick={() => go('pipelines')}><b>{kp ? kp.totals.won : '…'}</b><span>{k.won}</span><small>{kp ? money(kp.totals.wonValue, currency ?? 'CAD', locale) : ''}</small></button>
        <button class="ktile" onClick={() => go('pipelines')}><b>{kp ? pct(kp.totals.winRate) : '…'}</b><span>{k.win}</span></button>
        <div class={`ktile${dueToday ? ' hot' : ''}`}><b>{dueToday}</b><span>{k.due}</span></div>
        <button class="ktile" onClick={() => go('renewals')}><b>{renSoon}</b><span>{k.ren}</span></button>
        <div class={`ktile${d.risks.length ? ' hot' : ''}`}><b>{d.risks.length}</b><span>{k.stuck}</span></div>
      </div>

      {LMS && <HomeLearning call={call} locale={locale} go={go} />}

      <div class="hcols">
        <section class="hcard" aria-label={k.doNow}>
          <div class="hsec-h"><h3>{k.doNow}</h3></div>
          {doNow.length === 0 && (brandNew
            ? <div class="nudge"><p>{k.first}</p><div class="erow"><button class="btn" onClick={() => actPipe && go('pipelines', `${actPipe}::new`)}>＋ {x.newRecord}</button><span class="muted">{k.first2}</span><button class="btn quiet" onClick={() => actPipe && go('pipelines', `${actPipe}::import`)}>⇪ {x.import}</button></div></div>
            : <p class="muted">{k.empty}</p>)}
          {doNow.map((r) => (
            <button class="hrow" key={r.key} onClick={r.open}>
              <span class="rname">{r.title}</span><small class="muted">{r.sub}</small><span class={`chip${r.tone ? ` ${r.tone}` : ''}`}>{r.label}</span>
            </button>
          ))}
        </section>

        <section class="hcard"><div class="hsec-h"><h3>{x.snapshot}</h3>
          {pipes.length > 0 && <select aria-label={x.snapshot} value={pid} onChange={(e) => setPid((e.target as HTMLSelectElement).value)}>{pipes.map((p) => <option value={p.id}>{p.name}</option>)}</select>}
        </div>
          {pipes.length === 0 && <p class="muted">{x.noStages}</p>}
          {pipe && (
            <>
              <div class="snap vsnap">
                {pipe.stages.map((s, i) => {
                  const m = sum?.find((z) => z.stageId === s.id);
                  return (
                    <button class="snapstage" key={s.id} style={{ borderTopColor: stageColor(pipe.colorTheme, s, i) }} onClick={() => go('pipelines', pipe.id)}>
                      <b>{sum ? m?.count ?? 0 : '…'}</b><span>{s.name}</span>
                      {m && m.value > 0 && <small class="muted">{money(m.value, currency ?? 'CAD', locale)}</small>}
                    </button>
                  );
                })}
              </div>
              <button class="link" onClick={() => go('pipelines', pipe.id)}>{x.openPipe} →</button>
            </>
          )}
        </section>
      </div>

      <div class="h3grid">
        <section class="hcard"><div class="hsec-h"><h3>{x.recent}</h3>
          <div class="seg2" role="tablist">
            <button role="tab" aria-selected={tab === 'recents'} onClick={() => setTab('recents')}>{x.recents}</button>
            <button role="tab" aria-selected={tab === 'trending'} onClick={() => setTab('trending')}>{x.trending}</button>
          </div></div>
          {rows.length === 0 && <p class="muted">{tab === 'recents' ? x.noRecent : x.noTrending}</p>}
          {rows.slice(0, 6).map((r) => (
            <button class="hrow" key={r.id} onClick={() => openRec(r)}>
              <span class="rname">{r.name}</span>
              <span class="stagechip" style={{ background: colorOf(r.pipelineId, r.stage) }}>{r.stage}</span>
              <small class="muted">{r.pipeline} · {tab === 'trending' && r.activity ? x.moves(r.activity) : `${x.ago} ${new Date(r.updatedAt).toLocaleDateString(locale)}`}</small>
            </button>
          ))}
        </section>

        <section class="hcard"><h3>{k.later}</h3>
          {(d.upcoming ?? []).length === 0 && (d.renewals ?? []).length === 0 && <p class="muted">{x.noRadar}</p>}
          {(d.renewals ?? []).slice(0, 4).map((r) => (
            <button class="hrow" key={r.id} onClick={() => openRec(r)}>
              <span>{r.name}{r.policyType ? <span class="chip" style={{ marginLeft: '8px' }}>{r.policyType}</span> : null}</span>
              <span class={`due ${r.daysLeft < 0 ? 'bad' : r.daysLeft <= 30 ? 'warn' : 'ok'}`}>{x.rLeft(r.daysLeft)}</span>
            </button>
          ))}
          {(d.upcoming ?? []).slice(0, 4).map((u) => (
            <button class="hrow" key={u.id} onClick={() => openTask(u)}>
              <span>{u.title}</span><small class="muted">{u.boxName ?? ''}</small>
              <span class="chip">{u.dueAt ? new Date(u.dueAt).toLocaleDateString(locale) : x.noDate}</span>
            </button>
          ))}
          <button class="link" onClick={() => go('renewals')}>{x.radarAll}</button>
        </section>

        <section class="hcard"><h3>{k.activity}</h3>
          {feed.length === 0 && <p class="muted">{k.noAct}</p>}
          {feed.slice(0, 6).map((f) => (
            <button class="hrow" key={`${f.kind}${f.id}`} onClick={() => go('pipelines')}>
              <span><b>{f.actor ?? '—'}</b> {act(f)}</span><small class="muted">{f.boxName} · {new Date(f.at).toLocaleDateString(locale)}</small>
            </button>
          ))}
        </section>

        {d.merges.length > 0 && (
          <section class="hcard"><h3>{x.merges}</h3>
            {d.merges.map((m) => (
              <button class="hrow" key={m.id} onClick={() => go('merges')}>
                <span>{m.name}</span><small class="muted">{x.sent(m.sent, m.total)}{m.status === 'paused' ? ` · ${x.paused}` : ''}{m.failed ? ` · ${m.failed} ✕` : ''}</small>
                <progress max={m.total || 1} value={m.sent} />
              </button>
            ))}
          </section>
        )}
      </div>

      <h3 class="hpart">{k.perf}</h3>
      <DashboardPanel slim call={call} locale={locale} currency={currency ?? 'CAD'} />
      {isAdmin && (<><h3 class="hpart">{k.company}</h3><OverviewPanel call={call} locale={locale} go={go} currency={currency ?? 'CAD'} /></>)}

      {taskOpen && <TaskDialog call={call} x={x} options={[...d.recent, ...d.trending.filter((r) => !d.recent.some((q) => q.id === r.id))]} onClose={() => setTaskOpen(false)} onDone={() => { setTaskOpen(false); setToast(x.saved); void load(); }} />}
      {editOpen && <PinsDialog call={call} x={x} views={d.views} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void load(); }} />}
      {toast && <div class="toast" role="status">{toast}</div>}
    </div>
  );
}

type Xs = (typeof X)['en'];

function TaskDialog({ call, x, options, onClose, onDone }: { call: Call; x: Xs; options: RecRow[]; onClose: () => void; onDone: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [title, setTitle] = useState('');
  const [box, setBox] = useState(options[0]?.id ?? '');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!title.trim() || !box || busy) return;
    setBusy(true); setErr('');
    try { await call('POST', `/v1/boxes/${box}/tasks`, { title: title.trim(), ...(due ? { dueAt: new Date(`${due}T17:00:00`).toISOString() } : {}) }); onDone(); }
    catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer rec" role="dialog" aria-label={x.newTask} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form onSubmit={submit} class="rec-formwrap">
        <header class="rec-head"><div class="rec-top"><h2>{x.newTask}</h2><button type="button" class="x" aria-label={x.close} onClick={onClose}>×</button></div></header>
        <div class="rec-body rec-form">
          {options.length === 0 ? <p class="muted">{x.noneYet}</p> : (
            <>
              <label class="fld" for="ht-title">{x.taskTitle} *<input id="ht-title" required maxLength={300} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} autofocus /></label>
              <label class="fld" for="ht-box">{x.taskFor} *<select id="ht-box" required value={box} onChange={(e) => setBox((e.target as HTMLSelectElement).value)}><option value="">{x.pick}</option>{options.map((r) => <option value={r.id}>{r.name} · {r.pipeline}</option>)}</select></label>
              <label class="fld" for="ht-due">{x.taskDue}<input id="ht-due" type="date" value={due} onInput={(e) => setDue((e.target as HTMLInputElement).value)} /></label>
            </>
          )}
          {err && <p class="err" role="alert">{err}</p>}
        </div>
        <footer class="rec-foot"><button type="button" class="btn quiet" onClick={onClose}>{x.cancel}</button><button class="btn" disabled={busy || !title.trim() || !box}>{busy ? '…' : x.add}</button></footer>
      </form>
    </aside>
  );
}

function PinsDialog({ call, x, views, onClose, onSaved }: { call: Call; x: Xs; views: HomeData['views']; onClose: () => void; onSaved: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [sel, setSel] = useState<string[]>(views.filter((v) => v.pinned).map((v) => v.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((i) => i !== id) : s.length >= 12 ? s : [...s, id]));
  const save = async () => {
    setBusy(true); setErr('');
    try { await call('PUT', '/v1/home/pins', { viewIds: sel }); onSaved(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer rec" role="dialog" aria-label={x.editTitle} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div class="rec-formwrap">
        <header class="rec-head"><div class="rec-top"><h2>{x.editTitle}</h2><button type="button" class="x" aria-label={x.close} onClick={onClose}>×</button></div></header>
        <div class="rec-body rec-form">
          <p class="muted">{x.editHelp}</p>
          {views.length === 0 && <p class="muted">{x.noViews}</p>}
          {views.map((v) => <label class="check" key={v.id}><input type="checkbox" checked={sel.includes(v.id)} onChange={() => toggle(v.id)} /> {v.name} <small class="muted">· {v.pipeline}</small></label>)}
          {err && <p class="err" role="alert">{err}</p>}
        </div>
        <footer class="rec-foot"><button type="button" class="btn quiet" onClick={onClose}>{x.cancel}</button><button class="btn" disabled={busy} onClick={() => void save()}>{busy ? '…' : x.save}</button></footer>
      </div>
    </aside>
  );
}
