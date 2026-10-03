import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { NAV_ITEMS, SETTINGS, type NavLayout, type SettingDef, type SettingScope, type SettingTab } from '../../../packages/domain/src/settings.ts';
import type { Locale } from './types.ts';
import { AiAdminCard } from './ai.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Src = { type: 'default' | SettingScope; name?: string };
export interface Resolved { value: any; source: Src; locked: boolean; own?: any; inherited: any; inheritedSource: Src }
interface Level { key: string; scopeType: 'node' | 'tenant'; scopeId: string; value: any; locked: boolean; name: string | null }
interface CanSet { node: { id: string; name: string }[]; tenant: boolean }

export interface SettingsApi {
  values: Record<string, Resolved>;
  levels: Level[];
  canSet: CanSet;
  get<T>(key: string): T;
  set(key: string, scope: SettingScope, value: unknown, opts?: { scopeId?: string; locked?: boolean }): Promise<void>;
  clear(key: string, scope: SettingScope, scopeId?: string): Promise<void>;
  reload(): Promise<void>;
}

const changed = () => { try { window.dispatchEvent(new CustomEvent('pii-settings-changed')); } catch { /* not in a window */ } };

/** Loads the person's effective settings once and keeps them in step with every change. Null until loaded. */
export function useSettings(call: Call): SettingsApi | null {
  const [state, setState] = useState<{ values: Record<string, Resolved>; levels: Level[]; canSet: CanSet } | null>(null);
  const reload = useCallback(async () => {
    const r = await call('GET', '/v1/settings');
    setState({ values: r.settings, levels: r.levels ?? [], canSet: r.canSet ?? { node: [], tenant: false } });
  }, [call]);
  useEffect(() => { void reload().catch(() => undefined); }, [reload]);
  return useMemo(() => {
    if (!state) return null;
    const defaults = Object.fromEntries(SETTINGS.map((d) => [d.key, d.default]));
    return {
      ...state,
      get: <T,>(key: string) => (state.values[key]?.value ?? defaults[key]) as T,
      set: async (key, scope, value, opts) => { await call('PUT', `/v1/settings/${key}`, { scope, value, ...(opts?.scopeId ? { scopeId: opts.scopeId } : {}), ...(opts?.locked ? { locked: true } : {}) }); await reload(); changed(); },
      clear: async (key, scope, scopeId) => { await call('DELETE', `/v1/settings/${key}?scope=${scope}${scopeId ? `&scopeId=${scopeId}` : ''}`); await reload(); changed(); },
      reload,
    };
  }, [state, call, reload]);
}

const X = {
  'en': {
    title: 'Settings', search: 'Search settings (for example “snippets” or “left panel”)', noMatch: 'No setting matches that.',
    tabs: { me: 'Me', leftPanel: 'Left panel', email: 'Email and compose', team: 'Team and company' } as Record<SettingTab, string>,
    you: 'Set by you', company: 'Company setting', branch: (n: string) => `Set by ${n}`, def: 'Default', lockedBy: (n: string) => `Locked by ${n}`, useDefault: 'Use the default', useTeam: 'Use the team setting',
    saved: 'Saved', undo: 'Undo', failed: 'Could not save', history: 'Recent changes', noHistory: 'No changes yet.',
    layoutHelp: 'Choose what appears in Gmail’s left panel and drag to reorder. Settings always stays, so you can find your way back here.', preview: 'Preview', moveUp: 'Move up', moveDown: 'Move down', show: 'Show',
    nav: { home: 'Home', pipelines: 'Pipelines', contacts: 'Contacts', merges: 'Mail merges', training: 'Training', settings: 'Settings' } as Record<string, string>,
    none: 'No default',
    teamHelp: 'Set a value for a whole branch or for the company. Everyone beneath it gets that value; lock it to stop people changing it.',
    current: 'Current team and company settings', nothingSet: 'Nothing is set at team or company level yet.', level: 'Applies to', wholeCompany: 'Whole company', setting: 'Setting', value: 'Value', lock: 'Lock', lockedWord: 'locked', remove: 'Remove', apply: 'Apply',
    managersOnly: 'Only managers and administrators can set team and company values.', on: 'On', off: 'Off', pickLevel: 'Choose where to apply it',
  },
  'fr-CA': {
    title: 'Paramètres', search: 'Rechercher un paramètre (par exemple « extraits » ou « panneau »)', noMatch: 'Aucun paramètre ne correspond.',
    tabs: { me: 'Moi', leftPanel: 'Panneau de gauche', email: 'Courriel et rédaction', team: 'Équipe et entreprise' } as Record<SettingTab, string>,
    you: 'Défini par vous', company: 'Paramètre de l’entreprise', branch: (n: string) => `Défini par ${n}`, def: 'Par défaut', lockedBy: (n: string) => `Verrouillé par ${n}`, useDefault: 'Utiliser la valeur par défaut', useTeam: 'Utiliser le paramètre de l’équipe',
    saved: 'Enregistré', undo: 'Annuler', failed: 'Enregistrement impossible', history: 'Changements récents', noHistory: 'Aucun changement.',
    layoutHelp: 'Choisissez ce qui s’affiche dans le panneau de gauche de Gmail et glissez pour réordonner. Paramètres reste toujours affiché.', preview: 'Aperçu', moveUp: 'Monter', moveDown: 'Descendre', show: 'Afficher',
    nav: { home: 'Accueil', pipelines: 'Pipelines', contacts: 'Contacts', merges: 'Publipostages', training: 'Formation', settings: 'Paramètres' } as Record<string, string>,
    none: 'Aucun par défaut',
    teamHelp: 'Définissez une valeur pour une succursale entière ou pour l’entreprise. Tous ceux en dessous la reçoivent; verrouillez-la pour empêcher les changements.',
    current: 'Paramètres actuels de l’équipe et de l’entreprise', nothingSet: 'Rien n’est défini au niveau de l’équipe ou de l’entreprise.', level: 'S’applique à', wholeCompany: 'Toute l’entreprise', setting: 'Paramètre', value: 'Valeur', lock: 'Verrouiller', lockedWord: 'verrouillé', remove: 'Retirer', apply: 'Appliquer',
    managersOnly: 'Seuls les gestionnaires et les administrateurs peuvent définir ces valeurs.', on: 'Activé', off: 'Désactivé', pickLevel: 'Choisissez où l’appliquer',
  },
};

