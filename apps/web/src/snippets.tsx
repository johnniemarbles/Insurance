import { useEffect, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Snip { id: string; name: string; body: string; locale: Locale; shared: boolean; mine: boolean }

const X = {
  'en': { title: 'Snippets', help: 'Saved replies you can drop into any email from the Snippets button in Gmail’s compose window. Fields like {{firstName|there}}, {{myName}} and {{company}} are filled in for the person you are writing to.', none: 'No snippets yet.', name: 'Name', body: 'Text', add: 'Add snippet', save: 'Save', edit: 'Edit', del: 'Delete', share: 'Share with my team', sharedBy: 'shared', confirm: 'Delete this snippet?', close: 'Close', cancel: 'Cancel' },
  'fr-CA': { title: 'Extraits', help: 'Réponses enregistrées à insérer dans un courriel avec le bouton Extraits de la fenêtre de rédaction Gmail. Les champs comme {{firstName|}}, {{myName}} et {{company}} sont remplis pour la personne à qui vous écrivez.', none: 'Aucun extrait.', name: 'Nom', body: 'Texte', add: 'Ajouter l’extrait', save: 'Enregistrer', edit: 'Modifier', del: 'Supprimer', share: 'Partager avec mon équipe', sharedBy: 'partagé', confirm: 'Supprimer cet extrait?', close: 'Fermer', cancel: 'Annuler' },
};

/** Saved replies, private or shared down to a manager's team. */
export function SnippetsPanel({ call, locale, onClose }: { call: Call; locale: Locale; onClose: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const x = X[locale];
  const [list, setList] = useState<Snip[]>([]);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // snippet id, or '' for a new one
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(false);
  const load = () => call('GET', '/v1/snippets').then((r) => setList(r.snippets), (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };
  const open = (s?: Snip) => { setEditing(s?.id ?? ''); setName(s?.name ?? ''); setBody(s?.body ?? ''); setShared(s?.shared ?? false); };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={x.title}>
      <h2>{x.title}</h2>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {list.length === 0 && editing === null && <p class="muted">{x.none}</p>}
      {editing === null && list.map((s) => (
        <div class="erow" key={s.id}>
          <span><b>{s.name}</b> {s.shared && <small class="muted">· {x.sharedBy}</small>}<br /><small class="muted">{s.body.slice(0, 90)}</small></span><span class="spacer" />
          {s.mine && <button class="btn quiet" onClick={() => open(s)}>{x.edit}</button>}
          {s.mine && <button class="ib danger" aria-label={x.del} onClick={() => { if (confirm(x.confirm)) void act(() => call('DELETE', `/v1/snippets/${s.id}`)); }}>✕</button>}
        </div>
      ))}
      {editing === null ? <div class="actions"><button class="btn" onClick={() => open()}>+ {x.add}</button></div> : (
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { const b = { name: name.trim(), body, shared, locale }; if (editing) await call('PATCH', `/v1/snippets/${editing}`, b); else await call('POST', '/v1/snippets', b); setEditing(null); }); }}>
          <label for="sn">{x.name}</label><input id="sn" value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <label for="sb">{x.body}</label><textarea id="sb" rows={9} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
          <label><input type="checkbox" checked={shared} onChange={(e) => setShared((e.target as HTMLInputElement).checked)} /> {x.share}</label>
          <div class="actions"><button class="btn" disabled={!name.trim() || !body.trim()}>{x.save}</button><button type="button" class="btn quiet" onClick={() => setEditing(null)}>{x.cancel}</button></div>
        </form>
      )}
      <div class="actions"><button class="btn quiet" onClick={onClose}>{x.close}</button></div>
    </aside>
  );
}
