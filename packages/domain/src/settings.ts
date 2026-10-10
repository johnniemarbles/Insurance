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
    key: 'ui.theme', tab: 'me', type: 'enum', default: 'light', scopes: ['user', 'tenant'], lockable: false,
    options: [{ value: 'light', label: { en: 'Light', 'fr-CA': 'Clair' } }, { value: 'dark', label: { en: 'Dark', 'fr-CA': 'Sombre' } }, { value: 'auto', label: { en: 'Match my computer', 'fr-CA': 'Selon mon ordinateur' } }],
    label: { en: 'Appearance', 'fr-CA': 'Apparence' }, help: { en: 'Light or dark colours for PII pages. Gmail keeps its own theme.', 'fr-CA': 'Couleurs claires ou sombres pour les pages PII. Gmail garde son propre thème.' }, keywords: 'dark mode light theme appearance night colours',
  },
  {
    key: 'ui.compact', tab: 'me', type: 'bool', default: false, scopes: ['user', 'tenant'], lockable: false,
    label: { en: 'Compact rows', 'fr-CA': 'Lignes compactes' }, help: { en: 'Tighter tables and lists so more fits on screen.', 'fr-CA': 'Tableaux et listes plus serrés pour en voir davantage.' }, keywords: 'compact dense density rows tight',
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
    key: 'nav.layout', tab: 'leftPanel', type: 'json', default: { order: ['home', 'notifications', 'pipelines', 'renewals', 'compliance', 'contacts', 'merges', 'training', 'settings'], hidden: [] }, scopes: ALL, lockable: true,
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
    key: 'compliance.eoMinLimit', tab: 'organization', type: 'int', default: 0, min: 0, max: 100_000_000, scopes: ['tenant'], lockable: false,
    label: { en: 'Smallest E&O coverage limit allowed', 'fr-CA': 'Plus petite limite de garantie E&O permise' }, help: { en: 'Partners must hold errors and omissions cover of at least this amount (in your country’s currency). 0 means no minimum. The country’s own minimum, if there is one, still applies.', 'fr-CA': 'Les partenaires doivent détenir une assurance responsabilité professionnelle d’au moins ce montant (dans la devise de votre pays). 0 signifie aucun minimum. Le minimum du pays, s’il y en a un, s’applique toujours.' }, keywords: 'compliance E&O errors omissions insurance limit minimum coverage',
  },
  {
    key: 'pipelines.partnerCreate', tab: 'organization', type: 'bool', default: true, scopes: ['tenant'], lockable: false,
    label: { en: 'Partners can make their own pipelines', 'fr-CA': 'Les partenaires peuvent créer leurs propres pipelines' }, help: { en: 'Partners can start a pipeline from scratch, from a template, or by copying one they can see. Turn off to keep pipelines with managers only.', 'fr-CA': 'Les partenaires peuvent créer un pipeline à partir de zéro, d’un modèle ou en copiant un pipeline visible. Désactivez pour réserver les pipelines aux gestionnaires.' }, keywords: 'pipeline partner create copy clone template own',
  },
  {
    key: 'pipelines.partnerCap', tab: 'organization', type: 'int', default: 10, min: 1, max: 100, scopes: ['tenant'], lockable: false,
    label: { en: 'Pipelines each partner may have', 'fr-CA': 'Nombre de pipelines par partenaire' }, help: { en: 'The most pipelines one partner can own. Managers and admins are not limited.', 'fr-CA': 'Le maximum de pipelines qu’un partenaire peut posséder. Les gestionnaires et administrateurs ne sont pas limités.' }, keywords: 'pipeline partner limit cap maximum',
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
  {
    key: 'notify.compliance_expiry', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A licence or E&O policy is about to expire', 'fr-CA': 'Un permis ou une police E&O arrive à échéance' }, help: { en: 'Reminders come 90, 60, 30 and 0 days before the date.', 'fr-CA': 'Des rappels sont envoyés 90, 60, 30 et 0 jour avant la date.' }, keywords: 'notification alert compliance licence expiry E&O insurance reminder',
  },
  {
    key: 'notify.aml_alert', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A cash report or screening hit needs attention', 'fr-CA': 'Une déclaration d’espèces ou un résultat de vérification demande votre attention' }, help: { en: 'A large cash receipt with no report reference after 15 days, or a screening hit not reviewed after 2 days. Sent to administrators and compliance.', 'fr-CA': 'Un encaissement important en espèces sans référence de déclaration après 15 jours, ou un résultat de vérification non examiné après 2 jours. Envoyé aux administrateurs et à la conformité.' }, keywords: 'notification alert aml cash fintrac screening sanctions pep compliance',
  },
  {
    key: 'notify.first_week_late', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A new partner company is past its first week', 'fr-CA': 'Une nouvelle entreprise partenaire a dépassé sa première semaine' }, help: { en: 'A partner company still has first-week steps open after seven days. Sent once per partner.', 'fr-CA': 'Une entreprise partenaire a encore des étapes de première semaine ouvertes après sept jours. Un seul envoi par partenaire.' },
    keywords: 'notification alert first week new partner onboarding checklist compliance',
  },
  {
    key: 'notify.vault_alert', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'Signed paperwork is waiting to be archived', 'fr-CA': 'Des documents signés attendent d’être archivés' }, help: { en: 'Signed documents have waited more than a day to reach the archive vault. At most once a week. Sent to administrators and compliance.', 'fr-CA': 'Des documents signés attendent depuis plus d’un jour d’être copiés dans la voûte d’archives. Au plus une fois par semaine. Envoyé aux administrateurs et à la conformité.' }, keywords: 'notification alert vault archive signed paperwork storage',
  },
  {
    key: 'notify.learning_due', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A course is due soon or late', 'fr-CA': 'Une formation arrive à échéance ou est en retard' }, help: { en: 'One reminder a week before the due date, and one when it is late.', 'fr-CA': 'Un rappel une semaine avant l’échéance, et un autre quand elle est dépassée.' }, keywords: 'notification alert course training due overdue reminder learning',
  },
  {
    key: 'notify.team_overdue', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'Weekly summary of overdue training in my team', 'fr-CA': 'Résumé hebdomadaire des formations en retard de mon équipe' }, help: { en: 'Once a week, only when someone is overdue. Sent to administrators.', 'fr-CA': 'Une fois par semaine, seulement si quelqu’un est en retard. Envoyé aux administrateurs.' }, keywords: 'notification alert training course overdue late team weekly summary formation retard',
  },
  {
    key: 'notify.ce_reminder', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'My continuing education is at risk', 'fr-CA': 'Ma formation continue est à risque' }, help: { en: 'Hours are still missing with 60 days or fewer left in the term, or the term has ended.', 'fr-CA': 'Il manque des heures et il reste 60 jours ou moins, ou la période est terminée.' }, keywords: 'notification alert CE continuing education hours reminder term',
  },
  {
    key: 'notify.course_request', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'Someone asks to join a course', 'fr-CA': 'Quelqu’un demande à suivre une formation' }, help: { en: 'For courses that need approval, and only if you lead the person’s branch.', 'fr-CA': 'Pour les formations qui demandent une approbation, si vous dirigez la succursale de la personne.' }, keywords: 'notification alert course training request approve enrollment',
  },
  {
    key: 'notify.course_decision', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'My course request is answered', 'fr-CA': 'Ma demande de formation a reçu une réponse' }, help: { en: 'A manager approves or declines your request.', 'fr-CA': 'Un gestionnaire approuve ou refuse votre demande.' }, keywords: 'notification alert course training request approved declined',
  },
  {
    key: 'notify.quiz_attempts', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A manager gives me another quiz attempt', 'fr-CA': 'Un gestionnaire m’accorde une tentative de plus à un test' }, help: { en: 'When you ran out of tries and someone gave you more.', 'fr-CA': 'Lorsque vous n’aviez plus de tentatives et que quelqu’un vous en a accordé.' }, keywords: 'notification alert quiz attempt extra try training',
  },
  {
    key: 'notify.compliance_review', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A compliance file is submitted or reviewed', 'fr-CA': 'Un dossier de conformité est soumis ou examiné' }, help: { en: 'Head office approves or sends back a file, or a partner sends one for review.', 'fr-CA': 'Le siège social approuve ou renvoie un dossier, ou un partenaire en soumet un.' }, keywords: 'notification alert compliance review approved onboarding',
  },
  {
    key: 'notify.thread_shared', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A teammate shares a conversation with me', 'fr-CA': 'Un collègue partage une conversation avec moi' }, help: { en: 'Someone points you to an email linked to a record.', 'fr-CA': 'Quelqu’un vous signale un courriel lié à un dossier.' }, keywords: 'notification alert share conversation email thread',
  },
  {
    key: 'notify.document_added', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A document is added to my record', 'fr-CA': 'Un document est ajouté à mon dossier' }, help: { en: 'A teammate attaches a file to a record you own.', 'fr-CA': 'Un collègue joint un fichier à un dossier dont vous êtes responsable.' }, keywords: 'notification alert document file attachment',
  },
  {
    key: 'notify.appointment_request', tab: 'notifications', type: 'bool', default: true, scopes: ALL, lockable: false,
    label: { en: 'A carrier appointment is requested', 'fr-CA': 'Une nomination auprès d’un assureur est demandée' }, help: { en: 'A partner asks head office to appoint them with a carrier.', 'fr-CA': 'Un partenaire demande au siège social de le faire nommer auprès d’un assureur.' }, keywords: 'notification alert carrier appointment',
  },
] as const;

export const NAV_ITEMS = ['home', 'notifications', 'pipelines', 'renewals', 'compliance', 'contacts', 'merges', 'training', 'settings'] as const;
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