type Strs = (typeof X)['en'];

function SourceChip({ r, x }: { r: Resolved; x: Strs }) {
  const label = r.locked ? x.lockedBy(r.source.name ?? '') : r.source.type === 'user' ? x.you : r.source.type === 'tenant' ? x.company : r.source.type === 'node' ? x.branch(r.source.name ?? '') : x.def;
  return <span class={`srcchip${r.locked ? ' lockd' : ''}`}>{r.locked ? '🔒 ' : ''}{label}</span>;
}

/** The control for one setting's value. */
function Control({ def, value, onChange, disabled, locale, pipelines, x }: { def: SettingDef; value: any; onChange: (v: unknown) => void; disabled?: boolean; locale: Locale; pipelines: { id: string; name: string }[]; x: Strs }) {
  if (def.type === 'bool') return <label class="switch"><input type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} /> {value ? x.on : x.off}</label>;
  if (def.type === 'enum') return <select disabled={disabled} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>{def.options.map((o) => <option value={o.value}>{o.label[locale]}</option>)}</select>;
  if (def.type === 'int') return <input type="number" disabled={disabled} min={def.min} max={def.max} value={value} onChange={(e) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isInteger(n)) onChange(n); }} style={{ width: '90px' }} />;
  if (def.key === 'ui.defaultPipeline') return <select disabled={disabled} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}><option value="">{x.none}</option>{pipelines.map((p) => <option value={p.id}>{p.name}</option>)}</select>;
  if (def.type === 'string') return <input disabled={disabled} value={value} maxLength={def.maxLength} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />;
  return null;
}

