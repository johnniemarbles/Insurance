import { useEffect, useState } from 'preact/hooks';
import { SETTINGS } from '../../../packages/domain/src/settings.ts';
import type { Locale } from './types.ts';
import { Avatar, ago } from './people.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Ev { id: number; createdAt: string; action: string; area: string; actorId: string | null; actorName: string | null; entityType: string | null; detail: Record<string, any>; placeName: string | null; detailPlaceName: string | null }
type Area = '' | 'invitations' | 'people' | 'structure' | 'settings' | 'privacy' | 'records';

const X = {
  'en': {
    areas: { '': 'Everything', invitations: 'Invitations', people: 'People', structure: 'Structure', settings: 'Settings', privacy: 'Privacy', records: 'Records' } as Record<string, string>,
    search: 'Search by person, email or action', attention: 'Failures only', export: 'Export CSV', more: 'Show older', none: 'Nothing recorded for this filter yet.', from: 'From', to: 'To',
    someone: 'Someone', you: 'You', gmail: 'Gmail', link: 'a copied link', noaccess: 'Only administrators can read the activity log.', lock: 'locked',
    note: 'Lines cannot be edited or deleted. Each administrator sees the places they administer.',
    s: (e: Ev, who: string, place: string): string => {
      const d = e.detail, em = d.email ?? '', role = d.role ? String(d.role) : '';
      switch (e.action) {
        case 'invitation_created': return `${who} invited ${em} to ${place} as ${role}`;
        case 'invitation_sent': return `${who} sent the invitation to ${em} from ${d.method === 'link' ? 'a copied link' : 'Gmail'}`;
        case 'invitation_not_sent': return `The invitation to ${em} was not sent: ${d.error ?? 'unknown reason'}`;
        case 'invitation_resent': return `${who} made a new link for ${em}`;
        case 'invitation_opened': return `${em} opened the invitation link`;
        case 'invitation_accepted': return `${em || who} joined ${place} as ${role}`;
        case 'invitation_withdrawn': return `${who} withdrew the invitation to ${em}`;
        case 'role_added': return `${who} gave ${em} the role ${role} at ${place}`;
        case 'role_removed': return `${who} removed the role ${role} from ${em} at ${place}`;
        case 'user_disabled': return `${who} switched off ${em}`;
        case 'user_enabled': return `${who} switched ${em} back on`;
        case 'node_created': return `${who} created the ${d.type === 'location' ? 'branch' : 'partner'} ${d.name ?? place}`;
        case 'node_updated': return `${who} ${d.name ? `renamed a place to ${d.name}` : d.isActive === false ? `switched off ${place}` : d.isActive === true ? `switched ${place} back on` : `changed ${place}`}`;
        case 'link_changed': return `${who} ${d.op === 'remove' ? 'unlinked' : 'linked'} ${place}`;
        case 'setting_changed': return `${who} set ${settingName(d.key, 'en')} for ${e.entityType === 'tenant' ? 'the whole company' : place || 'a branch'}${d.locked ? ' and locked it' : ''}`;
        case 'setting_reverted': return `${who} cleared ${settingName(d.key, 'en')} for ${e.entityType === 'tenant' ? 'the whole company' : place || 'a branch'}`;
        case 'privacy_request': return `${who} made a privacy request (${d.kind})`;
        case 'privacy_export': return `${who} downloaded their own data`;
        case 'privacy_resolved': return `${who} closed a privacy request as ${d.status}`;
        case 'activity_export': return `${who} exported ${d.rows ?? ''} lines of activity`;
        default: return generic(e.action, who, 'en');
      }
    },
  },
  'fr-CA': {
    areas: { '': 'Tout', invitations: 'Invitations', people: 'Personnes', structure: 'Structure', settings: 'Paramètres', privacy: 'Confidentialité', records: 'Dossiers' } as Record<string, string>,
    search: 'Chercher une personne, un courriel ou une action', attention: 'Échecs seulement', export: 'Exporter en CSV', more: 'Voir plus ancien', none: 'Rien d’enregistré pour ce filtre.', from: 'Du', to: 'Au',
    someone: 'Quelqu’un', you: 'Vous', gmail: 'Gmail', link: 'un lien copié', noaccess: 'Seuls les administrateurs peuvent lire le journal d’activité.', lock: 'verrouillé',
    note: 'Les lignes ne peuvent être ni modifiées ni supprimées. Chaque administrateur voit les endroits qu’il administre.',
    s: (e: Ev, who: string, place: string): string => {
      const d = e.detail, em = d.email ?? '', role = d.role ? String(d.role) : '';
      switch (e.action) {
        case 'invitation_created': return `${who} a invité ${em} à ${place} comme ${role}`;
        case 'invitation_sent': return `${who} a envoyé l’invitation à ${em} depuis ${d.method === 'link' ? 'un lien copié' : 'Gmail'}`;
        case 'invitation_not_sent': return `L’invitation à ${em} n’est pas partie : ${d.error ?? 'raison inconnue'}`;
        case 'invitation_resent': return `${who} a créé un nouveau lien pour ${em}`;
        case 'invitation_opened': return `${em} a ouvert le lien d’invitation`;
        case 'invitation_accepted': return `${em || who} s’est joint à ${place} comme ${role}`;
        case 'invitation_withdrawn': return `${who} a retiré l’invitation à ${em}`;
        case 'role_added': return `${who} a donné le rôle ${role} à ${em} chez ${place}`;
        case 'role_removed': return `${who} a retiré le rôle ${role} à ${em} chez ${place}`;
        case 'user_disabled': return `${who} a désactivé ${em}`;
        case 'user_enabled': return `${who} a réactivé ${em}`;
        case 'node_created': return `${who} a créé ${d.type === 'location' ? 'la succursale' : 'le partenaire'} ${d.name ?? place}`;
        case 'node_updated': return `${who} ${d.name ? `a renommé un endroit en ${d.name}` : d.isActive === false ? `a désactivé ${place}` : d.isActive === true ? `a réactivé ${place}` : `a modifié ${place}`}`;
        case 'link_changed': return `${who} a ${d.op === 'remove' ? 'délié' : 'lié'} ${place}`;
        case 'setting_changed': return `${who} a réglé ${settingName(d.key, 'fr-CA')} pour ${e.entityType === 'tenant' ? 'toute l’entreprise' : place || 'une succursale'}${d.locked ? ' et l’a verrouillé' : ''}`;
        case 'setting_reverted': return `${who} a effacé ${settingName(d.key, 'fr-CA')} pour ${e.entityType === 'tenant' ? 'toute l’entreprise' : place || 'une succursale'}`;
        case 'privacy_request': return `${who} a fait une demande de confidentialité (${d.kind})`;
        case 'privacy_export': return `${who} a téléchargé ses propres données`;
        case 'privacy_resolved': return `${who} a clos une demande de confidentialité : ${d.status}`;
        case 'activity_export': return `${who} a exporté ${d.rows ?? ''} lignes d’activité`;
        default: return generic(e.action, who, 'fr-CA');
      }
    },
  },
};

