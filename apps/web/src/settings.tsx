import { PrivacyTab } from './privacy.tsx';
import { IaContractingSettings } from './ia-contracting-settings.tsx';
import { PeopleHub } from './people.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LMS } from './features.ts';
import { NAV_ITEMS, SETTINGS, type NavLayout, type SettingDef, type SettingScope, type SettingTab } from '../../../packages/domain/src/settings.ts';
import type { ComposeApi, Locale } from './types.ts';
import { AiAdminCard } from './ai.tsx';
import { VendorPanel } from './vendors.tsx';
import { CertificateSigner } from './report.tsx';
import { RetentionPolicies } from './retention-settings.tsx';
import { SnippetsPanel } from './snippets.tsx';

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

export type TabKey =
  | 'people'
  | 'me'
  | 'notifications'
  | 'email'
  | 'companyRules'
  | 'recordsSignatures'
  | 'privacy'
  | 'gmailSidePanel'
  | 'advanced';

interface Who {
  canAdminister: boolean;
  canSeeOrg: boolean;
  isTenantAdmin: boolean;
  isCompliance: boolean;
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
      set: async (key, scope, value, opts) => {
        await call('PUT', `/v1/settings/${key}`, { scope, value, ...(opts?.scopeId ? { scopeId: opts.scopeId } : {}), ...(opts?.locked ? { locked: true } : {}) });
        await reload();
        changed();
      },
      clear: async (key, scope, scopeId) => {
        await call('DELETE', `/v1/settings/${key}?scope=${scope}${scopeId ? `&scopeId=${scopeId}` : ''}`);
        await reload();
        changed();
      },
      reload,
    };
  }, [state, call, reload]);
}

const X = {
  en: {
    title: 'Settings',
    search: 'Search settings (for example “snippets” or “left panel”)',
    noMatch: 'No setting matches that.',
    tabs: {
      people: 'People',
      me: 'Me',
      notifications: 'Notifications',
      email: 'Email and compose',
      companyRules: 'Company rules',
      recordsSignatures: 'Records and signatures',
      privacy: 'Privacy',
      gmailSidePanel: 'Gmail side panel',
      advanced: 'Advanced',
    } as Record<TabKey, string>,
    you: 'Set by you',
    company: 'Company setting',
    branch: (n: string) => `Set by ${n}`,
    def: 'Default',
    lockedBy: (n: string) => `Locked by ${n}`,
    useDefault: 'Use the default',
    useTeam: 'Use the team setting',
    saved: 'Saved',
    undo: 'Undo',
    failed: 'Could not save',
    history: 'Recent changes',
    noHistory: 'No changes yet.',
    layoutHelp: 'This is the side panel inside Gmail. It does not change the menu on this website. People see it in Gmail after the extension that reads this layout is installed.',
    preview: 'Preview',
    moveUp: 'Move up',
    moveDown: 'Move down',
    show: 'Show',
    unsaved: 'You have unsaved changes',
    discard: 'Discard',
    saveChanges: 'Save changes',
    nav: {
      home: 'Home',
      renewals: 'Renewals',
      compliance: 'Compliance',
      notifications: 'Notifications',
      pipelines: 'Pipelines',
      contacts: 'Contacts',
      merges: 'Mail merges',
      training: 'Training',
      settings: 'Settings',
    } as Record<string, string>,
    none: 'No default',
    teamHelp: 'Set a value for a whole branch or for the company. Everyone beneath it gets that value; lock it to stop people changing it.',
    current: 'Current team and company settings',
    nothingSet: 'Nothing is set at team or company level yet.',
    level: 'Applies to',
    wholeCompany: 'Whole company',
    setting: 'Setting',
    value: 'Value',
    lock: 'Lock',
    lockedWord: 'locked',
    remove: 'Remove',
    apply: 'Apply',
    managersOnly: 'Only managers and administrators can set team and company values.',
    on: 'On',
    off: 'Off',
    pickLevel: 'Choose where to apply it',
    onlyImportant: 'Only the important ones',
    onlyImportantToast: (lockedCount: number) =>
      lockedCount > 0
        ? `Only the important ones: Saved (${lockedCount} locked ${lockedCount === 1 ? 'setting' : 'settings'} left unchanged)`
        : 'Only the important ones: Saved',
    setByCompanyLocked: 'Set by the company. You cannot change this.',
    applyToWholeCompany: 'Apply to the whole company',
    cancel: 'Cancel',
    leaveWithoutSaving: 'Leave without saving the side panel?',
    notificationsSubtitle: 'These are the alerts inside PII. Email reminders for training, continuing education, and licences are the switch at the bottom.',
    companyRulesSubtitle: 'These apply to the whole company.',
    sections: {
      myWork: 'My work',
      compliance: 'Compliance',
      learning: 'Learning',
    },
    confirmWholeCompanyTitle: 'Confirm company-wide setting',
    confirmWholeCompanyPrompt: (settingName: string, locked: boolean) =>
      `Apply ${settingName} to the whole company? (${locked ? 'Locked' : 'Not locked'})`,
  },
  'fr-CA': {
    title: 'Paramètres',
    search: 'Rechercher un paramètre (par exemple « extraits » ou « panneau »)',
    noMatch: 'Aucun paramètre ne correspond.',
    tabs: {
      people: 'Personnes',
      me: 'Moi',
      notifications: 'Notifications',
      email: 'Courriel et rédaction',
      companyRules: 'Règles de l’entreprise',
      recordsSignatures: 'Dossiers et signatures',
      privacy: 'Confidentialité',
      gmailSidePanel: 'Panneau latéral de Gmail',
      advanced: 'Avancé',
    } as Record<TabKey, string>,
    you: 'Défini par vous',
    company: 'Paramètre de l’entreprise',
    branch: (n: string) => `Défini par ${n}`,
    def: 'Par défaut',
    lockedBy: (n: string) => `Verrouillé par ${n}`,
    useDefault: 'Utiliser la valeur par défaut',
    useTeam: 'Utiliser le paramètre de l’équipe',
    saved: 'Enregistré',
    undo: 'Annuler',
    failed: 'Enregistrement impossible',
    history: 'Changements récents',
    noHistory: 'Aucun changement.',
    layoutHelp: 'Il s’agit du panneau latéral à l’intérieur de Gmail. Il ne modifie pas le menu de ce site Web. Les personnes le voient dans Gmail une fois installée l’extension qui lit cette disposition.',
    preview: 'Aperçu',
    moveUp: 'Monter',
    moveDown: 'Descendre',
    show: 'Afficher',
    unsaved: 'Vous avez des modifications non enregistrées',
    discard: 'Annuler',
    saveChanges: 'Enregistrer',
    nav: {
      home: 'Accueil',
      renewals: 'Renouvellements',
      compliance: 'Conformité',
      notifications: 'Notifications',
      pipelines: 'Pipelines',
      contacts: 'Contacts',
      merges: 'Publipostages',
      training: 'Formation',
      settings: 'Paramètres',
    } as Record<string, string>,
    none: 'Aucun par défaut',
    teamHelp: 'Définissez une valeur pour une succursale entière ou pour l’entreprise. Tous ceux en dessous la reçoivent; verrouillez-la pour empêcher les changements.',
    current: 'Paramètres actuels de l’équipe et de l’entreprise',
    nothingSet: 'Rien n’est défini au niveau de l’équipe ou de l’entreprise.',
    level: 'S’applique à',
    wholeCompany: 'Toute l’entreprise',
    setting: 'Paramètre',
    value: 'Valeur',
    lock: 'Verrouiller',
    lockedWord: 'verrouillé',
    remove: 'Retirer',
    apply: 'Appliquer',
    managersOnly: 'Seuls les gestionnaires et les administrateurs peuvent définir ces valeurs.',
    on: 'Activé',
    off: 'Désactivé',
    pickLevel: 'Choisissez où l’appliquer',
    onlyImportant: 'Seulement les importantes',
    onlyImportantToast: (lockedCount: number) =>
      lockedCount > 0
        ? `Seulement les importantes : Enregistré (${lockedCount} ${lockedCount === 1 ? 'paramètre verrouillé ignoré' : 'paramètres verrouillés ignorés'})`
        : 'Seulement les importantes : Enregistré',
    setByCompanyLocked: 'Défini par l’entreprise. Vous ne pouvez pas le changer.',
    applyToWholeCompany: 'Appliquer à toute l’entreprise',
    cancel: 'Annuler',
    leaveWithoutSaving: 'Quitter sans enregistrer le panneau latéral?',
    notificationsSubtitle: 'Il s’agit des alertes dans PII. Les rappels par courriel pour la formation, la formation continue et les permis se trouvent au bas.',
    companyRulesSubtitle: 'Ces règles s’appliquent à toute l’entreprise.',
    sections: {
      myWork: 'Mon travail',
      compliance: 'Conformité',
      learning: 'Apprentissage',
    },
    confirmWholeCompanyTitle: 'Confirmer le paramètre pour l’entreprise',
    confirmWholeCompanyPrompt: (settingName: string, locked: boolean) =>
      `Appliquer ${settingName} à toute l’entreprise? (${locked ? 'Verrouillé' : 'Non verrouillé'})`,
  },
};

