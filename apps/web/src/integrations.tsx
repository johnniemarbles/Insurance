import { useEffect, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Strings } from './i18n.ts';
import type { Locale, Pipeline } from './types.ts';
import { GROUPS, RECIPES, type Group, type Recipe } from './recipes.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Intake { id: string; kind: 'form' | 'webhook'; name: string; stageId: string; active: boolean; uses: number; lastUsedAt: string | null; tokenPrefix: string }
interface Hook { id: string; url: string; events: string[]; active: boolean; lastStatus: number | null; lastAt: string | null; failures: number }
interface Digest { days: number; newBoxes: { id: string; name: string; stage: string | null }[]; reachedStage: { stage: string; boxes: { id: string; name: string }[] }[]; dueTasks: { id: string; title: string; dueAt: string; overdue: boolean; boxId: string | null; boxName: string | null; assignee: string | null }[] }

const X = {
  'en': {
    tabs: ['Recipes', 'Your connections', 'This week', 'Transfer data'], setUp: 'Set up', back: 'Back', steps: 'Steps', script: 'Script (copy and paste)', create: 'Create', addr: 'Address from the other tool', sendTest: 'Send test message',
    tested: (n: number) => (n >= 200 && n < 400 ? 'Delivered.' : n ? `The other tool answered ${n}.` : 'Could not reach that address.'), linkReady: 'Your link is ready. The steps below use it.', needsLocation: 'Choose a location first.',
    newRecords: 'New records', reached: 'Reached a stage', dueTasks: 'Tasks due', overdue: 'overdue', nothing: 'Nothing in this period.', period: (n: number) => `Last ${n} days`, mine: 'My tasks', everyone: 'Everyone’s tasks',
    weekHelp: 'What changed in this pipeline, and what is due. A weekly version can be sent to Zapier or another tool from the Recipes tab.', events: { 'box.created': 'created', 'box.stage_changed': 'stage change', 'digest.weekly': 'weekly summary' } as Record<string, string>,
    transferHelp: 'Move data in and out. Files open in Google Sheets, Excel and others.', exportBoxes: 'Export records (CSV)', exportContacts: 'Export contacts (CSV)', importRecords: 'Import records…', openSheets: 'Open Google Sheets', sheetsTip: 'In Google Sheets: File → Import → Upload, then pick the file.', exporting: 'Preparing…',
    connected: 'Connected', none: 'Nothing connected yet.',
  },
  'fr-CA': {
    tabs: ['Recettes', 'Vos connexions', 'Cette semaine', 'Transférer des données'], setUp: 'Configurer', back: 'Retour', steps: 'Étapes', script: 'Script (à copier-coller)', create: 'Créer', addr: 'Adresse fournie par l’autre outil', sendTest: 'Envoyer un message test',
    tested: (n: number) => (n >= 200 && n < 400 ? 'Livré.' : n ? `L’autre outil a répondu ${n}.` : 'Impossible de joindre cette adresse.'), linkReady: 'Votre lien est prêt. Les étapes ci-dessous l’utilisent.', needsLocation: 'Choisissez d’abord un emplacement.',
    newRecords: 'Nouveaux dossiers', reached: 'Arrivés à une étape', dueTasks: 'Tâches à échéance', overdue: 'en retard', nothing: 'Rien pour cette période.', period: (n: number) => `${n} derniers jours`, mine: 'Mes tâches', everyone: 'Tâches de tous',
    weekHelp: 'Ce qui a changé dans ce pipeline et ce qui est dû. Une version hebdomadaire peut être envoyée à Zapier ou un autre outil depuis l’onglet Recettes.', events: { 'box.created': 'création', 'box.stage_changed': 'changement d’étape', 'digest.weekly': 'résumé hebdomadaire' } as Record<string, string>,
    transferHelp: 'Entrez et sortez des données. Les fichiers s’ouvrent dans Google Sheets, Excel et autres.', exportBoxes: 'Exporter les dossiers (CSV)', exportContacts: 'Exporter les contacts (CSV)', importRecords: 'Importer des dossiers…', openSheets: 'Ouvrir Google Sheets', sheetsTip: 'Dans Google Sheets : Fichier → Importer → Téléverser, puis choisissez le fichier.', exporting: 'Préparation…',
    connected: 'Connecté', none: 'Rien de connecté pour l’instant.',
  },
};