const NOUN: Record<string, [string, string]> = { box: ['a record', 'un dossier'], contact: ['a contact', 'un contact'], account: ['a company record', 'une fiche d’entreprise'], note: ['a note', 'une note'], task: ['a task', 'une tâche'], pipeline: ['a pipeline', 'un pipeline'], stage: ['a stage', 'une étape'], field: ['a column', 'une colonne'], merge: ['a mail merge', 'un publipostage'], automation: ['an automation', 'une automatisation'], course: ['a course', 'un cours'], lesson: ['a lesson', 'une leçon'], quiz: ['a quiz', 'un quiz'], webhook: ['a webhook', 'un webhook'], intake: ['a capture link', 'un lien de capture'], thread: ['an email conversation', 'une conversation courriel'], ai: ['the AI assistant', 'l’assistant IA'] };
const VERB: Record<string, [string, string]> = { created: ['created', 'a créé'], updated: ['updated', 'a modifié'], deleted: ['deleted', 'a supprimé'], added: ['added', 'a ajouté'], linked: ['linked', 'a lié'], unlinked: ['unlinked', 'a délié'], read: ['read', 'a lu'], ran: ['ran', 'a exécuté'], received: ['received', 'a reçu'], assigned: ['assigned', 'a assigné'], reordered: ['reordered', 'a réordonné'], generate: ['used', 'a utilisé'], changed: ['changed', 'a modifié'] };
function generic(action: string, who: string, locale: Locale): string {
  const m = action.match(/^(.*)_([a-z]+)$/);
  const i = locale === 'en' ? 0 : 1;
  const noun = m && NOUN[m[1]!.split('_')[0]!]?.[i], verb = m && VERB[m[2]!]?.[i];
  if (noun && verb) return `${who} ${verb} ${noun}`;
  return `${who}: ${action.replace(/_/g, ' ')}`;
}