type Strs = (typeof X)['en'];

function SourceChip({ r, x }: { r: Resolved; x: Strs }) {
  const label = r.locked ? x.lockedBy(r.source.name ?? '') : r.source.type === 'user' ? x.you : r.source.type === 'tenant' ? x.company : r.source.type === 'node' ? x.branch(r.source.name ?? '') : x.def;
  return <span class={`srcchip${r.locked ? ' lockd' : ''}`}>{r.locked ? '🔒 ' : ''}{label}</span>;
}

/** The control for one setting's value. */
function Control({
  def,
  value,
  onChange,
  disabled,
  locale,
  pipelines,
  x,
}: {
  def: SettingDef;
  value: any;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  locale: Locale;
  pipelines: { id: string; name: string }[];
  x: Strs;
}) {
  if (def.type === 'bool') {
    return (
      <label class="switch">
        <input type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
        {' '}{value ? x.on : x.off}
      </label>
    );
  }
  if (def.type === 'enum') {
    return (
      <select disabled={disabled} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {def.options.map((o) => <option key={o.value} value={o.value}>{o.label[locale]}</option>)}
      </select>
    );
  }
  if (def.type === 'int') {
    return (
      <input
        type="number"
        disabled={disabled}
        min={def.min}
        max={def.max}
        value={value}
        onChange={(e) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isInteger(n)) onChange(n);
        }}
        style={{ width: '90px' }}
      />
    );
  }
  if (def.key === 'ui.defaultPipeline') {
    return (
      <select disabled={disabled} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">{x.none}</option>
        {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );
  }
  if (def.type === 'string') {
    return <input disabled={disabled} value={value} maxLength={def.maxLength} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />;
  }
  return null;
}

function LayoutEditor({ layout, onChange, disabled, x }: { layout: NavLayout; onChange: (l: NavLayout) => void; disabled: boolean; x: Strs }) {
  const [drag, setDrag] = useState<string | null>(null);
  const order = layout.order.filter((id) => (NAV_ITEMS as readonly string[]).includes(id) && (LMS || id !== 'training'));
  const hidden = new Set(layout.hidden);
  const move = (id: string, to: number) => {
    const o = order.filter((i) => i !== id);
    o.splice(Math.max(0, Math.min(o.length, to)), 0, id);
    onChange({ order: o, hidden: layout.hidden });
  };
  const toggle = (id: string) => {
    const h = new Set(hidden);
    if (h.has(id)) h.delete(id); else h.add(id);
    onChange({ order, hidden: [...h] });
  };
  return (
    <div class="layout2">
      <ul class="navlist" aria-label={x.tabs.gmailSidePanel}>
        {order.map((id, i) => (
          <li
            key={id}
            draggable={!disabled}
            class={drag === id ? 'dragging' : ''}
            onDragStart={() => setDrag(id)}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drag !== id) move(drag, i);
              setDrag(null);
            }}
          >
            <span class="grip" aria-hidden="true">⋮⋮</span>
            <label>
              <input type="checkbox" disabled={disabled || id === 'settings'} checked={!hidden.has(id)} onChange={() => toggle(id)} />
              {' '}{x.nav[id] ?? id}
            </label>
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
          {order.filter((id) => !hidden.has(id) || id === 'settings').map((id) => <div key={id} class="navprev-i">{x.nav[id] ?? id}</div>)}
        </div>
      </div>
    </div>
  );
}

function resolveOldTarget(raw?: string): TabKey | undefined {
  if (!raw) return undefined;
  if (raw === 'organization') return 'people';
  if (raw === 'leftPanel') return 'gmailSidePanel';
  if (raw === 'team') return 'advanced';
  if (raw === 'company-rules' || raw === 'companyRules') return 'companyRules';
  if (raw === 'records-signatures' || raw === 'recordsSignatures') return 'recordsSignatures';
  const valid: TabKey[] = ['people', 'me', 'notifications', 'email', 'companyRules', 'recordsSignatures', 'privacy', 'gmailSidePanel', 'advanced'];
  return valid.includes(raw as TabKey) ? (raw as TabKey) : undefined;
}

const IMPORTANT_NOTIF_KEYS = [
  'notify.assigned',
  'notify.task_assigned',
  'notify.compliance_expiry',
  'notify.aml_alert',
  'notify.compliance_review',
  'notify.learning_due',
] as const;

const NOTIF_GROUPS = {
  myWork: [
    'notify.assigned', 'notify.task_assigned', 'notify.mention', 'notify.note',
    'notify.stage_change', 'notify.capture', 'notify.merge_done', 'notify.unsubscribed',
    'notify.invite_accepted', 'notify.invite_stale', 'notify.thread_shared', 'notify.document_added',
  ],
  compliance: [
    'notify.compliance_expiry', 'notify.aml_alert', 'notify.first_week_late',
    'notify.vault_alert', 'notify.compliance_review', 'notify.appointment_request',
  ],
  learning: [
    'notify.learning_due', 'notify.team_overdue', 'notify.ce_reminder',
    'notify.course_request', 'notify.course_decision', 'notify.quiz_attempts',
  ],
} as const;

