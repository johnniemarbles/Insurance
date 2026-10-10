// The partner guide: plain-English, one page, in English and Canadian French. Served only to signed-in people (see routes-pages.ts).
// Nothing here is legal advice; where a rule depends on the country the text says what the app does, not what the law is.
export type GuideLang = 'en' | 'fr-CA';
export type GuideCountry = 'CA' | 'US';
interface Section { id: string; h: string; p?: string[]; ol?: string[]; ul?: string[]; note?: string }
export interface Guide { title: string; intro: string; toc: string; print: string; sections: Section[]; foot: (support: string) => string }

const EN = (c: GuideCountry): Guide => ({
  title: 'Partner guide',
  intro: 'Everything a new partner company needs in its first week, in plain words. Your Home page shows a checklist that ticks itself off as you go. This guide explains each step.',
  toc: 'On this page', print: 'Print this guide',
  sections: [
    { id: 'week', h: 'Your first week at a glance', ol: [
      'Day 1: fill in your business profile, add your licence, add your E&O insurance (Compliance, then your company).',
      'Day 2: confirm the file is true, sign the partner agreement and send the file for review.',
      'Day 3: once head office approves, ask for your carrier appointments. Invite your team (Settings, then Company and people).',
      c === 'US' ? 'Day 4: set up continuing education for each licensed person (Training, then My CE) and finish the courses assigned to you.' : 'Day 4: set up continuing education for each licensed person (Training, then My CE) and finish the courses assigned to you.',
      'Days 5 to 7: add your first client to a pipeline, record the advice you gave and get it signed.',
    ], note: 'The checklist on your Home page has 12 steps. A new company has seven days to finish them. If you are late, head office can see it and will help.' },
    { id: 'file', h: 'Step 1: your compliance file', p: ['Open Compliance and then your company. The file is what lets head office say "yes, this partner may sell".'], ul: [
      c === 'US' ? 'Business profile: your legal name, the kind of business, and your EIN (the tax number for your business). A sole proprietor does not need an EIN here.' : 'Business profile: your legal name, the kind of business, and your business number (the tax number for your business). A sole proprietor does not need one here.',
      'Licence: add each licence with its number, the lines of insurance it covers and its expiry date. Attach a copy if you have one.',
      c === 'US' ? 'E&O insurance (errors and omissions): the cover that protects you if a client says you made a mistake. Add the policy, its limit and its expiry date. If the limit is below the minimum shown, the step stays open until it is raised.' : 'E&O insurance (errors and omissions): the cover that protects you if a client says you made a mistake. Add the policy, its limit and its expiry date. If the limit is below the minimum shown, the step stays open until it is raised.',
      'Confirm it is true: a short statement that what you entered is correct. Do this last, after you have checked everything.',
      'Partner agreement: your agreement with the company. It is marked signed when head office has your signed copy.',
    ] },
    { id: 'review', h: 'Step 2: send it for review', p: ['When the first five steps are done, press Send for review. Head office checks the file and either approves it or sends it back with a note saying what to fix. Fix it and send it again.', 'You can still be asked for more later. Keep your documents up to date: PII reminds you 90, 60, 30 days and on the day before a licence or policy runs out.'] },
    { id: 'carriers', h: 'Step 3: carriers and your team', ul: [
      'Carrier appointments: an appointment is an insurer saying "you may sell our products". After your file is approved, open it and choose Request appointment for each insurer you want. Head office does the paperwork and marks it appointed.',
      'Your team: open Settings, then Company and people, and invite each person by email. They sign in with the same Google account they use for Gmail. Give each person a role that fits (for example learner or manager).',
    ] },
    { id: 'learning', h: 'Step 4: learning and continuing education', ul: [
      c === 'US' ? 'Continuing education (CE) is the training a regulator requires each licence holder to finish every term. PII tracks California Department of Insurance rules: the term is two years and starts the day after your licence last expired, so you enter that date once on your licence. Add any course you take, with a copy of the certificate, and PII counts the hours.' : 'Continuing education (CE) is the training a regulator requires each licence holder to finish every term. PII tracks RIBO (Ontario) and the Insurance Council of BC. Choose your regulator and licence class once under Training, then My CE. Add any course you take, with a copy of the certificate, and PII counts the hours.',
      'Courses in PII that carry CE hours add them to your file by themselves when you finish.',
      'Required training: your administrator assigns courses. Open Training, then My learning. The step is done when everything assigned to your team is finished.',
      'Keep CE certificates. PII keeps them for the time the regulator requires, and nobody can delete them before that.',
    ] },
    { id: 'clients', h: 'Step 5: your first client', p: ['Open Pipelines and add a client as a card (a "box"). Link their email conversation from Gmail with the PII panel; PII asks for your consent once before it reads a conversation.'], ul: [
      'Notes, calls and tasks go on the card, so anyone covering for you sees the whole story.',
      'Advice: record your needs analysis and recommendation on the card. Send it to the client to sign. They get a code by email and type their name to sign. A signed record cannot be changed.',
      'Client consent: record the client\'s consent to collect and use their information before you go further.',
      c === 'US' ? 'ID and screening: record how you checked who the client is, and any sanctions screening result.' : 'ID and screening: record how you checked who the client is, and any sanctions or politically-exposed-person screening result.',
      c === 'US' ? 'Large cash: if a client pays a large amount in cash, log it. PII tells you when a report may be due.' : 'Large cash: if a client pays a large amount in cash, log it. PII tells you when a report may be due.',
      'Some pipeline stages ask for documents before a card can move on. If a card will not move, look for the red note that says what is missing.',
    ] },
    { id: 'cleared', h: 'What "cleared to transact" means', p: ['PII shows whether a partner is clear to sell today. It is not clear if the file is not approved, a licence or E&O policy has run out, the E&O limit is below the minimum, or continuing education was short for the last term. Fix the item and the flag clears by itself.'] },
    { id: 'safe', h: 'Where your records are kept', p: ['Signed documents are also copied to a locked, encrypted archive that nobody can change or delete during the retention period. In Compliance you can check that a copy is intact. Head office sees your compliance file and totals, not your client conversations.'] },
    { id: 'terms', h: 'Plain-English glossary', ul: [
      'E&O: errors and omissions insurance, cover for mistakes in your advice.',
      'Appointment: an insurer\'s permission for you to sell its products.',
      'CE: continuing education, the training you must finish each term to keep a licence.',
      'Attestation: your statement that the information is true.',
      'Retention: how long a record must be kept before it may be deleted.',
    ] },
  ],
  foot: (s) => `Need help? Write to ${s}. This guide explains how the app works. It is not legal advice; ask your own advisor if you are unsure about a rule.`,
});

