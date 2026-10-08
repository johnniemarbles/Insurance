import { DOC_TYPES } from './doctypes.ts';
import { useDialogFocus } from './a11y.ts';
import { useEffect, useState } from 'preact/hooks';
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
            <summary>{t.requiredToEnter}{((s.requiredFields?.length ?? 0) + (s.requiredDocs?.length ?? 0)) > 0 ? ` (${(s.requiredFields?.length ?? 0) + (s.requiredDocs?.length ?? 0)})` : ''}</summary>
            {[{ k: 'value', l: t.value }, { k: 'closeDate', l: t.closeDate }, { k: 'owner', l: t.owner }, ...pipeline.fields.map((f) => ({ k: f.key, l: f.labels[locale] ?? f.labels.en ?? f.key }))].map((o) => (
              <label class="check" key={o.k}><input type="checkbox" checked={s.requiredFields?.includes(o.k) ?? false}
                onChange={(e) => { const on = (e.target as HTMLInputElement).checked; const cur = s.requiredFields ?? []; void act(() => call('PATCH', `${P}/stages/${s.id}`, { requiredFields: on ? [...cur, o.k] : cur.filter((x) => x !== o.k) })); }} /> {o.l}</label>
            ))}
            <div class="muted" style={{ marginTop: '8px', fontWeight: 600 }}>{locale === 'fr-CA' ? 'Documents requis (conformité)' : 'Required paperwork (compliance)'}</div>
            {DOC_TYPES.map((o) => (
              <label class="check" key={o.k}><input type="checkbox" checked={s.requiredDocs?.includes(o.k) ?? false}
                onChange={(e) => { const on = (e.target as HTMLInputElement).checked; const cur = s.requiredDocs ?? []; void act(() => call('PATCH', `${P}/stages/${s.id}`, { requiredDocs: on ? [...cur, o.k] : cur.filter((x) => x !== o.k) })); }} /> {o.l[locale]}</label>
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

      <Automations pipeline={pipeline} call={call} t={t} locale={locale} act={act} />
      <AliasRules pipeline={pipeline} call={call} t={t} locale={locale} act={act} />

      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
    </aside>
  );
}

interface Auto {
  id: string; stageId: string; trigger: 'enter' | 'stale' | 'email'; staleDays: number | null; action: 'create_task' | 'assign_owner' | 'add_note' | 'move_stage' | 'copy_to_pipeline' | 'add_to_merge'; mergeName: string | null;
  title: string | null; dueInDays: number | null; body: string | null; assigneeName: string | null; targetStageName: string | null; targetPipelineName: string | null; active: boolean;
}
type Act = Auto['action'];
const AX = {
  'en': {
    trig: { enter: 'enters the stage', stale: 'sits in the stage for', email: 'gets its first received email in the stage' }, days: 'days', actions: { create_task: 'Create a task', assign_owner: 'Assign to', add_note: 'Add a note', move_stage: 'Move to stage', copy_to_pipeline: 'Copy to pipeline', add_to_merge: 'Add contact to mail merge' },
    note: 'Note text', stage2: 'Stage', pipe: 'Pipeline', firstStage: 'First stage', staleDays: 'Days',
    when: (k: Auto['trigger'], s: string, n: number | null) => (k === 'enter' ? `When a record enters ${s}` : k === 'stale' ? `When a record has sat in ${s} for ${n} days` : `When a record in ${s} gets its first received email`),
    does: (a: Auto) => (a.action === 'create_task' ? `create task “${a.title}”${a.dueInDays == null ? '' : ` due in ${a.dueInDays} days`}` : a.action === 'assign_owner' ? `assign to ${a.assigneeName ?? '…'}` : a.action === 'add_note' ? `add the note “${a.body}”` : a.action === 'move_stage' ? `move it to ${a.targetStageName ?? '…'}` : a.action === 'add_to_merge' ? `add its contact to mail merge “${a.mergeName ?? '…'}”` : `copy it to ${a.targetPipelineName ?? '…'}${a.targetStageName ? ` → ${a.targetStageName}` : ''}`),
    helpMore: 'Each automation acts once each time a record is in the stage. If a move is blocked by a stage’s required fields, it is skipped and your own change still goes through.',
  },
  'fr-CA': {
    trig: { enter: 'entre à l’étape', stale: 'reste à l’étape pendant', email: 'reçoit son premier courriel à l’étape' }, days: 'jours', actions: { create_task: 'Créer une tâche', assign_owner: 'Assigner à', add_note: 'Ajouter une note', move_stage: 'Déplacer à l’étape', copy_to_pipeline: 'Copier vers le pipeline', add_to_merge: 'Ajouter le contact au publipostage' },
    note: 'Texte de la note', stage2: 'Étape', pipe: 'Pipeline', firstStage: 'Première étape', staleDays: 'Jours',
    when: (k: Auto['trigger'], s: string, n: number | null) => (k === 'enter' ? `Quand un dossier entre à ${s}` : k === 'stale' ? `Quand un dossier reste à ${s} pendant ${n} jours` : `Quand un dossier à ${s} reçoit son premier courriel`),
    does: (a: Auto) => (a.action === 'create_task' ? `créer la tâche « ${a.title} »${a.dueInDays == null ? '' : ` due dans ${a.dueInDays} jours`}` : a.action === 'assign_owner' ? `assigner à ${a.assigneeName ?? '…'}` : a.action === 'add_note' ? `ajouter la note « ${a.body} »` : a.action === 'move_stage' ? `le déplacer à ${a.targetStageName ?? '…'}` : a.action === 'add_to_merge' ? `ajouter son contact au publipostage « ${a.mergeName ?? '…'} »` : `le copier vers ${a.targetPipelineName ?? '…'}${a.targetStageName ? ` → ${a.targetStageName}` : ''}`),
    helpMore: 'Chaque automatisation agit une fois par séjour à l’étape. Si un déplacement est bloqué par les champs requis d’une étape, il est ignoré et votre propre changement passe quand même.',
  },
};
function Automations({ pipeline, call, t, locale, act }: { pipeline: Pipeline; call: Call; t: Strings; locale: Locale; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const x = AX[locale];
  const [list, setList] = useState<Auto[]>([]);
  const [people, setPeople] = useState<{ id: string; displayName: string | null; email: string }[]>([]);
  const [pipes, setPipes] = useState<Pipeline[]>([]);
  const [trigger, setTrigger] = useState<Auto['trigger']>('enter');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [staleDays, setStaleDays] = useState('7');
  const [action, setAction] = useState<Act>('create_task');
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('');
  const [who, setWho] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState('');
  const [targetPipe, setTargetPipe] = useState('');
  const [merges, setMerges] = useState<{ id: string; name: string; status: string }[]>([]);
  const [mergeId, setMergeId] = useState('');
  const [tick, setTick] = useState(0);
  const P = `/v1/pipelines/${pipeline.id}/automations`;
  useEffect(() => { call('GET', P).then((r) => setList(r.automations), () => undefined); }, [call, P, tick]);
  useEffect(() => { call('GET', '/v1/users').then((r) => setPeople(r.users), () => undefined); call('GET', '/v1/pipelines').then((r) => setPipes(r.pipelines), () => undefined); call('GET', '/v1/merges').then((r) => setMerges(r.merges), () => undefined); }, [call]);
  const stageName = (id: string) => pipeline.stages.find((s) => s.id === id)?.name ?? '…';
  const run = (fn: () => Promise<unknown>) => act(async () => { await fn(); setTick((n) => n + 1); });
  const otherPipes = pipes.filter((p) => p.id !== pipeline.id);
  const targetStages = action === 'copy_to_pipeline' ? (otherPipes.find((p) => p.id === targetPipe)?.stages ?? []) : pipeline.stages.filter((s) => s.id !== stageId);
  const ready = (trigger !== 'stale' || Number(staleDays) >= 1) && (action === 'create_task' ? title.trim() !== '' : action === 'assign_owner' ? who !== '' : action === 'add_note' ? body.trim() !== '' : action === 'move_stage' ? target !== '' : action === 'add_to_merge' ? mergeId !== '' : targetPipe !== '');
  const sel = (label: string, value: string, set: (v: string) => void, children: unknown) => <select aria-label={label} value={value} onChange={(e) => set((e.target as HTMLSelectElement).value)}>{children as never}</select>;
  return (
    <>
      <h3>{t.automations}</h3>
      <p class="muted">{t.automationsHelp}</p>
      {list.map((a) => (
        <div class="erow" key={a.id}>
          <span class={a.active ? '' : 'strike'}>{x.when(a.trigger, stageName(a.stageId), a.staleDays)}: {x.does(a)}</span>
          <span class="spacer" />
          <button class="ib" aria-label={a.active ? t.pause : t.resume} onClick={() => void run(() => call('PATCH', `${P}/${a.id}`, { active: !a.active }))}>{a.active ? '⏸' : '▶'}</button>
          <button class="ib danger" aria-label={t.remove} onClick={() => void run(() => call('DELETE', `${P}/${a.id}`))}>✕</button>
        </div>
      ))}
      <form class="erow wrap2" onSubmit={(e) => {
        e.preventDefault(); if (!ready) return;
        const base = { stageId, trigger, ...(trigger === 'stale' ? { staleDays: Number(staleDays) } : {}), action };
        const rest = action === 'create_task' ? { title: title.trim(), ...(days !== '' ? { dueInDays: Number(days) } : {}) } : action === 'assign_owner' ? { assigneeUserId: who }
          : action === 'add_note' ? { body: body.trim() } : action === 'move_stage' ? { targetStageId: target } : action === 'add_to_merge' ? { mergeId } : { targetPipelineId: targetPipe, ...(target ? { targetStageId: target } : {}) };
        setTitle(''); setDays(''); setBody('');
        void run(() => call('POST', P, { ...base, ...rest }));
      }}>
        <span>{locale === 'en' ? 'When a record' : 'Quand un dossier'}</span>
        {sel(t.actionLabel, trigger, (v) => setTrigger(v as Auto['trigger']), (['enter', 'stale', 'email'] as const).map((k) => <option value={k}>{x.trig[k]}</option>))}
        {trigger === 'stale' && <input type="number" min="1" aria-label={x.staleDays} placeholder={x.staleDays} value={staleDays} onInput={(e) => setStaleDays((e.target as HTMLInputElement).value)} />}
        {sel(t.stage, stageId, (v) => { setStageId(v); setTarget(''); }, pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>))}
        {sel(t.actionLabel, action, (v) => { setAction(v as Act); setTarget(''); }, (Object.keys(x.actions) as Act[]).map((k) => <option value={k}>{x.actions[k]}</option>))}
        {action === 'create_task' && (
          <>
            <input placeholder={t.taskTitle} aria-label={t.taskTitle} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            <input type="number" min="0" placeholder={t.dueInDays} aria-label={t.dueInDays} value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} />
          </>
        )}
        {action === 'assign_owner' && sel(t.assignTo, who, setWho, <><option value="">{t.assignTo}…</option>{people.map((u) => <option value={u.id}>{u.displayName ?? u.email}</option>)}</>)}
        {action === 'add_note' && <input placeholder={x.note} aria-label={x.note} maxLength={1000} value={body} onInput={(e) => setBody((e.target as HTMLInputElement).value)} />}
        {action === 'move_stage' && sel(x.stage2, target, setTarget, <><option value="">{x.stage2}…</option>{targetStages.map((s) => <option value={s.id}>{s.name}</option>)}</>)}
        {action === 'add_to_merge' && sel(x.actions.add_to_merge, mergeId, setMergeId, <><option value="">…</option>{merges.filter((m) => m.status !== 'cancelled').map((m) => <option value={m.id}>{m.name}</option>)}</>)}
        {action === 'copy_to_pipeline' && (
          <>
            {sel(x.pipe, targetPipe, (v) => { setTargetPipe(v); setTarget(''); }, <><option value="">{x.pipe}…</option>{otherPipes.map((p) => <option value={p.id}>{p.name}</option>)}</>)}
            {targetPipe && sel(x.stage2, target, setTarget, <><option value="">{x.firstStage}</option>{targetStages.map((s) => <option value={s.id}>{s.name}</option>)}</>)}
          </>
        )}
        <button class="btn quiet" disabled={!ready} aria-label="+">+</button>
      </form>
      <p class="muted">{x.helpMore}</p>
    </>
  );
}

