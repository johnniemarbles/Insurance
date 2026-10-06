import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import { AiBox } from './ai.tsx';
import type { Strings } from './i18n.ts';
import type { Box, FieldDef, Locale, Pipeline, Stage } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Person { id: string; displayName: string | null; email: string }
interface Item { kind: 'note' | 'call' | 'task' | 'stage' | 'created'; outcome?: string | null; minutes?: number | null; id: string; at: string; by: string | null; text: string | null; dueAt: string | null; doneAt: string | null; fromStage: string | null; toStage: string | null; assignee: string | null; fresh?: boolean }

const R = {
  'en': {
    details: 'Details', activity: 'Activity', save: 'Save', saving: 'Saving…', cancel: 'Cancel', close: 'Close', create: 'Create', creating: 'Creating…', saved: 'Saved', unsaved: 'You have changes that are not saved', discard: 'Discard your changes?',
    name: 'Name', stage: 'Stage', owner: 'Owner', value: 'Value', closeDate: 'Close date', deal: 'Deal', fields: 'Fields', contacts: 'Contacts', noContacts: 'No contacts linked yet.', location: 'Branch', chooseLocation: 'Choose a branch',
    call: 'Call', callPh: 'What was discussed?', logCall: 'Log call', callAdded: 'Call logged', minutes: 'Minutes', outcome: 'Outcome', outcomes: { connected: 'Spoke with them', voicemail: 'Left a voicemail', no_answer: 'No answer', wrong_number: 'Wrong number' } as Record<string, string>, copyLink: 'Copy link', linkCopied: 'Link copied',
    note: 'Note', task: 'Task', notePh: 'Write a note for the team…', addNote: 'Add note', taskPh: 'What needs doing?', due: 'Due', assignee: 'Assigned to', addTask: 'Add task', noDate: 'No date',
    noteAdded: 'Note added', taskAdded: 'Task added', empty: 'Nothing yet. Add the first note or task above.', readOnly: 'View only: this record belongs to another branch.', moved: (a: string | null, b: string | null) => `Moved ${a ? `from ${a} ` : ''}to ${b ?? '—'}`, createdIn: (s: string | null) => `Created in ${s ?? '—'}`,
    filters: { all: 'All', call: 'Calls', note: 'Notes', task: 'Tasks', stage: 'Moves' } as Record<string, string>, newRecord: 'New record', pickContact: 'Link a contact (optional)', noneContact: 'No contact', yes: 'Yes', required: 'required', you: 'You',
    overdue: 'Overdue', moveFailed: 'Could not move the record',
  },
  'fr-CA': {
    details: 'Détails', activity: 'Activité', save: 'Enregistrer', saving: 'Enregistrement…', cancel: 'Annuler', close: 'Fermer', create: 'Créer', creating: 'Création…', saved: 'Enregistré', unsaved: 'Vous avez des changements non enregistrés', discard: 'Abandonner vos changements?',
    name: 'Nom', stage: 'Étape', owner: 'Responsable', value: 'Valeur', closeDate: 'Date de clôture', deal: 'Dossier', fields: 'Champs', contacts: 'Contacts', noContacts: 'Aucun contact lié.', location: 'Succursale', chooseLocation: 'Choisir une succursale',
    call: 'Appel', callPh: 'De quoi a-t-on discuté?', logCall: 'Consigner l’appel', callAdded: 'Appel consigné', minutes: 'Minutes', outcome: 'Résultat', outcomes: { connected: 'Conversation', voicemail: 'Message laissé', no_answer: 'Sans réponse', wrong_number: 'Mauvais numéro' } as Record<string, string>, copyLink: 'Copier le lien', linkCopied: 'Lien copié',
    note: 'Note', task: 'Tâche', notePh: 'Écrire une note pour l’équipe…', addNote: 'Ajouter la note', taskPh: 'Que faut-il faire?', due: 'Échéance', assignee: 'Assignée à', addTask: 'Ajouter la tâche', noDate: 'Sans date',
    noteAdded: 'Note ajoutée', taskAdded: 'Tâche ajoutée', empty: 'Rien pour l’instant. Ajoutez la première note ou tâche ci-dessus.', readOnly: 'Lecture seule : ce dossier appartient à une autre succursale.', moved: (a: string | null, b: string | null) => `Déplacé ${a ? `de ${a} ` : ''}à ${b ?? '—'}`, createdIn: (s: string | null) => `Créé à ${s ?? '—'}`,
    filters: { all: 'Tout', call: 'Appels', note: 'Notes', task: 'Tâches', stage: 'Déplacements' } as Record<string, string>, newRecord: 'Nouveau dossier', pickContact: 'Lier un contact (facultatif)', noneContact: 'Aucun contact', yes: 'Oui', required: 'requis', you: 'Vous',
    overdue: 'En retard', moveFailed: 'Impossible de déplacer le dossier',
  },
};

