import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Key { id: string; name: string; prefix: string; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null }

const X = {
  'en': { h: 'API keys', help: 'Read-only access for Zapier, spreadsheets and reporting tools. A key sees exactly what you see, and can never change anything. To send data into PII, use a pipeline’s capture link instead.', name: 'Name (for example, Zapier)', make: 'Create key', none: 'No keys yet.', shown: 'Copy this key now. It is shown only once.', copy: 'Copy', copied: 'Copied', revoke: 'Revoke', confirm: 'Revoke this key? Anything using it will stop working.', used: 'last used', never: 'never used', exp: 'expires', gone: 'revoked', base: 'Address', only: 'Only administrators and managers can create keys.', docs: 'Send it as “Authorization: Bearer <key>”. Try GET /v1/public/records or /v1/public/pipelines.' },
  'fr-CA': { h: 'Clés d’API', help: 'Accès en lecture seule pour Zapier, les chiffriers et les outils de rapport. Une clé voit exactement ce que vous voyez et ne peut rien modifier. Pour envoyer des données dans PII, utilisez plutôt le lien de capture d’un pipeline.', name: 'Nom (par exemple, Zapier)', make: 'Créer une clé', none: 'Aucune clé pour l’instant.', shown: 'Copiez cette clé maintenant. Elle ne s’affiche qu’une fois.', copy: 'Copier', copied: 'Copié', revoke: 'Révoquer', confirm: 'Révoquer cette clé? Tout ce qui l’utilise cessera de fonctionner.', used: 'dernière utilisation', never: 'jamais utilisée', exp: 'expire', gone: 'révoquée', base: 'Adresse', only: 'Seuls les administrateurs et gestionnaires peuvent créer des clés.', docs: 'Envoyez-la ainsi : « Authorization: Bearer <clé> ». Essayez GET /v1/public/records ou /v1/public/pipelines.' },
};

export function ApiKeys({ call, locale }: { call: Call; locale: Locale }) {
  const x = X[locale];
  const [keys, setKeys] = useState<Key[]>([]);
  const [can, setCan] = useState(false);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/api-keys').then((r) => { setKeys(r.keys); setCan(r.canCreate); }, (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, []);
  const make = async () => {
    setErr(''); setCopied(false);
    try { const r = await call('POST', '/v1/api-keys', { name }); setFresh(r.token); setName(''); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const revoke = async (k: Key) => { if (!confirm(x.confirm)) return; try { await call('DELETE', `/v1/api-keys/${k.id}`); setFresh(''); await load(); } catch (e) { setErr((e as Error).message); } };
  const day = (s: string) => new Date(s).toLocaleDateString(locale);
  return (
    <section class="icard">
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {fresh && (
        <div role="status" style={{ background: '#e6f4ea', color: '#137333', padding: '10px', borderRadius: '8px', margin: '8px 0' }}>
          <b>{x.shown}</b>
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
            <code style={{ wordBreak: 'break-all', flex: 1 }}>{fresh}</code>
            <button class="btn quiet" onClick={() => { void navigator.clipboard?.writeText(fresh).then(() => setCopied(true)); }}>{copied ? x.copied : x.copy}</button>
          </div>
          <p class="muted" style={{ margin: '6px 0 0' }}>{x.docs}</p>
        </div>
      )}
      {can ? (
        <div class="erow wrap2">
          <input placeholder={x.name} value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button class="btn" disabled={!name.trim()} onClick={() => void make()}>{x.make}</button>
        </div>
      ) : <p class="muted">{x.only}</p>}
      {keys.length === 0 && <p class="muted">{x.none}</p>}
      {keys.map((k) => (
        <div class="ev" key={k.id}>
          <b>{k.name}</b> <code>{k.prefix}…</code>
          <small>{k.revokedAt ? x.gone : `${x.exp} ${day(k.expiresAt)}`} · {k.lastUsedAt ? `${x.used} ${day(k.lastUsedAt)}` : x.never}</small>
          {!k.revokedAt && <button class="btn quiet danger" onClick={() => void revoke(k)}>{x.revoke}</button>}
        </div>
      ))}
    </section>
  );
}
