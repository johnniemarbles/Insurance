import { useEffect, useRef, useState } from 'preact/hooks';
import type { Strings } from './i18n.ts';
import type { Pipeline } from './types.ts';
import { emptyFilters, hasFilters, type Filters, type GroupBy, type SortField, type SortSpec } from './filters.ts';

export interface Person { id: string; displayName: string | null; email: string }
type Editor = 'stage' | 'assigned' | 'email' | 'stuck' | 'value' | null;
interface Item { id: string; section: 'filter' | 'sort' | 'group'; label: string; run: () => void }

interface Props {
  t: Strings; pipeline: Pipeline; people: Person[]; meEmail: string;
  filters: Filters; onFilters: (f: Filters) => void;
  sorts: SortSpec[]; onSorts: (s: SortSpec[]) => void;
  groupBy: GroupBy; onGroupBy: (g: GroupBy) => void;
}

/** The one bar for narrowing, ordering and grouping a pipeline. Chips show what is active; each chip can be changed or removed. */
export function FilterBar({ t, pipeline, people, meEmail, filters, onFilters, sorts, onSorts, groupBy, onGroupBy }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<Editor>(null);
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });

  useEffect(() => {
    const away = (e: Event) => { if (root.current && !e.composedPath().includes(root.current)) { setMenu(false); setEdit(null); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const personName = (id: string) => { const u = people.find((x) => x.id === id); return u ? (u.displayName ?? u.email) : '…'; };
  const me = people.find((u) => u.email.toLowerCase() === meEmail.toLowerCase());
  const sortLabels: Record<SortField, string> = {
    name: t.name, value: t.value, closeDate: t.closeDate, daysInStage: t.inStage, lastEmail: t.lastEmail, updated: t.sUpdated, created: t.sCreated, stage: t.stage, owner: t.owner,
    openTasks: t.cOpenTasks, nextTaskDue: t.cNextTask, emailCount: t.cEmails, lastInteraction: t.cLastInteraction,
  };
  const groupLabels: Record<GroupBy, string> = { none: t.gNone, stage: t.stage, owner: t.owner };

  const addSort = (key: SortField) => {
    const i = sorts.findIndex((s) => s.key === key);
    if (i >= 0) onSorts(sorts.map((s, n) => (n === i ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s)));
    else onSorts([...sorts.filter((s) => !(sorts.length === 1 && s.key === 'updated')), { key, dir: key === 'name' || key === 'stage' || key === 'owner' ? 'asc' : 'desc' }]);
  };
  const choose = (fn: () => void) => { fn(); setText(''); setMenu(false); };

  const items: Item[] = [
    { id: 'f-stage', section: 'filter', label: t.stage, run: () => setEdit('stage') },
    { id: 'f-assigned', section: 'filter', label: t.fAssigned, run: () => setEdit('assigned') },
    { id: 'f-email', section: 'filter', label: t.fLastEmail, run: () => setEdit('email') },
    { id: 'f-stuck', section: 'filter', label: t.fInStage, run: () => setEdit('stuck') },
    { id: 'f-value', section: 'filter', label: t.fValue, run: () => setEdit('value') },
    ...(['name', 'value', 'closeDate', 'daysInStage', 'lastEmail', 'lastInteraction', 'openTasks', 'updated', 'created'] as SortField[]).map((k): Item => ({ id: `s-${k}`, section: 'sort', label: sortLabels[k], run: () => addSort(k) })),
    ...(['stage', 'owner', 'none'] as GroupBy[]).map((g): Item => ({ id: `g-${g}`, section: 'group', label: groupLabels[g], run: () => onGroupBy(g) })),
  ];
  const needle = text.trim().toLowerCase();
  const shown = needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items;

  const chips: { id: string; label: string; open: () => void; remove: () => void }[] = [];
  if (filters.q) chips.push({ id: 'q', label: `“${filters.q}”`, open: () => { setText(filters.q); setMenu(true); }, remove: () => set({ q: '' }) });
  if (filters.stageIds.length) {
    const names = filters.stageIds.map((id) => pipeline.stages.find((s) => s.id === id)?.name ?? '…').join(', ');
    chips.push({ id: 'stage', label: `${t.stage} ${t.isAnyOf(names)}`, open: () => setEdit('stage'), remove: () => set({ stageIds: [] }) });
  }
  if (filters.assigneeIds.length || filters.unassigned) {
    const names = [...filters.assigneeIds.map((id) => (id === me?.id ? t.me : personName(id))), ...(filters.unassigned ? [t.unassigned] : [])].join(', ');
    chips.push({ id: 'assigned', label: `${t.fAssigned} ${t.isAnyOf(names)}`, open: () => setEdit('assigned'), remove: () => set({ assigneeIds: [], unassigned: false }) });
  }
  if (filters.emailOlder != null) chips.push({ id: 'eo', label: t.emailOlderChip(filters.emailOlder), open: () => setEdit('email'), remove: () => set({ emailOlder: null }) });
  if (filters.emailWithin != null) chips.push({ id: 'ew', label: t.emailWithinChip(filters.emailWithin), open: () => setEdit('email'), remove: () => set({ emailWithin: null }) });
  if (filters.noEmail) chips.push({ id: 'ne', label: t.noEmailYet, open: () => setEdit('email'), remove: () => set({ noEmail: false }) });
  if (filters.stuckDays != null) chips.push({ id: 'st', label: t.stuckChip(filters.stuckDays), open: () => setEdit('stuck'), remove: () => set({ stuckDays: null }) });
  if (filters.valueMin != null || filters.valueMax != null) chips.push({ id: 'v', label: t.valueChip(filters.valueMin, filters.valueMax), open: () => setEdit('value'), remove: () => set({ valueMin: null, valueMax: null }) });
  const customSort = !(sorts.length === 1 && sorts[0]!.key === 'updated' && sorts[0]!.dir === 'desc');
  if (customSort) sorts.forEach((s, i) => chips.push({
    id: `sort-${s.key}`, label: t.sortChip(sortLabels[s.key], s.dir), open: () => addSort(s.key),
    remove: () => onSorts(sorts.length === 1 ? [{ key: 'updated', dir: 'desc' }] : sorts.filter((_, n) => n !== i)),
  }));
  if (groupBy !== 'none') chips.push({ id: 'group', label: t.groupChip(groupLabels[groupBy]), open: () => setMenu(true), remove: () => onGroupBy('none') });

  const clearAll = () => { onFilters(emptyFilters); onSorts([{ key: 'updated', dir: 'desc' }]); onGroupBy('none'); setText(''); };
  const anything = hasFilters(filters) || customSort || groupBy !== 'none';

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const num = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));

  return (
    <div class="fbar" ref={root}>
      <div class="fbox" onClick={() => { setMenu(true); (root.current?.querySelector('.fin') as HTMLInputElement | null)?.focus(); }}>
        <span class="fglass" aria-hidden="true">⌕</span>
        {chips.map((c) => (
          <span class="chip" key={c.id}>
            <button class="chiplabel" onClick={(e) => { e.stopPropagation(); c.open(); }}>{c.label}</button>
            <button class="chipx" aria-label={`${t.remove}: ${c.label}`} onClick={(e) => { e.stopPropagation(); c.remove(); }}>×</button>
          </span>
        ))}
        <input
          class="fin" role="combobox" aria-expanded={menu} aria-controls="pii-fmenu" aria-label={t.fbPlaceholder}
          placeholder={chips.length ? '' : t.fbPlaceholder} value={text}
          onFocus={() => setMenu(true)}
          onInput={(e) => { setText((e.target as HTMLInputElement).value); setMenu(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { if (menu || edit) { e.stopPropagation(); setMenu(false); setEdit(null); } }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (shown.length > 0 && needle) choose(shown[0]!.run);
              else if (text.trim()) { set({ q: text.trim() }); setText(''); setMenu(false); }
            } else if (e.key === 'Backspace' && !text && chips.length) chips[chips.length - 1]!.remove();
          }}
        />
        {anything && <button class="fclear" onClick={(e) => { e.stopPropagation(); clearAll(); }}>{t.clearAll}</button>}
      </div>

      {menu && !edit && (
        <div class="fmenu" id="pii-fmenu" role="listbox">
          {(['filter', 'sort', 'group'] as const).map((sec) => {
            const rows = shown.filter((i) => i.section === sec);
            if (!rows.length) return null;
            return (
              <div key={sec}>
                <div class="fsec">{sec === 'filter' ? t.fbFilter : sec === 'sort' ? t.fbSort : t.fbGroup}</div>
                {rows.map((i) => <button role="option" aria-selected="false" class="fopt" key={i.id} onClick={() => choose(i.run)}>{i.label}</button>)}
              </div>
            );
          })}
          {needle && <button role="option" aria-selected="false" class="fopt" onClick={() => { set({ q: text.trim() }); setText(''); setMenu(false); }}>{t.fbSearchFor(text.trim())}</button>}
        </div>
      )}

      {edit && (
        <div class="fpop" role="dialog" aria-label={edit}>
          {edit === 'stage' && pipeline.stages.map((s) => (
            <label class="fchk" key={s.id}><input type="checkbox" checked={filters.stageIds.includes(s.id)} onChange={() => set({ stageIds: toggle(filters.stageIds, s.id) })} /> {s.name}</label>
          ))}
          {edit === 'assigned' && (
            <>
              {me && <label class="fchk"><input type="checkbox" checked={filters.assigneeIds.includes(me.id)} onChange={() => set({ assigneeIds: toggle(filters.assigneeIds, me.id) })} /> {t.me}</label>}
              <label class="fchk"><input type="checkbox" checked={filters.unassigned} onChange={() => set({ unassigned: !filters.unassigned })} /> {t.unassigned}</label>
              {people.filter((u) => u.id !== me?.id).map((u) => (
                <label class="fchk" key={u.id}><input type="checkbox" checked={filters.assigneeIds.includes(u.id)} onChange={() => set({ assigneeIds: toggle(filters.assigneeIds, u.id) })} /> {u.displayName ?? u.email}</label>
              ))}
            </>
          )}
          {edit === 'email' && (
            <>
              <div class="frow">
                <label>{t.olderThan}</label>
                <input type="number" min="0" aria-label={t.olderThan} value={filters.emailOlder ?? ''} onInput={(e) => set({ emailOlder: num((e.target as HTMLInputElement).value), emailWithin: null, noEmail: false })} />
                <span>{t.daysWord}</span>
              </div>
              <div class="frow">
                <label>{t.withinLast}</label>
                <input type="number" min="0" aria-label={t.withinLast} value={filters.emailWithin ?? ''} onInput={(e) => set({ emailWithin: num((e.target as HTMLInputElement).value), emailOlder: null, noEmail: false })} />
                <span>{t.daysWord}</span>
              </div>
              <label class="fchk"><input type="checkbox" checked={filters.noEmail} onChange={() => set({ noEmail: !filters.noEmail, emailOlder: null, emailWithin: null })} /> {t.noEmailAtAll}</label>
            </>
          )}
          {edit === 'stuck' && (
            <div class="frow"><label>{t.fInStage} ≥</label><input type="number" min="0" aria-label={t.fInStage} value={filters.stuckDays ?? ''} onInput={(e) => set({ stuckDays: num((e.target as HTMLInputElement).value) })} /><span>{t.daysWord}</span></div>
          )}
          {edit === 'value' && (
            <>
              <div class="frow"><label>{t.minimum}</label><input type="number" min="0" aria-label={t.minimum} value={filters.valueMin ?? ''} onInput={(e) => set({ valueMin: num((e.target as HTMLInputElement).value) })} /></div>
              <div class="frow"><label>{t.maximum}</label><input type="number" min="0" aria-label={t.maximum} value={filters.valueMax ?? ''} onInput={(e) => set({ valueMax: num((e.target as HTMLInputElement).value) })} /></div>
            </>
          )}
          <div class="actions"><button class="btn" onClick={() => setEdit(null)}>{t.done}</button></div>
        </div>
      )}
    </div>
  );
}