const lab = (f: FieldDef, locale: Locale) => f.labels[locale] ?? f.labels.en ?? f.key;
const when = (iso: string, locale: Locale) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

/** One input for one custom field. The same control is used on the record and on the new-record form. */
function FieldInput({ f, value, onChange, locale, disabled }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; locale: Locale; disabled?: boolean }) {
  const id = `f-${f.key}`;
  if (f.type === 'checkbox') return <label class="chk2"><input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} /> {lab(f, locale)}</label>;
  return (
    <label class="fld" for={id}>{lab(f, locale)}{f.required ? ' *' : ''}
      {f.type === 'dropdown' ? (
        <select id={id} disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)}>
          <option value="">—</option>{(f.options ?? []).map((o) => <option value={o}>{o}</option>)}
        </select>
      ) : (
        <input id={id} disabled={disabled} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step={f.type === 'number' ? 'any' : undefined} value={value == null ? '' : String(value)}
          onInput={(e) => { const v = (e.target as HTMLInputElement).value; onChange(v === '' ? null : f.type === 'number' ? Number(v) : v); }} />
      )}
    </label>
  );
}

const DX = {
  'en': { tab: 'Files', h: 'Documents', none: 'No documents yet.', add: 'Add a document', help: 'PDF, images, Word, Excel, PowerPoint, text or CSV, up to 8 MB. Stored in PII only, encrypted, and seen by whoever can see this record.', del: 'Remove', confirm: 'Remove this document for everyone?', big: 'That file is over 8 MB.', by: 'added by', open: 'Download', busy: 'Working…', saved: 'Saved', removed: 'Removed', wait: 'Uploading and encrypting…' },
  'fr-CA': { tab: 'Fichiers', h: 'Documents', none: 'Aucun document pour l’instant.', add: 'Ajouter un document', help: 'PDF, images, Word, Excel, PowerPoint, texte ou CSV, jusqu’à 8 Mo. Conservé dans PII seulement, chiffré, et visible par toute personne qui voit ce dossier.', del: 'Retirer', confirm: 'Retirer ce document pour tout le monde?', big: 'Ce fichier dépasse 8 Mo.', by: 'ajouté par', open: 'Télécharger', busy: 'En cours…', saved: 'Enregistré', removed: 'Retiré', wait: 'Téléversement et chiffrement…' },
};
interface Doc { id: string; name: string; mime: string; sizeBytes: number; createdAt: string; uploadedBy: string | null }
const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function Documents({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = DX[locale];
  const [docs, setDocs] = useState<Doc[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');
  const load = () => call('GET', `/v1/boxes/${boxId}/documents`).then((r) => setDocs(r.documents), (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [boxId]);
  const pick = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    setErr(''); setOk('');
    if (f.size > 8 * 1024 * 1024) { setErr(x.big); return; }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_BY_EXT[ext] ?? f.type;
    setBusy(true);
    try {
      const dataBase64 = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('read')); r.readAsDataURL(f); });
      await call('POST', `/v1/boxes/${boxId}/documents`, { name: f.name, mime, dataBase64 });
      await load();
      setOk(`✓ ${x.saved}: ${f.name}`);
    } catch (x2) { setErr((x2 as Error).message); } finally { setBusy(false); }
  };
  const download = async (d: Doc) => {
    setErr('');
    try {
      const r = await call('GET', `/v1/documents/${d.id}`);
      const bin = atob(r.dataBase64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = document.createElement('a'); a.href = url; a.download = r.name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (x2) { setErr((x2 as Error).message); }
  };
  const remove = async (d: Doc) => { if (!confirm(x.confirm)) return; try { await call('DELETE', `/v1/documents/${d.id}`); await load(); setOk(`✓ ${x.removed}: ${d.name}`); } catch (x2) { setErr((x2 as Error).message); } };
  return (
    <div class="rec-form">
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {busy && <div class="muted" role="status">{x.wait}</div>}
      {ok && !busy && <div role="status" style={{ background: '#e6f4ea', color: '#137333', padding: '8px 10px', borderRadius: '8px', margin: '8px 0', fontWeight: 600 }}>{ok}</div>}
      {canEdit && <label class="btn quiet" style={{ display: 'inline-block', cursor: 'pointer' }}>{busy ? x.busy : x.add}<input type="file" hidden disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(e) => void pick(e)} /></label>}
      {docs.length === 0 && <p class="muted">{x.none}</p>}
      {docs.map((d) => (
        <div class="ev" key={d.id}>
          <button class="link" onClick={() => void download(d)} aria-label={`${x.open} ${d.name}`}>{d.name}</button>
          <small>{size(d.sizeBytes)} · {x.by} {d.uploadedBy ?? '—'} · {when(d.createdAt, locale)}</small>
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <button class="btn quiet" onClick={() => void download(d)} aria-label={`${x.open} ${d.name}`}>⬇ {x.open}</button>
            {canEdit && <button class="ib danger" aria-label={`${x.del} ${d.name}`} onClick={() => void remove(d)}>✕</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecordPanel({ box, pipeline, call, t, locale, people, onClose, onChanged }: { box: Box; pipeline: Pipeline; call: Call; t: Strings; locale: Locale; people: Person[]; onClose: () => void; onChanged: () => void }) {
  const x = R[locale];
  const dlg = useDialogFocus<HTMLElement>();
  const [tab, setTab] = useState<'details' | 'activity' | 'files'>('details');
  const [full, setFull] = useState<Box & { canEdit?: boolean; contacts?: { id: string; fullName: string | null; email: string | null }[] }>(box);
  const [draft, setDraft] = useState({ name: box.name, ownerUserId: box.ownerUserId ?? '', valueAmount: box.valueAmount == null ? '' : String(box.valueAmount), closeDate: box.closeDate ?? '', custom: { ...box.custom } as Record<string, unknown> });
  const [stageId, setStageId] = useState(box.stageId);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState('all');
  const [kind, setKind] = useState<'note' | 'call' | 'task'>('note');
  const [outcome, setOutcome] = useState('connected');
  const [minutes, setMinutes] = useState('');
  const [noteText, setNoteText] = useState('');
  const [taskText, setTaskText] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = full.canEdit !== false;
  const flash = useRef<ReturnType<typeof setTimeout>>();
  const say = (m: string) => { setMsg(m); clearTimeout(flash.current); flash.current = setTimeout(() => setMsg(''), 3500); };

  const toDraft = (b: Box) => ({ name: b.name, ownerUserId: b.ownerUserId ?? '', valueAmount: b.valueAmount == null ? '' : String(b.valueAmount), closeDate: b.closeDate ?? '', custom: { ...b.custom } as Record<string, unknown> });
  const loadFull = async (resetDraft: boolean) => {
    const r = await call('GET', `/v1/boxes/${box.id}`);
    setFull(r); setStageId(r.stageId);
    if (resetDraft) setDraft(toDraft(r));
  };
  const loadFeed = async () => { const r = await call('GET', `/v1/boxes/${box.id}/timeline`); setItems(r.items); };
  useEffect(() => { void loadFull(true).catch((e) => setErr((e as Error).message)); void loadFeed().catch(() => undefined); }, [box.id]);

  const dirty = useMemo(() => {
    const base = toDraft(full);
    return draft.name !== base.name || draft.ownerUserId !== base.ownerUserId || draft.valueAmount !== base.valueAmount || draft.closeDate !== base.closeDate
      || pipeline.fields.some((f) => (draft.custom[f.key] ?? null) !== (base.custom[f.key] ?? null));
  }, [draft, full]);

  const requestClose = () => { if (dirty && !confirm(x.discard)) return; onClose(); };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true); setErr('');
    const base = toDraft(full);
    const body: Record<string, unknown> = {};
    if (draft.name.trim() !== base.name) body.name = draft.name.trim();
    if (draft.ownerUserId !== base.ownerUserId && draft.ownerUserId) body.ownerUserId = draft.ownerUserId;
    if (draft.valueAmount !== base.valueAmount) body.valueAmount = draft.valueAmount === '' ? null : Number(draft.valueAmount);
    if (draft.closeDate !== base.closeDate) body.closeDate = draft.closeDate || null;
    const custom: Record<string, unknown> = {};
    for (const f of pipeline.fields) if ((draft.custom[f.key] ?? null) !== (base.custom[f.key] ?? null)) custom[f.key] = draft.custom[f.key] ?? null;
    if (Object.keys(custom).length) body.custom = custom;
    try {
      await call('PATCH', `/v1/boxes/${box.id}`, body);
      await loadFull(true); await loadFeed(); onChanged(); say(x.saved);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };
  const cancel = () => { setDraft(toDraft(full)); setErr(''); };

  const move = async (id: string) => {
    const prev = stageId; setStageId(id); setErr('');
    try { await call('PATCH', `/v1/boxes/${box.id}`, { stageId: id }); await loadFull(false); await loadFeed(); onChanged(); say(x.saved); }
    catch (e) { setStageId(prev); setErr(`${x.moveFailed}: ${(e as Error).message}`); }
  };

  const addNote = async () => {
    const body = noteText.trim(); if (!body || busy) return;
    setBusy(true); setErr('');
    try {
      const isCall = kind === 'call';
      const r = await call('POST', `/v1/boxes/${box.id}/notes`, { body, ...(isCall ? { kind: 'call', outcome, ...(minutes ? { minutes: Math.min(600, Math.max(0, Math.round(Number(minutes)))) } : {}) } : {}) });
      setItems((cur) => [{ kind: isCall ? 'call' : 'note', outcome: isCall ? outcome : null, minutes: isCall && minutes ? Number(minutes) : null, id: r.id, at: new Date().toISOString(), by: x.you, text: body, dueAt: null, doneAt: null, fromStage: null, toStage: null, assignee: null, fresh: true }, ...cur]);
      setNoteText(''); setMinutes(''); say(kind === 'call' ? x.callAdded : x.noteAdded); onChanged(); void loadFeed();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const addTask = async () => {
    const title = taskText.trim(); if (!title || busy) return;
    setBusy(true); setErr('');
    const dueAt = taskDue ? new Date(`${taskDue}T09:00:00`).toISOString() : undefined;
    try {
      const r = await call('POST', `/v1/boxes/${box.id}/tasks`, { title, ...(dueAt ? { dueAt } : {}), ...(assignee ? { assigneeId: assignee } : {}) });
      const who = people.find((p) => p.id === assignee);
      setItems((cur) => [{ kind: 'task', id: r.id, at: new Date().toISOString(), by: null, text: title, dueAt: dueAt ?? null, doneAt: null, fromStage: null, toStage: null, assignee: who ? (who.displayName ?? who.email) : x.you, fresh: true }, ...cur]);
      setTaskText(''); setTaskDue(''); say(x.taskAdded); onChanged(); void loadFeed();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = async (it: Item, done: boolean) => {
    setItems((cur) => cur.map((i) => (i.id === it.id ? { ...i, doneAt: done ? new Date().toISOString() : null } : i)));
    try { await call('PATCH', `/v1/tasks/${it.id}`, { done }); onChanged(); } catch (e) { setErr((e as Error).message); void loadFeed(); }
  };

  const shown = items.filter((i) => filter === 'all' || i.kind === filter || (filter === 'stage' && i.kind === 'created'));
  const counts = { note: items.filter((i) => i.kind === 'note' || i.kind === 'call').length, task: items.filter((i) => i.kind === 'task').length };
  const stage: Stage | undefined = pipeline.stages.find((s) => s.id === stageId);

  return (
    <aside ref={dlg} tabIndex={-1} class="drawer rec" role="dialog" aria-label={full.name} onKeyDown={(e) => { if (e.key === 'Escape') { if (dirty && !confirm(x.discard)) { e.stopPropagation(); } } }}>
      <header class="rec-head">
        <div class="rec-top"><h2>{full.name}</h2><button class="link" title={x.copyLink} onClick={() => { const url = `${location.href.split('#')[0]}#pii/pipelines/${full.pipelineId}::open=${full.id}`; void (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => say(x.linkCopied), () => say(url)); }}>🔗 {x.copyLink}</button><button class="x" aria-label={x.close} onClick={requestClose}>×</button></div>
        {!canEdit && <p class="muted">{x.readOnly}</p>}
        <div class="rec-stage">
          <label for="rec-stg">{x.stage}</label>
          <select id="rec-stg" value={stageId} disabled={!canEdit} onChange={(e) => void move((e.target as HTMLSelectElement).value)}>{pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}</select>
          {msg && <span class="savedchip" role="status">✓ {msg}</span>}
        </div>
        <div class="rec-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'details'} class={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>{x.details}{dirty ? ' •' : ''}</button>
          <button role="tab" aria-selected={tab === 'activity'} class={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>{x.activity}{counts.note + counts.task > 0 ? ` (${counts.note + counts.task})` : ''}</button>
          <button role="tab" aria-selected={tab === 'files'} class={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>{DX[locale].tab}</button>
        </div>
      </header>

      <div class="rec-body">
        {tab === 'details' && (
          <div class="rec-form">
            <h3>{x.deal}</h3>
            <label class="fld" for="r-name">{x.name}<input id="r-name" disabled={!canEdit} value={draft.name} maxLength={200} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} /></label>
            <label class="fld" for="r-owner">{x.owner}
              <select id="r-owner" disabled={!canEdit} value={draft.ownerUserId} onChange={(e) => setDraft({ ...draft, ownerUserId: (e.target as HTMLSelectElement).value })}>
                <option value="">—</option>{people.map((p) => <option value={p.id}>{p.displayName ?? p.email}</option>)}
              </select></label>
            <div class="two">
              <label class="fld" for="r-val">{x.value}<input id="r-val" type="number" min="0" step="0.01" disabled={!canEdit} value={draft.valueAmount} onInput={(e) => setDraft({ ...draft, valueAmount: (e.target as HTMLInputElement).value })} /></label>
              <label class="fld" for="r-close">{x.closeDate}<input id="r-close" type="date" disabled={!canEdit} value={draft.closeDate} onInput={(e) => setDraft({ ...draft, closeDate: (e.target as HTMLInputElement).value })} /></label>
            </div>
            {pipeline.fields.length > 0 && <h3>{x.fields}</h3>}
            <div class="two">
              {pipeline.fields.map((f) => <FieldInput key={f.key} f={f} locale={locale} disabled={!canEdit} value={draft.custom[f.key]} onChange={(v) => setDraft({ ...draft, custom: { ...draft.custom, [f.key]: v } })} />)}
            </div>
            <h3>{x.contacts}</h3>
            {(full.contacts ?? []).length === 0 && <p class="muted">{x.noContacts}</p>}
            {(full.contacts ?? []).map((c) => <div class="ev" key={c.id}>{c.fullName ?? c.email}<small>{c.fullName ? c.email : ''}</small></div>)}
          </div>
        )}

        {tab === 'files' && <Documents boxId={box.id} call={call} locale={locale} canEdit={canEdit} />}

        {tab === 'activity' && (
          <div>
            {canEdit && (
              <div class="composer">
                <div class="seg" role="tablist">
                  <button role="tab" aria-selected={kind === 'note'} class={kind === 'note' ? 'on' : ''} onClick={() => setKind('note')}>{x.note}</button>
                  <button role="tab" aria-selected={kind === 'call'} class={kind === 'call' ? 'on' : ''} onClick={() => setKind('call')}>{x.call}</button>
                  <button role="tab" aria-selected={kind === 'task'} class={kind === 'task' ? 'on' : ''} onClick={() => setKind('task')}>{x.task}</button>
                </div>
                {kind === 'note' || kind === 'call' ? (
                  <>
                    {kind === 'call' && (
                      <div class="two">
                        <label class="fld" for="c-out">{x.outcome}<select id="c-out" value={outcome} onChange={(e) => setOutcome((e.target as HTMLSelectElement).value)}>{Object.entries(x.outcomes).map(([k, v]) => <option value={k}>{v}</option>)}</select></label>
                        <label class="fld" for="c-min">{x.minutes}<input id="c-min" type="number" min="0" max="600" value={minutes} onInput={(e) => setMinutes((e.target as HTMLInputElement).value)} /></label>
                      </div>
                    )}
                    <textarea rows={3} placeholder={kind === 'call' ? x.callPh : x.notePh} aria-label={kind === 'call' ? x.call : x.note} value={noteText} onInput={(e) => setNoteText((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void addNote(); }} />
                    <div class="comp-actions"><button class="btn" disabled={!noteText.trim() || busy} onClick={() => void addNote()}>{kind === 'call' ? x.logCall : x.addNote}</button></div>
                  </>
                ) : (
                  <>
                    <input placeholder={x.taskPh} aria-label={x.task} value={taskText} onInput={(e) => setTaskText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void addTask(); }} />
                    <div class="two">
                      <label class="fld" for="t-due">{x.due}<input id="t-due" type="date" value={taskDue} onInput={(e) => setTaskDue((e.target as HTMLInputElement).value)} /></label>
                      <label class="fld" for="t-who">{x.assignee}
                        <select id="t-who" value={assignee} onChange={(e) => setAssignee((e.target as HTMLSelectElement).value)}><option value="">{x.you}</option>{people.map((p) => <option value={p.id}>{p.displayName ?? p.email}</option>)}</select></label>
                    </div>
                    <div class="comp-actions"><button class="btn" disabled={!taskText.trim() || busy} onClick={() => void addTask()}>{x.addTask}</button></div>
                  </>
                )}
              </div>
            )}
            <div class="feed-filter">{(['all', 'call', 'note', 'task', 'stage'] as const).map((k) => <button class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{x.filters[k]}</button>)}</div>
            {shown.length === 0 && <p class="muted">{x.empty}</p>}
            <ol class="feed">
              {shown.map((i) => (
                <li key={`${i.kind}${i.id}`} class={`fi fi-${i.kind}${i.fresh ? ' fresh' : ''}`}>
                  {i.kind === 'note' && <><div class="fi-text">{i.text}</div><small>{i.by ?? ''} · {when(i.at, locale)}</small></>}
                  {i.kind === 'call' && <><div class="fi-call"><b>{x.call}: {x.outcomes[i.outcome ?? 'connected']}{i.minutes ? ` · ${i.minutes} min` : ''}</b></div><div class="fi-text">{i.text}</div><small>{i.by ?? ''} · {when(i.at, locale)}</small></>}
                  {i.kind === 'task' && (
                    <>
                      <label class="task"><input type="checkbox" disabled={!canEdit} checked={Boolean(i.doneAt)} onChange={(e) => void toggle(i, (e.target as HTMLInputElement).checked)} />
                        <span class={i.doneAt ? 'strike' : ''}>{i.text}</span></label>
                      <small>{i.assignee ?? ''} · {i.dueAt ? <span class={!i.doneAt && new Date(i.dueAt) < new Date() ? 'overdue' : ''}>{x.due} {new Date(i.dueAt).toLocaleDateString(locale)}</span> : x.noDate}</small>
                    </>
                  )}
                  {i.kind === 'stage' && <><div class="fi-sys">{x.moved(i.fromStage, i.toStage)}</div><small>{i.by ?? ''} · {when(i.at, locale)}</small></>}
                  {i.kind === 'created' && <><div class="fi-sys">{x.createdIn(i.toStage)}</div><small>{when(i.at, locale)}</small></>}
                </li>
              ))}
            </ol>
            <AiBox boxId={box.id} call={call} locale={locale} />
          </div>
        )}
      </div>

      <footer class="rec-foot">
        {err && <div class="err" role="alert">{err}</div>}
        {tab === 'details' && canEdit ? (
          <div class="foot-row">
            <span class={`foot-note${dirty ? ' warn' : ''}`}>{dirty ? x.unsaved : stage ? stage.name : ''}</span>
            <span class="spacer" />
            <button class="btn quiet" disabled={!dirty || saving} onClick={cancel}>{x.cancel}</button>
            <button class="btn" disabled={!dirty || saving || !draft.name.trim()} onClick={() => void save()}>{saving ? x.saving : x.save}</button>
          </div>
        ) : (
          <div class="foot-row"><span class="spacer" /><button class="btn quiet" onClick={requestClose}>{x.close}</button></div>
        )}
      </footer>
    </aside>
  );
}

/** A new record with every field, not just the name. The same inputs as the record itself. */
export function NewRecord({ pipeline, call, t, locale, people, onClose, onCreated }: { pipeline: Pipeline; call: Call; t: Strings; locale: Locale; people: Person[]; onClose: () => void; onCreated: (id: string) => void }) {
  const x = R[locale];
  const dlg = useDialogFocus<HTMLElement>();
  const [name, setName] = useState('');
  const [stageId, setStageId] = useState(pipeline.stages[0]?.id ?? '');
  const [owner, setOwner] = useState('');
  const [value, setValue] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]);
  const [loc, setLoc] = useState('');
  const [contacts, setContacts] = useState<{ id: string; fullName: string | null; email: string | null }[]>([]);
  const [contactId, setContactId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    call('GET', '/v1/org/contexts').then((r) => { const l = (r.locations ?? []) as { id: string; name: string }[]; setLocs(l); if (l.length === 1) setLoc(l[0]!.id); }, () => undefined);
    call('GET', '/v1/contacts?limit=100').then((r) => setContacts(r.contacts ?? []), () => undefined);
  }, [call]);
  const dirty = name.trim() !== '' || value !== '' || closeDate !== '' || Object.keys(custom).length > 0;
  const requestClose = () => { if (dirty && !confirm(x.discard)) return; onClose(); };
  const submit = async (e: Event) => {
    e.preventDefault(); if (!name.trim() || busy) return;
    setBusy(true); setErr('');
    const cv: Record<string, unknown> = {};
    for (const f of pipeline.fields) { const v = custom[f.key]; if (v !== undefined && v !== null && v !== '') cv[f.key] = v; }
    try {
      const r = await call('POST', '/v1/boxes', {
        pipelineId: pipeline.id, name: name.trim(), stageId,
        ...(owner ? { ownerUserId: owner } : {}), ...(value ? { valueAmount: Number(value) } : {}), ...(closeDate ? { closeDate } : {}),
        ...(Object.keys(cv).length ? { custom: cv } : {}), ...(loc ? { contextNodeId: loc } : {}), ...(contactId ? { contactIds: [contactId] } : {}),
      });
      onCreated(r.id);
    } catch (x2) { setErr((x2 as Error).message); setBusy(false); }
  };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer rec" role="dialog" aria-label={x.newRecord} onKeyDown={(e) => { if (e.key === 'Escape' && dirty && !confirm(x.discard)) e.stopPropagation(); }}>
      <form onSubmit={submit} class="rec-formwrap">
        <header class="rec-head"><div class="rec-top"><h2>{x.newRecord}</h2><button type="button" class="x" aria-label={x.close} onClick={requestClose}>×</button></div></header>
        <div class="rec-body rec-form">
          <label class="fld" for="n-name">{x.name} *<input id="n-name" required maxLength={200} placeholder={t.newPlaceholder} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autofocus /></label>
          <div class="two">
            <label class="fld" for="n-stage">{x.stage}<select id="n-stage" value={stageId} onChange={(e) => setStageId((e.target as HTMLSelectElement).value)}>{pipeline.stages.map((s) => <option value={s.id}>{s.name}</option>)}</select></label>
            <label class="fld" for="n-owner">{x.owner}<select id="n-owner" value={owner} onChange={(e) => setOwner((e.target as HTMLSelectElement).value)}><option value="">{x.you}</option>{people.map((p) => <option value={p.id}>{p.displayName ?? p.email}</option>)}</select></label>
          </div>
          <div class="two">
            <label class="fld" for="n-val">{x.value}<input id="n-val" type="number" min="0" step="0.01" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} /></label>
            <label class="fld" for="n-close">{x.closeDate}<input id="n-close" type="date" value={closeDate} onInput={(e) => setCloseDate((e.target as HTMLInputElement).value)} /></label>
          </div>
          {locs.length > 1 && <label class="fld" for="n-loc">{x.location} *<select id="n-loc" required value={loc} onChange={(e) => setLoc((e.target as HTMLSelectElement).value)}><option value="">{x.chooseLocation}</option>{locs.map((l) => <option value={l.id}>{l.name}</option>)}</select></label>}
          {pipeline.fields.length > 0 && <h3>{x.fields}</h3>}
          <div class="two">{pipeline.fields.map((f) => <FieldInput key={f.key} f={f} locale={locale} value={custom[f.key]} onChange={(v) => setCustom({ ...custom, [f.key]: v })} />)}</div>
          {contacts.length > 0 && <label class="fld" for="n-contact">{x.pickContact}<select id="n-contact" value={contactId} onChange={(e) => setContactId((e.target as HTMLSelectElement).value)}><option value="">{x.noneContact}</option>{contacts.map((c) => <option value={c.id}>{c.fullName ?? c.email}{c.fullName && c.email ? ` · ${c.email}` : ''}</option>)}</select></label>}
        </div>
        <footer class="rec-foot">
          {err && <div class="err" role="alert">{err}</div>}
          <div class="foot-row"><span class="spacer" /><button type="button" class="btn quiet" onClick={requestClose}>{x.cancel}</button><button class="btn" disabled={busy || !name.trim()}>{busy ? x.creating : x.create}</button></div>
        </footer>
      </form>
    </aside>
  );
}
