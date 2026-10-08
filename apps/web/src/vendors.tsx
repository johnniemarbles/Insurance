import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface VendorRow { id: string; name: string; fit: string; note: Record<Locale, string>; connected: boolean; enabled: boolean; note2: string | null }
const T = {
  'en': { h: 'E-signature vendors', help: 'Beneficiary designations and replacement disclosures need a certified vendor. Turn on the ones your company uses. If none is turned on, all are allowed.', on: 'On', save: 'Save note', note: 'Your note (for example, account or contact)', manual: 'Recorded by hand today', connected: 'Connected', only: 'Only the turned-on vendors can be recorded.', readonly: 'Only an administrator or the compliance role can change this.' },
  'fr-CA': { h: 'Fournisseurs de signature électronique', help: 'Les désignations de bénéficiaires et avis de remplacement exigent un fournisseur certifié. Activez ceux qu’utilise votre entreprise. Si aucun n’est activé, tous sont permis.', on: 'Activé', save: 'Enregistrer la note', note: 'Votre note (p. ex. compte ou contact)', manual: 'Consigné à la main pour l’instant', connected: 'Connecté', only: 'Seuls les fournisseurs activés peuvent être consignés.', readonly: 'Seuls un administrateur ou le rôle conformité peuvent modifier ceci.' },
};
export const useVendors = (call: Call) => {
  const [d, setD] = useState<{ vendors: VendorRow[]; restricted: boolean; canManage: boolean } | null>(null);
  const load = () => call('GET', '/v1/compliance/signing-vendors').then(setD, () => undefined);
  useEffect(() => { void load(); }, []);
  return { d, load };
};
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
            {d.canManage && v.enabled && d.restricted && <div><input aria-label={x.note} placeholder={x.note} maxLength={200} value={note} onInput={(e) => setNotes({ ...notes, [v.id]: (e.target as HTMLInputElement).value })} />{' '}
              <button class="btn quiet" disabled={note === (v.note2 ?? '')} onClick={() => set(v, true, note)}>{x.save}</button></div>}
          </div>
        );
      })}
    </section>
  );
}
