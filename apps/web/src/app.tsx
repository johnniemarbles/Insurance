import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { Board } from './board.tsx';
import { ImportDialog } from './import.tsx';
import { NewPipeline, PipelineEditor } from './editor.tsx';
import { TrainingView } from './training.tsx';
import { strings, type Strings } from './i18n.ts';
import { money, stageColor } from './theme.ts';
import type { Box, BoxEvent, FieldDef, HostOptions, Locale, Me, Pipeline, Scope, SortKey, Stage } from './types.ts';

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

  if (error) return <div class="pii"><div class="err">{error}</div><div class="msg"><button class="btn" onClick={boot}>{t.retry}</button></div></div>;
  if (!me) return <div class="pii"><div class="msg">{t.loading}</div></div>;
  if (me === 'out') return <div class="pii"><div class="msg"><p>{t.signedOut}</p><button class="btn" onClick={host.onSignIn}>{t.signIn}</button></div></div>;
  if (me.needsConsent) return <div class="pii"><div class="msg"><p>{t.needConsent}</p></div></div>;
  const canAuthor = (me as unknown as { isTenantAdmin?: boolean; roles?: { role: string }[] }).isTenantAdmin || ((me as unknown as { roles?: { role: string }[] }).roles ?? []).some((r) => ['admin', 'manager', 'trainer'].includes(r.role));
  return <Shell call={call} t={t} locale={locale} canAuthor={Boolean(canAuthor)} />;
}

function Shell({ call, t, locale, canAuthor }: { call: Call; t: Strings; locale: Locale; canAuthor: boolean }) {
  const [tab, setTab] = useState<'crm' | 'training'>(() => { try { return localStorage.getItem('pii.tab') === 'training' ? 'training' : 'crm'; } catch { return 'crm'; } });
  const pick = (v: 'crm' | 'training') => { setTab(v); try { localStorage.setItem('pii.tab', v); } catch { /* private window */ } };
  return (
    <div class="pii" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()} onKeyPress={(e) => e.stopPropagation()}>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'crm'} onClick={() => pick('crm')}>{t.tabPipelines}</button>
        <button role="tab" aria-selected={tab === 'training'} onClick={() => pick('training')}>{t.training}</button>
      </div>
      {tab === 'crm' ? <PipelineView call={call} t={t} locale={locale} /> : <TrainingView call={call} t={t} locale={locale} canAuthor={canAuthor} />}
    </div>
  );
}