function settingName(key: string | undefined, locale: Locale): string {
  const d = SETTINGS.find((s) => s.key === key);
  return d ? `“${d.label[locale]}”` : key ?? '';
}
const ICON: Record<string, string> = { invitations: '✉️', people: '👤', structure: '🏢', settings: '⚙️', privacy: '🔒', records: '📋' };

export function ActivityTab({ call, locale }: { call: Call; locale: Locale }) {
  const x = X[locale];
  const [area, setArea] = useState<Area>('');
  const [q, setQ] = useState('');
  const [attention, setAttention] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const query = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ limit: '50', ...extra });
    if (area) p.set('area', area);
    if (q.trim()) p.set('q', q.trim());
    if (attention) p.set('attention', 'true');
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return `/v1/activity?${p.toString()}`;
  };
  useEffect(() => {
    const t = setTimeout(() => { call('GET', query()).then((r) => { setEvents(r.events); setNext(r.next); setErr(''); }, (e) => setErr((e as Error).message)); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [area, q, attention, from, to]);
  const older = () => { if (next) call('GET', query({ before: String(next) })).then((r) => { setEvents([...(events ?? []), ...r.events]); setNext(r.next); }, (e) => setErr((e as Error).message)); };
  const exportCsv = async () => {
    try {
      const p = query({ format: 'csv' }).replace('limit=50&', '').replace('&limit=50', '');
      const r = await call('GET', p);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
      a.download = r.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setErr((e as Error).message); }
  };

  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  let last = '';
  return (
    <div class="act">
      <div class="act-chips">
        {(Object.keys(x.areas) as Area[]).map((k) => <button class={`achip ${area === k ? 'on' : ''}`} onClick={() => setArea(k)}>{ICON[k] ?? '◎'} {x.areas[k]}</button>)}
      </div>
      <div class="act-bar">
        <input class="ph-search" type="search" placeholder={x.search} aria-label={x.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <label class="dt">{x.from}<input type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} /></label>
        <label class="dt">{x.to}<input type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} /></label>
        <label class="check"><input type="checkbox" checked={attention} onChange={(e) => setAttention((e.target as HTMLInputElement).checked)} /> {x.attention}</label>
        <span class="spacer" />
        <button class="btn quiet" onClick={() => void exportCsv()}>⬇ {x.export}</button>
      </div>
      {err && <p class="err" role="alert">{err}</p>}
      {events && events.length === 0 && <div class="empty"><div class="empty-ic">🗒️</div><p>{x.none}</p></div>}
      <div class="timeline">
        {(events ?? []).map((e) => {
          const d = day(e.createdAt), head = d !== last; last = d;
          const who = e.actorName ?? x.someone, place = e.placeName ?? e.detailPlaceName ?? '';
          const bad = e.action === 'invitation_not_sent';
          return (
            <div key={e.id}>
              {head && <div class="tl-day">{d}</div>}
              <div class={`tl-row ${bad ? 'bad' : ''}`}>
                <span class="tl-ic">{ICON[e.area] ?? '◎'}</span>
                <div class="tl-main">
                  <div class="tl-text">{x.s(e, who, place)}</div>
                  <div class="tl-meta">{e.actorName && <><Avatar name={e.actorName} size={16} /> {e.actorName} · </>}<span title={new Date(e.createdAt).toLocaleString(locale)}>{ago(e.createdAt, locale)}</span>{place && e.action !== 'invitation_accepted' ? <> · <span class="pl">{place}</span></> : null}</div>
                </div>
                <span class={`pill a-${e.area}`}>{x.areas[e.area]}</span>
              </div>
            </div>
          );
        })}
      </div>
      {next && <button class="btn quiet" onClick={older}>{x.more}</button>}
      <p class="muted pad">{x.note}</p>
    </div>
  );
}
