import { useDialogFocus } from './a11y.ts';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { Board } from './board.tsx';
import { ImportDialog } from './import.tsx';
import { NewPipeline, PipelineEditor } from './editor.tsx';
import { TrainingView } from './training.tsx';
import { ContactsView } from './contacts.tsx';
import { FilterBar } from './filterbar.tsx';
import { defaultSorts, emptyFilters, filterParams, hasFilters, migrateView, sortParam, type Filters, type GroupBy, type SortSpec } from './filters.ts';
import { strings, type Strings } from './i18n.ts';
import { ink, money, stageColor } from './theme.ts';
import type { Box, BoxEvent, FieldDef, HostOptions, Locale, Me, Pipeline, Scope, Stage } from './types.ts';

const PAGE = 100;
type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
class ApiErr extends Error { constructor(public status: number, m: string) { super(m); } }

export function App({ host }: { host: HostOptions }) {
  const [me, setMe] = useState<Me | 'out' | null>(null);
  const [error, setError] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const t = strings(locale);

  const call: Call = useCallback(async (method, path, body) => {
    const r = await host.transport(method, path, body);
    if (r.status >= 200 && r.status < 300) return r.json;
    throw new ApiErr(r.status, r.status === -1 ? t.reloadNeeded : r.status === 0 ? t.offline : (r.json?.error?.message ?? `Error ${r.status}`));
  }, [host, t.offline]);

  const boot = useCallback(async () => {
    setError(''); setMe(null);
    try {
      const m = (await call('GET', '/v1/me')) as Me;
      setLocale(m.user.locale === 'fr-CA' ? 'fr-CA' : 'en');
      setMe(m);
    } catch (e) {
      if (e instanceof ApiErr && e.status === 401) setMe('out'); else setError((e as Error).message);
    }
  }, [call]);
  useEffect(() => { void boot(); }, [boot]);

  if (error) return <div class="pii"><div class="err" role="alert">{error}</div><div class="msg"><button class="btn" onClick={boot}>{t.retry}</button></div></div>;
  if (!me) return <div class="pii"><div class="msg">{t.loading}</div></div>;
  if (me === 'out') return <div class="pii"><div class="msg"><p>{t.signedOut}</p><button class="btn" onClick={host.onSignIn}>{t.signIn}</button></div></div>;
  if (me.needsConsent) return <div class="pii"><div class="msg"><p>{t.needConsent}</p></div></div>;
  const canAuthor = (me as unknown as { isTenantAdmin?: boolean; roles?: { role: string }[] }).isTenantAdmin || ((me as unknown as { roles?: { role: string }[] }).roles ?? []).some((r) => ['admin', 'manager', 'trainer'].includes(r.role));
  return <Shell call={call} t={t} locale={locale} canAuthor={Boolean(canAuthor)} meEmail={me.user.email} />;
}

function Shell({ call, t, locale, canAuthor, meEmail }: { call: Call; t: Strings; locale: Locale; canAuthor: boolean; meEmail: string }) {
  const [tab, setTab] = useState<'crm' | 'contacts' | 'training'>(() => { try { const v = localStorage.getItem('pii.tab'); return v === 'training' || v === 'contacts' ? v : 'crm'; } catch { return 'crm'; } });
  const pick = (v: 'crm' | 'contacts' | 'training') => { setTab(v); try { localStorage.setItem('pii.tab', v); } catch { /* private window */ } };
  return (
    <div class="pii" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()} onKeyPress={(e) => e.stopPropagation()}>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'crm'} onClick={() => pick('crm')}>{t.tabPipelines}</button>
        <button role="tab" aria-selected={tab === 'contacts'} onClick={() => pick('contacts')}>{t.contacts}</button>
        <button role="tab" aria-selected={tab === 'training'} onClick={() => pick('training')}>{t.training}</button>
      </div>
      {tab === 'crm' ? <PipelineView call={call} t={t} locale={locale} meEmail={meEmail} /> : tab === 'contacts' ? <ContactsView call={call} t={t} /> : <TrainingView call={call} t={t} locale={locale} canAuthor={canAuthor} />}
    </div>
  );
}

