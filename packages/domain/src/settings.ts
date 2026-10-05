/** Every configurable thing in PII is listed here once. The server validates against it; the Settings page is drawn from it. */
export type SettingScope = 'user' | 'node' | 'tenant';
export type SettingTab = 'me' | 'leftPanel' | 'notifications' | 'email' | 'team' | 'organization' | 'privacy';
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
    key: 'ui.goalRing', tab: 'me', type: 'bool', default: true, scopes: ['user', 'tenant'], lockable: false,
    label: { en: 'Show my weekly goal on Home', 'fr-CA': 'Afficher mon objectif de la semaine sur l’accueil' }, help: { en: 'A ring that fills as you finish tasks this week.', 'fr-CA': 'Un anneau qui se remplit à mesure que vous terminez des tâches cette semaine.' }, keywords: 'goal ring weekly target progress home',
  },
  {
    key: 'ui.weeklyGoal', tab: 'me', type: 'int', default: 10, min: 1, max: 200, scopes: ['user', 'tenant'], lockable: false,
    label: { en: 'Weekly goal: tasks to finish', 'fr-CA': 'Objectif hebdomadaire : tâches à terminer' }, help: { en: 'How many tasks you aim to finish each week.', 'fr-CA': 'Le nombre de tâches que vous visez chaque semaine.' }, keywords: 'goal weekly target tasks',
  },
  {
    key: 'ui.defaultPipeline', tab: 'me', type: 'string', default: '', maxLength: 40, scopes: ['user', 'node', 'tenant'], lockable: false,
    label: { en: 'Default pipeline', 'fr-CA': 'Pipeline par défaut' }, help: { en: 'Opens first when you click Pipelines.', 'fr-CA': 'S’ouvre en premier quand vous cliquez sur Pipelines.' }, keywords: 'pipeline default first open home',
  },
  {
    key: 'nav.layout', tab: 'leftPanel', type: 'json', default: { order: ['home', 'notifications', 'pipelines', 'contacts', 'merges', 'training', 'settings'], hidden: [] }, scopes: ALL, lockable: true,
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
  {
    key: 'notify.assigned', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A record is assigned to me', 'fr-CA': 'Un dossier m’est attribué' }, help: { en: 'Someone makes you the owner of a record.', 'fr-CA': 'Quelqu’un vous désigne responsable d’un dossier.' }, keywords: 'notification alert notify bell assigned',
  },
  {
    key: 'notify.task_assigned', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A task is assigned to me', 'fr-CA': 'Une tâche m’est attribuée' }, help: { en: 'Someone gives you a task.', 'fr-CA': 'Quelqu’un vous confie une tâche.' }, keywords: 'notification alert notify bell task assigned',
  },
  {
    key: 'notify.mention', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'I am mentioned in a note', 'fr-CA': 'On me mentionne dans une note' }, help: { en: 'Someone mentions you in a note.', 'fr-CA': 'Quelqu’un vous mentionne dans une note.' }, keywords: 'notification alert notify bell mention',
  },
  {
    key: 'notify.note', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'New note on my records', 'fr-CA': 'Nouvelle note sur mes dossiers' }, help: { en: 'Someone else adds a note to a record you own.', 'fr-CA': 'Quelqu’un d’autre ajoute une note à un dossier dont vous êtes responsable.' }, keywords: 'notification alert notify bell note',
  },
  {
    key: 'notify.stage_change', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'My record changes stage', 'fr-CA': 'Mon dossier change d’étape' }, help: { en: 'Someone else moves a record you own to another stage.', 'fr-CA': 'Quelqu’un d’autre déplace un dossier dont vous êtes responsable.' }, keywords: 'notification alert notify bell stage change',
  },
  {
    key: 'notify.capture', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A form or link captures a record', 'fr-CA': 'Un formulaire ou lien capte un dossier' }, help: { en: 'A web form, Calendly booking or webhook creates a record for you.', 'fr-CA': 'Un formulaire Web, une réservation Calendly ou un webhook crée un dossier pour vous.' }, keywords: 'notification alert notify bell capture',
  },
  {
    key: 'notify.merge_done', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'My mail merge finishes', 'fr-CA': 'Mon publipostage se termine' }, help: { en: 'All emails in your merge have been sent.', 'fr-CA': 'Tous les courriels de votre publipostage ont été envoyés.' }, keywords: 'notification alert notify bell merge done',
  },
  {
    key: 'notify.unsubscribed', tab: 'notifications', type: 'bool', default: false, scopes: ALL, lockable: false,
    label: { en: 'Someone unsubscribes from my merge', 'fr-CA': 'Quelqu’un se désabonne de mon publipostage' }, help: { en: 'A recipient clicks the unsubscribe link.', 'fr-CA': 'Un destinataire clique sur le lien de désabonnement.' }, keywords: 'notification alert notify bell unsubscribed',
  },
  {
    key: 'notify.invite_accepted', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'Someone I invited joins', 'fr-CA': 'Une personne que j’ai invitée se joint' }, help: { en: 'They accepted and signed in.', 'fr-CA': 'Elle a accepté et s’est connectée.' }, keywords: 'notification alert notify bell invitation accepted joined',
  },
  {
    key: 'notify.invite_stale', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'An invitation is stuck', 'fr-CA': 'Une invitation est bloquée' }, help: { en: 'Nothing has happened 3 days after you invited someone.', 'fr-CA': 'Rien ne s’est passé 3 jours après votre invitation.' }, keywords: 'notification alert notify bell invitation stale waiting',
  },
] as const;

export const NAV_ITEMS = ['home', 'notifications', 'pipelines', 'contacts', 'merges', 'training', 'settings'] as const;
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
