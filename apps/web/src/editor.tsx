import { useDialogFocus } from './a11y.ts';
import { useEffect, useState } from 'preact/hooks';
import { TEMPLATES } from './templates.ts';
import { stageColor } from './theme.ts';
import type { Strings } from './i18n.ts';
import type { Locale, Pipeline, Theme } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const THEMES: Theme[] = ['rainbow', 'ocean', 'forest', 'sunset', 'mono'];
const slug = (s: string) => { const k = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return (/^[a-z]/.test(k) ? k : `f_${k}`).slice(0, 40); };
const move = <T,>(a: T[], i: number, d: number): T[] => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return b; [b[i], b[j]] = [b[j]!, b[i]!]; return b; };

export function PipelineEditor({ pipeline, call, t, locale, onClose, onChanged }: { pipeline: Pipeline; call: Call; t: Strings; locale: Locale; onClose: () => void; onChanged: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [newStage, setNewStage] = useState('');
  const [colLabel, setColLabel] = useState('');
  const [colType, setColType] = useState('text');
  const [colOptions, setColOptions] = useState('');
  const [removing, setRemoving] = useState('');
  const [dest, setDest] = useState('');
  const P = `/v1/pipelines/${pipeline.id}`;

  const act = async (fn: () => Promise<unknown>) => {
    setErr(''); setNote('');
    try { await fn(); setNote(t.saved); onChanged(); } catch (e) { setErr((e as Error).message); }
  };
  const st = pipeline.stages;

  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={t.editPipeline}>
      <h2>{t.editPipeline}</h2>
      {err && <div class="err" role="alert">{err}</div>}{note && <div class="ok" role="status">{note}</div>}

      <label for="pn">{t.name}</label>
      <input id="pn" defaultValue={pipeline.name} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== pipeline.name) void act(() => call('PATCH', P, { name: v })); }} />
      <label for="th">{t.colourTheme}</label>
      <select id="th" value={pipeline.colorTheme} onChange={(e) => void act(() => call('PATCH', P, { colorTheme: (e.target as HTMLSelectElement).value }))}>
        {THEMES.map((x) => <option value={x}>{t.themes[x]}</option>)}
      </select>
      <label class="check"><input type="checkbox" checked={pipeline.sharedDown} onChange={(e) => void act(() => call('PATCH', P, { sharedDown: (e.target as HTMLInputElement).checked }))} /> {t.shareDown}</label>

      <h3>{t.stages}</h3>
      {st.map((s, i) => (
        <div class="erow" key={s.id}>
          <input type="color" aria-label={t.colour} value={stageColor(pipeline.colorTheme, s, i)} onChange={(e) => void act(() => call('PATCH', `${P}/stages/${s.id}`, { color: (e.target as HTMLInputElement).value }))} />
          <input aria-label={t.name} defaultValue={s.name} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== s.name) void act(() => call('PATCH', `${P}/stages/${s.id}`, { name: v })); }} />
          <button class="ib" aria-label={t.moveUp} disabled={i === 0} onClick={() => void act(() => call('PUT', `${P}/stages/order`, { stageIds: move(st, i, -1).map((x) => x.id) }))}>↑</button>
          <button class="ib" aria-label={t.moveDown} disabled={i === st.length - 1} onClick={() => void act(() => call('PUT', `${P}/stages/order`, { stageIds: move(st, i, 1).map((x) => x.id) }))}>↓</button>
          <button class="ib danger" aria-label={t.remove} disabled={st.length <= 1} onClick={() => { setRemoving(s.id); setDest(st.find((x) => x.id !== s.id)?.id ?? ''); }}>✕</button>
          {removing === s.id && (
            <div class="confirm">
              <span>{t.moveRecordsTo}</span>
              <select value={dest} onChange={(e) => setDest((e.target as HTMLSelectElement).value)}>{st.filter((x) => x.id !== s.id).map((x) => <option value={x.id}>{x.name}</option>)}</select>
              <button class="btn" onClick={() => { setRemoving(''); void act(() => call('DELETE', `${P}/stages/${s.id}?moveTo=${dest}`)); }}>{t.remove}</button>
              <button class="btn quiet" onClick={() => setRemoving('')}>{t.cancel}</button>
            </div>
          )}
          <details class="reqd">
            <summary>{t.requiredToEnter}{(s.requiredFields?.length ?? 0) > 0 ? ` (${s.requiredFields!.length})` : ''}</summary>
            {[{ k: 'value', l: t.value }, { k: 'closeDate', l: t.closeDate }, { k: 'owner', l: t.owner }, ...pipeline.fields.map((f) => ({ k: f.key, l: f.labels[locale] ?? f.labels.en ?? f.key }))].map((o) => (
              <label class="check" key={o.k}><input type="checkbox" checked={s.requiredFields?.includes(o.k) ?? false}
                onChange={(e) => { const on = (e.target as HTMLInputElement).checked; const cur = s.requiredFields ?? []; void act(() => call('PATCH', `${P}/stages/${s.id}`, { requiredFields: on ? [...cur, o.k] : cur.filter((x) => x !== o.k) })); }} /> {o.l}</label>
            ))}
          </details>
        </div>
      ))}
      <form class="erow" onSubmit={(e) => { e.preventDefault(); const n = newStage.trim(); if (n) { setNewStage(''); void act(() => call('POST', `${P}/stages`, { name: n })); } }}>
        <input placeholder={t.addStage} aria-label={t.addStage} value={newStage} onInput={(e) => setNewStage((e.target as HTMLInputElement).value)} />
        <button class="btn quiet" disabled={!newStage.trim()}>+</button>
      </form>

      <h3>{t.columns}</h3>
      {pipeline.fields.map((f, i) => (
        <div class="erow" key={f.id}>
          <input aria-label="English" title="English" defaultValue={f.labels.en} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== f.labels.en) void act(() => call('PATCH', `${P}/fields/${f.id}`, { labels: { ...f.labels, en: v } })); }} />
          <input aria-label="Français" title="Français (fr-CA)" placeholder="fr-CA" defaultValue={f.labels['fr-CA'] ?? ''} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v !== (f.labels['fr-CA'] ?? '')) { const labels: Record<string, string> = { en: f.labels.en! }; if (v) labels['fr-CA'] = v; void act(() => call('PATCH', `${P}/fields/${f.id}`, { labels })); } }} />
          <span class="tag">{t.types[f.type] ?? f.type}</span>
          <button class="ib" aria-label={t.moveUp} disabled={i === 0} onClick={() => void act(() => call('PUT', `${P}/fields/order`, { fieldIds: move(pipeline.fields, i, -1).map((x) => x.id) }))}>↑</button>
          <button class="ib" aria-label={t.moveDown} disabled={i === pipeline.fields.length - 1} onClick={() => void act(() => call('PUT', `${P}/fields/order`, { fieldIds: move(pipeline.fields, i, 1).map((x) => x.id) }))}>↓</button>
          <button class="ib danger" aria-label={t.remove} onClick={() => { if (confirm(t.confirmColumn(f.labels[locale] ?? f.labels.en ?? f.key))) void act(() => call('DELETE', `${P}/fields/${f.id}`)); }}>✕</button>
        </div>
      ))}
      <form class="erow wrap2" onSubmit={(e) => {
        e.preventDefault();
        const label = colLabel.trim(); if (!label) return;
        const options = colType === 'dropdown' ? colOptions.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
        if (colType === 'dropdown' && !options?.length) { setErr(t.needOptions); return; }
        let key = slug(label); const have = new Set(pipeline.fields.map((x) => x.key)); let n = 2; const base = key; while (have.has(key)) key = `${base.slice(0, 36)}_${n++}`;
        setColLabel(''); setColOptions('');
        void act(() => call('POST', `${P}/fields`, { key, labels: { en: label }, type: colType, ...(options ? { options } : {}) }));
      }}>
        <input placeholder={t.addColumn} aria-label={t.addColumn} value={colLabel} onInput={(e) => setColLabel((e.target as HTMLInputElement).value)} />
        <select aria-label={t.type} value={colType} onChange={(e) => setColType((e.target as HTMLSelectElement).value)}>{Object.entries(t.types).map(([k, v]) => <option value={k}>{v}</option>)}</select>
        {colType === 'dropdown' && <input placeholder={t.optionsHint} aria-label={t.optionsHint} value={colOptions} onInput={(e) => setColOptions((e.target as HTMLInputElement).value)} />}
        <button class="btn quiet" disabled={!colLabel.trim()}>+</button>
      </form>

      <Automations pipeline={pipeline} call={call} t={t} act={act} />

      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
    </aside>
  );
}

