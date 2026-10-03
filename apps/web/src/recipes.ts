import type { Locale } from './types.ts';

type L = Record<Locale, string>;
export type Group = 'forms' | 'schedulers' | 'sheets' | 'notify';
export interface Recipe {
  id: string;
  group: Group;
  /** Direct: understood without any middle step. Zapier: Zapier (or similar) carries the data. Script: a short Google Apps Script. */
  badge: 'Direct' | 'Zapier' | 'Script';
  /** Receives data from another tool, or sends data to one. */
  kind: 'inbound' | 'outbound';
  title: L;
  about: L;
  steps: Record<Locale, string[]>;
  /** Outbound recipes subscribe to these events. */
  events?: ('box.created' | 'box.stage_changed' | 'digest.weekly')[];
  script?: (link: string) => string;
}

const zapIn = (tool: string, trig: string): Record<Locale, string[]> => ({
  'en': [`In Zapier, create a Zap. Trigger: ${tool} → “${trig}”.`, 'Action: Webhooks by Zapier → “POST”. Paste the link above as the URL and set Payload Type to JSON.', 'Map the person’s name, email and phone (and anything else) as fields. Names like name, email, phone and message are recognised automatically.', 'Turn the Zap on. Each new entry now appears here as a record.'],
  'fr-CA': [`Dans Zapier, créez un Zap. Déclencheur : ${tool} → « ${trig} ».`, 'Action : Webhooks by Zapier → « POST ». Collez le lien ci-dessus comme URL et choisissez JSON.', 'Associez le nom, le courriel et le téléphone (et le reste). Les noms name, email, phone et message sont reconnus automatiquement.', 'Activez le Zap. Chaque nouvelle entrée devient un dossier ici.'],
});

const catchHook = (what: Record<Locale, string>): Record<Locale, string[]> => ({
  'en': ['In Zapier, create a Zap. Trigger: Webhooks by Zapier → “Catch Hook”. Copy the URL it gives you.', 'Paste that URL above, press “Create”, then “Send test message” so Zapier can see the fields.', `Add the action: ${what.en}`, 'Turn the Zap on.'],
  'fr-CA': ['Dans Zapier, créez un Zap. Déclencheur : Webhooks by Zapier → « Catch Hook ». Copiez l’URL fournie.', 'Collez cette URL ci-dessus, appuyez sur « Créer », puis « Envoyer un message test » pour que Zapier voie les champs.', `Ajoutez l’action : ${what['fr-CA']}`, 'Activez le Zap.'],
});