/** Streak-style "Integrations & Automation": ways data comes in and goes out, plus a shortcut to stage automations. */
export function IntegrationsPanel({ pipeline, call, t, locale, onAutomations, onExport, onImport, onOpenBox, onClose }: { pipeline: Pipeline; call: Call; t: Strings; locale: Locale; onAutomations: () => void; onExport: () => void; onImport: () => void; onOpenBox: (id: string) => void; onClose: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const P = `/v1/pipelines/${pipeline.id}`;
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]);
  const [loc, setLoc] = useState('');
  const [err, setErr] = useState('');
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [hookName, setHookName] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => { call('GET', `${P}/intakes`).then((r) => setIntakes(r.intakes), () => undefined); call('GET', `${P}/webhooks`).then((r) => setHooks(r.webhooks), () => undefined); }, [call, P, tick]);
  useEffect(() => { call('GET', '/v1/org/contexts').then((r) => { const l = (r.locations ?? []) as { id: string; name: string }[]; setLocs(l); if (l.length === 1) setLoc(l[0]!.id); }, () => undefined); }, [call]);
  const act = async (fn: () => Promise<void>) => { setErr(''); try { await fn(); setTick((n) => n + 1); } catch (e) { setErr((e as Error).message); } };
  const needLoc = locs.length > 1 && !loc;
  const locBody = loc ? { contextNodeId: loc } : {};
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the text stays selectable */ } };
  const when = (v: string | null) => (v ? new Date(v).toLocaleString(locale) : t.never);
  const stageName = (id: string) => pipeline.stages.find((s) => s.id === id)?.name ?? '…';

  const x = X[locale];
  const [tab, setTab] = useState(0);
  const [group, setGroup] = useState<Group>('forms');
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [made, setMade] = useState<{ link?: string; hookId?: string } | null>(null);
  const [rUrl, setRUrl] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState(7);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [digest, setDigest] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (tab !== 2) return; call('GET', `${P}/digest?days=${days}&tasks=${scope}`).then(setDigest, (e) => setErr((e as Error).message)); }, [call, P, tab, days, scope]);
  const pick = (r: Recipe | null) => { setRecipe(r); setMade(null); setRUrl(''); setNote(''); };
  const makeInbound = (r: Recipe) => act(async () => {
    const res = await call('POST', `${P}/intakes`, { kind: 'webhook', name: r.title[locale].slice(0, 120), stageId, ...locBody });
    setMade({ link: res.url });
  });
  const makeOutbound = (r: Recipe) => act(async () => {
    const res = await call('POST', `${P}/webhooks`, { url: rUrl.trim(), events: r.events });
    setMade({ hookId: res.id }); setSecret({ label: t.signingSecret, value: res.secret });
  });
  const sendTest = (hookId: string, event?: string) => act(async () => {
    const r = await call('POST', `${P}/webhooks/${hookId}/test`, event ? { event } : {});
    setNote(x.tested(r.status));
  });
  const csvEsc = (v: unknown) => { let q = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(q)) q = `'${q}`; return /[",\n\r]/.test(q) ? `"${q.replace(/"/g, '""')}"` : q; };
  const exportContacts = () => act(async () => {
    setBusy(true);
    try {
      const all: any[] = [];
      for (let off = 0; off < 50000; off += 200) { const r = await call('GET', `/v1/contacts?limit=200&offset=${off}`); all.push(...r.contacts); if (r.contacts.length < 200) break; }
      const rows = [['Name', 'Email', 'Phone'].map(csvEsc).join(',')];
      for (const c of all) rows.push([c.fullName, c.email, c.phone].map(csvEsc).join(','));
      const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click(); URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  });

  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={t.integrations}>
      <h2>{t.integrations}</h2>
      {err && <div class="err" role="alert">{err}</div>}
      {secret && (
        <div class="secretbox" role="status">
          <b>{secret.label}</b>
          <code>{secret.value}</code>
          <div class="actions"><button class="btn" onClick={() => void copy(secret.value)}>{copied ? t.copied : t.copy}</button><button class="btn quiet" onClick={() => setSecret(null)}>{t.done}</button></div>
          <small>{t.shownOnce}</small>
        </div>
      )}
      {locs.length > 1 && (
        <>
          <label for="il">{t.location}</label>
          <select id="il" value={loc} onChange={(e) => setLoc((e.target as HTMLSelectElement).value)}><option value="">{t.chooseLocation}</option>{locs.map((l) => <option value={l.id}>{l.name}</option>)}</select>
        </>
      )}

      <div class="seg itabs" role="tablist">{x.tabs.map((n, i) => <button role="tab" aria-selected={tab === i} aria-pressed={tab === i} onClick={() => setTab(i)}>{n}</button>)}</div>

      {tab === 0 && !recipe && (
        <>
          <div class="gchips">{GROUPS.map((g) => <button class="gchip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>{g.title[locale]}</button>)}</div>
          <button class="rcard" onClick={onAutomations}><b>{t.automateTasks}</b><span>{t.automationsHelp}</span><em class="rbadge">Direct</em></button>
          {RECIPES.filter((r) => r.group === group).map((r) => (
            <button class="rcard" key={r.id} onClick={() => pick(r)}><b>{r.title[locale]}</b><span>{r.about[locale]}</span><em class={`rbadge ${r.badge.toLowerCase()}`}>{r.badge}</em></button>
          ))}
        </>
      )}
      {tab === 0 && recipe && (
        <section class="icard">
          <button class="btn quiet" onClick={() => pick(null)}>← {x.back}</button>
          <h3>{recipe.title[locale]} <em class={`rbadge ${recipe.badge.toLowerCase()}`}>{recipe.badge}</em></h3>
          <p class="muted">{recipe.about[locale]}</p>
          {recipe.kind === 'inbound' && !made && (
            <div class="erow wrap2">
              <select aria-label={t.stage} value={stageId} onChange={(e) => setStageId((e.target as HTMLSelectElement).value)}>{pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}</select>
              <button class="btn" disabled={needLoc} onClick={() => void makeInbound(recipe)}>{t.createLink}</button>
              {needLoc && <small class="muted">{x.needsLocation}</small>}
            </div>
          )}
          {recipe.kind === 'inbound' && made?.link && (
            <div class="secretbox" role="status"><b>{t.hookLink}</b><code>{made.link}</code><div class="actions"><button class="btn" onClick={() => void copy(made.link!)}>{copied ? t.copied : t.copy}</button></div><small>{t.shownOnce}</small></div>
          )}
          {recipe.kind === 'outbound' && !made && (
            <form class="erow wrap2" onSubmit={(e) => { e.preventDefault(); if (rUrl.trim()) void makeOutbound(recipe); }}>
              <input type="url" placeholder="https://hooks.zapier.com/…" aria-label={x.addr} value={rUrl} onInput={(e) => setRUrl((e.target as HTMLInputElement).value)} />
              <button class="btn" disabled={!rUrl.trim()}>{x.create}</button>
            </form>
          )}
          {recipe.kind === 'outbound' && made?.hookId && (
            <div class="erow wrap2"><b>{x.connected}</b><button class="btn quiet" onClick={() => void sendTest(made.hookId!, recipe.events?.[0])}>{x.sendTest}</button>{note && <span role="status">{note}</span>}</div>
          )}
          <h4>{x.steps}</h4>
          <ol class="isteps">{recipe.steps[locale].map((st) => <li>{st}</li>)}</ol>
          {recipe.script && (
            <>
              <h4>{x.script}</h4>
              <pre class="sample">{recipe.script(made?.link ?? '<your link>')}</pre>
              <button class="btn quiet" onClick={() => void copy(recipe.script!(made?.link ?? '<your link>'))}>{copied ? t.copied : t.copy}</button>
            </>
          )}
        </section>
      )}

      {tab === 1 && <>
      <section class="icard">
        <h3>{t.captureForms}</h3>
        <p class="muted">{t.captureFormsHelp}</p>
        {intakes.filter((i) => i.kind === 'form').map((i) => (
          <div class="erow" key={i.id}><span class={i.active ? '' : 'strike'}>{i.name} <small class="muted">→ {stageName(i.stageId)} · {t.uses(i.uses)} · …{i.tokenPrefix}</small></span><span class="spacer" />
            <button class="ib" aria-label={i.active ? t.pause : t.resume} onClick={() => void act(() => call('PATCH', `${P}/intakes/${i.id}`, { active: !i.active }))}>{i.active ? '⏸' : '▶'}</button>
            <button class="ib danger" aria-label={t.remove} onClick={() => { if (confirm(t.confirmRemoveLink)) void act(() => call('DELETE', `${P}/intakes/${i.id}`)); }}>✕</button></div>
        ))}
        <form class="erow wrap2" onSubmit={(e) => {
          e.preventDefault(); if (!name.trim() || needLoc) return;
          void act(async () => { const r = await call('POST', `${P}/intakes`, { kind: 'form', name: name.trim(), stageId, ...(title.trim() ? { title: title.trim() } : {}), ...(intro.trim() ? { intro: intro.trim() } : {}), ...locBody }); setSecret({ label: t.formLink, value: r.url }); setName(''); setTitle(''); setIntro(''); });
        }}>
          <input placeholder={t.formName} aria-label={t.formName} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <input placeholder={t.formTitle} aria-label={t.formTitle} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <input placeholder={t.formIntro} aria-label={t.formIntro} value={intro} onInput={(e) => setIntro((e.target as HTMLInputElement).value)} />
          <select aria-label={t.stage} value={stageId} onChange={(e) => setStageId((e.target as HTMLSelectElement).value)}>{pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}</select>
          <button class="btn quiet" disabled={!name.trim() || needLoc}>{t.createForm}</button>
        </form>
      </section>

      <section class="icard">
        <h3>{t.connectApps}</h3>
        <p class="muted">{t.connectAppsHelp}</p>
        {intakes.filter((i) => i.kind === 'webhook').map((i) => (
          <div class="erow" key={i.id}><span class={i.active ? '' : 'strike'}>{i.name} <small class="muted">→ {stageName(i.stageId)} · {t.uses(i.uses)} · …{i.tokenPrefix}</small></span><span class="spacer" />
            <button class="ib" aria-label={i.active ? t.pause : t.resume} onClick={() => void act(() => call('PATCH', `${P}/intakes/${i.id}`, { active: !i.active }))}>{i.active ? '⏸' : '▶'}</button>
            <button class="ib danger" aria-label={t.remove} onClick={() => { if (confirm(t.confirmRemoveLink)) void act(() => call('DELETE', `${P}/intakes/${i.id}`)); }}>✕</button></div>
        ))}
        <form class="erow wrap2" onSubmit={(e) => {
          e.preventDefault(); if (!hookName.trim() || needLoc) return;
          void act(async () => { const r = await call('POST', `${P}/intakes`, { kind: 'webhook', name: hookName.trim(), stageId, ...locBody }); setSecret({ label: t.hookLink, value: r.url }); setHookName(''); });
        }}>
          <input placeholder={t.hookName} aria-label={t.hookName} value={hookName} onInput={(e) => setHookName((e.target as HTMLInputElement).value)} />
          <button class="btn quiet" disabled={!hookName.trim() || needLoc}>{t.createLink}</button>
        </form>
        <pre class="sample">{`POST <link>\n{"name":"Jane Roe","email":"jane@example.com","phone":"555-0100","value":1200,"note":"Wants a quote","custom":{"policy_no":"A-1"}}`}</pre>
      </section>

      <section class="icard">
        <h3>{t.sendApps}</h3>
        <p class="muted">{t.sendAppsHelp}</p>
        {hooks.map((h) => (
          <div class="erow" key={h.id}><span class={h.active ? '' : 'strike'}>{h.url} <small class="muted">{h.events.map((e) => x.events[e] ?? e).join(', ')} · {h.lastStatus == null ? t.neverSent : `${h.lastStatus || t.failed} · ${when(h.lastAt)}`}{!h.active ? ` · ${t.autoPaused}` : ''}</small></span><span class="spacer" />
            <button class="btn quiet" onClick={() => void sendTest(h.id, h.events[0])}>{x.sendTest}</button>
            <button class="ib danger" aria-label={t.remove} onClick={() => void act(() => call('DELETE', `${P}/webhooks/${h.id}`))}>✕</button></div>
        ))}
        <form class="erow wrap2" onSubmit={(e) => {
          e.preventDefault(); if (!hookUrl.trim()) return;
          void act(async () => { const r = await call('POST', `${P}/webhooks`, { url: hookUrl.trim() }); setSecret({ label: t.signingSecret, value: r.secret }); setHookUrl(''); });
        }}>
          <input type="url" placeholder="https://hooks.zapier.com/…" aria-label={t.webhookUrl} value={hookUrl} onInput={(e) => setHookUrl((e.target as HTMLInputElement).value)} />
          <button class="btn quiet" disabled={!hookUrl.trim()}>{t.addWebhook}</button>
        </form>
      </section>

      <section class="icard">
        <h3>{t.automateTasks}</h3>
        <p class="muted">{t.automationsHelp}</p>
        <button class="btn quiet" onClick={onAutomations}>{t.openAutomations}</button>
      </section>
      {note && <div role="status" class="muted">{note}</div>}
      <section class="icard soon">
        <h3>{t.comingSoon}</h3>
        <p class="muted">{t.soonList}</p>
      </section>
      </>}

      {tab === 2 && (
        <section class="icard">
          <h3>{x.period(days)}</h3>
          <p class="muted">{x.weekHelp}</p>
          <div class="erow wrap2">
            <select aria-label={x.period(days)} value={days} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}>{[7, 14, 30].map((n) => <option value={n}>{x.period(n)}</option>)}</select>
            <select aria-label={x.dueTasks} value={scope} onChange={(e) => setScope((e.target as HTMLSelectElement).value as 'mine' | 'all')}><option value="mine">{x.mine}</option><option value="all">{x.everyone}</option></select>
          </div>
          {digest && (
            <>
              <h4>{x.newRecords} ({digest.newBoxes.length})</h4>
              {digest.newBoxes.length === 0 && <p class="muted">{x.nothing}</p>}
              {digest.newBoxes.slice(0, 20).map((b) => <div class="erow" key={b.id}><button class="linkbtn" onClick={() => onOpenBox(b.id)}>{b.name}</button><span class="spacer" /><small class="muted">{b.stage}</small></div>)}
              <h4>{x.reached}</h4>
              {digest.reachedStage.length === 0 && <p class="muted">{x.nothing}</p>}
              {digest.reachedStage.map((g) => <div key={g.stage}><b>{g.stage}</b> <small class="muted">({g.boxes.length})</small><div>{g.boxes.slice(0, 15).map((b) => <button class="linkbtn pill" key={b.id} onClick={() => onOpenBox(b.id)}>{b.name}</button>)}</div></div>)}
              <h4>{x.dueTasks} ({digest.dueTasks.length})</h4>
              {digest.dueTasks.length === 0 && <p class="muted">{x.nothing}</p>}
              {digest.dueTasks.slice(0, 30).map((k) => <div class="erow" key={k.id}><span>{k.title}{k.boxName && <> · <button class="linkbtn" onClick={() => k.boxId && onOpenBox(k.boxId)}>{k.boxName}</button></>}</span><span class="spacer" /><small class={k.overdue ? 'bad' : 'muted'}>{new Date(k.dueAt).toLocaleDateString(locale)}{k.overdue ? ` · ${x.overdue}` : ''}{scope === 'all' && k.assignee ? ` · ${k.assignee}` : ''}</small></div>)}
            </>
          )}
        </section>
      )}

      {tab === 3 && (
        <section class="icard">
          <h3>{x.tabs[3]}</h3>
          <p class="muted">{x.transferHelp}</p>
          <div class="erow wrap2">
            <button class="btn" onClick={onExport}>{x.exportBoxes}</button>
            <button class="btn" disabled={busy} onClick={() => void exportContacts()}>{busy ? x.exporting : x.exportContacts}</button>
            <button class="btn quiet" onClick={onImport}>{x.importRecords}</button>
            <a class="btn quiet" href="https://sheets.new" target="_blank" rel="noopener noreferrer">{x.openSheets}</a>
          </div>
          <p class="muted">{x.sheetsTip}</p>
        </section>
      )}

      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
    </aside>
  );
}