function PipelineView({ call, t, locale, meEmail }: { call: Call; t: Strings; locale: Locale; meEmail: string }) {
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [pid, setPid] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sorts, setSorts] = useState<SortSpec[]>(defaultSorts);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [groups, setGroups] = useState<Record<string, { count: number; value: number }>>({});
  const [quickName, setQuickName] = useState('');
  const [quickStage, setQuickStage] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickLocs, setQuickLocs] = useState<{ id: string; name: string }[]>([]);
  const [quickLoc, setQuickLoc] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hideStart, setHideStart] = useState(() => { try { return localStorage.getItem('pii.start') === 'off'; } catch { return false; } });
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Record<string, { count: number; value: number }>>({});
  const [openId, setOpenId] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newPipe, setNewPipe] = useState(false);
  const [myTasks, setMyTasks] = useState<TaskRow[] | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<'table' | 'board'>(() => { try { return localStorage.getItem('pii.view') === 'board' ? 'board' : 'table'; } catch { return 'table'; } });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState('');
  const [people, setPeople] = useState<{ id: string; displayName: string | null; email: string }[]>([]);
  interface SavedView { name: string; scope: Scope; filters: Filters; sorts: SortSpec[]; groupBy: GroupBy; view: 'table' | 'board' }
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => { call('GET', '/v1/org/contexts').then((r) => { const l = (r.locations ?? []) as { id: string; name: string }[]; setQuickLocs(l); if (l.length === 1) setQuickLoc(l[0]!.id); }, () => undefined); }, [call]);
  useEffect(() => { call('GET', '/v1/users').then((r) => setPeople(r.users), () => undefined); }, [call]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(`pii.views.${pid}`) ?? '[]') as any[];
      setViews(raw.map((v) => ({ name: v.name, scope: v.scope ?? 'all', view: v.view ?? 'table', ...migrateView(v) })));
    } catch { setViews([]); }
  }, [pid]);

  useEffect(() => {
    call('GET', '/v1/pipelines').then((r) => {
      const list = r.pipelines as Pipeline[];
      setPipelines(list);
      setPid((cur) => cur || (list[0]?.id ?? ''));
    }, (e) => setError((e as Error).message));
  }, [call, tick]);

  useEffect(() => {
    call('GET', '/v1/tasks?mine=true&open=true&limit=200').then((r) => setDueCount((r.tasks as TaskRow[]).filter((k) => k.dueAt && new Date(k.dueAt) <= new Date()).length), () => undefined);
  }, [call, tick]);
  const openTasks = async () => { try { setMyTasks((await call('GET', '/v1/tasks?mine=true&open=true&limit=200')).tasks); } catch (e) { setError((e as Error).message); } };

  const pipeline = useMemo(() => pipelines?.find((p) => p.id === pid), [pipelines, pid]);

  const query = useCallback((offset: number) => {
    const p = new URLSearchParams(view === 'board'
      ? { pipelineId: pid, scope, sort: 'position', dir: 'asc', limit: '200', offset: String(offset) }
      : { pipelineId: pid, scope, sorts: sortParam(sorts, groupBy), limit: String(PAGE), offset: String(offset) });
    if (view === 'table' && groupBy !== 'none') p.set('groupBy', groupBy);
    filterParams(filters, p);
    return `/v1/boxes?${p}`;
  }, [pid, scope, sorts, groupBy, filters, view]);

  useEffect(() => {
    if (!pid) return;
    let live = true;
    setError('');
    Promise.all([call('GET', query(0)), call('GET', `/v1/pipelines/${pid}/summary?scope=${scope}`)]).then(
      ([b, s]) => {
        if (!live) return;
        setBoxes(b.boxes); setTotal(b.total);
        if (b.groups) setGroups(Object.fromEntries((b.groups as { key: string | null; count: number; value: number }[]).map((g) => [g.key ?? '', g])));
        setSummary(Object.fromEntries((s.stages as { stageId: string; count: number; value: number }[]).map((x) => [x.stageId, x])));
      },
      (e) => live && setError((e as Error).message),
    );
    return () => { live = false; };
  }, [call, pid, scope, query, tick]);

  const loadMore = async () => {
    try { const b = await call('GET', query(boxes.length)); setBoxes((cur) => [...cur, ...b.boxes]); } catch (e) { setError((e as Error).message); }
  };
  const refresh = () => setTick((n) => n + 1);
  const storeViews = (v: SavedView[]) => { setViews(v); try { localStorage.setItem(`pii.views.${pid}`, JSON.stringify(v)); } catch { /* private window */ } };
  const saveView = () => {
    const name = prompt(t.viewName)?.trim();
    if (!name) return;
    storeViews([...views.filter((v) => v.name !== name), { name, scope, filters, sorts, groupBy, view }]);
  };
  const applyView = (name: string) => {
    const v = views.find((x) => x.name === name);
    if (!v) return;
    setScope(v.scope); setFilters(v.filters); setSorts(v.sorts); setGroupBy(v.groupBy); setView(v.view);
  };
  const exportCsv = async () => {
    try {
      const all: Box[] = [];
      for (let off = 0; off < 20000; off += 200) {
        const p = filterParams(filters, new URLSearchParams({ pipelineId: pid, scope, sorts: 'name:asc', limit: '200', offset: String(off) }));
        const r = await call('GET', `/v1/boxes?${p}`);
        all.push(...r.boxes);
        if (all.length >= r.total || r.boxes.length === 0) break;
      }
      const stageName = new Map((pipeline?.stages ?? []).map((x) => [x.id, x.name]));
      const cols = pipeline?.fields ?? [];
      const esc = (v: unknown) => { let x = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(x)) x = `'${x}`; return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const rows = [[t.name, t.stage, t.value, t.closeDate, t.inStage, t.owner, t.lastEmail, t.lastEmailFrom, ...cols.map((f) => label(f, locale))].map(esc).join(',')];
      for (const b of all) rows.push([b.name, stageName.get(b.stageId), b.valueAmount, b.closeDate, b.daysInStage, b.ownerName, b.lastEmailAt?.slice(0, 10), b.lastEmailFrom, ...cols.map((f) => b.custom[f.key])].map(esc).join(','));
      const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `${pipeline?.name ?? 'pipeline'}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
  };
  const setViewSaved = (v: 'table' | 'board') => { setView(v); try { localStorage.setItem('pii.view', v); } catch { /* private window */ } };
  const move = async (id: string, stageId: string, position: number) => {
    // show the move at once, then confirm with the server
    setBoxes((cur) => cur.map((b) => (b.id === id ? { ...b, stageId, position } : b)));
    try { await call('PATCH', `/v1/boxes/${id}`, { stageId, position }); refresh(); } catch (e) { setError((e as Error).message); refresh(); }
  };
  const togglePick = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulkMove = async () => {
    if (!bulkStage) return;
    const ids = [...picked]; setPicked(new Set()); setBulkStage('');
    const failed: string[] = [];
    for (const id of ids) { try { await call('PATCH', `/v1/boxes/${id}`, { stageId: bulkStage }); } catch { failed.push(id); } }
    if (failed.length) setError(t.bulkFailed(failed.length));
    refresh();
  };

  if (error && !pipelines) return <div class="pii"><div class="err" role="alert">{error}</div></div>;
  if (!pipelines) return <div class="pii"><div class="msg">{t.loading}</div></div>;
  if (pipelines.length === 0) return <div class="pii"><div class="msg">{t.noPipelines}</div></div>;

  if (!pipeline) return <div class="pii"><div class="msg">{t.loading}</div></div>;
  const stages = pipeline.stages;
  const stageById = new Map(stages.map((s, i) => [s.id, { s, color: stageColor(pipeline!.colorTheme, s, i) }]));
  const headSort = (key: SortSpec['key']) => setSorts((cur) => {
    const f = cur.find((x) => x.key === key);
    return f ? [{ key, dir: f.dir === 'asc' ? 'desc' : 'asc' }] : [{ key, dir: key === 'name' ? 'asc' : 'desc' }];
  });
  const arrow = (key: SortSpec['key']) => { const f = sorts[0]?.key === key ? sorts[0] : undefined; return f ? (f.dir === 'asc' ? ' ▲' : ' ▼') : ''; };
  const ariaSort = (key: SortSpec['key']) => { const f = sorts[0]?.key === key ? sorts[0] : undefined; return f ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'; };
  const cur = boxes[0]?.currency ?? 'CAD';
  const opened = boxes.find((b) => b.id === openId);
  const filtering = hasFilters(filters);
  const onlyStage = filters.stageIds.length === 1 ? filters.stageIds[0] : '';
  const toggleStage = (id: string) => setFilters((f) => ({ ...f, stageIds: f.stageIds.length === 1 && f.stageIds[0] === id ? [] : [id] }));
  const groupKey = (b: Box) => (groupBy === 'stage' ? b.stageId : groupBy === 'owner' ? (b.ownerUserId ?? '') : '');
  const quickAdd = async (stageId: string, name: string) => {
    if (!name.trim()) return;
    setQuickBusy(true); setError('');
    try {
      await call('POST', '/v1/boxes', { pipelineId: pid, name: name.trim(), stageId, ...(quickLoc ? { contextNodeId: quickLoc } : {}) });
      setQuickName(''); refresh();
    } catch (e) { setError((e as Error).message); }
    setQuickBusy(false);
  };
  const quickStageId = quickStage || onlyStage || stages[0]?.id || '';
  const showStart = !hideStart && total === 0 && !filtering && boxes.length === 0;
  const colCount = 9 + pipeline.fields.length;

  return (
    <div class="pii" tabIndex={-1} onKeyUp={(e) => e.stopPropagation()} onKeyPress={(e) => e.stopPropagation()} onKeyDown={(e) => {
      // keep Gmail's own one-key shortcuts (c, e, #, …) from firing while the person works in PII
      e.stopPropagation();
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (e.key === 'Escape') { setOpenId(''); setCreating(false); setEditing(false); setImporting(false); setNewPipe(false); setMyTasks(null); setMenuOpen(false); return; }
      if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); refresh(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('.fin')?.focus(); }
      else if (e.key === 'n') { e.preventDefault(); setCreating(true); }
      else if (e.key === 'v') setViewSaved(view === 'table' ? 'board' : 'table');
    }}>
      <div class="bar">
        <h1>{pipeline?.name}</h1>
        {pipelines.length > 1 && (
          <select class="sel" aria-label={t.pipeline} value={pid} onChange={(e) => { setPid((e.target as HTMLSelectElement).value); setFilters(emptyFilters); setGroupBy('none'); }}>
            {pipelines.map((p) => <option value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div class="seg" role="group" aria-label="Scope">
          {(['all', 'mine', 'below'] as Scope[]).map((s) => <button aria-pressed={scope === s} onClick={() => setScope(s)}>{t[s]}</button>)}
        </div>
        <div class="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'table'} onClick={() => setViewSaved('table')}>{t.table}</button>
          <button aria-pressed={view === 'board'} onClick={() => setViewSaved('board')}>{t.board}</button>
        </div>
        <span class="spacer" />
        <button class="btn quiet" onClick={openTasks}>{t.myTasks}{dueCount > 0 && <span class="badge">{dueCount}</span>}</button>
        <div class="menuwrap">
          <button class="btn quiet" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>⋯ {t.moreActions}</button>
          {menuOpen && (
            <div class="kebab" role="menu" onClick={() => setMenuOpen(false)}>
              <button role="menuitem" onClick={refresh}>{t.refresh} <small>Alt+R</small></button>
              <button role="menuitem" onClick={() => setEditing(true)}>{t.editPipeline}</button>
              <button role="menuitem" onClick={() => setNewPipe(true)}>{t.newPipeline}</button>
              <button role="menuitem" onClick={() => setImporting(true)}>{t.import}</button>
              <button role="menuitem" onClick={exportCsv}>{t.exportCsv}</button>
            </div>
          )}
        </div>
        <button class="btn" onClick={() => setCreating(true)}>+ {t.newBox}</button>
      </div>

      <FilterBar t={t} pipeline={pipeline} people={people} meEmail={meEmail} filters={filters} onFilters={setFilters} sorts={sorts} onSorts={setSorts} groupBy={groupBy} onGroupBy={setGroupBy} />

      <div class="stages" role="group" aria-label={t.stage}>
        {stages.map((s, i) => {
          const sum = summary[s.id];
          const on = filters.stageIds.includes(s.id);
          return (
            <button class={`stagebtn${filters.stageIds.length && !on ? ' dim' : ''}`} style={{ background: stageById.get(s.id)!.color, color: ink(stageById.get(s.id)!.color) }} aria-pressed={on}
              onClick={() => toggleStage(s.id)} key={s.id}>
              <b>{s.name}</b>
              <span>{sum?.count ?? 0}{sum && sum.value > 0 ? ` · ${money(sum.value, cur, locale)}` : ''}</span>
            </button>
          );
        })}
      </div>
      <div class="meta">
        <span aria-live="polite">{t.rows(total)}</span>
        <select class="sel small" aria-label={t.views} value="" onChange={(e) => applyView((e.target as HTMLSelectElement).value)}>
          <option value="">{t.views}…</option>{views.map((v) => <option value={v.name}>{v.name}</option>)}
        </select>
        <button onClick={saveView}>{t.saveView}</button>
        {views.length > 0 && <button onClick={() => { const n = prompt(t.removeViewName)?.trim(); if (n) storeViews(views.filter((v) => v.name !== n)); }}>{t.removeView}</button>}
        <span class="spacer" /><small title={t.shortcuts}>⌨ {t.shortcuts}</small>
      </div>
      {picked.size > 0 && (
        <div class="bulk" role="region" aria-label={t.selected(picked.size)}>
          <b>{t.selected(picked.size)}</b>
          <select class="sel" aria-label={t.moveTo} value={bulkStage} onChange={(e) => setBulkStage((e.target as HTMLSelectElement).value)}>
            <option value="">{t.moveTo}…</option>{stages.map((s) => <option value={s.id}>{s.name}</option>)}
          </select>
          <button class="btn" disabled={!bulkStage} onClick={bulkMove}>{t.apply}</button>
          <button class="btn quiet" onClick={() => setPicked(new Set())}>{t.cancel}</button>
        </div>
      )}
      {error && <div class="err" role="alert">{error}</div>}

      <div class="root">
        {view === 'board' ? (
          <div class="wrap"><Board pipeline={pipeline!} boxes={boxes} summary={summary} t={t} locale={locale} onOpen={setOpenId} onMove={move} /></div>
        ) : (
        <div class="wrap">
          {showStart && (
            <div class="start" role="region" aria-label={t.gsTitle}>
              <h2>{t.gsTitle}</h2>
              <button onClick={() => setEditing(true)}><b>1</b> {t.gsStages}</button>
              <button onClick={() => setImporting(true)}><b>2</b> {t.gsImport}</button>
              <button onClick={() => setCreating(true)}><b>3</b> {t.gsAdd}</button>
              <button class="link" onClick={() => { setHideStart(true); try { localStorage.setItem('pii.start', 'off'); } catch { /* private window */ } }}>{t.gsDone}</button>
            </div>
          )}
          <form class="quick" onSubmit={(e) => { e.preventDefault(); void quickAdd(quickStageId, quickName); }}>
            <input aria-label={t.quickAdd} placeholder={t.quickAdd} maxLength={200} value={quickName} disabled={quickBusy} onInput={(e) => setQuickName((e.target as HTMLInputElement).value)} />
            <select aria-label={t.stage} value={quickStageId} onChange={(e) => setQuickStage((e.target as HTMLSelectElement).value)}>{stages.map((s) => <option value={s.id}>{s.name}</option>)}</select>
            {quickLocs.length > 1 && <select aria-label={t.location} value={quickLoc} onChange={(e) => setQuickLoc((e.target as HTMLSelectElement).value)}><option value="">{t.chooseLocation}</option>{quickLocs.map((l) => <option value={l.id}>{l.name}</option>)}</select>}
            <button class="btn" disabled={quickBusy || !quickName.trim() || (quickLocs.length > 1 && !quickLoc)}>{t.addHere}</button>
          </form>
          {boxes.length === 0 ? (!showStart && <div class="msg">{t.empty}</div>) : (
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label={t.selectAll} checked={boxes.length > 0 && picked.size === boxes.length} onChange={(e) => setPicked((e.target as HTMLInputElement).checked ? new Set(boxes.map((b) => b.id)) : new Set())} /></th>
                  <th aria-sort={ariaSort('name')}><button onClick={() => headSort('name')}>{t.name}{arrow('name')}</button></th>
                  <th>{t.stage}</th>
                  <th>{t.owner}</th>
                  <th aria-sort={ariaSort('value')}><button onClick={() => headSort('value')}>{t.value}{arrow('value')}</button></th>
                  <th aria-sort={ariaSort('closeDate')}><button onClick={() => headSort('closeDate')}>{t.closeDate}{arrow('closeDate')}</button></th>
                  <th aria-sort={ariaSort('daysInStage')}><button onClick={() => headSort('daysInStage')}>{t.inStage}{arrow('daysInStage')}</button></th>
                  <th aria-sort={ariaSort('lastEmail')}><button onClick={() => headSort('lastEmail')}>{t.lastEmail}{arrow('lastEmail')}</button></th>
                  <th>{t.lastEmailFrom}</th>
                  {pipeline!.fields.map((f) => <th>{label(f, locale)}</th>)}
                </tr>
              </thead>
              <tbody>
                {boxes.map((b, i) => {
                  const st = stageById.get(b.stageId);
                  const gk = groupKey(b);
                  const header = groupBy !== 'none' && (i === 0 || groupKey(boxes[i - 1]!) !== gk);
                  const g = groups[gk];
                  const gColor = groupBy === 'stage' ? stageById.get(gk)?.color : '#6b7280';
                  const gName = groupBy === 'stage' ? (stageById.get(gk)?.s.name ?? '') : (b.ownerName ?? t.noOwner);
                  const hidden = groupBy !== 'none' && collapsed.has(gk);
                  return (
                    <>
                      {header && (
                        <tr class="ghead" key={`h-${gk}`}>
                          <td colSpan={colCount}>
                            <button class="gtoggle" aria-expanded={!collapsed.has(gk)} onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(gk)) n.delete(gk); else n.add(gk); return n; })}>
                              <i style={{ background: gColor }} />{collapsed.has(gk) ? '▸' : '▾'} <b>{gName}</b>
                              <span class="muted"> {g ? t.rows(g.count) : ''}{g && g.value > 0 ? ` · ${money(g.value, cur, locale)}` : ''}</span>
                            </button>
                            {groupBy === 'stage' && <button class="gadd" aria-label={t.addToGroup(gName)} onClick={(e) => { setQuickStage(gk); ((e.currentTarget as HTMLElement).closest('.wrap')?.querySelector('.quick input') as HTMLInputElement | null)?.focus(); }}>+ {t.addHere}</button>}
                          </td>
                        </tr>
                      )}
                      {!hidden && (
                    <tr class="row" tabIndex={0} key={b.id} onClick={() => setOpenId(b.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(b.id); else if (e.key === ' ' && e.target === e.currentTarget) { e.preventDefault(); togglePick(b.id); } }}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={b.name} checked={picked.has(b.id)} onChange={() => togglePick(b.id)} /></td>
                      <td class="name">{b.name}</td>
                      <td>{st && <span class="pill" style={{ background: st.color, color: ink(st.color) }}>{st.s.name}</span>}</td>
                      <td>{b.ownerName ?? ''}</td>
                      <td>{money(b.valueAmount, b.currency, locale)}</td>
                      <td>{b.closeDate ?? ''}</td>
                      <td><span class={`age${b.daysInStage >= 30 ? ' bad' : b.daysInStage >= 14 ? ' warn' : ''}`}>{b.daysInStage === 0 ? t.today : t.days(b.daysInStage)}</span></td>
                      <td>{b.lastEmailAt ? new Date(b.lastEmailAt).toLocaleDateString(locale) : ''}</td>
                      <td>{b.lastEmailFrom ?? ''}</td>
                      {pipeline!.fields.map((f) => <td>{cell(b.custom[f.key])}</td>)}
                    </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
          {boxes.length < total && <div class="msg"><button class="btn quiet" onClick={loadMore}>{t.loadMore}</button></div>}
        </div>
        )}
        {opened && pipeline && <Drawer key={opened.id} box={opened} pipeline={pipeline} call={call} t={t} locale={locale} onClose={() => setOpenId('')} onChanged={refresh} />}
        {myTasks && (
          <aside ref={(el) => el?.focus()} tabIndex={-1} class="drawer" role="dialog" aria-label={t.myTasks}>
            <h2>{t.myTasks}</h2>
            {myTasks.length === 0 && <p class="muted">{t.noTasks}</p>}
            {myTasks.map((k) => (
              <label class="task" key={k.id}>
                <input type="checkbox" onChange={async () => { try { await call('PATCH', `/v1/tasks/${k.id}`, { done: true }); setMyTasks((cur) => cur && cur.filter((x) => x.id !== k.id)); refresh(); } catch (e) { setError((e as Error).message); } }} />
                <span>{k.title}<small class={k.dueAt && new Date(k.dueAt) < new Date() ? 'overdue' : ''}>{k.dueAt ? ` · ${new Date(k.dueAt).toLocaleDateString(locale)}` : ''}</small><small class="muted"> {k.boxName}</small></span>
              </label>
            ))}
            <div class="actions"><button class="btn quiet" onClick={() => setMyTasks(null)}>{t.close}</button></div>
          </aside>
        )}
        {editing && pipeline && <PipelineEditor pipeline={pipeline} call={call} t={t} locale={locale} onClose={() => setEditing(false)} onChanged={refresh} />}
        {newPipe && <NewPipeline call={call} t={t} locale={locale} onClose={() => setNewPipe(false)} onCreated={(id) => { setNewPipe(false); setPid(id); setFilters(emptyFilters); refresh(); }} />}
        {importing && pipeline && <ImportDialog pipeline={pipeline} call={call} t={t} onClose={() => setImporting(false)} onDone={refresh} />}
        {creating && pipeline && <Create pipeline={pipeline} call={call} t={t} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refresh(); }} />}
      </div>
    </div>
  );
}

interface TaskRow { id: string; boxId: string; boxName: string | null; title: string; dueAt: string | null; doneAt: string | null }
const label = (f: FieldDef, locale: Locale) => f.labels[locale] ?? f.labels.en ?? f.key;
const cell = (v: unknown) => (v == null ? '' : typeof v === 'boolean' ? (v ? '✓' : '') : String(v));

function Drawer({ box, pipeline, call, t, locale, onClose, onChanged }: { box: Box; pipeline: Pipeline; call: Call; t: Strings; locale: Locale; onClose: () => void; onChanged: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [events, setEvents] = useState<BoxEvent[]>([]);
  const [canEdit, setCanEdit] = useState(true);
  const [contacts, setContacts] = useState<{ id: string; fullName: string | null; email: string | null }[]>([]);
  const [notes, setNotes] = useState<{ id: string; authorName: string | null; body: string; createdAt: string }[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [noteText, setNoteText] = useState('');
  const [taskText, setTaskText] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [reload, setReload] = useState(0);
  const [stageId, setStageId] = useState(box.stageId);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    call('GET', `/v1/boxes/${box.id}/events`).then((r) => setEvents(r.events), () => undefined);
    call('GET', `/v1/boxes/${box.id}`).then((r) => { setCanEdit(Boolean(r.canEdit)); setContacts(r.contacts ?? []); }, () => undefined);
    call('GET', `/v1/boxes/${box.id}/notes`).then((r) => setNotes(r.notes), () => undefined);
    call('GET', `/v1/tasks?boxId=${box.id}`).then((r) => setTasks(r.tasks), () => undefined);
  }, [call, box.id, msg, reload]);
  const addNote = async (e: Event) => { e.preventDefault(); const b = noteText.trim(); if (!b) return; setNoteText(''); try { await call('POST', `/v1/boxes/${box.id}/notes`, { body: b }); setReload((n) => n + 1); } catch (x) { setErr((x as Error).message); } };
  const addTask = async (e: Event) => {
    e.preventDefault(); const title = taskText.trim(); if (!title) return;
    const due = taskDue ? new Date(`${taskDue}T09:00:00`).toISOString() : undefined;
    setTaskText(''); setTaskDue('');
    try { await call('POST', `/v1/boxes/${box.id}/tasks`, { title, ...(due ? { dueAt: due } : {}) }); setReload((n) => n + 1); } catch (x) { setErr((x as Error).message); }
  };
  const toggleTask = async (id: string, done: boolean) => { try { await call('PATCH', `/v1/tasks/${id}`, { done }); setReload((n) => n + 1); } catch (x) { setErr((x as Error).message); } };
  const move = async (id: string) => {
    setStageId(id); setErr(''); setMsg('');
    try { await call('PATCH', `/v1/boxes/${box.id}`, { stageId: id }); setMsg(t.saved); onChanged(); } catch (e) { setErr((e as Error).message); setStageId(box.stageId); }
  };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer" role="dialog" aria-label={box.name}>
      <h2>{box.name}</h2>
      {!canEdit && <p class="muted">{t.readOnly}</p>}
      <label for="stg">{t.stage}</label>
      <select id="stg" value={stageId} disabled={!canEdit} onChange={(e) => void move((e.target as HTMLSelectElement).value)}>
        {pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}
      </select>
      {msg && <div class="ok" role="status">{msg}</div>}{err && <div class="err" role="alert">{err}</div>}
      <dl class="kv">
        <dt>{t.value}</dt><dd>{money(box.valueAmount, box.currency, locale)}</dd>
        <dt>{t.closeDate}</dt><dd>{box.closeDate ?? ''}</dd>
        {pipeline.fields.map((f) => <><dt>{label(f, locale)}</dt><dd>{cell(box.custom[f.key])}</dd></>)}
      </dl>
      {contacts.length > 0 && <><h3>{t.contacts}</h3>{contacts.map((c) => <div class="ev" key={c.id}>{c.fullName ?? c.email}<small>{c.fullName ? c.email : ''}</small></div>)}</>}
      <h3>{t.tasks}</h3>
      {tasks.map((k) => (
        <label class="task" key={k.id}>
          <input type="checkbox" checked={Boolean(k.doneAt)} onChange={(e) => void toggleTask(k.id, (e.target as HTMLInputElement).checked)} />
          <span class={k.doneAt ? 'strike' : ''}>{k.title}{k.dueAt && <small class={!k.doneAt && new Date(k.dueAt) < new Date() ? 'overdue' : ''}> · {new Date(k.dueAt).toLocaleDateString(locale)}</small>}</span>
        </label>
      ))}
      <form class="erow" onSubmit={addTask}>
        <input placeholder={t.addTask} aria-label={t.addTask} value={taskText} onInput={(e) => setTaskText((e.target as HTMLInputElement).value)} />
        <input type="date" aria-label={t.dueDate} value={taskDue} onInput={(e) => setTaskDue((e.target as HTMLInputElement).value)} style={{ flex: '0 0 140px' }} />
        <button class="btn quiet" disabled={!taskText.trim()}>+</button>
      </form>
      <h3>{t.notes}</h3>
      <form onSubmit={addNote}>
        <textarea rows={3} placeholder={t.addNote} aria-label={t.addNote} value={noteText} onInput={(e) => setNoteText((e.target as HTMLTextAreaElement).value)} />
        <div class="actions"><button class="btn quiet" disabled={!noteText.trim()}>{t.addNote}</button></div>
      </form>
      {notes.map((n) => <div class="ev" key={n.id}>{n.body}<small>{n.authorName ?? ''} · {new Date(n.createdAt).toLocaleString(locale)}</small></div>)}
      <h3>{t.history}</h3>
      {events.map((e) => (
        <div class="ev" key={e.id}>
          {e.kind === 'created' ? `${t.created} ${e.toStage ?? '—'}` : t.movedTo(e.fromStage, e.toStage)}
          <small>{new Date(e.createdAt).toLocaleString(locale)}</small>
        </div>
      ))}
      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
    </aside>
  );
}

function Create({ pipeline, call, t, onClose, onCreated }: { pipeline: Pipeline; call: Call; t: Strings; onClose: () => void; onCreated: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [name, setName] = useState('');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]);
  const [loc, setLoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    call('GET', '/v1/org/contexts').then((r) => {
      const l = (r.locations ?? []) as { id: string; name: string }[];
      setLocs(l); if (l.length === 1) setLoc(l[0]!.id);
    }, () => undefined);
  }, [call]);
  const submit = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call('POST', '/v1/boxes', {
        pipelineId: pipeline.id, name: name.trim(), stageId,
        ...(value ? { valueAmount: Number(value) } : {}), ...(loc ? { contextNodeId: loc } : {}),
      });
      onCreated();
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer" role="dialog" aria-label={t.newBox}>
      <h2>{t.newBox}</h2>
      <form onSubmit={submit}>
        <label for="nm">{t.name}</label>
        <input id="nm" required maxLength={200} placeholder={t.newPlaceholder} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autofocus />
        <label for="sg">{t.stage}</label>
        <select id="sg" value={stageId} onChange={(e) => setStageId((e.target as HTMLSelectElement).value)}>{pipeline.stages.map((s: Stage) => <option value={s.id}>{s.name}</option>)}</select>
        <label for="vl">{t.value}</label>
        <input id="vl" type="number" min="0" step="0.01" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
        {locs.length > 1 && (
          <>
            <label for="lc">{t.location}</label>
            <select id="lc" required value={loc} onChange={(e) => setLoc((e.target as HTMLSelectElement).value)}>
              <option value="">{t.chooseLocation}</option>{locs.map((l) => <option value={l.id}>{l.name}</option>)}
            </select>
          </>
        )}
        {err && <div class="err" role="alert">{err}</div>}
        <div class="actions"><button class="btn" disabled={busy || !name.trim()}>{t.create}</button><button type="button" class="btn quiet" onClick={onClose}>{t.cancel}</button></div>
      </form>
    </aside>
  );
}
