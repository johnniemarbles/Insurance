/** Every configurable thing in PII is listed here once. The server validates against it; the Settings page is drawn from it. */
export type SettingScope = 'user' | 'node' | 'tenant';
export type SettingTab = 'me' | 'leftPanel' | 'email' | 'team';
type L = { en: string; 'fr-CA': string };

interface Base { key: string; tab: SettingTab; scopes: readonly SettingScope[]; lockable: boolean; label: L; help: L; keywords: string }
export type SettingDef = Base & (
  | { type: 'bool'; default: boolean }
  | { type: 'enum'; default: string; options: readonly { value: string; label: L }[] }
  | { type: 'int'; default: number; min: number; max: number }
  | { type: 'string'; default: string; maxLength: number }
  | { type: 'json'; default: unknown }
);

const ALL = ['user', 'node', 'tenant'] as const;

export const SETTINGS: readonly SettingDef[] = [
  {
    key: 'ui.defaultView', tab: 'me', type: 'enum', default: 'table', scopes: ALL, lockable: false,
    options: [{ value: 'table', label: { en: 'Table', 'fr-CA': 'Tableau' } }, { value: 'board', label: { en: 'Board', 'fr-CA': 'Tableau kanban' } }],
    label: { en: 'Pipelines open as', 'fr-CA': 'Les pipelines s’ouvrent en' }, help: { en: 'The layout you see first. You can still switch in a pipeline.', 'fr-CA': 'La disposition affichée en premier. Vous pouvez la changer dans un pipeline.' }, keywords: 'table board kanban layout view',
  },
  {
    key: 'ui.startTips', tab: 'me', type: 'bool', default: true, scopes: ['user', 'tenant'], lockable: false,
    label: { en: 'Show getting-started tips', 'fr-CA': 'Afficher les conseils de démarrage' }, help: { en: 'The short guide at the top of an empty pipeline.', 'fr-CA': 'Le court guide au haut d’un pipeline vide.' }, keywords: 'tips help guide onboarding start',
  },
  {
    key: 'ui.defaultPipeline', tab: 'me', type: 'string', default: '', maxLength: 40, scopes: ['user', 'node', 'tenant'], lockable: false,
    label: { en: 'Default pipeline', 'fr-CA': 'Pipeline par défaut' }, help: { en: 'Opens first when you click Pipelines.', 'fr-CA': 'S’ouvre en premier quand vous cliquez sur Pipelines.' }, keywords: 'pipeline default first open home',
  },
  {
    key: 'nav.layout', tab: 'leftPanel', type: 'json', default: { order: ['home', 'pipelines', 'contacts', 'merges', 'training', 'settings'], hidden: [] }, scopes: ALL, lockable: true,
    label: { en: 'Left panel layout', 'fr-CA': 'Disposition du panneau de gauche' }, help: { en: 'Which items appear in Gmail’s left panel, and in what order.', 'fr-CA': 'Les éléments affichés dans le panneau de gauche de Gmail, et leur ordre.' }, keywords: 'left panel navigation menu sidebar order hide reorder',
  },
  {
    key: 'email.snippetsButton', tab: 'email', type: 'bool', default: true, scopes: ['user', 'node', 'tenant'], lockable: false,
    label: { en: 'Show the Snippets button when writing an email', 'fr-CA': 'Afficher le bouton Extraits dans la rédaction' }, help: { en: 'Adds a PII snippets button to Gmail’s compose window.', 'fr-CA': 'Ajoute un bouton Extraits PII à la fenêtre de rédaction de Gmail.' }, keywords: 'snippets compose canned replies button',
  },
  {
    key: 'merge.dailyCap', tab: 'email', type: 'int', default: 400, min: 10, max: 400, scopes: ALL, lockable: true,
    label: { en: 'Mail merge: emails per day', 'fr-CA': 'Publipostage : courriels par jour' }, help: { en: 'The most merge emails sent from your Gmail in one day. 400 is the highest allowed.', 'fr-CA': 'Le maximum de courriels de publipostage envoyés par jour depuis votre Gmail. 400 est le plafond.' }, keywords: 'mail merge limit cap daily send quota',
  },
] as const;

export const NAV_ITEMS = ['home', 'pipelines', 'contacts', 'merges', 'training', 'settings'] as const;
export type NavItemId = (typeof NAV_ITEMS)[number];
export interface NavLayout { order: string[]; hidden: string[] }

export const settingDef = (key: string): SettingDef | undefined => SETTINGS.find((s) => s.key === key);

/** Returns the cleaned value, or an error message. */
export function validateSetting(def: SettingDef, v: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (def.type) {
    case 'bool': return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, error: 'Expected on or off' };
    case 'enum': return typeof v === 'string' && def.options.some((o) => o.value === v) ? { ok: true, value: v } : { ok: false, error: 'Not one of the allowed choices' };
    case 'int': return typeof v === 'number' && Number.isInteger(v) && v >= def.min && v <= def.max ? { ok: true, value: v } : { ok: false, error: `Enter a whole number from ${def.min} to ${def.max}` };
    case 'string': return typeof v === 'string' && v.length <= def.maxLength ? { ok: true, value: v } : { ok: false, error: 'Too long' };
    case 'json': {
      if (def.key === 'nav.layout') {
        const o = v as Partial<NavLayout> | null;
        const strs = (a: unknown) => Array.isArray(a) && a.length <= 20 && a.every((x) => typeof x === 'string' && (NAV_ITEMS as readonly string[]).includes(x));
        if (!o || typeof o !== 'object' || !strs(o.order) || !strs(o.hidden)) return { ok: false, error: 'Not a valid layout' };
        const order = [...new Set(o.order as string[])];
        for (const id of NAV_ITEMS) if (!order.includes(id)) order.push(id);
        return { ok: true, value: { order, hidden: [...new Set(o.hidden as string[])] } };
      }
      return { ok: false, error: 'Unsupported' };
    }
  }
}