export function SettingsPage({
  api,
  call,
  locale,
  onLocale,
  initialTab,
  isManager,
  pipelines,
  compose,
}: {
  compose?: ComposeApi;
  api: SettingsApi;
  call: Call;
  locale: Locale;
  onLocale: (l: Locale) => void;
  initialTab?: string;
  isManager: boolean;
  pipelines: { id: string; name: string }[];
}) {
  const x = X[locale];

  // Who sees what state
  const [who, setWho] = useState<Who | null>(null);
  useEffect(() => {
    call('GET', '/v1/me').then(
      (m) => {
        const roles: { role: string }[] = Array.isArray(m.roles) ? m.roles : [];
        const isCompliance = roles.some((r) => r.role === 'compliance');
        const isMgr = roles.some((r) => r.role === 'manager');
        setWho({
          canAdminister: Boolean(m.canAdminister),
          canSeeOrg: Boolean(m.canAdminister) || isCompliance || isMgr,
          isTenantAdmin: Boolean(m.isTenantAdmin),
          isCompliance,
        });
      },
      () => {
        // If profile call fails, fallback safe defaults (only personal screens visible)
        setWho({
          canAdminister: false,
          canSeeOrg: false,
          isTenantAdmin: false,
          isCompliance: false,
        });
      }
    );
  }, [call]);

  const showAdvanced = Boolean(api.canSet.tenant || api.canSet.node.length > 0);
  const canSeePeople = Boolean(who?.canSeeOrg);
  const canSeeCompanyRules = Boolean(who?.canSeeOrg);
  const canSeeRecordsSignatures = Boolean(who?.isTenantAdmin || who?.isCompliance);

  // Available tabs calculation
  const tabs = useMemo<TabKey[]>(() => {
    const list: TabKey[] = [];
    if (canSeePeople) list.push('people');
    list.push('me');
    list.push('notifications');
    list.push('email');
    if (canSeeCompanyRules) list.push('companyRules');
    if (canSeeRecordsSignatures) list.push('recordsSignatures');
    list.push('privacy');
    list.push('gmailSidePanel');
    if (showAdvanced) list.push('advanced');
    return list;
  }, [canSeePeople, canSeeCompanyRules, canSeeRecordsSignatures, showAdvanced]);

  // Tab selection: default to 'me' while loading to avoid flash of People followed by jump
  const [tab, setTabState] = useState<TabKey>(() => {
    const resolved = resolveOldTarget(initialTab);
    return resolved ?? 'me';
  });

  // When who finishes loading, if no explicit initialTab was requested, open People for those who have it
  const initialHandled = useRef(Boolean(initialTab));
  useEffect(() => {
    if (!who) return;
    if (!initialHandled.current) {
      initialHandled.current = true;
      if (who.canSeeOrg) {
        setTabState('people');
      }
    }
  }, [who]);

  // If active tab is not in available tabs after who loads, jump to first available
  useEffect(() => {
    if (who && !tabs.includes(tab)) {
      setTabState(tabs[0] ?? 'me');
    }
  }, [who, tabs, tab]);

  // Draft layout for Gmail side panel
  const [layoutDraft, setLayoutDraft] = useState<NavLayout | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const isLayoutDirty = layoutDraft !== null;

  // Tab change handler with side-panel guard
  const changeTab = (next: TabKey) => {
    if (tab === 'gmailSidePanel' && isLayoutDirty) {
      if (!window.confirm(x.leaveWithoutSaving)) {
        return;
      }
      setLayoutDraft(null);
    }
    setTabState(next);
  };

  // Toast and error state
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savingImportant, setSavingImportant] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 30_000);
    return () => clearTimeout(id);
  }, [toast]);

  // Change history
  const [hist, setHist] = useState<{ key: string; scopeType: string; scopeName: string | null; newValue: unknown; changedAt: string; changedBy: string }[] | null>(null);
  useEffect(() => {
    call('GET', '/v1/settings/history').then((r) => setHist(r.history), () => setHist([]));
  }, [call, api]);

  // Search state
  const [q, setQ] = useState('');
  const [tabBeforeSearch, setTabBeforeSearch] = useState<TabKey>(tab);
  const onSearchInput = (val: string) => {
    if (!q && val) setTabBeforeSearch(tab);
    if (q && !val) setTabState(tabBeforeSearch);
    setQ(val);
  };

  const label = (d: SettingDef) => d.label[locale];

  // Generic setting save with undo
  const saveSetting = async (key: string, scope: SettingScope, value: unknown, labelText: string, opts?: { scopeId?: string; locked?: boolean }) => {
    setRowErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
    const before = scope === 'user' ? api.values[key]?.own : api.values[key]?.value;
    try {
      await api.set(key, scope, value, opts);
      setToast({
        text: `${labelText}: ${x.saved}`,
        undo: async () => {
          if (scope === 'user') {
            if (before === undefined) await api.clear(key, 'user');
            else await api.set(key, 'user', before);
          } else {
            if (before === undefined) await api.clear(key, scope, opts?.scopeId);
            else await api.set(key, scope, before, opts);
          }
          setToast(null);
        },
      });
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [key]: (e as Error).message }));
      throw e;
    }
  };

  const revert = async (d: SettingDef) => {
    setRowErrors((prev) => { const n = { ...prev }; delete n[d.key]; return n; });
    const before = api.values[d.key]?.own;
    try {
      await api.clear(d.key, 'user');
      setToast({
        text: `${label(d)}: ${x.saved}`,
        undo: async () => {
          if (before !== undefined) await api.set(d.key, 'user', before);
          setToast(null);
        },
      });
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [d.key]: (e as Error).message }));
    }
  };

  // Only the important ones handler
  const applyOnlyImportant = async () => {
    if (savingImportant) return;
    setSavingImportant(true);
    try {
      const allNotifKeys = [...NOTIF_GROUPS.myWork, ...NOTIF_GROUPS.compliance, ...NOTIF_GROUPS.learning];
      const beforeState: { key: string; before: unknown }[] = [];
      let lockedCount = 0;

      for (const k of allNotifKeys) {
        const r = api.values[k];
        if (r?.locked) {
          lockedCount++;
          continue;
        }
        beforeState.push({ key: k, before: r?.own });
        const target = IMPORTANT_NOTIF_KEYS.includes(k as any);
        if (r?.value !== target) {
          await api.set(k, 'user', target);
        }
      }

      setToast({
        text: x.onlyImportantToast(lockedCount),
        undo: async () => {
          for (const item of beforeState) {
            if (item.before === undefined) await api.clear(item.key, 'user');
            else await api.set(item.key, 'user', item.before);
          }
          setToast(null);
        },
      });
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, 'notify.important': (e as Error).message }));
    } finally {
      setSavingImportant(false);
    }
  };

  // Gmail side panel save
  const saveLayout = async () => {
    if (!layoutDraft) return;
    setSavingLayout(true);
    try {
      await saveSetting('nav.layout', 'user', layoutDraft, x.tabs.gmailSidePanel);
      setLayoutDraft(null);
    } catch {
      // error set in saveSetting
    } finally {
      setSavingLayout(false);
    }
  };

  // Standard row rendering for a SettingDef
  const renderSettingRow = (d: SettingDef, isCompanyRule = false) => {
    const r = api.values[d.key];
    if (!r) return null;
    const canOwn = isCompanyRule ? Boolean(api.canSet.tenant) : d.scopes.includes('user');
    const isLocked = r.locked || (isCompanyRule && !api.canSet.tenant);
    const hasInherited = r.source.type === 'user' && r.own !== undefined;
    const rowErr = rowErrors[d.key];

    return (
      <div class="srow" key={d.key} id={`s-${d.key}`}>
        <div class="srow-h">
          <strong id={`s-${d.key}`}>{label(d)}</strong>
          <SourceChip r={r} x={x} />
        </div>
        <p class="muted">{d.help[locale]}</p>
        <Control
          def={d}
          value={r.value}
          disabled={isLocked || !canOwn}
          locale={locale}
          pipelines={pipelines}
          x={x}
          onChange={(val) => {
            if (isCompanyRule) {
              void saveSetting(d.key, 'tenant', val, label(d));
            } else {
              void saveSetting(d.key, 'user', val, label(d));
            }
          }}
        />
        {rowErr && <p class="err" role="alert" style={{ marginTop: '6px' }}>{rowErr}</p>}
        {!isCompanyRule && hasInherited && !r.locked && (
          <button class="link" onClick={() => void revert(d)}>
            {r.inheritedSource.type === 'default' ? x.useDefault : x.useTeam}
          </button>
        )}
      </div>
    );
  };

  // Search catalog definition
  interface SearchItem {
    id: string;
    screen: TabKey;
    screenName: string;
    title: string;
    help: string;
    keywords: string;
    visible: boolean;
  }

  const searchCatalog = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];

    // 1. Language on Me
    items.push({
      id: 's-me-language',
      screen: 'me',
      screenName: x.tabs.me,
      title: locale === 'fr-CA' ? 'Langue' : 'Language',
      help: locale === 'fr-CA' ? 'La langue des écrans et des courriels, pour vous seul.' : 'The language of the screens and emails, for you only.',
      keywords: 'language langue french english locale francais',
      visible: true,
    });

    // 2. Settings from domain
    for (const d of SETTINGS) {
      let screen: TabKey = 'me';
      let visible = true;

      if (d.key.startsWith('ui.')) {
        screen = 'me';
      } else if (d.key.startsWith('notify.')) {
        screen = 'notifications';
      } else if (d.key === 'email.snippetsButton' || d.key === 'merge.dailyCap') {
        screen = 'email';
      } else if (d.key === 'compliance.eoMinLimit' || d.key === 'pipelines.partnerCreate' || d.key === 'pipelines.partnerCap') {
        screen = 'companyRules';
        visible = canSeeCompanyRules;
      } else if (d.key === 'nav.layout') {
        screen = 'gmailSidePanel';
      }

      items.push({
        id: `s-${d.key}`,
        screen,
        screenName: x.tabs[screen],
        title: d.label[locale],
        help: d.help[locale],
        keywords: `${d.keywords} ${d.label.en} ${d.label['fr-CA']} ${d.help.en} ${d.help['fr-CA']}`,
        visible,
      });
    }

    // 3. Email reminders on Notifications
    items.push({
      id: 's-notify-email',
      screen: 'notifications',
      screenName: x.tabs.notifications,
      title: locale === 'fr-CA' ? 'Rappels par courriel' : 'Email reminders',
      help: locale === 'fr-CA' ? 'Recevoir aussi par courriel les rappels de formation, de FPC et d’expiration de permis.' : 'Also send training, CE and licence-expiry reminders by email.',
      keywords: 'email mail reminders training ce licence expiry courriel rappels',
      visible: true,
    });

    // 4. Only the important ones on Notifications
    items.push({
      id: 's-notify-important',
      screen: 'notifications',
      screenName: x.tabs.notifications,
      title: x.onlyImportant,
      help: locale === 'fr-CA' ? 'Active les six alertes critiques et désactive les autres.' : 'Turns on the six critical alerts and turns off the other eighteen.',
      keywords: 'important alerts notifications critical six seulement importantes',
      visible: true,
    });

    // 5. Snippets on Email
    items.push({
      id: 's-email-snippets',
      screen: 'email',
      screenName: x.tabs.email,
      title: locale === 'fr-CA' ? 'Bibliothèque de textes' : 'Snippets library',
      help: locale === 'fr-CA' ? 'Textes réutilisables pour vos courriels.' : 'Reusable text for your emails.',
      keywords: 'snippets canned replies templates library extraits textes bibliotheque',
      visible: true,
    });

    // 6. People Hub on People
    items.push({
      id: 's-people-hub',
      screen: 'people',
      screenName: x.tabs.people,
      title: locale === 'fr-CA' ? 'Personnes et annuaire' : 'People and directory',
      help: locale === 'fr-CA' ? 'Annuaire, invitations, rôles, organigramme et journal d’activité.' : 'Directory, invitations, roles, structure and activity log.',
      keywords: 'people directory invite add person roles structure activity annuaire inviter structure membres',
      visible: canSeePeople,
    });

    // 7. Vendors on Records & signatures
    items.push({
      id: 's-vendors',
      screen: 'recordsSignatures',
      screenName: x.tabs.recordsSignatures,
      title: locale === 'fr-CA' ? 'Fournisseurs de signatures' : 'Signing vendors',
      help: locale === 'fr-CA' ? 'Fournisseurs de signature électronique et clés d’API.' : 'Digital signature providers and credentials.',
      keywords: 'signing vendors docusign onespan signatures signataires',
      visible: canSeeRecordsSignatures,
    });

    // 8. Retention on Records & signatures
    items.push({
      id: 's-retention',
      screen: 'recordsSignatures',
      screenName: x.tabs.recordsSignatures,
      title: locale === 'fr-CA' ? 'Politiques de conservation' : 'Retention policies',
      help: locale === 'fr-CA' ? 'Périodes de conservation des dossiers et suspensions légales.' : 'Record retention periods and legal holds.',
      keywords: 'retention policies legal hold archive conservation dossiers',
      visible: canSeeRecordsSignatures,
    });

    // 9. Certificate signer on Records & signatures
    items.push({
      id: 's-certificates',
      screen: 'recordsSignatures',
      screenName: x.tabs.recordsSignatures,
      title: locale === 'fr-CA' ? 'Signataire des certificats' : 'Certificate signer',
      help: locale === 'fr-CA' ? 'Nom et titre du dirigeant responsable sur les certificats de formation.' : 'Principal broker name and title on completion certificates.',
      keywords: 'certificate signer principal broker signature certificat formation',
      visible: Boolean(who?.isTenantAdmin),
    });

    // 10. Privacy
    items.push({
      id: 's-privacy',
      screen: 'privacy',
      screenName: x.tabs.privacy,
      title: x.tabs.privacy,
      help: locale === 'fr-CA' ? 'Avis de confidentialité et consentement.' : 'Privacy notice and consent records.',
      keywords: 'privacy confidentialite consent avis loi 25 rgpd',
      visible: true,
    });

    // 11. Gmail side panel
    items.push({
      id: 's-gmail-layout',
      screen: 'gmailSidePanel',
      screenName: x.tabs.gmailSidePanel,
      title: x.tabs.gmailSidePanel,
      help: x.layoutHelp,
      keywords: 'left panel gmail side panel navigation menu sidebar disposition panneau gauche',
      visible: true,
    });

    // 12. Advanced
    items.push({
      id: 's-advanced',
      screen: 'advanced',
      screenName: x.tabs.advanced,
      title: x.tabs.advanced,
      help: x.teamHelp,
      keywords: 'advanced team company levels locks branch avancement succursale equipe entreprise',
      visible: showAdvanced,
    });

    return items;
  }, [x, locale, canSeePeople, canSeeCompanyRules, canSeeRecordsSignatures, showAdvanced, who?.isTenantAdmin]);

  const needle = q.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!needle) return [];
    return searchCatalog.filter((item) => {
      if (!item.visible) return false;
      const haystack = `${item.title} ${item.help} ${item.keywords} ${item.screenName}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [needle, searchCatalog]);

  return (
    <div class="settings">
      <div class="shead">
        <h2>{x.title}</h2>
        <input
          class="ssearch"
          type="search"
          placeholder={x.search}
          aria-label={x.search}
          value={q}
          onInput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
        />
      </div>

      {needle ? (
        <div class="smain">
          {searchMatches.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {searchMatches.map((item) => (
                <div
                  class="srow"
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer', padding: '12px 14px', borderRadius: '10px', background: 'var(--tint)' }}
                  onClick={() => {
                    changeTab(item.screen);
                    setQ('');
                    setTimeout(() => {
                      document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 60);
                  }}
                >
                  <div class="srow-h">
                    <strong>{item.title}</strong>
                  </div>
                  <p class="muted" style={{ margin: '2px 0 4px' }}>{item.help}</p>
                  <small style={{ color: 'var(--pri)', fontWeight: 600 }}>{item.screenName}</small>
                </div>
              ))}
            </div>
          ) : (
            <p class="muted">{x.noMatch}</p>
          )}
        </div>
      ) : (
        <div class="sgrid">
          <nav class="snav" role="tablist" aria-label={x.title}>
            {tabs.map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => changeTab(k)}
              >
                {x.tabs[k]}
              </button>
            ))}
          </nav>

          <div class="smain">
            {/* 1. PEOPLE */}
            {tab === 'people' && canSeePeople && (
              <div id="s-people-hub">
                <PeopleHub call={call} locale={locale} isTenantAdmin={Boolean(who?.isTenantAdmin)} compose={compose} />
              </div>
            )}

            {/* 2. ME */}
            {tab === 'me' && (
              <MeTab
                api={api}
                call={call}
                locale={locale}
                onLocale={onLocale}
                pipelines={pipelines}
                x={x}
                hist={hist}
                rowErrors={rowErrors}
                onSave={saveSetting}
                onRevert={revert}
              />
            )}

            {/* 3. NOTIFICATIONS */}
            {tab === 'notifications' && (
              <NotificationsTab
                api={api}
                call={call}
                locale={locale}
                x={x}
                savingImportant={savingImportant}
                onApplyOnlyImportant={applyOnlyImportant}
                rowErrors={rowErrors}
                onSave={saveSetting}
                onRevert={revert}
              />
            )}

            {/* 4. EMAIL AND COMPOSE */}
            {tab === 'email' && (
              <EmailTab
                api={api}
                call={call}
                locale={locale}
                x={x}
                renderRow={renderSettingRow}
              />
            )}

            {/* 5. COMPANY RULES */}
            {tab === 'companyRules' && canSeeCompanyRules && (
              <CompanyRulesTab
                api={api}
                locale={locale}
                x={x}
                renderRow={(d) => renderSettingRow(d, true)}
              />
            )}
            {tab === 'companyRules' && who?.isTenantAdmin && (
              <IaContractingSettings call={call} locale={locale} editable={Boolean(who.isTenantAdmin)} />
            )}
            

            {/* 6. RECORDS AND SIGNATURES */}
            {tab === 'recordsSignatures' && canSeeRecordsSignatures && (
              <RecordsSignaturesTab
                call={call}
                locale={locale}
                isTenantAdmin={Boolean(who?.isTenantAdmin)}
              />
            )}

            {/* 7. PRIVACY */}
            {tab === 'privacy' && (
              <div id="s-privacy">
                <PrivacyTab call={call} locale={locale} />
              </div>
            )}

            {/* 8. GMAIL SIDE PANEL */}
            {tab === 'gmailSidePanel' && (
              <GmailSidePanelTab
                api={api}
                x={x}
                layoutDraft={layoutDraft}
                onChangeLayout={setLayoutDraft}
              />
            )}

            {/* 9. ADVANCED */}
            {tab === 'advanced' && showAdvanced && (
              <div id="s-advanced">
                <AdvancedTab
                  api={api}
                  call={call}
                  locale={locale}
                  pipelines={pipelines}
                  isManager={isManager}
                  x={x}
                  onError={(msg) => setToast({ text: `${x.failed}: ${msg}` })}
                  onToast={(t) => setToast(t)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* GMAIL SIDE PANEL SAVE BAR (Only screen with save bar) */}
      {tab === 'gmailSidePanel' && isLayoutDirty && (
        <div class="savebar" role="region" aria-label={x.unsaved}>
          <span>{x.unsaved}</span>
          <span class="spacer" />
          <button class="btn quiet" disabled={savingLayout} onClick={() => setLayoutDraft(null)}>
            {x.discard}
          </button>
          <button class="btn" disabled={savingLayout} onClick={() => void saveLayout()}>
            {savingLayout ? '…' : x.saveChanges}
          </button>
        </div>
      )}

      {toast && (
        <div class="toast" role="status">
          {toast.text}
          {toast.undo && (
            <button class="link" onClick={() => void toast.undo!()}>
              {x.undo}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 2. ME TAB */
function MeTab({
  api,
  call,
  locale,
  onLocale,
  pipelines,
  x,
  hist,
  rowErrors,
  onSave,
  onRevert,
}: {
  api: SettingsApi;
  call: Call;
  locale: Locale;
  onLocale: (l: Locale) => void;
  pipelines: { id: string; name: string }[];
  x: Strs;
  hist: { key: string; scopeType: string; scopeName: string | null; newValue: unknown; changedAt: string; changedBy: string }[] | null;
  rowErrors: Record<string, string>;
  onSave: (key: string, scope: SettingScope, value: unknown, labelText: string) => Promise<void>;
  onRevert: (d: SettingDef) => Promise<void>;
}) {
  const fr = locale === 'fr-CA';

  // 1. Language Row
  const changeLanguage = async (v: Locale) => {
    const prevLocale = locale;
    try {
      await call('PUT', '/v1/me/locale', { locale: v });
      try { localStorage.setItem('pii.lang', v); } catch {}
      onLocale(v);
      const langLabel = v === 'fr-CA' ? 'Langue' : 'Language';
      window.dispatchEvent(new CustomEvent('pii-toast', {
        detail: {
          text: `${langLabel}: ${X[v].saved}`,
          undo: async () => {
            await call('PUT', '/v1/me/locale', { locale: prevLocale });
            try { localStorage.setItem('pii.lang', prevLocale); } catch {}
            onLocale(prevLocale);
          },
        },
      }));
    } catch {
      // error handled locally
    }
  };

  // Weekly Goal states
  const goalRingDef = SETTINGS.find((s) => s.key === 'ui.goalRing')!;
  const weeklyGoalDef = SETTINGS.find((s) => s.key === 'ui.weeklyGoal')!;
  const rGoalRing = api.values['ui.goalRing'];
  const rWeeklyGoal = api.values['ui.weeklyGoal'];
  const goalRingVal = rGoalRing ? Boolean(rGoalRing.value) : true;
  const [goalNumLocal, setGoalNumLocal] = useState<number>(rWeeklyGoal ? Number(rWeeklyGoal.value) : 10);
  useEffect(() => {
    if (rWeeklyGoal) setGoalNumLocal(Number(rWeeklyGoal.value));
  }, [rWeeklyGoal?.value]);

  const defs = useMemo(() => {
    return {
      theme: SETTINGS.find((s) => s.key === 'ui.theme')!,
      compact: SETTINGS.find((s) => s.key === 'ui.compact')!,
      defaultView: SETTINGS.find((s) => s.key === 'ui.defaultView')!,
      defaultPipeline: SETTINGS.find((s) => s.key === 'ui.defaultPipeline')!,
      startTips: SETTINGS.find((s) => s.key === 'ui.startTips')!,
    };
  }, []);

  const renderSingleRow = (d: SettingDef) => {
    const r = api.values[d.key];
    if (!r) return null;
    const canOwn = d.scopes.includes('user');
    const hasInherited = r.source.type === 'user' && r.own !== undefined;
    const rowErr = rowErrors[d.key];

    return (
      <div class="srow" key={d.key} id={`s-${d.key}`}>
        <div class="srow-h">
          <strong id={`s-${d.key}`}>{d.label[locale]}</strong>
          <SourceChip r={r} x={x} />
        </div>
        <p class="muted">{d.help[locale]}</p>
        <Control
          def={d}
          value={r.value}
          disabled={r.locked || !canOwn}
          locale={locale}
          pipelines={pipelines}
          x={x}
          onChange={(val) => void onSave(d.key, 'user', val, d.label[locale])}
        />
        {rowErr && <p class="err" role="alert" style={{ marginTop: '6px' }}>{rowErr}</p>}
        {hasInherited && !r.locked && (
          <button class="link" onClick={() => void onRevert(d)}>
            {r.inheritedSource.type === 'default' ? x.useDefault : x.useTeam}
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* 1. Language */}
      <div class="srow" id="s-me-language">
        <div class="srow-h">
          <strong>{fr ? 'Langue' : 'Language'}</strong>
        </div>
        <p class="muted">
          {fr ? 'La langue des écrans et des courriels, pour vous seul.' : 'The language of the screens and emails, for you only.'}
        </p>
        <select
          aria-label={fr ? 'Langue' : 'Language'}
          value={locale}
          onChange={(e) => void changeLanguage((e.target as HTMLSelectElement).value as Locale)}
        >
          <option value="en">English</option>
          <option value="fr-CA">Français (Canada)</option>
        </select>
        {rowErrors['locale'] && <p class="err" role="alert" style={{ marginTop: '6px' }}>{rowErrors['locale']}</p>}
      </div>

      {/* 2. Appearance */}
      {renderSingleRow(defs.theme)}

      {/* 3. Compact rows */}
      {renderSingleRow(defs.compact)}

      {/* 4. Pipelines open as */}
      {renderSingleRow(defs.defaultView)}

      {/* 5. Default pipeline */}
      {renderSingleRow(defs.defaultPipeline)}

      {/* 6. Show getting-started tips */}
      {renderSingleRow(defs.startTips)}

      {/* 7. Show my weekly goal on Home (switch & number on the same row) */}
      {rGoalRing && rWeeklyGoal && (
        <div class="srow" key="ui.goalRing" id="s-ui.weeklyGoal">
          <div class="srow-h">
            <strong id="s-ui.goalRing">{goalRingDef.label[locale]}</strong>
            <SourceChip r={rGoalRing} x={x} />
          </div>
          <p class="muted">{goalRingDef.help[locale]}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <label class="switch">
              <input
                type="checkbox"
                disabled={rGoalRing.locked}
                checked={goalRingVal}
                onChange={(e) => {
                  const checked = (e.target as HTMLInputElement).checked;
                  void onSave('ui.goalRing', 'user', checked, goalRingDef.label[locale]);
                }}
              />
              {' '}{goalRingVal ? x.on : x.off}
            </label>

            {goalRingVal && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <label for="weekly-goal-input" style={{ fontSize: '13px', color: 'var(--mute)' }}>
                  {weeklyGoalDef.label[locale]}:
                </label>
                <input
                  id="weekly-goal-input"
                  type="number"
                  min={1}
                  max={200}
                  disabled={rWeeklyGoal.locked}
                  value={goalNumLocal}
                  onBlur={(e) => {
                    const n = Number((e.target as HTMLInputElement).value);
                    if (!Number.isInteger(n) || n < 1 || n > 200) {
                      setGoalNumLocal(Number(rWeeklyGoal.value));
                      return;
                    }
                    if (n !== rWeeklyGoal.value) {
                      void onSave('ui.weeklyGoal', 'user', n, weeklyGoalDef.label[locale]);
                    }
                  }}
                  onChange={(e) => {
                    const n = Number((e.target as HTMLInputElement).value);
                    setGoalNumLocal(n);
                    if (Number.isInteger(n) && n >= 1 && n <= 200) {
                      void onSave('ui.weeklyGoal', 'user', n, weeklyGoalDef.label[locale]);
                    }
                  }}
                  style={{ width: '90px' }}
                />
              </div>
            )}
          </div>
          {rowErrors['ui.goalRing'] && <p class="err" role="alert" style={{ marginTop: '6px' }}>{rowErrors['ui.goalRing']}</p>}
          {rowErrors['ui.weeklyGoal'] && <p class="err" role="alert" style={{ marginTop: '6px' }}>{rowErrors['ui.weeklyGoal']}</p>}
        </div>
      )}

      {/* 8. Change history */}
      <details class="hist">
        <summary>{x.history}</summary>
        {hist && hist.length === 0 && <p class="muted">{x.noHistory}</p>}
        {(hist ?? []).slice(0, 15).map((h, i) => (
          <div key={i} class="ev">
            {SETTINGS.find((d) => d.key === h.key)?.label[locale] ?? h.key}
            <small>
              {h.scopeType === 'user' ? x.you : h.scopeName ?? x.company} · {h.changedBy} · {new Date(h.changedAt).toLocaleString(locale)}
            </small>
          </div>
        ))}
      </details>
    </div>
  );
}

/** 3. NOTIFICATIONS TAB */
function NotificationsTab({
  api,
  call,
  locale,
  x,
  savingImportant,
  onApplyOnlyImportant,
  rowErrors,
  onSave,
  onRevert,
}: {
  api: SettingsApi;
  call: Call;
  locale: Locale;
  x: Strs;
  savingImportant: boolean;
  onApplyOnlyImportant: () => Promise<void>;
  rowErrors: Record<string, string>;
  onSave: (key: string, scope: SettingScope, value: unknown, labelText: string) => Promise<void>;
  onRevert: (d: SettingDef) => Promise<void>;
}) {
  const renderRowByKey = (k: string) => {
    const d = SETTINGS.find((s) => s.key === k);
    if (!d) return null;
    const r = api.values[d.key];
    if (!r) return null;
    const canOwn = d.scopes.includes('user');
    const rowErr = rowErrors[d.key];

    return (
      <div class="srow" key={d.key} id={`s-${d.key}`}>
        <div class="srow-h">
          <strong id={`s-${d.key}`}>{d.label[locale]}</strong>
          <SourceChip r={r} x={x} />
        </div>
        <p class="muted">{d.help[locale]}</p>
        <label class="switch">
          <input
            type="checkbox"
            disabled={r.locked || !canOwn}
            checked={Boolean(r.value)}
            onChange={(e) => void onSave(d.key, 'user', (e.target as HTMLInputElement).checked, d.label[locale])}
          />
          {' '}{r.value ? x.on : x.off}
        </label>
        {rowErr && <p class="err" role="alert" style={{ marginTop: '6px' }}>{rowErr}</p>}
        {r.source.type === 'user' && r.own !== undefined && !r.locked && (
          <button class="link" onClick={() => void onRevert(d)}>
            {r.inheritedSource.type === 'default' ? x.useDefault : x.useTeam}
          </button>
        )}
      </div>
    );
  };

  return (
    <div id="s-notifications">
      <p class="muted" style={{ marginBottom: '14px' }}>{x.notificationsSubtitle}</p>
      <div style={{ marginBottom: '20px' }}>
        <button
          class="btn quiet"
          id="s-notify-important"
          disabled={savingImportant}
          onClick={() => void onApplyOnlyImportant()}
        >
          {savingImportant ? '…' : x.onlyImportant}
        </button>
      </div>

      <h3 style={{ marginTop: '16px', marginBottom: '8px' }}>{x.sections.myWork}</h3>
      {NOTIF_GROUPS.myWork.map(renderRowByKey)}

      <h3 style={{ marginTop: '24px', marginBottom: '8px' }}>{x.sections.compliance}</h3>
      {NOTIF_GROUPS.compliance.map(renderRowByKey)}

      <h3 style={{ marginTop: '24px', marginBottom: '8px' }}>{x.sections.learning}</h3>
      {NOTIF_GROUPS.learning.map(renderRowByKey)}

      <div id="s-notify-email" style={{ marginTop: '24px' }}>
        <MailReminders call={call} locale={locale} />
      </div>
    </div>
  );
}

/** 4. EMAIL AND COMPOSE TAB */
function EmailTab({
  api,
  call,
  locale,
  x,
  renderRow,
}: {
  api: SettingsApi;
  call: Call;
  locale: Locale;
  x: Strs;
  renderRow: (d: SettingDef) => preact.JSX.Element | null;
}) {
  const snippetsButtonDef = SETTINGS.find((s) => s.key === 'email.snippetsButton');
  const dailyCapDef = SETTINGS.find((s) => s.key === 'merge.dailyCap');

  return (
    <div>
      <div id="s-email-snippets">
        <SnippetsRow call={call} locale={locale} />
      </div>
      {snippetsButtonDef && renderRow(snippetsButtonDef)}
      {dailyCapDef && renderRow(dailyCapDef)}
    </div>
  );
}

/** 5. COMPANY RULES TAB */
function CompanyRulesTab({
  api,
  locale,
  x,
  renderRow,
}: {
  api: SettingsApi;
  locale: Locale;
  x: Strs;
  renderRow: (d: SettingDef) => preact.JSX.Element | null;
}) {
  const canEdit = Boolean(api.canSet.tenant);
  const eoDef = SETTINGS.find((s) => s.key === 'compliance.eoMinLimit');
  const partnerCreateDef = SETTINGS.find((s) => s.key === 'pipelines.partnerCreate');
  const partnerCapDef = SETTINGS.find((s) => s.key === 'pipelines.partnerCap');

  return (
    <div id="s-company-rules">
      <p class="muted" style={{ marginBottom: '12px' }}>{x.companyRulesSubtitle}</p>
      {!canEdit && (
        <p style={{ fontWeight: 500, color: 'var(--ink)', marginBottom: '16px' }}>
          {x.setByCompanyLocked}
        </p>
      )}
      {eoDef && renderRow(eoDef)}
      {partnerCreateDef && renderRow(partnerCreateDef)}
      {partnerCapDef && renderRow(partnerCapDef)}
    </div>
  );
}

/** 6. RECORDS AND SIGNATURES TAB */
function RecordsSignaturesTab({
  call,
  locale,
  isTenantAdmin,
}: {
  call: Call;
  locale: Locale;
  isTenantAdmin: boolean;
}) {
  return (
    <div>
      <div id="s-vendors">
        <VendorPanel call={call} locale={locale} />
      </div>
      <div id="s-retention" style={{ marginTop: '24px' }}>
        <RetentionPolicies call={call} locale={locale} />
      </div>
      {isTenantAdmin && (
        <div id="s-certificates" style={{ marginTop: '24px' }}>
          <CertificateSigner call={call} locale={locale} />
        </div>
      )}
    </div>
  );
}

/** 8. GMAIL SIDE PANEL TAB */
function GmailSidePanelTab({
  api,
  x,
  layoutDraft,
  onChangeLayout,
}: {
  api: SettingsApi;
  x: Strs;
  layoutDraft: NavLayout | null;
  onChangeLayout: (l: NavLayout) => void;
}) {
  const rLayout = api.values['nav.layout'];
  const current = layoutDraft ?? (rLayout?.value as NavLayout) ?? { order: [...NAV_ITEMS], hidden: [] };

  return (
    <div id="s-gmail-layout">
      <div class="srow">
        <div class="srow-h">
          <strong>{x.tabs.gmailSidePanel}</strong>
          {rLayout && <SourceChip r={rLayout} x={x} />}
        </div>
        <p class="muted">{x.layoutHelp}</p>
        <LayoutEditor
          layout={current}
          disabled={Boolean(rLayout?.locked)}
          x={x}
          onChange={onChangeLayout}
        />
      </div>
    </div>
  );
}

/** 9. ADVANCED TAB */
function AdvancedTab({
  api,
  call,
  locale,
  pipelines,
  isManager,
  x,
  onError,
  onToast,
}: {
  api: SettingsApi;
  call: Call;
  locale: Locale;
  pipelines: { id: string; name: string }[];
  isManager: boolean;
  x: Strs;
  onError: (m: string) => void;
  onToast: (t: { text: string; undo?: () => Promise<void> }) => void;
}) {
  const eligible = SETTINGS.filter((d) => d.scopes.includes('node') || d.scopes.includes('tenant'));
  const [key, setKey] = useState(eligible[0]?.key ?? '');
  const def = eligible.find((d) => d.key === key);
  const levelsOpts = [
    ...(api.canSet.tenant && def?.scopes.includes('tenant') ? [{ id: 'tenant', name: x.wholeCompany }] : []),
    ...(def?.scopes.includes('node') ? api.canSet.node : []),
  ];
  const [lvl, setLvl] = useState('');
  const [val, setVal] = useState<any>(def?.default);
  const [lock, setLock] = useState(false);

  // Whole-company confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    key: string;
    settingName: string;
    value: any;
    locked: boolean;
  } | null>(null);

  useEffect(() => {
    setVal(def?.default);
    setLock(false);
    setLvl('');
  }, [key]);

  if (!isManager && !api.canSet.tenant && api.canSet.node.length === 0) {
    return <p class="muted">{x.managersOnly}</p>;
  }

  const handleApplyClick = () => {
    if (!def || !lvl) return;
    if (lvl === 'tenant') {
      // Whole-company confirmation prompt
      setConfirmModal({
        key: def.key,
        settingName: def.label[locale],
        value: val,
        locked: lock && def.lockable,
      });
      return;
    }
    // Branch applies immediately
    void applyBranch(def.key, lvl, val, lock && def.lockable);
  };

  const applyBranch = async (k: string, nodeId: string, v: any, isLocked: boolean) => {
    const targetDef = SETTINGS.find((s) => s.key === k);
    const before = api.levels.find((l) => l.key === k && l.scopeType === 'node' && l.scopeId === nodeId);
    try {
      await api.set(k, 'node', v, { scopeId: nodeId, locked: isLocked });
      onToast({
        text: `${targetDef?.label[locale] ?? k}: ${x.saved}`,
        undo: async () => {
          if (before) await api.set(k, 'node', before.value, { scopeId: nodeId, locked: before.locked });
          else await api.clear(k, 'node', nodeId);
        },
      });
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const applyWholeCompany = async () => {
    if (!confirmModal) return;
    const { key: k, settingName, value: v, locked: isLocked } = confirmModal;
    setConfirmModal(null);
    const before = api.levels.find((l) => l.key === k && l.scopeType === 'tenant');
    try {
      await api.set(k, 'tenant', v, { locked: isLocked });
      onToast({
        text: `${settingName}: ${x.saved}`,
        undo: async () => {
          if (before) await api.set(k, 'tenant', before.value, { locked: before.locked });
          else await api.clear(k, 'tenant');
        },
      });
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const fmt = (d: SettingDef | undefined, v: any) =>
    d?.key === 'nav.layout'
      ? (v.order as string[]).filter((i) => !(v.hidden as string[]).includes(i)).map((i) => x.nav[i] ?? i).join(', ')
      : d?.type === 'bool'
      ? (v ? x.on : x.off)
      : d?.type === 'enum'
      ? d.options.find((o) => o.value === v)?.label[locale] ?? String(v)
      : d?.key === 'ui.defaultPipeline'
      ? pipelines.find((p) => p.id === v)?.name ?? x.none
      : String(v);

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
            <span>
              <strong>{d?.label[locale] ?? l.key}</strong>{' '}
              <small class="muted">
                {l.scopeType === 'tenant' ? x.wholeCompany : l.name} · {fmt(d, l.value)}
                {l.locked ? ` · 🔒 ${x.lockedWord}` : ''}
              </small>
            </span>
            <span class="spacer" />
            {mayEdit && (
              <button
                class="link"
                onClick={() =>
                  void api.clear(l.key, l.scopeType, l.scopeType === 'node' ? l.scopeId : undefined).catch((e) => onError((e as Error).message))
                }
              >
                {x.remove}
              </button>
            )}
          </div>
        );
      })}

      {api.canSet.tenant && <AiAdminCard call={call} locale={locale} />}

      <h3>{x.apply}</h3>
      <div class="erow wrap2">
        <select aria-label={x.setting} value={key} onChange={(e) => setKey((e.target as HTMLSelectElement).value)}>
          {eligible.map((d) => <option key={d.key} value={d.key}>{d.label[locale]}</option>)}
        </select>
        <select aria-label={x.level} value={lvl} onChange={(e) => setLvl((e.target as HTMLSelectElement).value)}>
          <option value="">{x.pickLevel}</option>
          {levelsOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {def && def.key !== 'nav.layout' && (
        <div class="erow">
          <Control def={def} value={val} onChange={setVal} locale={locale} pipelines={pipelines} x={x} />
        </div>
      )}
      {def?.key === 'nav.layout' && (
        <LayoutEditor layout={val as NavLayout} disabled={false} x={x} onChange={setVal} />
      )}
      <div class="erow">
        {def?.lockable && (
          <label class="check">
            <input type="checkbox" checked={lock} onChange={(e) => setLock((e.target as HTMLInputElement).checked)} />
            {' '}🔒 {x.lock}
          </label>
        )}
        <span class="spacer" />
        <button class="btn" disabled={!lvl} onClick={handleApplyClick}>
          {x.apply}
        </button>
      </div>

      {/* Confirmation Modal for Whole Company */}
      {confirmModal && (
        <div class="mdl-back" role="dialog" aria-modal="true" aria-label={x.confirmWholeCompanyTitle}>
          <div class="mdl small">
            <div class="mdl-top">
              <h3>{x.confirmWholeCompanyTitle}</h3>
              <button class="x" onClick={() => setConfirmModal(null)}>×</button>
            </div>
            <div class="mdl-body" style={{ minHeight: 'auto', padding: '12px 0' }}>
              <p>
                <strong>{confirmModal.settingName}</strong>
              </p>
              <p class="muted">
                {x.level}: <strong>{x.wholeCompany}</strong>
              </p>
              <p class="muted">
                {confirmModal.locked ? `🔒 ${x.lockedWord}` : (locale === 'fr-CA' ? 'Non verrouillé' : 'Not locked')}
              </p>
            </div>
            <div class="mdl-foot">
              <button class="btn quiet" onClick={() => setConfirmModal(null)}>
                {x.cancel}
              </button>
              <span class="spacer" />
              <button class="btn" onClick={() => void applyWholeCompany()}>
                {x.applyToWholeCompany}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Email copies of training, CE and licence reminders */
function MailReminders({ call, locale }: { call: Call; locale: Locale }) {
  const fr = locale === 'fr-CA';
  const [mail, setMail] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', '/v1/me/email-reminders').then(setMail, () => setMail(null)); }, [call]);
  if (!mail?.available) return null;
  const toggle = async (enabled: boolean) => {
    setErr('');
    try {
      await call('PUT', '/v1/me/email-reminders', { enabled });
      setMail({ ...mail, enabled });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div class="srow">
      <div class="srow-h">
        <strong>{fr ? 'Rappels par courriel' : 'Email reminders'}</strong>
      </div>
      <p class="muted">
        {fr
          ? 'Recevoir aussi par courriel les rappels de formation, de FPC et d’expiration de permis.'
          : 'Also send training, CE and licence-expiry reminders by email.'}
      </p>
      <label class="erow">
        <input type="checkbox" checked={mail.enabled} onChange={(e) => void toggle((e.target as HTMLInputElement).checked)} />
        {' '}{fr ? 'Envoyer les rappels par courriel' : 'Send reminders by email'}
      </label>
      {err && <p class="err" role="alert">{err}</p>}
    </div>
  );
}

/** The snippets library (reusable email text) */
function SnippetsRow({ call, locale }: { call: Call; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const fr = locale === 'fr-CA';
  return (
    <div class="srow">
      <div class="srow-h">
        <strong>{fr ? 'Bibliothèque de textes' : 'Snippets library'}</strong>
      </div>
      <p class="muted">
        {fr
          ? 'Textes réutilisables pour vos courriels. Le bouton d’insertion se règle plus bas.'
          : 'Reusable text for your emails. The insert button is set below.'}
      </p>
      <button class="btn quiet" onClick={() => setOpen(true)}>
        {fr ? 'Gérer les textes' : 'Manage snippets'}
      </button>
      {open && <SnippetsPanel call={call} locale={locale} onClose={() => setOpen(false)} />}
    </div>
  );
}
