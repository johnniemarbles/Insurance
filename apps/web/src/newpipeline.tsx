import { useEffect, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import { TEMPLATES } from './templates.ts';
import type { Strings } from './i18n.ts';
import type { Locale, Pipeline } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Place { nodeId: string; name: string; type: string; mode: 'manager' | 'partner'; used: number }
interface Tpl { code: string; version: number; name: Record<Locale, string>; about: Record<Locale, string>; stages: Record<Locale, string>[]; columns: Record<Locale, string>[] }

const K = {
  en: {
    where: 'Where does it belong?', none: 'You cannot create pipelines here. Ask a manager, or ask your company admin to let partners make their own.',
    cap: (used: number, cap: number) => `You have ${used} of ${cap} pipelines allowed for this partner.`,
    tabs: { tpl: 'Templates', copy: 'Copy one', blank: 'Blank' },
    tplHelp: (c: string) => `Ready-made pipelines for ${c}. Using one makes your own copy, so you can change it freely.`,
    copyHelp: 'Copy any pipeline you can see. The stages and columns come across; automations and integrations do not. Your copy is yours to edit.',
    use: 'Use this', copyBtn: 'Copy', canada: 'Canada', us: 'the United States', loading: 'Loading…', stagesL: 'Stages', outdated: (a: number, b: number) => `Started from version ${a}. Version ${b} is available.`, noneToCopy: 'There are no pipelines to copy yet.',
    private: 'It starts private to you and the people above you. You can share it down later.',
  },
  'fr-CA': {
    where: 'À quel endroit appartient-il?', none: 'Vous ne pouvez pas créer de pipeline ici. Demandez à un gestionnaire, ou à l’administrateur de votre entreprise d’autoriser les partenaires à créer les leurs.',
    cap: (used: number, cap: number) => `Vous avez ${used} pipeline(s) sur ${cap} permis pour ce partenaire.`,
    tabs: { tpl: 'Modèles', copy: 'Copier', blank: 'Vide' },
    tplHelp: (c: string) => `Des pipelines prêts à l’emploi pour ${c}. En utiliser un crée votre propre copie, que vous pouvez modifier librement.`,
    copyHelp: 'Copiez n’importe quel pipeline que vous voyez. Les étapes et les colonnes sont copiées; pas les automatisations ni les intégrations. La copie est à vous.',
    use: 'Utiliser', copyBtn: 'Copier', canada: 'le Canada', us: 'les États-Unis', loading: 'Chargement…', stagesL: 'Étapes', outdated: (a: number, b: number) => `Créé à partir de la version ${a}. La version ${b} est disponible.`, noneToCopy: 'Aucun pipeline à copier pour le moment.',
    private: 'Il est d’abord privé : vous et les personnes au-dessus de vous le voyez. Vous pourrez le partager plus tard.',
  },
} as const;

/** Start a pipeline: from a country template, by copying one you can see, or blank. Partners and managers both use this. */
export function NewPipeline({ call, t, locale, pipelines, onClose, onCreated }: { call: Call; t: Strings; locale: Locale; pipelines: Pipeline[]; onClose: () => void; onCreated: (id: string) => void }) {
  const x = K[locale];
  const dlg = useDialogFocus<HTMLElement>();
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [cap, setCap] = useState(0);
  const [place, setPlace] = useState('');
  const [tpls, setTpls] = useState<Tpl[] | null>(null);
  const [country, setCountry] = useState('CA');
  const [tab, setTab] = useState<'tpl' | 'copy' | 'blank'>('tpl');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    call('GET', '/v1/pipelines/places').then((r) => { setPlaces(r.places as Place[]); setCap(r.cap as number); setPlace((r.places as Place[])[0]?.nodeId ?? ''); }, (e) => { setPlaces([]); setErr((e as Error).message); });
    call('GET', '/v1/pipeline-templates').then((r) => { setTpls(r.templates as Tpl[]); setCountry(r.country as string); }, () => setTpls([]));
  }, [call]);

  const chosen = places?.find((p) => p.nodeId === place);
  const shared = chosen?.mode === 'manager'; // a manager's pipelines are shared down as before; a partner's start private
  const go = async (path: string, body: object) => {
    setBusy(true); setErr('');
    try { const r = await call('POST', path, { ownerNodeId: place, sharedDown: shared, ...body }); onCreated(r.id); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={t.newPipeline}>
      <h2>{t.newPipeline}</h2>
      {err && <div class="err" role="alert">{err}</div>}
      {places === null ? <p class="muted">{x.loading}</p> : places.length === 0 ? <p class="muted">{x.none}</p> : (
        <>
          {places.length > 1 && (
            <label>{x.where}
              <select value={place} onChange={(e) => setPlace((e.target as HTMLSelectElement).value)}>
                {places.map((p) => <option value={p.nodeId}>{p.name}</option>)}
              </select>
            </label>
          )}
          {chosen?.mode === 'partner' && <p class="muted">{x.cap(chosen.used, cap)} {x.private}</p>}
          <div class="seg" role="group" aria-label={t.newPipeline} style={{ margin: '10px 0' }}>
            {(['tpl', 'copy', 'blank'] as const).map((k) => <button aria-pressed={tab === k} onClick={() => setTab(k)}>{x.tabs[k]}</button>)}
          </div>
          {tab === 'tpl' && (
            <>
              <p class="muted">{x.tplHelp(country === 'US' ? x.us : x.canada)}</p>
              {tpls === null && <p class="muted">{x.loading}</p>}
              {(tpls ?? []).map((tp) => (
                <button class="tpl" disabled={busy} key={tp.code} onClick={() => void go(`/v1/pipeline-templates/${tp.code}/use`, { locale })}>
                  <b>{tp.name[locale]}</b>
                  <span>{tp.about[locale]}</span>
                  <small>{tp.stages.map((s) => s[locale]).join(' → ')}</small>
                </button>
              ))}
              {tpls !== null && tpls.length === 0 && TEMPLATES.map((tp) => (
                <button class="tpl" disabled={busy} key={tp.id} onClick={() => void go('/v1/pipelines', { name: tp.name[locale], stages: tp.stages, fields: tp.fields.map((f) => ({ key: f.key, labels: f.labels, type: f.type, ...(f.options ? { options: f.options } : {}) })) })}>
                  <b>{tp.name[locale]}</b><span>{tp.about[locale]}</span><small>{tp.stages.map((s) => s.name).join(' → ')}</small>
                </button>
              ))}
            </>
          )}
          {tab === 'copy' && (
            <>
              <p class="muted">{x.copyHelp}</p>
              {pipelines.length === 0 && <p class="muted">{x.noneToCopy}</p>}
              {pipelines.map((p) => (
                <button class="tpl" disabled={busy} key={p.id} onClick={() => void go(`/v1/pipelines/${p.id}/clone`, {})}>
                  <b>{p.name} <small>· {x.copyBtn}</small></b>
                  <small>{p.stages.map((s) => s.name).join(' → ')}</small>
                </button>
              ))}
            </>
          )}
          {tab === 'blank' && (
            <form class="erow" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void go('/v1/pipelines', { name: name.trim() }); }}>
              <input placeholder={t.name} aria-label={t.name} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
              <button class="btn" disabled={busy || !name.trim()}>{t.create}</button>
            </form>
          )}
        </>
      )}
      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.cancel}</button></div>
    </aside>
  );
}

export const outdatedText = (locale: Locale, have: number, latest: number) => K[locale].outdated(have, latest);
