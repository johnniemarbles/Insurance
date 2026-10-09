import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const T = {
  'en': { h: 'Archive vault', help: 'Signed paperwork is copied, encrypted, to write-once storage outside the database, and cannot be changed or deleted until its retention date.', off: 'Not connected on this server yet. Signed paperwork stays in the database only.', on: 'Connected', where: 'Storage', lock: 'Lock', archived: 'archived', pending: 'waiting', last: 'Last copy', now: 'Archive now', ok: 'Done', verify: 'Verify copy', dl: 'Download copy', intact: 'The copy is intact.', bad: 'The copy does NOT match.', until: 'kept until', none: 'Nothing archived yet. Once a signed document is copied, it is listed here with a Verify copy button.' },
  'fr-CA': { h: 'Voûte d’archives', help: 'Les documents signés sont copiés, chiffrés, vers un stockage à écriture unique hors de la base de données, sans modification ni suppression possible avant la date de conservation.', off: 'Pas encore connectée sur ce serveur. Les documents signés restent dans la base de données seulement.', on: 'Connectée', where: 'Stockage', lock: 'Verrou', archived: 'archivés', pending: 'en attente', last: 'Dernière copie', now: 'Archiver maintenant', ok: 'Terminé', verify: 'Vérifier la copie', dl: 'Télécharger la copie', intact: 'La copie est intacte.', bad: 'La copie NE correspond PAS.', until: 'conservé jusqu’au', none: 'Rien d’archivé pour l’instant. Dès qu’un document signé est copié, il apparaît ici avec un bouton Vérifier la copie.' },
};
interface V { connected: boolean; bucket: string | null; region: string | null; lockMode: string | null; archived: number; pending: number; lastArchivedAt: string | null; recent: { documentId: string; name: string | null; retainUntil: string; lockMode: string }[] }
/** Status of the write-once archive. Visible to administrators and the compliance role (others get a refusal and see nothing). */
export function VaultPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale];
  const [d, setD] = useState<V | null>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/compliance/vault').then(setD, () => undefined);
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  const act = async (fn: () => Promise<string>) => { setErr(''); setMsg(''); try { setMsg(await fn()); await load(); } catch (e) { setErr((e as Error).message); } };
  return (
    <section class="vpanel" aria-label={x.h}>
      <h3>{x.h}</h3><p class="muted">{x.help}</p>
      {err && <p class="err" role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}
      {!d.connected ? <p class="muted">{x.off}</p> : <>
        <p class="vstat"><strong>{x.on}</strong> · {x.where}: {d.bucket} ({d.region}) · {x.lock}: {d.lockMode}</p>
        <p class="vstat"><strong>{d.archived}</strong> {x.archived} · <strong>{d.pending}</strong> {x.pending}{d.lastArchivedAt ? ` · ${x.last}: ${d.lastArchivedAt.slice(0, 16)}` : ''}</p>
        <button class="btn quiet" onClick={() => void act(async () => { await call('POST', '/v1/compliance/vault/archive-now'); return x.ok; })}>{x.now}</button>
        {d.recent.length === 0 && <p class="muted">{x.none}</p>}
        {d.recent.map((r) => <div class="vrow" key={r.documentId}><span>{r.name ?? r.documentId.slice(0, 8)} <small class="muted">{x.until} {r.retainUntil}</small></span>
          <span><button class="btn quiet" onClick={() => void act(async () => ((await call('GET', `/v1/compliance/vault/${r.documentId}/verify`)).intact ? x.intact : x.bad))}>{x.verify}</button>{' '}
          <button class="btn quiet" onClick={() => void act(async () => {
            const f = await call('GET', `/v1/compliance/vault/${r.documentId}/download`);
            const bin = atob(f.dataBase64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
            const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            return x.intact;
          })}>{x.dl}</button></span></div>)}
      </>}
    </section>
  );
}
