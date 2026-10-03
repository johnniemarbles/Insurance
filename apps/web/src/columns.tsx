import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Strings } from './i18n.ts';
import type { SortField } from './filters.ts';
import { ink, money } from './theme.ts';
import type { Box, FieldDef, Locale, Pipeline, Stage } from './types.ts';

export interface Person { id: string; displayName: string | null; email: string }

/** What a cell needs in order to draw itself and to save an edit. */
export interface Ctx {
  t: Strings; locale: Locale; stages: Stage[]; stageColor: (id: string) => string; people: Person[];
  open: (id: string) => void;
  /** Save a change; `undo` is the body that puts it back. */
  commit: (box: Box, forward: Record<string, unknown>, undo: Record<string, unknown>, what: string) => Promise<void>;
}

type EditSpec =
  | { type: 'text' | 'number' | 'date'; value: (b: Box) => string; body: (v: string) => Record<string, unknown>; back: (b: Box) => Record<string, unknown> }
  | { type: 'select'; options: { value: string; label: string }[]; value: (b: Box) => string; body: (v: string) => Record<string, unknown>; back: (b: Box) => Record<string, unknown> }
  | { type: 'checkbox'; value: (b: Box) => boolean; body: (v: boolean) => Record<string, unknown>; back: (b: Box) => Record<string, unknown> };

export interface ColDef {
  id: string; label: string; kind: 'core' | 'magic' | 'custom'; sort?: SortField; defaultOn: boolean;
  render: (b: Box, x: Ctx) => ComponentChildren; edit?: (x: Ctx) => EditSpec;
}

const DAY = 86_400_000;
const lastInteractionOf = (b: Box): number | null => {
  const times = [b.lastEmailAt, b.lastNoteAt].filter(Boolean).map((v) => new Date(v!).getTime());
  return times.length ? Math.max(...times) : null;
};
const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const Avatar = ({ name }: { name: string }) => <span class="avatar" style={{ background: `hsl(${hue(name)} 55% 42%)` }} title={name} aria-hidden="true">{initials(name)}</span>;

const fieldLabel = (f: FieldDef, locale: Locale) => f.labels[locale] ?? f.labels.en ?? f.key;

