import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Persona { id: string; name: string; role: string; nodeName: string; locale: string }
interface Invite { id: string; label: string; createdAt: string; expiresAt: string; revokedAt: string | null; uses: number; maxUses: number; lastUsedAt: string | null }

const X = {
  'en': {
    banner: 'Demo with fictional data. Nothing here is real, and no email is sent.', viewAs: 'View as',
    h: 'Demo access', help: 'Private links that open the demo company without a Google account. Share one with a prospect or a reviewer; revoke it any time.',
    label: 'Who is it for? (for example, Chrome reviewer)', days: 'Days valid', make: 'Create link', shown: 'Copy this link now. It is shown only once.', copy: 'Copy', copied: 'Copied',
    none: 'No links yet.', revoke: 'Revoke', confirm: 'Revoke this link? It stops working at once.', gone: 'revoked', exp: 'expires', uses: 'opened', never: 'never opened',
    off: 'This site has no demo company yet.',
    roles: { admin: 'Admin', manager: 'Manager', trainer: 'Trainer', partner: 'Partner', learner: 'Advisor', compliance: 'Compliance' } as Record<string, string>,
  },
  'fr-CA': {
    banner: 'Démo avec des données fictives. Rien ici n’est réel et aucun courriel n’est envoyé.', viewAs: 'Voir en tant que',
    h: 'Accès à la démo', help: 'Des liens privés qui ouvrent l’entreprise de démonstration sans compte Google. Envoyez-en un à un prospect ou à un évaluateur; révoquez-le à tout moment.',
    label: 'Pour qui? (par exemple, évaluateur Chrome)', days: 'Jours de validité', make: 'Créer le lien', shown: 'Copiez ce lien maintenant. Il ne s’affiche qu’une fois.', copy: 'Copier', copied: 'Copié',
    none: 'Aucun lien pour l’instant.', revoke: 'Révoquer', confirm: 'Révoquer ce lien? Il cesse de fonctionner immédiatement.', gone: 'révoqué', exp: 'expire', uses: 'ouvert', never: 'jamais ouvert',
    off: 'Ce site n’a pas encore d’entreprise de démonstration.',
    roles: { admin: 'Administrateur', manager: 'Gestionnaire', trainer: 'Formateur', partner: 'Partenaire', learner: 'Conseiller', compliance: 'Conformité' } as Record<string, string>,
  },
};

/** Shown to everyone inside the demo company: a reminder it is fictional, and a way to look at it as another person. */
export function DemoBar({ call, locale, meId }: { call: Call; locale: Locale; meId: string }) {
  const x = X[locale];
  const [people, setPeople] = useState<Persona[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', '/v1/demo/personas').then((r) => setPeople(r.personas), () => undefined); }, [call]);
  const pick = async (id: string) => {
    setErr('');
    try { await call('POST', '/v1/demo/switch', { userId: id }); window.location.reload(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div class="demobar" role="status">
      <span>{x.banner}</span>
      <label>{x.viewAs}{' '}
        <select value={meId} onChange={(e) => void pick((e.target as HTMLSelectElement).value)} aria-label={x.viewAs}>
          {people.map((p) => <option value={p.id}>{p.name} · {x.roles[p.role] ?? p.role} · {p.nodeName}</option>)}
        </select>
      </label>
      {err && <span class="err">{err}</span>}
    </div>
  );
}

/** For head-office administrators: make and revoke the private demo links. Renders nothing elsewhere. */
export function DemoAccess({ call, locale }: { call: Call; locale: Locale }) {
  const x = X[locale];
  const [state, setState] = useState<'loading' | 'no' | 'off' | 'ok'>('loading');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(7);
  const [fresh, setFresh] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/demo/invites').then((r) => { setInvites(r.invites); setState(r.available ? 'ok' : 'off'); }, () => setState('no'));
  useEffect(() => { void load(); }, []);
  if (state === 'loading' || state === 'no') return null;
  const make = async () => {
    setErr(''); setCopied(false);
    try { const r = await call('POST', '/v1/demo/invites', { label, days }); setFresh(r.url); setLabel(''); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const revoke = async (i: Invite) => { if (!confirm(x.confirm)) return; try { await call('DELETE', `/v1/demo/invites/${i.id}`); setFresh(''); await load(); } catch (e) { setErr((e as Error).message); } };
  const day = (s: string) => new Date(s).toLocaleDateString(locale);
  return (
    <section class="icard">
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {state === 'off' ? <p class="muted">{x.off}</p> : (
        <>
          {fresh && (
            <div role="status" class="freshkey">
              <b>{x.shown}</b>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
                <code style={{ wordBreak: 'break-all', flex: 1 }}>{fresh}</code>
                <button class="btn quiet" onClick={() => { void navigator.clipboard?.writeText(fresh).then(() => setCopied(true)); }}>{copied ? x.copied : x.copy}</button>
              </div>
            </div>
          )}
          <div class="erow wrap2">
            <input placeholder={x.label} value={label} maxLength={80} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
            <select value={days} aria-label={x.days} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}>
              {[1, 3, 7, 14, 30].map((d) => <option value={d}>{d} {x.days.toLowerCase()}</option>)}
            </select>
            <button class="btn" disabled={!label.trim()} onClick={() => void make()}>{x.make}</button>
          </div>
          {invites.length === 0 && <p class="muted">{x.none}</p>}
          {invites.map((i) => (
            <div class="ev" key={i.id}>
              <b>{i.label}</b>
              <small>{i.revokedAt ? x.gone : `${x.exp} ${day(i.expiresAt)}`} · {i.uses ? `${x.uses} ${i.uses}/${i.maxUses}` : x.never}</small>
              {!i.revokedAt && <button class="btn quiet danger" onClick={() => void revoke(i)}>{x.revoke}</button>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