function PipelineView({ call, t, locale }: { call: Call; t: Strings; locale: Locale }) {
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [pid, setPid] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [stageFilter, setStageFilter] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updated', dir: 'desc' });
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
  useEffect(() => { const h = setTimeout(() => setDebouncedQ(q), 250); return () => clearTimeout(h); }, [q]);

  const pipeline = useMemo(() => pipelines?.find((p) => p.id === pid), [pipelines, pid]);

  const query = useCallback((offset: number) => {
    const p = new URLSearchParams(view === 'board'
      ? { pipelineId: pid, scope, sort: 'position', dir: 'asc', limit: '200', offset: String(offset) }
      : { pipelineId: pid, scope, sort: sort.key, dir: sort.dir, limit: String(PAGE), offset: String(offset) });
    if (stageFilter) p.set('stageId', stageFilter);
    if (debouncedQ) p.set('q', debouncedQ);
    return `/v1/boxes?${p}`;
  }, [pid, scope, sort, stageFilter, debouncedQ, view]);

  useEffect(() => {
    if (!pid) return;
    let live = true;
    setError('');
    Promise.all([call('GET', query(0)), call('GET', `/v1/pipelines/${pid}/summary?scope=${scope}`)]).then(
      ([b, s]) => {
        if (!live) return;
        setBoxes(b.boxes); setTotal(b.total);
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

  if (error && !pipelines) return <div class="pii"><div class="err">{error}</div></div>;
  if (!pipelines) return <div class="pii"><div class="msg">{t.loading}</div></div>;
  if (pipelines.length === 0) return <div class="pii"><div class="msg">{t.noPipelines}</div></div>;

  if (!pipeline) return <div class="pii"><div class="msg">{t.loading}</div></div>;
  const stages = pipeline.stages;
  const stageById = new Map(stages.map((s, i) => [s.id, { s, color: stageColor(pipeline!.colorTheme, s, i) }]));
  const sortBy = (key: SortKey) => setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const cur = boxes[0]?.currency ?? 'CAD';
  const opened = boxes.find((b) => b.id === openId);

  return (
    <div class="pii" tabIndex={-1} onKeyUp={(e) => e.stopPropagation()} onKeyPress={(e) => e.stopPropagation()} onKeyDown={(e) => {
      // keep Gmail's own one-key shortcuts (c, e, #, …) from firing while the person works in PII
      e.stopPropagation();
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (e.key === 'Escape') { setOpenId(''); setCreating(false); setEditing(false); setImporting(false); setNewPipe(false); setMyTasks(null); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('.search')?.focus(); }
      else if (e.key === 'n') { e.preventDefault(); setCreating(true); }
      else if (e.key === 'v') setViewSaved(view === 'table' ? 'board' : 'table');
    }}>
      <div class="bar">
        <h1>{pipeline?.name}</h1>
        {pipelines.length > 1 && (
          <select class="sel" aria-label={t.pipeline} value={pid} onChange={(e) => { setPid((e.target as HTMLSelectElement).value); setStageFilter(''); }}>
            {pipelines.map((p) => <option value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div class="seg" role="group" aria-label="Scope">
          {(['all', 'mine', 'below'] as Scope[]).map((s) => <button aria-pressed={scope === s} onClick={() => setScope(s)}>{t[s]}</button>)}
        </div>
        <input class="search" type="search" placeholder={t.search} aria-label={t.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <div class="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'table'} onClick={() => setViewSaved('table')}>{t.table}</button>
          <button aria-pressed={view === 'board'} onClick={() => setViewSaved('board')}>{t.board}</button>
        </div>
        <span class="spacer" />
        <button class="btn quiet" onClick={openTasks}>{t.myTasks}{dueCount > 0 && <span class="badge">{dueCount}</span>}</button>
        <button class="btn quiet" onClick={() => setEditing(true)}>{t.edit}</button>
        <button class="btn quiet" onClick={() => setNewPipe(true)}>{t.newPipeline}</button>
        <button class="btn quiet" onClick={() => setImporting(true)}>{t.import}</button>
        <button class="btn" onClick={() => setCreating(true)}>+ {t.newBox}</button>
      </div>

      <div class="stages" role="group" aria-label={t.stage}>
        {stages.map((s, i) => {
          const sum = summary[s.id];
          const on = stageFilter === s.id;
          return (
            <button class={`stagebtn${stageFilter && !on ? ' dim' : ''}`} style={{ background: stageById.get(s.id)!.color }} aria-pressed={on}
              onClick={() => setStageFilter(on ? '' : s.id)} key={s.id}>
              <b>{s.name}</b>
              <span>{sum?.count ?? 0}{sum && sum.value > 0 ? ` · ${money(sum.value, cur, locale)}` : ''}</span>
            </button>
          );
        })}
      </div>
      <div class="meta">
        <span>{t.rows(total)}</span>
        <span class="spacer" /><small title={t.shortcuts}>⌨ {t.shortcuts}</small>
        {stageFilter && <button onClick={() => setStageFilter('')}>{t.clearFilter}</button>}
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
      {error && <div class="err">{error}</div>}

      <div class="root">
        {view === 'board' ? (
          <div class="wrap"><Board pipeline={pipeline!} boxes={boxes} summary={summary} t={t} locale={locale} onOpen={setOpenId} onMove={move} /></div>
        ) : (
        <div class="wrap">
          {boxes.length === 0 ? <div class="msg">{t.empty}</div> : (
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label={t.selectAll} checked={boxes.length > 0 && picked.size === boxes.length} onChange={(e) => setPicked((e.target as HTMLInputElement).checked ? new Set(boxes.map((b) => b.id)) : new Set())} /></th>
                  <th aria-sort={ariaSort('name')}><button onClick={() => sortBy('name')}>{t.name}{arrow('name')}</button></th>
                  <th>{t.stage}</th>
                  <th aria-sort={ariaSort('value')}><button onClick={() => sortBy('value')}>{t.value}{arrow('value')}</button></th>
                  <th aria-sort={ariaSort('closeDate')}><button onClick={() => sortBy('closeDate')}>{t.closeDate}{arrow('closeDate')}</button></th>
                  <th aria-sort={ariaSort('daysInStage')}><button onClick={() => sortBy('daysInStage')}>{t.inStage}{arrow('daysInStage')}</button></th>
                  {pipeline!.fields.map((f) => <th>{label(f, locale)}</th>)}
                </tr>
              </thead>
              <tbody>
                {boxes.map((b) => {
                  const st = stageById.get(b.stageId);
                  return (
                    <tr class="row" tabIndex={0} key={b.id} onClick={() => setOpenId(b.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(b.id); else if (e.key === ' ' && e.target === e.currentTarget) { e.preventDefault(); togglePick(b.id); } }}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={b.name} checked={picked.has(b.id)} onChange={() => togglePick(b.id)} /></td>
                      <td class="name">{b.name}</td>
                      <td>{st && <span class="pill" style={{ background: st.color }}>{st.s.name}</span>}</td>
                      <td>{money(b.valueAmount, b.currency, locale)}</td>
                      <td>{b.closeDate ?? ''}</td>
                      <td><span class={`age${b.daysInStage >= 30 ? ' bad' : b.daysInStage >= 14 ? ' warn' : ''}`}>{b.daysInStage === 0 ? t.today : t.days(b.daysInStage)}</span></td>
                      <td>{b.lastEmailAt ? new Date(b.lastEmailAt).toLocaleDateString(locale) : ''}</td>
                      <td>{b.lastEmailFrom ?? ''}</td>
                      {pipeline!.fields.map((f) => <td>{cell(b.custom[f.key])}</td>)}
                    </tr>
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
          <aside class="drawer" role="dialog" aria-label={t.myTasks}>
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
        {newPipe && <NewPipeline call={call} t={t} locale={locale} onClose={() => setNewPipe(false)} onCreated={(id) => { setNewPipe(false); setPid(id); setStageFilter(''); refresh(); }} />}
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
    <aside class="drawer" role="dialog" aria-label={box.name}>
      <h2>{box.name}</h2>
      {!canEdit && <p class="muted">{t.readOnly}</p>}
      <label for="stg">{t.stage}</label>
      <select id="stg" value={stageId} disabled={!canEdit} onChange={(e) => void move((e.target as HTMLSelectElement).value)}>
        {pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}
      </select>
      {msg && <div class="ok">{msg}</div>}{err && <div class="err">{err}</div>}
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
    <aside class="drawer" role="dialog" aria-label={t.newBox}>
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
        {err && <div class="err">{err}</div>}
        <div class="actions"><button class="btn" disabled={busy || !name.trim()}>{t.create}</button><button type="button" class="btn quiet" onClick={onClose}>{t.cancel}</button></div>
      </form>
    </aside>
  );
}