export function buildColumns(pipeline: Pipeline, t: Strings, locale: Locale): ColDef[] {
  const date = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(locale) : '');
  const cols: ColDef[] = [
    { id: 'name', label: t.name, kind: 'core', sort: 'name', defaultOn: true,
      render: (b, x) => <button class="namebtn" onClick={(e) => { e.stopPropagation(); x.open(b.id); }}>{b.name}</button>,
      edit: () => ({ type: 'text', value: (b) => b.name, body: (v) => ({ name: v }), back: (b) => ({ name: b.name }) }) },
    { id: 'stage', label: t.stage, kind: 'core', sort: 'stage', defaultOn: true,
      render: (b, x) => { const s = x.stages.find((y) => y.id === b.stageId); const c = x.stageColor(b.stageId); return s ? <span class="pill" style={{ background: c, color: ink(c) }}>{s.name}</span> : null; },
      edit: (x) => ({ type: 'select', options: x.stages.map((s) => ({ value: s.id, label: s.name })), value: (b) => b.stageId, body: (v) => ({ stageId: v }), back: (b) => ({ stageId: b.stageId }) }) },
    { id: 'owner', label: t.owner, kind: 'core', sort: 'owner', defaultOn: true,
      render: (b) => (b.ownerName ? <span class="who"><Avatar name={b.ownerName} />{b.ownerName}</span> : <span class="muted">—</span>),
      edit: (x) => ({ type: 'select', options: [{ value: '', label: '—' }, ...x.people.map((u) => ({ value: u.id, label: u.displayName ?? u.email }))], value: (b) => b.ownerUserId ?? '', body: (v) => ({ ownerUserId: v || null }), back: (b) => ({ ownerUserId: b.ownerUserId }) }) },
    { id: 'value', label: t.value, kind: 'core', sort: 'value', defaultOn: true,
      render: (b) => money(b.valueAmount, b.currency, locale),
      edit: () => ({ type: 'number', value: (b) => (b.valueAmount == null ? '' : String(b.valueAmount)), body: (v) => ({ valueAmount: v === '' ? null : Number(v) }), back: (b) => ({ valueAmount: b.valueAmount }) }) },
    { id: 'closeDate', label: t.closeDate, kind: 'core', sort: 'closeDate', defaultOn: true,
      render: (b) => b.closeDate ?? '',
      edit: () => ({ type: 'date', value: (b) => b.closeDate ?? '', body: (v) => ({ closeDate: v || null }), back: (b) => ({ closeDate: b.closeDate }) }) },
    { id: 'daysInStage', label: t.inStage, kind: 'core', sort: 'daysInStage', defaultOn: true,
      render: (b) => <span class={`age${b.daysInStage >= 30 ? ' bad' : b.daysInStage >= 14 ? ' warn' : ''}`}>{b.daysInStage === 0 ? t.today : t.days(b.daysInStage)}</span> },
    { id: 'lastEmail', label: t.lastEmail, kind: 'magic', sort: 'lastEmail', defaultOn: true, render: (b) => date(b.lastEmailAt) },
    { id: 'lastEmailFrom', label: t.lastEmailFrom, kind: 'magic', defaultOn: false, render: (b) => b.lastEmailFrom ?? '' },
    { id: 'lastInteraction', label: t.cLastInteraction, kind: 'magic', sort: 'lastInteraction', defaultOn: false, render: (b) => { const v = lastInteractionOf(b); return v ? new Date(v).toLocaleDateString(locale) : ''; } },
    { id: 'freshness', label: t.cFreshness, kind: 'magic', defaultOn: true,
      render: (b) => {
        const v = lastInteractionOf(b);
        if (v == null) return <span class="muted">—</span>;
        const d = (Date.now() - v) / DAY;
        const [cls, text] = d <= 7 ? ['good', t.fresh] : d <= 30 ? ['mid', t.aging] : ['bad', t.stale];
        return <span class={`fresh ${cls}`}><i />{text}</span>;
      } },
    { id: 'emailCount', label: t.cEmails, kind: 'magic', sort: 'emailCount', defaultOn: false, render: (b) => b.emailCount || '' },
    { id: 'openTasks', label: t.cOpenTasks, kind: 'magic', sort: 'openTasks', defaultOn: true, render: (b) => b.openTasks || '' },
    { id: 'overdueTasks', label: t.cOverdue, kind: 'magic', defaultOn: false, render: (b) => (b.overdueTasks ? <span class="overdue">{b.overdueTasks}</span> : '') },
    { id: 'nextTaskDue', label: t.cNextTask, kind: 'magic', sort: 'nextTaskDue', defaultOn: false,
      render: (b) => (b.nextTaskDue ? <span class={new Date(b.nextTaskDue) < new Date() ? 'overdue' : ''}>{date(b.nextTaskDue)}</span> : '') },
    { id: 'taskProgress', label: t.cTaskProgress, kind: 'magic', defaultOn: false,
      render: (b) => { const done = b.doneTasks ?? 0, all = done + (b.openTasks ?? 0); return all ? <span class="mini" title={`${done}/${all}`}><i style={{ width: `${Math.round((done / all) * 100)}%` }} /></span> : ''; } },
    { id: 'noteCount', label: t.cNotes, kind: 'magic', defaultOn: false, render: (b) => b.noteCount || '' },
    { id: 'updatedAt', label: t.cUpdated, kind: 'magic', sort: 'updated', defaultOn: false, render: (b) => date(b.updatedAt) },
    { id: 'createdAt', label: t.cCreated, kind: 'magic', sort: 'created', defaultOn: false, render: (b) => date(b.createdAt) },
  ];
  for (const f of pipeline.fields) {
    const key = f.key;
    const val = (b: Box) => b.custom[key];
    const base = { id: `cf:${key}`, label: fieldLabel(f, locale), kind: 'custom' as const, defaultOn: true };
    if (f.type === 'checkbox') cols.push({ ...base, render: (b) => (val(b) ? '✓' : ''), edit: () => ({ type: 'checkbox', value: (b) => Boolean(val(b)), body: (v) => ({ custom: { [key]: v } }), back: (b) => ({ custom: { [key]: val(b) ?? null } }) }) });
    else if (f.type === 'dropdown') cols.push({ ...base, render: (b) => String(val(b) ?? ''), edit: () => ({ type: 'select', options: [{ value: '', label: '—' }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))], value: (b) => String(val(b) ?? ''), body: (v) => ({ custom: { [key]: v || null } }), back: (b) => ({ custom: { [key]: val(b) ?? null } }) }) });
    else {
      const type = f.type === 'number' || f.type === 'currency' ? 'number' : f.type === 'date' ? 'date' : 'text';
      cols.push({ ...base, render: (b) => (val(b) == null ? '' : String(val(b))), edit: () => ({ type, value: (b) => String(val(b) ?? ''), body: (v) => ({ custom: { [key]: v === '' ? null : type === 'number' ? Number(v) : v } }), back: (b) => ({ custom: { [key]: val(b) ?? null } }) }) });
    }
  }
  return cols;
}

/** The saved choice of visible columns and their order for one pipeline. */
export function loadColumns(pid: string, all: ColDef[]): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(`pii.cols.${pid}`) ?? 'null') as string[] | null;
    if (saved) { const known = new Set(all.map((c) => c.id)); const list = saved.filter((id) => known.has(id)); if (!list.includes('name')) list.unshift('name'); return list; }
  } catch { /* private window */ }
  return all.filter((c) => c.defaultOn).map((c) => c.id);
}
export function saveColumns(pid: string, ids: string[] | null): void {
  try { if (ids) localStorage.setItem(`pii.cols.${pid}`, JSON.stringify(ids)); else localStorage.removeItem(`pii.cols.${pid}`); } catch { /* private window */ }
}

