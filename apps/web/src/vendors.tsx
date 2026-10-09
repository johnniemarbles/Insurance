import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface VendorRow { live?: boolean; id: string; name: string; fit: string; note: Record<Locale, string>; connected: boolean; enabled: boolean; note2: string | null }
const T = {
  'en': { h: 'E-signature vendors', help: 'Beneficiary designations and replacement disclosures need a certified vendor. Turn on the ones your company uses. If none is turned on, all are allowed.', on: 'On', save: 'Save note', note: 'Your note (for example, account or contact)', manual: 'Recorded by hand today', adobeH: 'Adobe connection', adobeHelp: 'Paste the API access point and sign-in details from your Adobe Acrobat Sign account (Account > Acrobat Sign API > API Information). Either an access token, or the client ID, client secret and refresh token of your OAuth app. They are stored encrypted and never shown again.', point: 'API access point (https://api.na1.adobesign.com)', token: 'Access token', cid: 'Client ID', csec: 'Client secret', rtok: 'Refresh token', connect: 'Connect', disconnect: 'Disconnect', connectedAs: 'Connected', signedInAs: 'signed in as', saved: 'Connected to Adobe.', connected: 'Connected', only: 'Only the turned-on vendors can be recorded.', readonly: 'Only an administrator or the compliance role can change this.' },
  'fr-CA': { h: 'Fournisseurs de signature électronique', help: 'Les désignations de bénéficiaires et avis de remplacement exigent un fournisseur certifié. Activez ceux qu’utilise votre entreprise. Si aucun n’est activé, tous sont permis.', on: 'Activé', save: 'Enregistrer la note', note: 'Votre note (p. ex. compte ou contact)', manual: 'Consigné à la main pour l’instant', adobeH: 'Connexion Adobe', adobeHelp: 'Collez le point d’accès API et les identifiants de votre compte Adobe Acrobat Sign (Compte > API Acrobat Sign > Informations sur l’API). Soit un jeton d’accès, soit l’ID client, le secret client et le jeton d’actualisation de votre application OAuth. Ils sont chiffrés et ne sont plus jamais affichés.', point: 'Point d’accès API (https://api.na1.adobesign.com)', token: 'Jeton d’accès', cid: 'ID client', csec: 'Secret client', rtok: 'Jeton d’actualisation', connect: 'Connecter', disconnect: 'Déconnecter', connectedAs: 'Connecté', signedInAs: 'connecté en tant que', saved: 'Connecté à Adobe.', connected: 'Connecté', only: 'Seuls les fournisseurs activés peuvent être consignés.', readonly: 'Seuls un administrateur ou le rôle conformité peuvent modifier ceci.' },
};
export const useVendors = (call: Call) => {
  const [d, setD] = useState<{ vendors: VendorRow[]; restricted: boolean; canManage: boolean } | null>(null);
  const load = () => call('GET', '/v1/compliance/signing-vendors').then(setD, () => undefined);
  useEffect(() => { void load(); }, []);
  return { d, load };
};
interface AdobeStatus { connected: boolean; apiAccessPoint: string | null; setBy: string | null; canManage: boolean }
function AdobeConnect({ call, locale, onChange }: { call: Call; locale: Locale; onChange: () => void }) {
  const x = T[locale];
  const [st, setSt] = useState<AdobeStatus | null>(null);
  const [f, setF] = useState({ apiAccessPoint: '', accessToken: '', clientId: '', clientSecret: '', refreshToken: '' });
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const load = () => call('GET', '/v1/compliance/esign/adobe').then(setSt, () => undefined);
  useEffect(() => { void load(); }, []);
  if (!st?.canManage) return null;
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const save = async () => {
    setErr(''); setOk('');
    try {
      const body: Record<string, string> = { apiAccessPoint: f.apiAccessPoint };
      for (const k of ['accessToken', 'clientId', 'clientSecret', 'refreshToken'] as const) if (f[k].trim()) body[k] = f[k];
      const r = await call('PUT', '/v1/compliance/esign/adobe', body);
      setOk(r.signedInAs ? `${x.saved} (${x.signedInAs} ${r.signedInAs})` : x.saved);
      setF({ apiAccessPoint: '', accessToken: '', clientId: '', clientSecret: '', refreshToken: '' });
      await load(); onChange();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div style={{ marginTop: '6px' }}>
      <strong>{x.adobeH}</strong>
      {err && <p class="err" role="alert">{err}</p>}{ok && <p role="status">{ok}</p>}
      {st.connected ? <p>{x.connectedAs}: {st.apiAccessPoint}{' '}<button class="btn quiet" onClick={() => { setErr(''); void call('DELETE', '/v1/compliance/esign/adobe').then(() => { void load(); onChange(); }, (e) => setErr((e as Error).message)); }}>{x.disconnect}</button></p> : <>
        <p class="muted">{x.adobeHelp}</p>
        <div><input aria-label={x.point} placeholder={x.point} style={{ width: '320px' }} value={f.apiAccessPoint} onInput={set('apiAccessPoint')} /></div>
        <div><input aria-label={x.token} placeholder={x.token} type="password" autocomplete="off" value={f.accessToken} onInput={set('accessToken')} /></div>
        <div><input aria-label={x.cid} placeholder={x.cid} autocomplete="off" value={f.clientId} onInput={set('clientId')} />{' '}
          <input aria-label={x.csec} placeholder={x.csec} type="password" autocomplete="off" value={f.clientSecret} onInput={set('clientSecret')} />{' '}
          <input aria-label={x.rtok} placeholder={x.rtok} type="password" autocomplete="off" value={f.refreshToken} onInput={set('refreshToken')} /></div>
        <button class="btn" disabled={!f.apiAccessPoint.trim() || !(f.accessToken.trim() || (f.clientId.trim() && f.clientSecret.trim() && f.refreshToken.trim()))} onClick={() => void save()}>{x.connect}</button>
      </>}
    </div>
  );
}

/** Which certified e-signature vendors the company uses. Everyone sees it; administrators and compliance change it. */
export function VendorPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale];
  const { d, load } = useVendors(call);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  if (!d) return null;
  const set = (v: VendorRow, enabled: boolean, note: string) => { setErr(''); void call('PUT', `/v1/compliance/signing-vendors/${v.id}`, { enabled, note }).then(load, (e) => setErr((e as Error).message)); };
  return (
    <section class="rec-form" aria-label={x.h} style={{ marginTop: '16px' }}>
      <h3>{x.h}</h3><p class="muted">{x.help}</p>
      {!d.canManage && <p class="muted">{x.readonly}</p>}
      {err && <p class="err" role="alert">{err}</p>}
      {d.vendors.map((v) => {
        const note = notes[v.id] ?? v.note2 ?? '';
        return (
          <div class="ev" key={v.id}>
            <label><input type="checkbox" disabled={!d.canManage} checked={v.enabled && d.restricted} onChange={(e) => set(v, (e.target as HTMLInputElement).checked, note)} /> <strong>{v.name}</strong></label>{' '}
            <small class="muted">{v.connected ? x.connected : x.manual}</small>
            <div><small>{v.note[locale]}</small></div>
            {v.id === 'adobe_sign' && <AdobeConnect call={call} locale={locale} onChange={() => void load()} />}
            {d.canManage && v.enabled && d.restricted && <div><input aria-label={x.note} placeholder={x.note} maxLength={200} value={note} onInput={(e) => setNotes({ ...notes, [v.id]: (e.target as HTMLInputElement).value })} />{' '}
              <button class="btn quiet" disabled={note === (v.note2 ?? '')} onClick={() => set(v, true, note)}>{x.save}</button></div>}
          </div>
        );
      })}
    </section>
  );
}
