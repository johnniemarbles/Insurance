// Retention periods by document kind. A company setting: set in Settings, read by Compliance (which shows what is due and held).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<any>;
interface Policy { kind: string; label: Record<Locale, string>; years: number; min: number; max: number }

const X = {
  en: { h: 'Retention periods', help: 'How long each kind of record is kept after its file closes. Nothing is deleted automatically.', years: 'years', save: 'Save', saved: 'Saved.', failed: 'Could not save' },
  'fr-CA': { h: 'Durées de conservation', help: 'Durée de conservation de chaque type de document après la fermeture du dossier. Rien n’est supprimé automatiquement.', years: 'ans', save: 'Enregistrer', saved: 'Enregistré.', failed: 'Enregistrement impossible' },
} as const;

/** Retention years by kind. Admins and the compliance role can change them. */
export function RetentionPolicies({ call, locale }: { call: Call; locale: Locale }) {
  const x = X[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [yrs, setYrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const load = () => call('GET', '/v1/compliance/retention').then((d) => setPolicies(d.policies as Policy[]), () => setPolicies(null));
  useEffect(() => { void load(); }, [call]);
  if (!policies) return null;
  const save = async (p: Policy) => {
    setMsg('');
    try {
      await call('PUT', `/v1/compliance/retention/${p.kind}`, { years: Number(yrs[p.kind]) });
      setYrs((m) => { const n = { ...m }; delete n[p.kind]; return n; });
      setMsg(x.saved); await load();
    } catch (e) { setMsg(`${x.failed}: ${(e as Error).message}`); }
  };
  return (
    <section class="rec-form" aria-label={x.h}>
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {msg && <p class="muted" role="status">{msg}</p>}
      {policies.map((p) => {
        const v = yrs[p.kind] ?? String(p.years);
        return (
          <div class="erow" key={p.kind}>
            <span>{p.label[locale]}</span>
            <span class="spacer" />
            <input type="number" min={p.min} max={p.max} style={{ width: '80px' }} aria-label={`${p.label[locale]} (${x.years})`} value={v} onInput={(e) => setYrs({ ...yrs, [p.kind]: (e.target as HTMLInputElement).value })} />
            <span class="muted">{x.years}</span>
            <button class="btn quiet" disabled={v === String(p.years)} onClick={() => void save(p)}>{x.save}</button>
          </div>
        );
      })}
    </section>
  );
}