function LayoutEditor({ layout, onChange, disabled, x }: { layout: NavLayout; onChange: (l: NavLayout) => void; disabled: boolean; x: Strs }) {
  const [drag, setDrag] = useState<string | null>(null);
  const order = layout.order.filter((id) => (NAV_ITEMS as readonly string[]).includes(id));
  const hidden = new Set(layout.hidden);
  const move = (id: string, to: number) => { const o = order.filter((i) => i !== id); o.splice(Math.max(0, Math.min(o.length, to)), 0, id); onChange({ order: o, hidden: layout.hidden }); };
  const toggle = (id: string) => { const h = new Set(hidden); if (h.has(id)) h.delete(id); else h.add(id); onChange({ order, hidden: [...h] }); };
  return (
    <div class="layout2">
      <ul class="navlist" aria-label={x.tabs.leftPanel}>
        {order.map((id, i) => (
          <li key={id} draggable={!disabled} class={drag === id ? 'dragging' : ''}
            onDragStart={() => setDrag(id)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (drag && drag !== id) move(drag, i); setDrag(null); }}>
            <span class="grip" aria-hidden="true">⋮⋮</span>
            <label><input type="checkbox" disabled={disabled || id === 'settings'} checked={!hidden.has(id)} onChange={() => toggle(id)} /> {x.nav[id] ?? id}</label>
            <span class="spacer" />
            <button class="ib" disabled={disabled || i === 0} aria-label={`${x.moveUp}: ${x.nav[id]}`} onClick={() => move(id, i - 1)}>↑</button>
            <button class="ib" disabled={disabled || i === order.length - 1} aria-label={`${x.moveDown}: ${x.nav[id]}`} onClick={() => move(id, i + 1)}>↓</button>
          </li>
        ))}
      </ul>
      <div class="navprev" aria-label={x.preview}>
        <div class="navprev-h">{x.preview}</div>
        <div class="navprev-b">
          <strong>PII</strong>
          {order.filter((id) => !hidden.has(id) || id === 'settings').map((id) => <div class="navprev-i">{x.nav[id] ?? id}</div>)}
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({ api, call, locale, initialTab, isManager, pipelines }: { api: SettingsApi; call: Call; locale: Locale; initialTab?: string; isManager: boolean; pipelines: { id: string; name: string }[] }) {
  const x = X[locale];
  const showTeam = api.canSet.tenant || api.canSet.node.length > 0;
  const tabs = (['me', 'leftPanel', 'email', ...(showTeam ? ['team'] : [])] as SettingTab[]);
  const [tab, setTab] = useState<SettingTab>(() => (tabs.includes(initialTab as SettingTab) ? (initialTab as SettingTab) : 'me'));
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState<{ key: string; scopeType: string; scopeName: string | null; newValue: unknown; changedAt: string; changedBy: string }[] | null>(null);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 30_000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { call('GET', '/v1/settings/history').then((r) => setHist(r.history), () => setHist([])); }, [call, api]);

  const label = (d: SettingDef) => d.label[locale];
  const save = async (d: SettingDef, value: unknown) => {
    setErr('');
    const before = api.values[d.key]?.own;
    try {
      await api.set(d.key, 'user', value);
      setToast({ text: `${label(d)}: ${x.saved}`, undo: async () => { if (before === undefined) await api.clear(d.key, 'user'); else await api.set(d.key, 'user', before); setToast(null); } });
    } catch (e) { setErr(`${x.failed}: ${(e as Error).message}`); }
  };
  const revert = async (d: SettingDef) => { setErr(''); const before = api.values[d.key]?.own; try { await api.clear(d.key, 'user'); setToast({ text: `${label(d)}: ${x.saved}`, undo: async () => { if (before !== undefined) await api.set(d.key, 'user', before); setToast(null); } }); } catch (e) { setErr((e as Error).message); } };

  const row = (d: SettingDef) => {
    const r = api.values[d.key];
    if (!r) return null;
    const canOwn = d.scopes.includes('user');
    const hasInherited = r.source.type === 'user' && (r.inheritedSource.type !== 'default' || true);
    return (
      <div class="srow" key={d.key}>
        <div class="srow-h"><strong id={`s-${d.key}`}>{label(d)}</strong> <SourceChip r={r} x={x} /></div>
        <p class="muted">{d.help[locale]}</p>
        {d.key === 'nav.layout'
          ? <LayoutEditor layout={r.value as NavLayout} disabled={r.locked || !canOwn} x={x} onChange={(l) => void save(d, l)} />
          : <Control def={d} value={r.value} disabled={r.locked || !canOwn} locale={locale} pipelines={pipelines} x={x} onChange={(v) => void save(d, v)} />}
        {hasInherited && !r.locked && r.own !== undefined && <button class="link" onClick={() => void revert(d)}>{r.inheritedSource.type === 'default' ? x.useDefault : x.useTeam}</button>}
      </div>
    );
  };

  const needle = q.trim().toLowerCase();
  const matches = needle ? SETTINGS.filter((d) => `${d.label.en} ${d.label['fr-CA']} ${d.help.en} ${d.help['fr-CA']} ${d.keywords}`.toLowerCase().includes(needle)) : [];

  return (
    <div class="settings">
      <h2>{x.title}</h2>
      <input class="ssearch" type="search" placeholder={x.search} aria-label={x.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {err && <p class="err" role="alert">{err}</p>}
      {needle ? (
        matches.length ? matches.map(row) : <p class="muted">{x.noMatch}</p>
      ) : (
        <>
          <div class="tabs sub" role="tablist">
            {tabs.map((k) => <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{x.tabs[k]}</button>)}
          </div>
          {tab !== 'team' && SETTINGS.filter((d) => d.tab === tab).map(row)}
          {tab === 'me' && (
            <details class="hist"><summary>{x.history}</summary>
              {hist && hist.length === 0 && <p class="muted">{x.noHistory}</p>}
              {(hist ?? []).slice(0, 15).map((h) => <div class="ev">{SETTINGS.find((d) => d.key === h.key)?.label[locale] ?? h.key}<small>{h.scopeType === 'user' ? x.you : h.scopeName ?? x.company} · {h.changedBy} · {new Date(h.changedAt).toLocaleString(locale)}</small></div>)}
            </details>
          )}
          {tab === 'team' && <TeamTab api={api} call={call} locale={locale} pipelines={pipelines} isManager={isManager} x={x} onError={setErr} />}
        </>
      )}
      {toast && <div class="toast" role="status">{toast.text}{toast.undo && <button class="link" onClick={() => void toast.undo!()}>{x.undo}</button>}</div>}
    </div>
  );
}

function TeamTab({ api, call, locale, pipelines, isManager, x, onError }: { api: SettingsApi; call: Call; locale: Locale; pipelines: { id: string; name: string }[]; isManager: boolean; x: Strs; onError: (m: string) => void }) {
  const eligible = SETTINGS.filter((d) => d.scopes.includes('node') || d.scopes.includes('tenant'));
  const [key, setKey] = useState(eligible[0]?.key ?? '');
  const def = eligible.find((d) => d.key === key);
  const levelsOpts = [...(api.canSet.tenant && def?.scopes.includes('tenant') ? [{ id: 'tenant', name: x.wholeCompany }] : []), ...(def?.scopes.includes('node') ? api.canSet.node : [])];
  const [lvl, setLvl] = useState('');
  const [val, setVal] = useState<any>(def?.default);
  const [lock, setLock] = useState(false);
  useEffect(() => { setVal(def?.default); setLock(false); setLvl(''); }, [key]);
  if (!isManager && !api.canSet.tenant && api.canSet.node.length === 0) return <p class="muted">{x.managersOnly}</p>;
  const apply = async () => {
    if (!def || !lvl) return;
    try { await api.set(def.key, lvl === 'tenant' ? 'tenant' : 'node', val, { scopeId: lvl === 'tenant' ? undefined : lvl, locked: lock && def.lockable }); } catch (e) { onError((e as Error).message); }
  };
  const fmt = (d: SettingDef | undefined, v: any) => (d?.key === 'nav.layout' ? (v.order as string[]).filter((i) => !(v.hidden as string[]).includes(i)).map((i) => x.nav[i] ?? i).join(', ') : d?.type === 'bool' ? (v ? x.on : x.off) : d?.type === 'enum' ? d.options.find((o) => o.value === v)?.label[locale] ?? String(v) : d?.key === 'ui.defaultPipeline' ? pipelines.find((p) => p.id === v)?.name ?? x.none : String(v));
  return (
    <div>
      <p class="muted">{x.teamHelp}</p>
      <h3>{x.current}</h3>
      {api.levels.length === 0 && <p class="muted">{x.nothingSet}</p>}
      {api.levels.map((l) => {
        const d = SETTINGS.find((s) => s.key === l.key);
        const mayEdit = l.scopeType === 'tenant' ? api.canSet.tenant : api.canSet.node.some((n) => n.id === l.scopeId);
        return (
          <div class="erow" key={`${l.key}${l.scopeId}`}>
            <span><strong>{d?.label[locale] ?? l.key}</strong> <small class="muted">{l.scopeType === 'tenant' ? x.wholeCompany : l.name} · {fmt(d, l.value)}{l.locked ? ` · 🔒 ${x.lockedWord}` : ''}</small></span>
            <span class="spacer" />
            {mayEdit && <button class="link" onClick={() => void api.clear(l.key, l.scopeType, l.scopeType === 'node' ? l.scopeId : undefined).catch((e) => onError((e as Error).message))}>{x.remove}</button>}
          </div>
        );
      })}
      {api.canSet.tenant && <AiAdminCard call={call} locale={locale} />}
      <h3>{x.apply}</h3>
      <div class="erow wrap2">
        <select aria-label={x.setting} value={key} onChange={(e) => setKey((e.target as HTMLSelectElement).value)}>{eligible.map((d) => <option value={d.key}>{d.label[locale]}</option>)}</select>
        <select aria-label={x.level} value={lvl} onChange={(e) => setLvl((e.target as HTMLSelectElement).value)}><option value="">{x.pickLevel}</option>{levelsOpts.map((o) => <option value={o.id}>{o.name}</option>)}</select>
      </div>
      {def && def.key !== 'nav.layout' && <div class="erow"><Control def={def} value={val} onChange={setVal} locale={locale} pipelines={pipelines} x={x} /></div>}
      {def?.key === 'nav.layout' && <LayoutEditor layout={val as NavLayout} disabled={false} x={x} onChange={setVal} />}
      <div class="erow">
        {def?.lockable && <label class="check"><input type="checkbox" checked={lock} onChange={(e) => setLock((e.target as HTMLInputElement).checked)} /> 🔒 {x.lock}</label>}
        <span class="spacer" />
        <button class="btn" disabled={!lvl} onClick={() => void apply()}>{x.apply}</button>
      </div>
    </div>
  );
}