interface Auto { id: string; stageId: string; action: 'create_task' | 'assign_owner'; title: string | null; dueInDays: number | null; assigneeName: string | null; active: boolean }
function Automations({ pipeline, call, t, act }: { pipeline: Pipeline; call: Call; t: Strings; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [list, setList] = useState<Auto[]>([]);
  const [people, setPeople] = useState<{ id: string; displayName: string | null; email: string }[]>([]);
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [action, setAction] = useState<'create_task' | 'assign_owner'>('create_task');
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('');
  const [who, setWho] = useState('');
  const [tick, setTick] = useState(0);
  const P = `/v1/pipelines/${pipeline.id}/automations`;
  useEffect(() => { call('GET', P).then((r) => setList(r.automations), () => undefined); }, [call, P, tick]);
  useEffect(() => { call('GET', '/v1/users').then((r) => setPeople(r.users), () => undefined); }, [call]);
  const stageName = (id: string) => pipeline.stages.find((s) => s.id === id)?.name ?? '…';
  const run = (fn: () => Promise<unknown>) => act(async () => { await fn(); setTick((n) => n + 1); });
  const ready = action === 'create_task' ? title.trim() !== '' : who !== '';
  return (
    <>
      <h3>{t.automations}</h3>
      <p class="muted">{t.automationsHelp}</p>
      {list.map((a) => (
        <div class="erow" key={a.id}>
          <span class={a.active ? '' : 'strike'}>{t.whenEnters(stageName(a.stageId))}: {a.action === 'create_task' ? t.doTask(a.title ?? '', a.dueInDays) : t.doAssign(a.assigneeName ?? '…')}</span>
          <span class="spacer" />
          <button class="ib" aria-label={a.active ? t.pause : t.resume} onClick={() => void run(() => call('PATCH', `${P}/${a.id}`, { active: !a.active }))}>{a.active ? '⏸' : '▶'}</button>
          <button class="ib danger" aria-label={t.remove} onClick={() => void run(() => call('DELETE', `${P}/${a.id}`))}>✕</button>
        </div>
      ))}
      <form class="erow wrap2" onSubmit={(e) => {
        e.preventDefault(); if (!ready) return;
        const body = action === 'create_task' ? { stageId, action, title: title.trim(), ...(days !== '' ? { dueInDays: Number(days) } : {}) } : { stageId, action, assigneeUserId: who };
        setTitle(''); setDays('');
        void run(() => call('POST', P, body));
      }}>
        <span>{t.whenEntersShort}</span>
        <select aria-label={t.stage} value={stageId} onChange={(e) => setStageId((e.target as HTMLSelectElement).value)}>{pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}</select>
        <select aria-label={t.actionLabel} value={action} onChange={(e) => setAction((e.target as HTMLSelectElement).value as 'create_task' | 'assign_owner')}>
          <option value="create_task">{t.actCreateTask}</option><option value="assign_owner">{t.actAssign}</option>
        </select>
        {action === 'create_task' ? (
          <>
            <input placeholder={t.taskTitle} aria-label={t.taskTitle} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            <input type="number" min="0" placeholder={t.dueInDays} aria-label={t.dueInDays} value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} />
          </>
        ) : (
          <select aria-label={t.assignTo} value={who} onChange={(e) => setWho((e.target as HTMLSelectElement).value)}><option value="">{t.assignTo}…</option>{people.map((u) => <option value={u.id}>{u.displayName ?? u.email}</option>)}</select>
        )}
        <button class="btn quiet" disabled={!ready}>+</button>
      </form>
    </>
  );
}