export const RECIPES: Recipe[] = [
  // ---- forms ----
  {
    id: 'typeform', group: 'forms', badge: 'Direct', kind: 'inbound',
    title: { 'en': 'Capture from Typeform submissions', 'fr-CA': 'Saisir les réponses Typeform' },
    about: { 'en': 'Create a record and contact for each Typeform response.', 'fr-CA': 'Crée un dossier et un contact pour chaque réponse Typeform.' },
    steps: {
      'en': ['In Typeform open your form → Connect → Webhooks → Add a webhook.', 'Paste the link above as the Destination URL and turn the webhook on.', 'Answers to email and phone questions become the contact. A question titled “Name” becomes the record name. Every other answer is added as a note.'],
      'fr-CA': ['Dans Typeform, ouvrez le formulaire → Connect → Webhooks → Add a webhook.', 'Collez le lien ci-dessus comme URL de destination et activez le webhook.', 'Les réponses courriel et téléphone forment le contact. Une question intitulée « Nom » donne le nom du dossier. Les autres réponses sont ajoutées en note.'],
    },
  },
  {
    id: 'gforms', group: 'forms', badge: 'Script', kind: 'inbound',
    title: { 'en': 'Capture from Google Forms submissions', 'fr-CA': 'Saisir les réponses Google Forms' },
    about: { 'en': 'Create a record and contact for each Google Forms response, with a short script.', 'fr-CA': 'Crée un dossier et un contact pour chaque réponse Google Forms, avec un court script.' },
    steps: {
      'en': ['Open your Google Form → ⋮ → Script editor. Delete what is there and paste the script below.', 'In the script editor choose Triggers (clock icon) → Add Trigger → function onFormSubmit, event source “From form”, event type “On form submit”.', 'Save and accept the permission prompt. Questions called Name, Email and Phone are recognised; other answers become a note.'],
      'fr-CA': ['Ouvrez votre Google Form → ⋮ → Éditeur de scripts. Remplacez le contenu par le script ci-dessous.', 'Dans l’éditeur, choisissez Déclencheurs (horloge) → Ajouter → fonction onFormSubmit, source « Du formulaire », type « Lors de l’envoi du formulaire ».', 'Enregistrez et acceptez l’autorisation. Les questions Nom, Courriel et Téléphone sont reconnues; les autres réponses forment une note.'],
    },
    script: (link) => `function onFormSubmit(e) {\n  var out = {};\n  e.response.getItemResponses().forEach(function (r) {\n    out[r.getItem().getTitle()] = r.getResponse();\n  });\n  UrlFetchApp.fetch('${link}', {\n    method: 'post', contentType: 'application/json', payload: JSON.stringify(out)\n  });\n}`,
  },
  {
    id: 'jotform', group: 'forms', badge: 'Direct', kind: 'inbound',
    title: { 'en': 'Capture from Jotform forms', 'fr-CA': 'Saisir les formulaires Jotform' },
    about: { 'en': 'Create a record and contact for every Jotform submission.', 'fr-CA': 'Crée un dossier et un contact pour chaque envoi Jotform.' },
    steps: {
      'en': ['In Jotform open your form → Settings → Integrations → search “WebHooks”.', 'Paste the link above as the WebHook URL and complete the integration.', 'Name, email and phone fields are recognised; the rest become a note.'],
      'fr-CA': ['Dans Jotform, ouvrez le formulaire → Settings → Integrations → cherchez « WebHooks ».', 'Collez le lien ci-dessus comme URL du WebHook et terminez.', 'Les champs nom, courriel et téléphone sont reconnus; le reste devient une note.'],
    },
  },
  { id: 'wufoo', group: 'forms', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Capture from Wufoo forms', 'fr-CA': 'Saisir les formulaires Wufoo' }, about: { 'en': 'A record and contact for every Wufoo form submission.', 'fr-CA': 'Un dossier et un contact pour chaque envoi Wufoo.' }, steps: zapIn('Wufoo', 'New Entry') },
  { id: 'gravity', group: 'forms', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Capture from Gravity Forms', 'fr-CA': 'Saisir les Gravity Forms' }, about: { 'en': 'A record and contact for every Gravity Forms submission.', 'fr-CA': 'Un dossier et un contact pour chaque envoi Gravity Forms.' }, steps: zapIn('Gravity Forms', 'New Form Entry') },
  { id: 'webflow', group: 'forms', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Capture from Webflow forms', 'fr-CA': 'Saisir les formulaires Webflow' }, about: { 'en': 'A record and contact for every new Webflow form submission.', 'fr-CA': 'Un dossier et un contact pour chaque nouvel envoi Webflow.' }, steps: zapIn('Webflow', 'New Form Submission') },
  { id: 'facebook', group: 'forms', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Capture new Facebook leads', 'fr-CA': 'Saisir les nouveaux prospects Facebook' }, about: { 'en': 'A record and contact for each lead from a Facebook Lead Ad.', 'fr-CA': 'Un dossier et un contact pour chaque prospect d’une publicité Facebook.' }, steps: zapIn('Facebook Lead Ads', 'New Lead') },
  // ---- schedulers ----
  {
    id: 'calendly', group: 'schedulers', badge: 'Direct', kind: 'inbound',
    title: { 'en': 'Capture from Calendly bookings', 'fr-CA': 'Saisir les réservations Calendly' },
    about: { 'en': 'Create a record and contact for each booked Calendly meeting, with the time and answers in a note.', 'fr-CA': 'Crée un dossier et un contact pour chaque rendez-vous Calendly, avec l’heure et les réponses en note.' },
    steps: {
      'en': ['Calendly sends bookings to a link through a webhook (available on Calendly’s paid plans). In Calendly open Integrations & apps → Webhooks, or use the Calendly API “Create webhook subscription” with event invitee.created.', 'Use the link above as the callback URL.', 'Cancellations are ignored. If you are on a free Calendly plan, use the Zapier route instead: trigger Calendly → “Invitee Created”, action Webhooks by Zapier → POST to the link.'],
      'fr-CA': ['Calendly envoie les réservations à un lien par webhook (forfaits payants). Dans Calendly : Integrations & apps → Webhooks, ou l’API « Create webhook subscription » avec l’événement invitee.created.', 'Utilisez le lien ci-dessus comme URL de rappel.', 'Les annulations sont ignorées. Avec le forfait gratuit, passez par Zapier : déclencheur Calendly → « Invitee Created », action Webhooks by Zapier → POST vers le lien.'],
    },
  },
  { id: 'onceHub', group: 'schedulers', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Capture from ScheduleOnce bookings', 'fr-CA': 'Saisir les réservations ScheduleOnce' }, about: { 'en': 'A record and contact for every OnceHub booking.', 'fr-CA': 'Un dossier et un contact pour chaque réservation OnceHub.' }, steps: zapIn('OnceHub', 'New Booking') },
  { id: 'savvycal', group: 'schedulers', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Capture from SavvyCal bookings', 'fr-CA': 'Saisir les réservations SavvyCal' }, about: { 'en': 'A record and contact for every SavvyCal booking.', 'fr-CA': 'Un dossier et un contact pour chaque réservation SavvyCal.' }, steps: zapIn('SavvyCal', 'New Booking') },
  { id: 'gcal-in', group: 'schedulers', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Capture from new Google Calendar events', 'fr-CA': 'Saisir les nouveaux événements Google Agenda' }, about: { 'en': 'A record whenever a new Google Calendar event is created.', 'fr-CA': 'Un dossier à chaque nouvel événement Google Agenda.' }, steps: zapIn('Google Calendar', 'New Event') },
  // ---- sheets ----
  {
    id: 'sheet-in', group: 'sheets', badge: 'Script', kind: 'inbound',
    title: { 'en': 'Create records from new rows in Google Sheets', 'fr-CA': 'Créer des dossiers à partir des nouvelles lignes Google Sheets' },
    about: { 'en': 'Rows that have not been sent yet become records. Keeps a sheet in step with the pipeline.', 'fr-CA': 'Les lignes pas encore envoyées deviennent des dossiers. Garde la feuille synchronisée avec le pipeline.' },
    steps: {
      'en': ['Make the first row of your sheet a header row with columns such as Name, Email, Phone, Value, Notes.', 'In the sheet choose Extensions → Apps Script and paste the script below. Save.', 'Run sendToPII once and accept the permissions. To run it automatically, add a Trigger (clock icon): function sendToPII, “Time-driven”, every hour.', 'Each row is sent once and marked in a “Sent to PII” column. Up to 300 rows per 10 minutes.'],
      'fr-CA': ['Faites de la première ligne un en-tête avec des colonnes comme Nom, Courriel, Téléphone, Valeur, Notes.', 'Dans la feuille : Extensions → Apps Script, collez le script ci-dessous et enregistrez.', 'Exécutez sendToPII une fois et acceptez les autorisations. Pour l’automatiser, ajoutez un déclencheur (horloge) : fonction sendToPII, « Basé sur le temps », toutes les heures.', 'Chaque ligne n’est envoyée qu’une fois et marquée dans la colonne « Sent to PII ». Jusqu’à 300 lignes par 10 minutes.'],
    },
    script: (link) => `function sendToPII() {\n  var sh = SpreadsheetApp.getActiveSheet();\n  var rows = sh.getDataRange().getValues();\n  var head = rows[0];\n  var sent = head.indexOf('Sent to PII');\n  if (sent < 0) { sent = head.length; sh.getRange(1, sent + 1).setValue('Sent to PII'); }\n  for (var i = 1; i < rows.length; i++) {\n    if (rows[i][sent]) continue;\n    var o = {};\n    head.forEach(function (h, c) { if (h && c !== sent) o[h] = rows[i][c]; });\n    UrlFetchApp.fetch('${link}', { method: 'post', contentType: 'application/json', payload: JSON.stringify(o) });\n    sh.getRange(i + 1, sent + 1).setValue(new Date());\n  }\n}`,
  },
  {
    id: 'sheet-out', group: 'sheets', badge: 'Script', kind: 'outbound', events: ['box.created', 'box.stage_changed'],
    title: { 'en': 'Add a row to Google Sheets for new records', 'fr-CA': 'Ajouter une ligne Google Sheets pour les nouveaux dossiers' },
    about: { 'en': 'A row is added each time a record is created or changes stage.', 'fr-CA': 'Une ligne est ajoutée à chaque création ou changement d’étape.' },
    steps: {
      'en': ['In the sheet choose Extensions → Apps Script and paste the script below. Save.', 'Deploy → New deployment → type “Web app”, Execute as “Me”, Who has access “Anyone”. Copy the Web app URL.', 'Paste that URL above and press “Create”. Press “Send test message” to see a first row.'],
      'fr-CA': ['Dans la feuille : Extensions → Apps Script, collez le script ci-dessous et enregistrez.', 'Déployer → Nouveau déploiement → type « Application Web », Exécuter en tant que « Moi », Accès « Tout le monde ». Copiez l’URL.', 'Collez cette URL ci-dessus et appuyez sur « Créer ». « Envoyer un message test » ajoute une première ligne.'],
    },
    script: () => `function doPost(e) {\n  var d = JSON.parse(e.postData.contents);\n  var b = d.box || {};\n  SpreadsheetApp.getActiveSheet().appendRow([new Date(), d.event, b.name, b.stageName, b.valueAmount, b.id]);\n  return ContentService.createTextOutput('ok');\n}`,
  },
  { id: 'sheet-zap-in', group: 'sheets', badge: 'Zapier', kind: 'inbound', title: { 'en': 'Create records from new rows (Zapier)', 'fr-CA': 'Créer des dossiers à partir des nouvelles lignes (Zapier)' }, about: { 'en': 'Prefer Zapier? It watches the sheet for you.', 'fr-CA': 'Vous préférez Zapier? Il surveille la feuille pour vous.' }, steps: zapIn('Google Sheets', 'New Spreadsheet Row') },
  // ---- notifications ----
  {
    id: 'weekly-new', group: 'notify', badge: 'Zapier', kind: 'outbound', events: ['digest.weekly'],
    title: { 'en': 'Weekly email summary of new records', 'fr-CA': 'Résumé hebdomadaire par courriel des nouveaux dossiers' },
    about: { 'en': 'Once a week we send the summary; Zapier turns it into an email.', 'fr-CA': 'Chaque semaine nous envoyons le résumé; Zapier le transforme en courriel.' },
    steps: catchHook({ 'en': 'Gmail → “Send Email”, and put the “digest new boxes” list in the body.', 'fr-CA': 'Gmail → « Send Email », avec la liste « digest new boxes » dans le corps.' }),
  },
  {
    id: 'weekly-stage', group: 'notify', badge: 'Zapier', kind: 'outbound', events: ['digest.weekly'],
    title: { 'en': 'Weekly summary of records that reached a stage', 'fr-CA': 'Résumé hebdomadaire des dossiers arrivés à une étape' },
    about: { 'en': 'The same weekly message lists records by the stage they reached.', 'fr-CA': 'Le même message hebdomadaire liste les dossiers par étape atteinte.' },
    steps: catchHook({ 'en': 'Gmail → “Send Email”, using the “digest reached stage” list.', 'fr-CA': 'Gmail → « Send Email », avec la liste « digest reached stage ».' }),
  },
  {
    id: 'weekly-tasks', group: 'notify', badge: 'Zapier', kind: 'outbound', events: ['digest.weekly'],
    title: { 'en': 'Weekly email of tasks that are due', 'fr-CA': 'Courriel hebdomadaire des tâches à échéance' },
    about: { 'en': 'The weekly message also lists tasks due in the next 7 days, and overdue ones.', 'fr-CA': 'Le message hebdomadaire liste aussi les tâches dues dans 7 jours et celles en retard.' },
    steps: catchHook({ 'en': 'Gmail → “Send Email”, using the “digest due tasks” list.', 'fr-CA': 'Gmail → « Send Email », avec la liste « digest due tasks ».' }),
  },
  {
    id: 'gcal-out', group: 'notify', badge: 'Zapier', kind: 'outbound', events: ['box.created'],
    title: { 'en': 'Create Google Calendar events for new records', 'fr-CA': 'Créer des événements Google Agenda pour les nouveaux dossiers' },
    about: { 'en': 'A calendar event each time a record is created.', 'fr-CA': 'Un événement d’agenda à chaque création de dossier.' },
    steps: catchHook({ 'en': 'Google Calendar → “Create Detailed Event”, using the record name as the title.', 'fr-CA': 'Google Agenda → « Create Detailed Event », avec le nom du dossier comme titre.' }),
  },
];

export const GROUPS: { id: Group; title: L }[] = [
  { id: 'forms', title: { 'en': 'Forms', 'fr-CA': 'Formulaires' } },
  { id: 'schedulers', title: { 'en': 'Schedulers', 'fr-CA': 'Rendez-vous' } },
  { id: 'sheets', title: { 'en': 'Google Sheets', 'fr-CA': 'Google Sheets' } },
  { id: 'notify', title: { 'en': 'Get notified', 'fr-CA': 'Notifications' } },
];
