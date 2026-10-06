import { useEffect, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface B { id: string; name: string; stage: string; valueAmount: number | null; ownerName: string | null; updatedAt: string; notes: number; tasks: number; threads: number }
interface G { reason: 'name' | 'contact'; label: string; boxes: B[] }

const X = {
  'en': { title: 'Find duplicates', intro: 'Records that look like the same person or policy. Choose the one to keep; the others fold into it with their notes, tasks and emails.', none: 'No duplicates found. Nice and tidy.', name: 'Same name', contact: 'Same contact', keep: 'Keep this one', merge: 'Merge', merging: 'Merging…', close: 'Close', notes: (n: number) => `${n} note${n === 1 ? '' : 's'}`, tasks: (n: number) => `${n} task${n === 1 ? '' : 's'}`, mails: (n: number) => `${n} email thread${n === 1 ? '' : 's'}`, done: (n: number) => `Merged ${n} record${n === 1 ? '' : 's'}.`, sure: 'This cannot be undone. Merge these records?' },
  'fr-CA': { title: 'Trouver les doublons', intro: 'Dossiers qui semblent être la même personne ou la même police. Choisissez celui à garder; les autres s’y fondent avec leurs notes, tâches et courriels.', none: 'Aucun doublon trouvé. Tout est en ordre.', name: 'Même nom', contact: 'Même contact', keep: 'Garder celui-ci', merge: 'Fusionner', merging: 'Fusion…', close: 'Fermer', notes: (n: number) => `${n} note${n === 1 ? '' : 's'}`, tasks: (n: number) => `${n} tâche${n === 1 ? '' : 's'}`, mails: (n: number) => `${n} fil${n === 1 ? '' : 's'} de courriels`, done: (n: number) => `${n} dossier${n === 1 ? '' : 's'} fusionné${n === 1 ? '' : 's'}.`, sure: 'Cette action est irréversible. Fusionner ces dossiers?' },
};

export function DuplicatesDialog({ call, locale, pipelineId, onClose, onChanged }: { call: Call; locale: Locale; pipelineId: string; onClose: () => void; onChanged: () => void }) {
  const x = X[locale];
  const dlg = useDialogFocus<HTMLElement>();
  const [groups, setGroups] = useState<G[] | null>(null);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(-1);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => call('GET', `/v1/pipelines/${pipelineId}/duplicates`).then((r) => { setGroups(r.groups as G[]); setKeep({}); }, (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [pipelineId]);
  const merge = async (i: number, g: G) => {
    const k = keep[i] ?? g.boxes.reduce((a, b) => (b.notes + b.tasks + b.threads > a.notes + a.tasks + a.threads ? b : a)).id;
    if (!confirm(x.sure)) return;
    setBusy(i); setErr('');
    try { const r = await call('POST', `/v1/boxes/${k}/merge`, { ids: g.boxes.filter((b) => b.id !== k).map((b) => b.id) }); setMsg(x.done(r.merged)); onChanged(); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(-1); }
  };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer rec" role="dialog" aria-label={x.title} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <header class="rec-head"><div class="rec-top"><h2>{x.title}</h2><button type="button" class="x" aria-label={x.close} onClick={onClose}>×</button></div><p class="muted">{x.intro}</p></header>
      <div class="rec-body">
        {err && <p class="err" role="alert">{err}</p>}
        {msg && <p class="savedchip" role="status">✓ {msg}</p>}
        {!groups && !err && <div class="msg">…</div>}
        {groups?.length === 0 && <p class="muted">{x.none}</p>}
        {groups?.map((g, i) => {
          const best = g.boxes.reduce((a, b) => (b.notes + b.tasks + b.threads > a.notes + a.tasks + a.threads ? b : a)).id;
          const chosen = keep[i] ?? best;
          return (
            <section class="hcard dupgroup" key={`${g.reason}${g.boxes.map((b) => b.id).join()}`}>
              <h3>{g.reason === 'name' ? x.name : x.contact}: <span class="muted">{g.label}</span></h3>
              {g.boxes.map((b) => (
                <label class={`duprow${chosen === b.id ? ' on' : ''}`} key={b.id}>
                  <input type="radio" name={`keep-${i}`} checked={chosen === b.id} onChange={() => setKeep({ ...keep, [i]: b.id })} />
                  <span><b>{b.name}</b><small class="muted"> · {b.stage}{b.ownerName ? ` · ${b.ownerName}` : ''}</small><br /><small class="muted">{x.notes(b.notes)} · {x.tasks(b.tasks)} · {x.mails(b.threads)}</small></span>
                  {chosen === b.id && <span class="chip">{x.keep}</span>}
                </label>
              ))}
              <div class="comp-actions"><button class="btn" disabled={busy >= 0} onClick={() => void merge(i, g)}>{busy === i ? x.merging : x.merge}</button></div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