export function NewPipeline({ call, t, locale, onClose, onCreated }: { call: Call; t: Strings; locale: Locale; onClose: () => void; onCreated: (id: string) => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const create = async (body: object) => {
    setBusy(true); setErr('');
    try { const r = await call('POST', '/v1/pipelines', { sharedDown: true, ...body }); onCreated(r.id); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={t.newPipeline}>
      <h2>{t.newPipeline}</h2>
      {err && <div class="err" role="alert">{err}</div>}
      <p class="muted">{t.templateHelp}</p>
      {TEMPLATES.map((tp) => (
        <button class="tpl" disabled={busy} key={tp.id} onClick={() => void create({ name: tp.name[locale], stages: tp.stages, fields: tp.fields.map((f) => ({ key: f.key, labels: f.labels, type: f.type, ...(f.options ? { options: f.options } : {}) })) })}>
          <b>{tp.name[locale]}</b>
          <span>{tp.about[locale]}</span>
          <small>{tp.stages.map((s) => s.name).join(' → ')}</small>
        </button>
      ))}
      <h3>{t.blankPipeline}</h3>
      <form class="erow" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create({ name: name.trim() }); }}>
        <input placeholder={t.name} aria-label={t.name} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <button class="btn" disabled={busy || !name.trim()}>{t.create}</button>
      </form>
      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.cancel}</button></div>
    </aside>
  );
}