const ALX = {
  'en': { h: 'Email aliases', help: 'When someone opens an email sent to one of these addresses, PII suggests adding it to this pipeline. Nothing is added until they accept.', ph: 'travel@yourcompany.com', start: 'Starting stage', first: 'First stage', none: 'No aliases yet.', add: 'Add alias', rm: 'Remove alias' },
  'fr-CA': { h: 'Alias courriel', help: 'Quand quelqu’un ouvre un courriel envoyé à l’une de ces adresses, PII propose de l’ajouter à ce pipeline. Rien n’est ajouté avant son acceptation.', ph: 'voyage@votreentreprise.com', start: 'Étape de départ', first: 'Première étape', none: 'Aucun alias pour l’instant.', add: 'Ajouter l’alias', rm: 'Retirer l’alias' },
};
interface AliasRule { id: string; alias: string; stageId: string | null }
function AliasRules({ pipeline, call, locale, act }: { pipeline: Pipeline; call: Call; t: Strings; locale: Locale; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const x = ALX[locale];
  const [rules, setRules] = useState<AliasRule[]>([]);
  const [alias, setAlias] = useState('');
  const [stageId, setStageId] = useState('');
  const [tick, setTick] = useState(0);
  const P = `/v1/pipelines/${pipeline.id}/aliases`;
  useEffect(() => { call('GET', P).then((r) => setRules(r.rules), () => undefined); }, [call, P, tick]);
  const run = (fn: () => Promise<unknown>) => act(async () => { await fn(); setTick((n) => n + 1); });
  const stageName = (id: string | null) => pipeline.stages.find((s) => s.id === id)?.name ?? x.first;
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alias.trim());
  return (
    <>
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {rules.length === 0 && <p class="muted">{x.none}</p>}
      {rules.map((r) => (
        <div class="erow" key={r.id}>
          <span>{r.alias} → {stageName(r.stageId)}</span>
          <span class="spacer" />
          <button class="ib danger" aria-label={x.rm} onClick={() => void run(() => call('DELETE', `${P}/${r.id}`))}>✕</button>
        </div>
      ))}
      <form class="erow wrap2" onSubmit={(e) => { e.preventDefault(); if (!ok) return; const a = alias.trim(); setAlias(''); void run(() => call('POST', P, { alias: a, ...(stageId ? { stageId } : {}) })); }}>
        <input type="email" placeholder={x.ph} aria-label={x.h} value={alias} onInput={(e) => setAlias((e.target as HTMLInputElement).value)} />
        <select aria-label={x.start} value={stageId} onChange={(e) => setStageId((e.target as HTMLSelectElement).value)}>
          <option value="">{x.first}</option>
          {pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}
        </select>
        <button class="btn quiet" disabled={!ok} aria-label={x.add}>+</button>
      </form>
    </>
  );
}