const FR = (c: GuideCountry): Guide => ({
  title: 'Guide du partenaire',
  intro: 'Tout ce dont une nouvelle entreprise partenaire a besoin pendant sa première semaine, en mots simples. Votre page d’accueil affiche une liste qui se coche toute seule. Ce guide explique chaque étape.',
  toc: 'Sur cette page', print: 'Imprimer ce guide',
  sections: [
    { id: 'week', h: 'Votre première semaine en bref', ol: [
      'Jour 1 : remplissez le profil de l’entreprise, ajoutez votre permis et votre assurance E&O (Conformité, puis votre entreprise).',
      'Jour 2 : confirmez que le dossier est exact, signez l’entente de partenariat et envoyez le dossier pour examen.',
      'Jour 3 : une fois le dossier approuvé par le siège social, demandez vos nominations auprès des assureurs. Invitez votre équipe (Paramètres, puis Entreprise et personnes).',
      'Jour 4 : configurez la formation continue de chaque titulaire de permis (Formation, puis Ma FC) et terminez les cours qui vous sont assignés.',
      'Jours 5 à 7 : ajoutez votre premier client à un pipeline, consignez le conseil donné et faites-le signer.',
    ], note: 'La liste de votre page d’accueil compte 12 étapes. Une nouvelle entreprise a sept jours pour les terminer. En cas de retard, le siège social le voit et vous aide.' },
    { id: 'file', h: 'Étape 1 : votre dossier de conformité', p: ['Ouvrez Conformité, puis votre entreprise. Le dossier permet au siège social de dire « oui, ce partenaire peut vendre ».'], ul: [
      c === 'US' ? 'Profil de l’entreprise : dénomination sociale, genre d’entreprise et EIN (le numéro fiscal de l’entreprise). Un travailleur autonome n’a pas besoin d’EIN ici.' : 'Profil de l’entreprise : dénomination sociale, genre d’entreprise et numéro d’entreprise (le numéro fiscal). Un travailleur autonome n’en a pas besoin ici.',
      'Permis : ajoutez chaque permis avec son numéro, les branches d’assurance visées et sa date d’expiration. Joignez une copie si vous en avez une.',
      'Assurance E&O (erreurs et omissions) : la protection si un client prétend que vous avez commis une erreur. Ajoutez la police, sa limite et sa date d’expiration. Si la limite est sous le minimum affiché, l’étape reste ouverte tant qu’elle n’est pas relevée.',
      'Confirmer l’exactitude : une courte déclaration que ce que vous avez saisi est exact. Faites-le en dernier, après vérification.',
      'Entente de partenariat : votre entente avec l’entreprise. Elle est marquée signée quand le siège social a votre copie signée.',
    ] },
    { id: 'review', h: 'Étape 2 : envoyer pour examen', p: ['Quand les cinq premières étapes sont faites, appuyez sur Envoyer pour examen. Le siège social vérifie le dossier et l’approuve, ou le retourne avec une note indiquant quoi corriger. Corrigez, puis renvoyez.', 'On peut vous demander des pièces plus tard. Gardez vos documents à jour : PII vous rappelle 90, 60 et 30 jours avant l’expiration d’un permis ou d’une police, puis le jour même.'] },
    { id: 'carriers', h: 'Étape 3 : assureurs et équipe', ul: [
      'Nominations : une nomination est l’autorisation d’un assureur de vendre ses produits. Après l’approbation de votre dossier, ouvrez-le et choisissez Demander une nomination pour chaque assureur voulu. Le siège social fait les démarches et la marque comme nommée.',
      'Votre équipe : ouvrez Paramètres, puis Entreprise et personnes, et invitez chaque personne par courriel. Elle se connecte avec le compte Google qu’elle utilise pour Gmail. Donnez à chacun un rôle qui convient (par exemple apprenant ou gestionnaire).',
    ] },
    { id: 'learning', h: 'Étape 4 : formation et formation continue', ul: [
      c === 'US' ? 'La formation continue (FC) est la formation qu’un organisme de réglementation exige de chaque titulaire de permis à chaque période. PII suit les règles du California Department of Insurance : la période est de deux ans et commence le lendemain de la dernière expiration de votre permis; vous saisissez cette date une fois sur votre permis. Ajoutez chaque cours suivi avec une copie de l’attestation, et PII compte les heures.' : 'La formation continue (FC) est la formation qu’un organisme de réglementation exige de chaque titulaire de permis à chaque période. PII suit le RIBO (Ontario) et l’Insurance Council of BC. Choisissez votre organisme et votre catégorie de permis une fois sous Formation, puis Ma FC. Ajoutez chaque cours suivi avec une copie de l’attestation, et PII compte les heures.',
      'Les cours de PII qui comportent des heures de FC les ajoutent à votre dossier quand vous les terminez.',
      'Formation obligatoire : votre administrateur assigne des cours. Ouvrez Formation, puis Mon apprentissage. L’étape est faite quand tout ce qui est assigné à votre équipe est terminé.',
      'Conservez vos attestations de FC. PII les garde pendant la durée exigée par l’organisme, et personne ne peut les supprimer avant.',
    ] },
    { id: 'clients', h: 'Étape 5 : votre premier client', p: ['Ouvrez Pipelines et ajoutez un client sous forme de fiche (une « boîte »). Liez sa conversation courriel depuis Gmail avec le panneau PII; PII demande votre consentement une fois avant de lire une conversation.'], ul: [
      'Les notes, appels et tâches vont sur la fiche, pour que la personne qui vous remplace voie tout l’historique.',
      'Conseil : consignez votre analyse des besoins et votre recommandation sur la fiche. Envoyez-la au client pour signature. Il reçoit un code par courriel et tape son nom pour signer. Un dossier signé ne peut plus être modifié.',
      'Consentement du client : consignez son consentement à la collecte et à l’utilisation de ses renseignements avant d’aller plus loin.',
      c === 'US' ? 'Identité et filtrage : consignez comment vous avez vérifié l’identité du client et tout résultat de filtrage des sanctions.' : 'Identité et filtrage : consignez comment vous avez vérifié l’identité du client et tout résultat de filtrage des sanctions ou des personnes politiquement vulnérables.',
      'Espèces importantes : si un client paie un montant élevé en espèces, inscrivez-le. PII indique quand une déclaration peut être exigée.',
      'Certaines étapes de pipeline exigent des documents avant qu’une fiche puisse avancer. Si une fiche ne bouge pas, cherchez la note rouge qui dit ce qui manque.',
    ] },
    { id: 'cleared', h: 'Ce que signifie « autorisé à transiger »', p: ['PII montre si un partenaire peut vendre aujourd’hui. Il ne l’est pas si le dossier n’est pas approuvé, si un permis ou une police E&O est expiré, si la limite E&O est sous le minimum ou si la formation continue était insuffisante pour la dernière période. Corrigez l’élément et l’indicateur disparaît seul.'] },
    { id: 'safe', h: 'Où sont conservés vos dossiers', p: ['Les documents signés sont aussi copiés dans une archive chiffrée et verrouillée que personne ne peut modifier ni supprimer pendant la période de conservation. Dans Conformité, vous pouvez vérifier qu’une copie est intacte. Le siège social voit votre dossier de conformité et des totaux, pas vos conversations avec les clients.'] },
    { id: 'terms', h: 'Glossaire en mots simples', ul: [
      'E&O : assurance erreurs et omissions, protection en cas d’erreur dans vos conseils.',
      'Nomination : l’autorisation d’un assureur de vendre ses produits.',
      'FC : formation continue, la formation à terminer chaque période pour garder un permis.',
      'Attestation : votre déclaration que les renseignements sont exacts.',
      'Conservation : la durée pendant laquelle un dossier doit être gardé avant de pouvoir être supprimé.',
    ] },
  ],
  foot: (s) => `Besoin d’aide? Écrivez à ${s}. Ce guide explique le fonctionnement de l’application. Il ne constitue pas un avis juridique; consultez votre conseiller en cas de doute sur une règle.`,
});

