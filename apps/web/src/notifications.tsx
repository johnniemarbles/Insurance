import { ErrorBar } from './errorbar.tsx';
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface N { id: string; kind: string; boxId: string | null; pipelineId: string | null; data: Record<string, any>; createdAt: string; readAt: string | null; actorName: string | null }

export const X = {
  'en': {
    title: 'Notifications', none: 'You are all caught up.', markAll: 'Mark all read', settings: 'Choose what you are told about',
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
        default: return n.kind;
      }
    },
  },
  'fr-CA': {
    title: 'Notifications', none: 'Vous êtes à jour.', markAll: 'Tout marquer comme lu', settings: 'Choisir ce dont vous êtes informé',
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
