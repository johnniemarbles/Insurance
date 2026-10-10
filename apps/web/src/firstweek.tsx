import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Step { id: string; group: string; done: boolean; hint?: string }
interface FW { applicable: boolean; node?: { id: string; name: string }; steps: Step[]; done: number; total: number; percent: number; complete: boolean; next: string | null; day: number; daysLeft: number; late: boolean; guideUrl: string }

const L = {
  en: {
    title: 'Your first week', day: (d: number, left: number) => `Day ${d} of 7 · ${left} day${left === 1 ? '' : 's'} left`, late: 'Past the first week: finish the open steps, or ask head office for help.', done: (d: number, t: number) => `${d} of ${t} done`,
    complete: 'Everything is done. You are ready to sell.', guide: 'Read the partner guide', open: 'Open', hide: 'Show all steps', next: 'Next',
    groups: { file: 'Compliance file', team: 'Carriers and team', learning: 'Learning', selling: 'Selling' } as Record<string, string>,
    steps: { profile: 'Fill in the business profile', licence: 'Add a licence', eo: 'Add E&O insurance', attestation: 'Confirm the file is true', agreement: 'Sign the partner agreement', submitted: 'Send the file for review', approved: 'File approved by head office',
      carriers: 'Get appointed with an insurer', team: 'Invite your team', ce: 'Set up continuing education', training: 'Finish the assigned training', client: 'Add your first client' } as Record<string, string>,
    hints: { limit_low: 'The E&O limit is below the minimum', requested: 'Requested, waiting for head office', none_assigned: 'Nothing assigned yet', rejected: 'Sent back: read the note and fix it', waiting: 'Waiting for head office' } as Record<string, string>,
  },
  'fr-CA': {
    title: 'Votre première semaine', day: (d: number, left: number) => `Jour ${d} sur 7 · ${left} jour${left === 1 ? '' : 's'} restant${left === 1 ? '' : 's'}`, late: 'La première semaine est passée : terminez les étapes ouvertes ou demandez de l’aide au siège social.', done: (d: number, t: number) => `${d} sur ${t} faites`,
    complete: 'Tout est fait. Vous êtes prêt à vendre.', guide: 'Lire le guide du partenaire', open: 'Ouvrir', hide: 'Voir toutes les étapes', next: 'Prochaine',
    groups: { file: 'Dossier de conformité', team: 'Assureurs et équipe', learning: 'Apprentissage', selling: 'Vente' } as Record<string, string>,
    steps: { profile: 'Remplir le profil de l’entreprise', licence: 'Ajouter un permis', eo: 'Ajouter l’assurance E&O', attestation: 'Confirmer l’exactitude du dossier', agreement: 'Signer l’entente de partenariat', submitted: 'Envoyer le dossier pour examen', approved: 'Dossier approuvé par le siège social',
      carriers: 'Être nommé auprès d’un assureur', team: 'Inviter votre équipe', ce: 'Configurer la formation continue', training: 'Terminer la formation assignée', client: 'Ajouter votre premier client' } as Record<string, string>,
    hints: { limit_low: 'La limite E&O est sous le minimum', requested: 'Demandée, en attente du siège social', none_assigned: 'Rien d’assigné pour l’instant', rejected: 'Retourné : lisez la note et corrigez', waiting: 'En attente du siège social' } as Record<string, string>,
  },
};
const WHERE: Record<string, string> = { profile: 'compliance', licence: 'compliance', eo: 'compliance', attestation: 'compliance', agreement: 'compliance', submitted: 'compliance', approved: 'compliance', carriers: 'compliance', team: 'settings', ce: 'training', training: 'training', client: 'pipelines' };

function Bar({ pct }: { pct: number }) { return <span class="cbar" role="img" aria-label={`${pct}%`}><i style={{ width: `${pct}%` }} /></span>; }

function Steps({ w, locale, go, openFile }: { w: FW; locale: Locale; go?: (page: string, id?: string) => void; openFile?: () => void }) {
  const x = L[locale];
  const groups = ['file', 'team', 'learning', 'selling'].filter((g) => w.steps.some((s) => s.group === g));
  return (
    <div>
      {groups.map((g) => (
        <div key={g}>
          <h4 style={{ margin: '12px 0 4px' }}>{x.groups[g]}</h4>
          <ol class="csteps">
            {w.steps.filter((s) => s.group === g).map((s) => (
              <li class={s.done ? 'done' : ''} key={s.id}>
                <span aria-hidden="true">{s.done ? '✓' : '○'}</span> {x.steps[s.id]}
                {!s.done && s.hint ? <small class="muted"> · {x.hints[s.hint]}</small> : null}
                {!s.done && s.id === w.next ? <small class="muted"> · {x.next}</small> : null}
                {!s.done && go && <> <button class="link" onClick={() => (WHERE[s.id] === 'compliance' && openFile ? openFile() : go(WHERE[s.id]!))}>{x.open}</button></>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Head({ w, locale }: { w: FW; locale: Locale }) {
  const x = L[locale];
  return (
    <div class="erow" style={{ margin: 0, alignItems: 'center' }}>
      <b>{x.title}</b><Bar pct={w.percent} /><span class="muted">{x.done(w.done, w.total)}</span>
      <span class="spacer" style={{ flex: 1 }} />
      <a class="btn quiet" href={w.guideUrl} target="_blank" rel="noopener noreferrer">{x.guide}</a>
    </div>
  );
}

/** Home: shown to people who belong to a partner company during its first month, until everything is done. */
export function FirstWeekCard({ call, locale, go }: { call: Call; locale: Locale; go: (page: string, id?: string) => void }) {
  const x = L[locale];
  const [w, setW] = useState<FW | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { call('GET', '/v1/first-week').then((r) => setW(r), () => undefined); }, [call]);
  if (!w || !w.applicable || w.complete || w.day > 30) return null;
  const open = w.steps.filter((s) => !s.done);
  const shown = all ? w : { ...w, steps: open.slice(0, 3) };
  return (
    <section class="hcard" aria-label={x.title}>
      <Head w={w} locale={locale} />
      <p class="muted" style={{ margin: '6px 0' }}>{w.late ? x.late : x.day(w.day, w.daysLeft)}</p>
      <Steps w={shown} locale={locale} go={go} />
      {!all && open.length > 3 && <button class="link" onClick={() => setAll(true)}>{x.hide}</button>}
    </section>
  );
}

/** On a partner's file in Compliance: the full list, for the partner and for head office reading it. */
export function FirstWeekPanel({ call, locale, nodeId, ho, go }: { call: Call; locale: Locale; nodeId: string; ho: boolean; go?: (page: string, id?: string) => void }) {
  const x = L[locale];
  const [w, setW] = useState<FW | null>(null);
  useEffect(() => { call('GET', `/v1/first-week/${nodeId}`).then((r) => setW(r), () => undefined); }, [call, nodeId]);
  if (!w || !w.applicable) return null;
  return (
    <section class="hcard" aria-label={x.title}>
      <Head w={w} locale={locale} />
      <p class="muted" style={{ margin: '6px 0' }}>{w.complete ? x.complete : w.late ? x.late : x.day(w.day, w.daysLeft)}</p>
      <Steps w={w} locale={locale} go={ho ? undefined : go} />
    </section>
  );
}