export function ColumnPicker({ all, visible, onChange, onReset, t }: { all: ColDef[]; visible: string[]; onChange: (ids: string[]) => void; onReset: () => void; t: Strings }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: Event) => { if (root.current && !e.composedPath().includes(root.current)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  const byId = new Map(all.map((c) => [c.id, c]));
  const move = (id: string, d: -1 | 1) => {
    const i = visible.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const next = [...visible]; [next[i], next[j]] = [next[j]!, next[i]!]; onChange(next);
  };
  const toggle = (id: string) => onChange(visible.includes(id) ? visible.filter((x) => x !== id) : [...visible, id]);
  const hidden = all.filter((c) => !visible.includes(c.id));
  const groups: [string, ColDef[]][] = [[t.colGroupCore, hidden.filter((c) => c.kind === 'core')], [t.colGroupMagic, hidden.filter((c) => c.kind === 'magic')], [t.colGroupCustom, hidden.filter((c) => c.kind === 'custom')]];
  return (
    <div class="menuwrap" ref={root}>
      <button class="btn quiet" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>▥ {t.columnsBtn}</button>
      {open && (
        <div class="kebab colpick" role="dialog" aria-label={t.columnsBtn}>
          <p class="muted">{t.colsHelp}</p>
          {visible.map((id, i) => {
            const c = byId.get(id); if (!c) return null;
            return (
              <div class="colrow" key={id}>
                <label class="fchk"><input type="checkbox" checked disabled={id === 'name'} onChange={() => toggle(id)} /> {c.label}</label>
                <span><button class="ib" aria-label={`${t.moveUp}: ${c.label}`} disabled={i === 0} onClick={() => move(id, -1)}>▲</button><button class="ib" aria-label={`${t.moveDown}: ${c.label}`} disabled={i === visible.length - 1} onClick={() => move(id, 1)}>▼</button></span>
              </div>
            );
          })}
          {groups.map(([title, list]) => list.length > 0 && (
            <div key={title}>
              <div class="fsec">{title}</div>
              {list.map((c) => <label class="fchk" key={c.id}><input type="checkbox" checked={false} onChange={() => toggle(c.id)} /> {c.label}</label>)}
            </div>
          ))}
          <div class="actions"><button class="btn quiet" onClick={onReset}>{t.colsReset}</button><button class="btn" onClick={() => setOpen(false)}>{t.done}</button></div>
        </div>
      )}
    </div>
  );
}

/** One table cell. Click to edit when the column allows it; Enter or leaving the cell saves, Esc cancels. */
export function Cell({ box, col, x }: { box: Box; col: ColDef; x: Ctx }) {
  const [editing, setEditing] = useState(false);
  const spec = col.edit?.(x);
  if (!spec || col.id === 'name') return <td class={col.id === 'name' ? 'name sticky2' : undefined} onClick={col.id === 'name' ? undefined : undefined}>{col.render(box, x)}</td>;
  const save = async (raw: string | boolean) => {
    setEditing(false);
    const before = spec.value(box);
    if (raw === before) return;
    if (spec.type === 'text' && raw === '') return;
    const forward = (spec as any).body(raw);
    await x.commit(box, forward, (spec as any).back(box), col.label);
  };
  if (spec.type === 'checkbox') {
    return <td class="ed" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={col.label} checked={spec.value(box)} onChange={(e) => void save((e.target as HTMLInputElement).checked)} /></td>;
  }
  if (!editing) {
    return (
      <td class="ed" tabIndex={0} title={col.label} onClick={(e) => { e.stopPropagation(); setEditing(true); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); setEditing(true); } }}>
        {col.render(box, x)}
      </td>
    );
  }
  const cancel = () => setEditing(false);
  if (spec.type === 'select') {
    return (
      <td class="ed editing" onClick={(e) => e.stopPropagation()}>
        <select ref={(el) => el?.focus()} aria-label={col.label} value={spec.value(box)} onChange={(e) => void save((e.target as HTMLSelectElement).value)} onBlur={cancel} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }}>
          {spec.options.map((o) => <option value={o.value}>{o.label}</option>)}
        </select>
      </td>
    );
  }
  return (
    <td class="ed editing" onClick={(e) => e.stopPropagation()}>
      <input
        ref={(el) => el?.focus()} type={spec.type} aria-label={col.label} defaultValue={spec.value(box)} step={spec.type === 'number' ? '0.01' : undefined} min={spec.type === 'number' ? '0' : undefined}
        onBlur={(e) => void save((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { (e.target as HTMLInputElement).value = spec.value(box); cancel(); } }}
      />
    </td>
  );
}
