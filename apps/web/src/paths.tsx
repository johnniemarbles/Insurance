import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface PCourse { id: string; title: string; status: string; enrollStatus: string | null; progressPct: number | null }
interface Path { id: string; name: string; description: string | null; canEdit: boolean; courses: PCourse[]; done: number }

/** Learning paths: ordered sets of courses. Learners start and follow them; authors create and assign them. */
export function Paths({ call, locale, canAuthor, onOpen }: { call: Call; locale: Locale; canAuthor: boolean; onOpen: (courseId: string) => void }) {
  const fr = locale === 'fr-CA';
  const [paths, setPaths] = useState<Path[] | null>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [making, setMaking] = useState(false);
  const [name, setName] = useState(''); const [desc, setDesc] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const [avail, setAvail] = useState<{ id: string; title: string; status: string }[]>([]);
  const [nodes, setNodes] = useState<{ id: string; name: string }[]>([]);
  const [asg, setAsg] = useState<{ id: string; node: string; days: string } | null>(null);
  const load = useCallback(() => { call('GET', `/v1/paths?locale=${locale}`).then((r) => setPaths(r.paths), (e) => setErr((e as Error).message)); }, [call, locale]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => { setErr(''); setNote(''); try { await fn(); if (ok) setNote(ok); load(); } catch (e) { setErr((e as Error).message); } };
  const openMake = () => { setMaking(true); void call('GET', `/v1/courses?locale=${locale}`).then((r) => setAvail(r.courses.filter((c: any) => c.status === 'published')), () => undefined); };
  const openAsg = (id: string) => { setAsg({ id, node: '', days: '' }); if (!nodes.length) void call('GET', '/v1/org/nodes').then((r) => setNodes(r.nodes), () => undefined); };
  if (!paths) return err ? <div class="err">{err}</div> : null;
  if (paths.length === 0 && !canAuthor) return null;
  return (
    <section class="pa">
      <h3 class="ml-h">{fr ? 'Parcours d’apprentissage' : 'Learning paths'} {paths.length > 0 && <small>{paths.length}</small>}</h3>
      {err && <div class="err" role="alert">{err}</div>}
      {note && <p class="ok" role="status">{note}</p>}
      {paths.map((p) => (
        <div class="pa-c" key={p.id}>
          <div class="pa-top"><b>{p.name}</b><span class="pa-n">{p.done} / {p.courses.length} {fr ? 'cours terminés' : 'courses done'}</span></div>
          {p.description && <p class="muted pa-d">{p.description}</p>}
          <ol class="pa-l">{p.courses.map((c, i) => (
            <li class={c.enrollStatus === 'completed' ? 'done' : ''}><button class="link" onClick={() => onOpen(c.id)}><span class="pa-i">{c.enrollStatus === 'completed' ? '✓' : i + 1}</span>{c.title}{c.status !== 'published' && <em> ({fr ? 'brouillon' : 'draft'})</em>}</button>{c.enrollStatus && c.enrollStatus !== 'completed' && <small>{Math.round(c.progressPct ?? 0)}%</small>}</li>
          ))}</ol>
          <div class="pa-a">
            <button class="btn" onClick={() => void act(async () => { const r = await call('POST', `/v1/paths/${p.id}/start`); if (r.firstCourseId && r.enrolled) onOpen(r.firstCourseId); }, undefined)}>{p.done > 0 ? (fr ? 'Continuer le parcours' : 'Continue path') : (fr ? 'Commencer le parcours' : 'Start path')}</button>
            {p.canEdit && <button class="btn quiet" onClick={() => openAsg(p.id)}>{fr ? 'Assigner…' : 'Assign…'}</button>}
            {p.canEdit && <button class="btn quiet danger" onClick={() => { if (confirm(fr ? 'Supprimer ce parcours ? Les cours restent.' : 'Delete this path? The courses stay.')) void act(() => call('DELETE', `/v1/paths/${p.id}`)); }}>{fr ? 'Supprimer' : 'Delete'}</button>}
          </div>
          {asg?.id === p.id && (
            <form class="erow" onSubmit={(e) => { e.preventDefault(); if (!asg.node) return; void act(async () => { const r = await call('POST', `/v1/paths/${p.id}/assignments`, { nodeId: asg.node, ...(asg.days ? { dueInDays: Number(asg.days) } : {}) }); setAsg(null); setNote(fr ? `${r.enrolled} inscriptions dans ${r.courses} cours.` : `${r.enrolled} enrolments across ${r.courses} courses.`); }); }}>
              <select aria-label={fr ? 'Assigner à' : 'Assign to'} value={asg.node} onChange={(e) => setAsg({ ...asg, node: (e.target as HTMLSelectElement).value })}><option value="">{fr ? 'Assigner à…' : 'Assign to…'}</option>{nodes.map((n) => <option value={n.id}>{n.name}</option>)}</select>
              <input type="number" min={1} max={730} placeholder={fr ? 'échéance (jours)' : 'due in days'} aria-label={fr ? 'Échéance en jours' : 'Due in days'} value={asg.days} onInput={(e) => setAsg({ ...asg, days: (e.target as HTMLInputElement).value })} style={{ flex: '0 0 150px' }} />
              <button class="btn" disabled={!asg.node}>{fr ? 'Assigner' : 'Assign'}</button>
              <button class="btn quiet" type="button" onClick={() => setAsg(null)}>{fr ? 'Annuler' : 'Cancel'}</button>
            </form>
          )}
        </div>
      ))}
      {canAuthor && !making && <button class="btn quiet" onClick={openMake}>+ {fr ? 'Nouveau parcours' : 'New learning path'}</button>}
      {making && (
        <form class="pa-c" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || pick.length === 0) return; void act(async () => { await call('POST', '/v1/paths', { name: name.trim(), ...(desc.trim() ? { description: desc.trim() } : {}), courseIds: pick }); setMaking(false); setName(''); setDesc(''); setPick([]); }); }}>
          <label>{fr ? 'Nom du parcours' : 'Path name'}<input class="wide" value={name} maxLength={200} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder={fr ? 'p. ex. Nouveau courtier' : 'e.g. New broker'} /></label>
          <label>{fr ? 'Description (facultatif)' : 'Description (optional)'}<input class="wide" value={desc} maxLength={2000} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} /></label>
          <p class="muted">{fr ? 'Choisissez les cours publiés, dans l’ordre où ils doivent être suivis :' : 'Pick the published courses, in the order they should be taken:'}</p>
          {avail.length === 0 && <p class="muted">{fr ? 'Aucun cours publié.' : 'No published courses yet.'}</p>}
          {avail.map((c) => { const at = pick.indexOf(c.id); return <label class="opt"><input type="checkbox" checked={at >= 0} onChange={() => setPick(at >= 0 ? pick.filter((x) => x !== c.id) : [...pick, c.id])} /> {at >= 0 && <b class="pa-i">{at + 1}</b>} {c.title}</label>; })}
          <div class="actions"><button class="btn" disabled={!name.trim() || pick.length === 0}>{fr ? 'Créer le parcours' : 'Create path'}</button><button class="btn quiet" type="button" onClick={() => setMaking(false)}>{fr ? 'Annuler' : 'Cancel'}</button></div>
        </form>
      )}
    </section>
  );
}