export const guideFor = (lang: GuideLang, country: GuideCountry): Guide => (lang === 'fr-CA' ? FR(country) : EN(country));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The guide as one self-contained HTML page. */
export function renderGuide(g: Guide, o: { lang: GuideLang; product: string; support: string; otherLangHref: string; otherLangLabel: string }): string {
  const sec = (s: Section) => `<section id="${s.id}"><h2>${esc(s.h)}</h2>${(s.p ?? []).map((t) => `<p>${esc(t)}</p>`).join('')}${s.ol ? `<ol>${s.ol.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}${s.ul ? `<ul>${s.ul.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</section>`;
  return `<!doctype html><html lang="${o.lang === 'fr-CA' ? 'fr-CA' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(g.title)} · ${esc(o.product)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#1f2937;background:#f9fafb;margin:0}main{max-width:760px;margin:0 auto;padding:24px 20px 56px}
header{display:flex;align-items:center;gap:12px;margin-bottom:8px}header img{width:40px;height:40px}header a{margin-left:auto;font-size:14px}h1{font-size:28px;margin:12px 0 8px}h2{font-size:20px;margin:32px 0 8px}
p,li{max-width:68ch}li{margin:6px 0}a{color:#1d4ed8}nav{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;margin:20px 0}nav b{display:block;margin-bottom:4px}nav a{display:inline-block;margin:2px 12px 2px 0;font-size:14px}
.note{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px}footer{margin-top:40px;color:#4b5563;font-size:14px;border-top:1px solid #e5e7eb;padding-top:16px}button{font:inherit;padding:6px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer}
@media print{nav,button,header a{display:none}body{background:#fff}}</style></head>
<body><main><header><img src="/brand/logo.png" alt=""><b>${esc(o.product)}</b><a href="${esc(o.otherLangHref)}">${esc(o.otherLangLabel)}</a></header>
<h1>${esc(g.title)}</h1><p>${esc(g.intro)}</p><nav aria-label="${esc(g.toc)}"><b>${esc(g.toc)}</b>${g.sections.map((s) => `<a href="#${s.id}">${esc(s.h)}</a>`).join('')}</nav>
${g.sections.map(sec).join('')}<footer><p>${esc(g.foot(o.support))}</p><button onclick="print()">${esc(g.print)}</button></footer></main></body></html>`;
}
