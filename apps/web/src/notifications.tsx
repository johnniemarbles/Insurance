import { ErrorBar } from './errorbar.tsx';
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface N { id: string; kind: string; boxId: string | null; pipelineId: string | null; data: Record<string, any>; createdAt: string; readAt: string | null; actorName: string | null }

export const X = {
  'en': {
    title: 'Notifications', none: 'You are all caught up.', markAll: 'Mark all read', settings: 'Choose what you are told about', emailRem: 'Email reminders (training, continuing education, licences)',
    text: (n: N) => {
      const who = n.actorName ?? 'Someone', box = n.data.boxName ?? 'a record';
      switch (n.kind) {
        case 'assigned': return `${who} made you the owner of ${box}`;
        case 'task_assigned': return `${who} gave you a task on ${box}: ${n.data.title ?? ''}`;
        case 'mention': return `${who} mentioned you on ${box}: “${n.data.text ?? ''}”`;
        case 'note': return `${who} added a note to ${box}: “${n.data.text ?? ''}”`;
        case 'stage_change': return `${who} moved ${box} to ${n.data.stage ?? 'another stage'}`;
        case 'capture': return `${n.data.source ?? 'A form'} “${n.data.via ?? ''}” created ${box}`;
        case 'merge_done': return `Your mail merge “${n.data.name ?? ''}” has finished`;
        case 'unsubscribed': return `${n.data.email ?? 'A recipient'} unsubscribed from your mail merge`;
        case 'invite_accepted': return `${n.data.email ?? who} accepted your invitation and joined`;
        case 'invite_stale': return `${n.data.email ?? 'Someone'} has not joined yet, 3 days after your invitation. Open Settings > Company and people to resend it.`;
        case 'compliance_expiry': return `${n.data.name ?? 'A partner'}: ${n.data.label ?? 'a licence'} ${n.data.daysLeft < 0 ? 'has expired' : n.data.daysLeft === 0 ? 'expires today' : `expires in ${n.data.daysLeft} days`}${n.data.company ? ` (${n.data.company})` : ''}`;
        case 'compliance_review': return n.data.decision === 'submitted' ? `${n.data.name ?? 'A partner'} sent a compliance file for review${n.data.company ? ` (${n.data.company})` : ''}` : `${n.data.reviewer ?? 'Head office'} ${n.data.decision === 'approved' ? 'approved' : 'sent back'} the compliance file for ${n.data.name ?? 'your partner'}${n.data.note ? `: “${n.data.note}”` : ''}`;
        case 'appointment_request': return `${n.data.name ?? 'A partner'} asked to be appointed with ${n.data.carrier ?? 'a carrier'}${n.data.company ? ` (${n.data.company})` : ''}`;
        case 'thread_shared': return `${who} shared a conversation with you on ${box}${n.data.message ? `: “${n.data.message}”` : ''}`;
        case 'document_added': return `${who} added a document to ${box}: ${n.data.name ?? ''}`;
        case 'aml_alert': return `${n.data.name ?? 'A client file'}: ${n.data.issue === 'cash_overdue' ? `cash receipt of ${n.data.detail} on ${n.data.since} has no report reference` : `screening hit (${n.data.detail}) from ${n.data.since} has not been reviewed`}`;
        case 'vault_alert': return `Archive vault: ${n.data.pending} signed document${n.data.pending === 1 ? '' : 's'} waiting more than a day to be copied`;
        case 'team_overdue': return `Training: ${n.data.overdue} learner${n.data.overdue === 1 ? ' is' : 's are'} overdue across your team`;
        case 'learning_due': return `${n.data.title || 'A course'} ${n.data.daysLeft < 0 ? `was due ${n.data.dueOn}` : n.data.daysLeft === 0 ? 'is due today' : `is due in ${n.data.daysLeft} days`}`;
        case 'course_request': return `${n.data.name ?? 'Someone'} asked to join “${n.data.course ?? 'a course'}”${n.data.note ? `: “${n.data.note}”` : ''}`;
        case 'course_decision': return `Your request to join “${n.data.course ?? 'a course'}” was ${n.data.decision === 'approved' ? 'approved' : 'declined'}${n.data.note ? `: “${n.data.note}”` : ''}`;
        case 'quiz_attempts': return `${who} gave you ${n.data.extra ?? 1} more attempt(s) at the quiz in “${n.data.course ?? 'a course'}”`;
        case 'ce_reminder': return n.data.state === 'overdue' ? `${n.data.pack}: your term ended ${n.data.termEnd} and ${n.data.remaining} hours were still missing` : `${n.data.pack}: ${n.data.remaining} hours still to complete before ${n.data.termEnd}`;
        default: return n.kind;
      }
    },
  },
  'fr-CA': {
    title: 'Notifications', none: 'Vous êtes à jour.', markAll: 'Tout marquer comme lu', settings: 'Choisir ce dont vous êtes informé', emailRem: 'Rappels par courriel (formation, formation continue, permis)',
    text: (n: N) => {
      const who = n.actorName ?? 'Quelqu’un', box = n.data.boxName ?? 'un dossier';
      switch (n.kind) {
        case 'assigned': return `${who} vous a désigné responsable de ${box}`;
        case 'task_assigned': return `${who} vous a confié une tâche sur ${box} : ${n.data.title ?? ''}`;
        case 'mention': return `${who} vous a mentionné sur ${box} : « ${n.data.text ?? ''} »`;
        case 'note': return `${who} a ajouté une note à ${box} : « ${n.data.text ?? ''} »`;
        case 'stage_change': return `${who} a déplacé ${box} vers ${n.data.stage ?? 'une autre étape'}`;
        case 'capture': return `${n.data.source ?? 'Un formulaire'} « ${n.data.via ?? ''} » a créé ${box}`;
        case 'merge_done': return `Votre publipostage « ${n.data.name ?? ''} » est terminé`;
        case 'unsubscribed': return `${n.data.email ?? 'Un destinataire'} s’est désabonné de votre publipostage`;
        case 'invite_accepted': return `${n.data.email ?? who} a accepté votre invitation et s’est joint`;
        case 'invite_stale': return `${n.data.email ?? 'Quelqu’un'} ne s’est pas encore joint, 3 jours après votre invitation. Ouvrez Paramètres > Entreprise et personnes pour la renvoyer.`;
        case 'compliance_expiry': return `${n.data.name ?? 'Un partenaire'} : ${n.data.label ?? 'un permis'} ${n.data.daysLeft < 0 ? 'est expiré' : n.data.daysLeft === 0 ? 'expire aujourd’hui' : `expire dans ${n.data.daysLeft} jours`}${n.data.company ? ` (${n.data.company})` : ''}`;
        case 'compliance_review': return n.data.decision === 'submitted' ? `${n.data.name ?? 'Un partenaire'} a soumis un dossier de conformité${n.data.company ? ` (${n.data.company})` : ''}` : `${n.data.reviewer ?? 'Le siège social'} a ${n.data.decision === 'approved' ? 'approuvé' : 'renvoyé'} le dossier de conformité de ${n.data.name ?? 'votre partenaire'}${n.data.note ? ` : « ${n.data.note} »` : ''}`;
        case 'appointment_request': return `${n.data.name ?? 'Un partenaire'} demande une nomination auprès de ${n.data.carrier ?? 'un assureur'}${n.data.company ? ` (${n.data.company})` : ''}`;
        case 'thread_shared': return `${who} a partagé une conversation avec vous sur ${box}${n.data.message ? ` : « ${n.data.message} »` : ''}`;
        case 'document_added': return `${who} a ajouté un document à ${box} : ${n.data.name ?? ''}`;
        case 'aml_alert': return `${n.data.name ?? 'Un dossier client'} : ${n.data.issue === 'cash_overdue' ? `l’encaissement en espèces de ${n.data.detail} du ${n.data.since} n’a pas de référence de déclaration` : `le résultat de vérification (${n.data.detail}) du ${n.data.since} n’a pas été examiné`}`;
        case 'vault_alert': return `Voûte d’archives : ${n.data.pending} document(s) signé(s) en attente de copie depuis plus d’un jour`;
        case 'team_overdue': return `Formation : ${n.data.overdue} apprenant(s) en retard dans votre équipe`;
        case 'learning_due': return `${n.data.title || 'Une formation'} ${n.data.daysLeft < 0 ? `devait être terminée le ${n.data.dueOn}` : n.data.daysLeft === 0 ? 'est due aujourd’hui' : `est due dans ${n.data.daysLeft} jours`}`;
        case 'course_request': return `${n.data.name ?? 'Quelqu’un'} demande à suivre « ${n.data.course ?? 'une formation'} »${n.data.note ? ` : « ${n.data.note} »` : ''}`;
        case 'course_decision': return `Votre demande pour « ${n.data.course ?? 'une formation'} » a été ${n.data.decision === 'approved' ? 'approuvée' : 'refusée'}${n.data.note ? ` : « ${n.data.note} »` : ''}`;
        case 'quiz_attempts': return `${who} vous a accordé ${n.data.extra ?? 1} tentative(s) de plus au test de « ${n.data.course ?? 'une formation'} »`;
        case 'ce_reminder': return n.data.state === 'overdue' ? `${n.data.pack} : votre période s’est terminée le ${n.data.termEnd} et il manquait ${n.data.remaining} heures` : `${n.data.pack} : il reste ${n.data.remaining} heures à compléter avant le ${n.data.termEnd}`;
        default: return n.kind;
      }
    },
  },
};

const changed = () => { try { window.dispatchEvent(new CustomEvent('pii-settings-changed')); } catch { /* not in a window */ } };

export function NotificationsPage({ call, locale, go }: { call: Call; locale: Locale; go: (page: string, id?: string) => void }) {
  const x = X[locale];
  const [list, setList] = useState<N[] | null>(null);
  const [err, setErr] = useState('');
  const [mail, setMail] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const [ms, setMs] = useState<{ configured: boolean; from: string; lastOkAt: string | null; lastErrorAt: string | null; lastError: string | null } | null>(null);
  const [testMsg, setTestMsg] = useState('');
  useEffect(() => { call('GET', '/v1/mail/status').then(setMs, () => setMs(null)); }, [call]);
  const sendTest = async () => {
    const fr = locale === 'fr-CA'; setTestMsg('…');
    try {
      const r = await call('POST', '/v1/mail/test');
      setTestMsg(r.ok ? (fr ? `Courriel de test envoyé à ${r.to}.` : `Test email sent to ${r.to}.`) : (fr ? `Échec : ${r.error}` : `Failed: ${r.error}`));
      call('GET', '/v1/mail/status').then(setMs, () => {});
    } catch (e) { setTestMsg((e as Error).message); }
  };
  useEffect(() => { call('GET', '/v1/me/email-reminders').then(setMail, () => setMail(null)); }, [call]);
  const toggleMail = async (enabled: boolean) => { try { await call('PUT', '/v1/me/email-reminders', { enabled }); setMail((m) => (m ? { ...m, enabled } : m)); } catch (e) { setErr((e as Error).message); } };
  const load = () => call('GET', '/v1/notifications').then((r) => setList(r.notifications), (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [call]);
  const open = async (n: N) => {
    if (!n.readAt) { try { await call('POST', '/v1/notifications/read', { ids: [n.id] }); changed(); } catch { /* still navigate */ } }
    if (n.kind === 'merge_done' || n.kind === 'unsubscribed') go('merges');
    else if (n.kind.startsWith('compliance') || n.kind === 'appointment_request') go('compliance');
    else if (n.pipelineId) go('pipelines', n.pipelineId);
    else void load();
  };
  const markAll = async () => { try { await call('POST', '/v1/notifications/read', { all: true }); changed(); await load(); } catch (e) { setErr((e as Error).message); } };
  if (err) return <ErrorBar msg={err} retry={locale === 'fr-CA' ? 'Réessayer' : 'Try again'} />;
  if (!list) return <div class="msg">…</div>;
  return (
    <div class="home">
      <div class="erow"><h2 style={{ margin: 0 }}>{x.title}</h2><span class="spacer" />
        <button class="link" onClick={() => go('settings', 'notifications')}>{x.settings}</button>
        <button class="btn quiet" disabled={!list.some((n) => !n.readAt)} onClick={() => void markAll()}>{x.markAll}</button></div>
      {ms && (() => {
        const fr = locale === 'fr-CA';
        const bad = !ms.configured || (ms.lastErrorAt && (!ms.lastOkAt || ms.lastErrorAt > ms.lastOkAt));
        return (
          <div class={`hcard mailbox${bad ? ' bad' : ''}`} style={{ marginTop: '8px' }}>
            <b>{fr ? 'Livraison des courriels' : 'Email delivery'}</b>
            <p class="muted" style={{ margin: '4px 0' }}>
              {!ms.configured ? (fr ? 'Les courriels ne sont pas configurés sur ce serveur : les rappels restent dans l’application.' : 'Email is not set up on this server, so reminders stay in the app.')
                : bad ? (fr ? `Le dernier envoi a été refusé : ${ms.lastError}` : `The last send was refused: ${ms.lastError}`)
                : ms.lastOkAt ? (fr ? `Les courriels partent de ${ms.from}. Dernier envoi réussi : ${new Date(ms.lastOkAt).toLocaleString(locale)}.` : `Email goes out from ${ms.from}. Last successful send: ${new Date(ms.lastOkAt).toLocaleString(locale)}.`)
                : (fr ? `Les courriels partent de ${ms.from}. Aucun envoi depuis le dernier redémarrage — envoyez-vous un test.` : `Email goes out from ${ms.from}. Nothing sent since the last restart — send yourself a test.`)}
            </p>
            {ms.configured && <div class="erow"><button class="btn quiet" onClick={() => void sendTest()}>{fr ? 'M’envoyer un courriel de test' : 'Send me a test email'}</button>{testMsg && <span class="muted">{testMsg}</span>}</div>}
          </div>
        );
      })()}
      {mail?.available && <label class="erow" style={{ marginTop: '8px' }}><input type="checkbox" checked={mail.enabled} onChange={(e) => void toggleMail((e.target as HTMLInputElement).checked)} /> {x.emailRem}</label>}
      <div class="hcard" style={{ marginTop: '12px' }}>
        {list.length === 0 && <p class="muted">{x.none}</p>}
        {list.map((n) => (
          <button class={`hrow${n.readAt ? '' : ' unread'}`} key={n.id} onClick={() => void open(n)}>
            <span>{x.text(n)}</span><small class="muted">{new Date(n.createdAt).toLocaleString(locale)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
