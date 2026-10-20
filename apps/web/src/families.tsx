// Families (Gate A): the Family card on a client and the Family panel. A family groups separate client records;
// the Head is only the person family letters go to. Shown only when the server has FAMILIES_ENABLED on.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Locale } from './types.ts';
import { FamilyInsurance } from './family-insurance.tsx';
import { FamilyCompliance } from './family-compliance.tsx';

export type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export type Role = 'head' | 'spouse_partner' | 'child' | 'dependent' | 'other';
const ROLES: Role[] = ['head', 'spouse_partner', 'child', 'dependent', 'other'];
const NON_HEAD: Role[] = ['spouse_partner', 'child', 'dependent', 'other'];
type EndReason = 'left' | 'separated' | 'deceased' | 'entered_in_error';

export interface Family { id: string; displayName: string; salutation: string | null; mailingAddress: string | null; mailingPreference: 'head' | 'each_adult'; status: string; version: number; memberCount: number; head: { contactId: string; fullName: string | null } | null; needsHead: boolean }
export interface Member { id: string; contactId: string; fullName: string | null; email: string | null; phone: string | null; role: Role; startedAt: string; endedAt: string | null; endReason: string | null; dateOfBirth: string | null; deceasedOn: string | null; age: number | null }
interface PersonFamily { person: { id: string; fullName: string | null; dateOfBirth: string | null; preferredLanguage: string | null; deceasedOn: string | null; age: number | null }; family: Family | null; membership: { id: string; role: Role } | null; members: Member[]; history: { familyId: string; familyName: string; role: Role; endedAt: string; endReason: string }[] }

const L = {
  en: {
    family: 'Family', familyOfOne: 'Not in a family yet: shown as a family of one.', create: 'Create a family', addToFamily: 'Add to an existing family',
    name: 'Family name', salutation: 'How to address them', address: 'Mailing address', letters: 'Family letters go to', toHead: 'The Head', toAdults: 'Each adult',
    head: 'Head', headHelp: 'The Head is only the person family letters go to. It gives no authority over anyone else.', needsHead: 'No Head: choose one',
    members: 'Members', addMember: 'Add a member', findClient: 'Find a client by name or email', role: 'Role', add: 'Add', confirm: 'Confirm', save: 'Save', cancel: 'Cancel', close: 'Close',
    changeHead: 'Make Head', formerHeadAs: 'The current Head becomes', end: 'Remove from family', endWhy: 'Why?', move: 'Move to another family', moveTo: 'Move to', archive: 'Archive family',
    archiveWarn: 'Everyone leaves the family. People, policies and records are not changed or deleted.', history: 'Past members', showHistory: 'Show past members', hideHistory: 'Hide past members',
    open: 'Open family', age: (n: number) => `${n} yrs`, profile: 'Details', editDetails: 'Edit details', dob: 'Date of birth', lang: 'Preferred language', deceased: 'Date of death',
    conflict: 'Someone else changed this family. It has been reloaded; try again.', noneFound: 'No matching clients.', noFamilies: 'No families yet.', searchFamilies: 'Find a family',
    since: 'since', left: 'left', pastFamilies: 'Past families', loading: 'Loading…', members_n: (n: number) => (n === 1 ? '1 member' : `${n} members`),
    roles: { head: 'Head', spouse_partner: 'Spouse or partner', child: 'Child', dependent: 'Dependent', other: 'Other' } as Record<Role, string>,
    reasons: { left: 'Left the family', separated: 'Separated', deceased: 'Deceased', entered_in_error: 'Added by mistake', moved: 'Moved', family_archived: 'Family archived' } as Record<string, string>,
  },
  'fr-CA': {
    family: 'Famille', familyOfOne: 'Pas encore dans une famille : affiché comme une famille d’une personne.', create: 'Créer une famille', addToFamily: 'Ajouter à une famille existante',
    name: 'Nom de la famille', salutation: 'Formule d’appel', address: 'Adresse postale', letters: 'Les lettres familiales vont à', toHead: 'Chef de famille', toAdults: 'Chaque adulte',
    head: 'Chef de famille', headHelp: 'Le chef de famille est seulement la personne qui reçoit les lettres familiales. Ce rôle ne donne aucune autorité sur les autres.', needsHead: 'Aucun chef de famille : choisissez-en un',
    members: 'Membres', addMember: 'Ajouter un membre', findClient: 'Trouver un client par nom ou courriel', role: 'Rôle', add: 'Ajouter', confirm: 'Confirmer', save: 'Enregistrer', cancel: 'Annuler', close: 'Fermer',
    changeHead: 'Nommer chef de famille', formerHeadAs: 'Le chef actuel devient', end: 'Retirer de la famille', endWhy: 'Pourquoi?', move: 'Déplacer vers une autre famille', moveTo: 'Déplacer vers', archive: 'Archiver la famille',
    archiveWarn: 'Tout le monde quitte la famille. Les personnes, polices et dossiers ne sont ni modifiés ni supprimés.', history: 'Anciens membres', showHistory: 'Afficher les anciens membres', hideHistory: 'Masquer les anciens membres',
    open: 'Ouvrir la famille', age: (n: number) => `${n} ans`, profile: 'Détails', editDetails: 'Modifier les détails', dob: 'Date de naissance', lang: 'Langue préférée', deceased: 'Date du décès',
    conflict: 'Quelqu’un d’autre a modifié cette famille. Elle a été rechargée; réessayez.', noneFound: 'Aucun client correspondant.', noFamilies: 'Aucune famille pour l’instant.', searchFamilies: 'Trouver une famille',
    since: 'depuis', left: 'parti', pastFamilies: 'Familles précédentes', loading: 'Chargement…', members_n: (n: number) => (n === 1 ? '1 membre' : `${n} membres`),
    roles: { head: 'Chef de famille', spouse_partner: 'Conjoint ou partenaire', child: 'Enfant', dependent: 'Personne à charge', other: 'Autre' } as Record<Role, string>,
    reasons: { left: 'A quitté la famille', separated: 'Séparation', deceased: 'Décès', entered_in_error: 'Ajouté par erreur', moved: 'Déplacé', family_archived: 'Famille archivée' } as Record<string, string>,
  },
};
export const familyStrings = (l: Locale) => L[l] ?? L.en;
const statusOf = (e: unknown) => (e as { status?: number }).status;
const day = (iso: string | null, l: Locale) => (iso ? new Date(iso).toLocaleDateString(l, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/** Client search used by "Add a member" and "Create a family". Only clients the partner may see come back. */
export function ClientPicker({ call, locale, exclude, onPick }: { call: Call; locale: Locale; exclude: string[]; onPick: (c: { id: string; fullName: string | null; email: string | null }) => void }) {
  const x = familyStrings(locale);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<{ id: string; fullName: string | null; email: string | null }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    let live = true;
    const h = setTimeout(() => { call('GET', `/v1/contacts?limit=10&q=${encodeURIComponent(q.trim())}`).then((r) => live && setRows(r.contacts), () => live && setRows([])); }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [call, q]);
  const shown = rows.filter((r) => !exclude.includes(r.id));
  return (
    <div>
      <input type="search" aria-label={x.findClient} placeholder={x.findClient} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {q.trim().length >= 2 && (shown.length === 0 ? <p class="muted">{x.noneFound}</p> : (
        <ul class="maplist">{shown.map((r) => <li key={r.id}><button type="button" class="linkbtn" onClick={() => { onPick(r); setQ(''); }}>{r.fullName || r.email || '—'}</button>{r.email && r.fullName ? <span class="muted"> · {r.email}</span> : null}</li>)}</ul>
      ))}
    </div>
  );
}

/** Member list with the actions for each row. */
function MemberRows({ members, locale, editable, onHead, onRole, onEnd, onMove, onOpenPerson }: {
  members: Member[]; locale: Locale; editable: boolean;
  onHead: (m: Member, formerHeadRole: Role) => void; onRole: (m: Member, r: Role) => void; onEnd: (m: Member, why: EndReason) => void; onMove: (m: Member) => void; onOpenPerson?: (id: string) => void;
}) {
  const x = familyStrings(locale);
  const [ending, setEnding] = useState<string | null>(null);
  const [heading, setHeading] = useState<{ id: string; former: Role } | null>(null);
  const hasHead = members.some((m) => m.role === 'head');
  return (
    <ul class="maplist" aria-label={x.members}>
      {members.map((m) => (
        <li key={m.id} style={{ display: 'grid', gap: '4px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            {onOpenPerson ? <button type="button" class="linkbtn" onClick={() => onOpenPerson(m.contactId)}><strong>{m.fullName || m.email || '—'}</strong></button> : <strong>{m.fullName || m.email || '—'}</strong>}
            {(m.role === 'head' || !editable) && <span class={m.role === 'head' ? 'chip' : 'muted'} style={m.role === 'head' ? { padding: '1px 8px', fontSize: '12px' } : undefined}>{x.roles[m.role]}</span>}
            {m.age != null && <span class="muted">{x.age(m.age)}</span>}
            {m.deceasedOn && <span class="muted">† {day(m.deceasedOn, locale)}</span>}
          </div>
          {editable && (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12.5px' }}>
              {m.role !== 'head' && (heading?.id === m.id ? (
                <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {hasHead && <>{x.formerHeadAs}
                    <select aria-label={x.formerHeadAs} value={heading.former} style={{ width: 'auto', padding: '1px 4px', fontSize: '12.5px' }} onChange={(e) => setHeading({ id: m.id, former: (e.target as HTMLSelectElement).value as Role })}>
                      {NON_HEAD.map((r) => <option key={r} value={r}>{x.roles[r]}</option>)}
                    </select></>}
                  <button type="button" class="linkbtn pill" onClick={() => { const f = heading.former; setHeading(null); onHead(m, f); }}>{x.confirm}</button>
                  <button type="button" class="linkbtn" onClick={() => setHeading(null)}>{x.cancel}</button>
                </span>
              ) : <button type="button" class="linkbtn" onClick={() => setHeading({ id: m.id, former: m.role })}>{x.changeHead}</button>)}
              {m.role !== 'head' && (
                <select aria-label={`${x.role}: ${m.fullName ?? ''}`} value={m.role} style={{ width: 'auto', padding: '1px 4px', fontSize: '12.5px' }} onChange={(e) => onRole(m, (e.target as HTMLSelectElement).value as Role)}>
                  {NON_HEAD.map((r) => <option key={r} value={r}>{x.roles[r]}</option>)}
                </select>
              )}
              <button type="button" class="linkbtn" onClick={() => onMove(m)}>{x.move}</button>
              {ending === m.id ? (
                <span>
                  {x.endWhy}{' '}
                  {(['left', 'separated', 'deceased', 'entered_in_error'] as EndReason[]).map((r) => <button key={r} type="button" class="linkbtn pill" onClick={() => { setEnding(null); onEnd(m, r); }}>{x.reasons[r]}</button>)}
                  <button type="button" class="linkbtn" onClick={() => setEnding(null)}>{x.cancel}</button>
                </span>
              ) : <button type="button" class="linkbtn" onClick={() => setEnding(m.id)}>{x.end}</button>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Choose another family of the same partner to move a member into. */
function MovePicker({ call, locale, from, onPick, onCancel }: { call: Call; locale: Locale; from: string; onPick: (f: Family, role: Role) => void; onCancel: () => void }) {
  const x = familyStrings(locale);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Family[]>([]);
  const [role, setRole] = useState<Role>('other');
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => { call('GET', `/v1/families?limit=20${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then((r) => live && setRows(r.families.filter((f: Family) => f.id !== from)), () => live && setRows([])); }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [call, q, from]);
  return (
    <div class="hcard" style={{ marginTop: '8px' }}>
      <label>{x.moveTo}</label>
      <input type="search" aria-label={x.searchFamilies} placeholder={x.searchFamilies} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <label>{x.role}</label>
      <select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>{NON_HEAD.map((r) => <option key={r} value={r}>{x.roles[r]}</option>)}</select>
      {rows.length === 0 ? <p class="muted">{x.noFamilies}</p> : <ul class="maplist">{rows.map((f) => <li key={f.id}><button type="button" class="linkbtn" onClick={() => onPick(f, role)}>{f.displayName}</button> <span class="muted">· {x.members_n(f.memberCount)}</span></li>)}</ul>}
      <button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button>
    </div>
  );
}

/** The actions on one family, shared by the Family card and the Family panel. Every change sends the version seen. */
function useFamilyActions(call: Call, familyId: string | null, reload: () => Promise<void>, setErr: (s: string) => void, locale: Locale) {
  const x = familyStrings(locale);
  return useCallback(async (fn: () => Promise<unknown>) => {
    if (!familyId) return;
    setErr('');
    try { await fn(); await reload(); }
    catch (e) {
      if (statusOf(e) === 409) { await reload(); setErr(x.conflict); } else setErr((e as Error).message);
    }
  }, [familyId, reload, setErr, x.conflict]);
}

/** Family card on a client: their family and its members, or "a family of one" with ways to build one. */
export function FamilyCard({ call, locale, contactId, contactName, onOpenFamily, onOpenPerson, onChanged }: {
  call: Call; locale: Locale; contactId: string; contactName: string; onOpenFamily: (id: string) => void; onOpenPerson?: (id: string) => void; onChanged?: () => void;
}) {
  const x = familyStrings(locale);
  const [data, setData] = useState<PersonFamily | null>(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'' | 'create' | 'join' | 'add' | 'profile'>('');
  const [moving, setMoving] = useState<Member | null>(null);
  const load = useCallback(async () => {
    try { setData(await call('GET', `/v1/people/${contactId}/family`)); } catch (e) { setErr((e as Error).message); }
  }, [call, contactId]);
  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(async () => { await load(); onChanged?.(); }, [load, onChanged]);
  const fam = data?.family ?? null;
  const act = useFamilyActions(call, fam?.id ?? 'none', reload, setErr, locale);
  if (!data) return <section class="hcard"><h3>{x.family}</h3>{err ? <p class="err" role="alert">{err}</p> : <p class="muted">{x.loading}</p>}</section>;
  const v = () => fam!.version;
  return (
    <section class="hcard" aria-label={x.family}>
      <h3 style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <span>{fam ? fam.displayName : x.family}</span>
        {fam && <button type="button" class="linkbtn" onClick={() => onOpenFamily(fam.id)}>{x.open}</button>}
      </h3>
      {err && <p class="err" role="alert" style={{ padding: '0 0 8px' }}>{err}</p>}
      {fam?.needsHead && <p class="foot-note warn">{x.needsHead}</p>}
      {!fam ? (
        <>
          <p class="muted">{x.familyOfOne}</p>
          {mode === '' && (
            <div class="actions" style={{ marginTop: '8px' }}>
              <button type="button" class="btn" onClick={() => setMode('create')}>{x.create}</button>
              <button type="button" class="btn quiet" onClick={() => setMode('join')}>{x.addToFamily}</button>
            </div>
          )}
          {mode === 'create' && <CreateFamily call={call} locale={locale} headId={contactId} headName={contactName} onDone={async (id) => { setMode(''); await reload(); if (id) onOpenFamily(id); }} />}
          {mode === 'join' && (
            <MovePicker call={call} locale={locale} from="" onCancel={() => setMode('')} onPick={(f, role) => {
              setMode('');
              void (async () => {
                setErr('');
                try { await call('POST', `/v1/families/${f.id}/members`, { version: f.version, contactId, role }); await reload(); }
                catch (e) { setErr(statusOf(e) === 409 ? x.conflict : (e as Error).message); }
              })();
            }} />
          )}
        </>
      ) : (
        <>
          <MemberRows members={data.members} locale={locale} editable onOpenPerson={onOpenPerson}
            onHead={(m, former) => act(() => call('POST', `/v1/families/${fam.id}/change-head`, { version: v(), contactId: m.contactId, formerHeadRole: former }))}
            onRole={(m, r) => act(() => call('PATCH', `/v1/families/${fam.id}/members/${m.id}`, { version: v(), role: r }))}
            onEnd={(m, why) => act(() => call('POST', `/v1/families/${fam.id}/members/${m.id}/end`, { version: v(), reason: why }))}
            onMove={(m) => setMoving(m)} />
          {moving && <MovePicker call={call} locale={locale} from={fam.id} onCancel={() => setMoving(null)} onPick={(to, role) => { const m = moving; setMoving(null); void act(() => call('POST', `/v1/families/${fam.id}/move-member`, { version: v(), contactId: m.contactId, toFamilyId: to.id, toVersion: to.version, role })); }} />}
          {mode === 'add' ? (
            <AddMember call={call} locale={locale} exclude={data.members.map((m) => m.contactId)} onCancel={() => setMode('')}
              onAdd={(id, role) => { setMode(''); void act(() => call('POST', `/v1/families/${fam.id}/members`, { version: v(), contactId: id, role })); }} />
          ) : <div class="actions" style={{ marginTop: '8px' }}><button type="button" class="btn quiet" onClick={() => setMode('add')}>{x.addMember}</button></div>}
        </>
      )}
      <details style={{ marginTop: '10px' }} open={mode === 'profile'}>
        <summary class="muted" style={{ cursor: 'pointer' }}>{x.profile}</summary>
        <Profile call={call} locale={locale} contactId={contactId} person={data.person} onSaved={reload} />
      </details>
      {data.history.length > 0 && (
        <details style={{ marginTop: '6px' }}>
          <summary class="muted" style={{ cursor: 'pointer' }}>{x.pastFamilies}</summary>
          <ul class="maplist">{data.history.map((h, i) => <li key={i}>{h.familyName} · {x.roles[h.role]} · {x.reasons[h.endReason] ?? h.endReason} {day(h.endedAt, locale)}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

function AddMember({ call, locale, exclude, onAdd, onCancel }: { call: Call; locale: Locale; exclude: string[]; onAdd: (id: string, role: Role) => void; onCancel: () => void }) {
  const x = familyStrings(locale);
  const [role, setRole] = useState<Role>('other');
  return (
    <div class="hcard" style={{ marginTop: '8px' }}>
      <label>{x.role}</label>
      <select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>{NON_HEAD.map((r) => <option key={r} value={r}>{x.roles[r]}</option>)}</select>
      <label>{x.addMember}</label>
      <ClientPicker call={call} locale={locale} exclude={exclude} onPick={(c) => onAdd(c.id, role)} />
      <button type="button" class="btn quiet" style={{ marginTop: '8px' }} onClick={onCancel}>{x.cancel}</button>
    </div>
  );
}

function CreateFamily({ call, locale, headId, headName, onDone }: { call: Call; locale: Locale; headId: string; headName: string; onDone: (id: string | null) => void }) {
  const x = familyStrings(locale);
  const surname = headName.trim().split(/\s+/).slice(-1)[0] ?? '';
  const [name, setName] = useState(surname ? (locale === 'fr-CA' ? `Famille ${surname}` : `${surname} family`) : '');
  const [others, setOthers] = useState<{ id: string; label: string; role: Role }[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const f = await call('POST', '/v1/families', { displayName: name.trim(), members: [{ contactId: headId, role: 'head' }, ...others.map((o) => ({ contactId: o.id, role: o.role }))] });
      onDone(f.id);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div class="hcard" style={{ marginTop: '8px' }}>
      <label for="fam-name">{x.name}</label>
      <input id="fam-name" value={name} maxLength={120} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <p class="muted" style={{ fontSize: '12.5px' }}>{x.head}: <strong>{headName}</strong>. {x.headHelp}</p>
      {others.length > 0 && <ul class="maplist">{others.map((o, i) => (
        <li key={o.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{o.label}</span>
          <select aria-label={`${x.role}: ${o.label}`} value={o.role} style={{ width: 'auto' }} onChange={(e) => setOthers(others.map((p, j) => (j === i ? { ...p, role: (e.target as HTMLSelectElement).value as Role } : p)))}>{NON_HEAD.map((r) => <option key={r} value={r}>{x.roles[r]}</option>)}</select>
          <button type="button" class="linkbtn" onClick={() => setOthers(others.filter((_, j) => j !== i))}>×</button>
        </li>
      ))}</ul>}
      <label>{x.addMember}</label>
      <ClientPicker call={call} locale={locale} exclude={[headId, ...others.map((o) => o.id)]} onPick={(c) => setOthers([...others, { id: c.id, label: c.fullName || c.email || '—', role: 'other' }])} />
      {err && <p class="err" role="alert" style={{ padding: '8px 0 0' }}>{err}</p>}
      <div class="actions">
        <button type="button" class="btn" disabled={busy || !name.trim()} onClick={submit}>{x.create}</button>
        <button type="button" class="btn quiet" onClick={() => onDone(null)}>{x.cancel}</button>
      </div>
    </div>
  );
}

function Profile({ call, locale, contactId, person, onSaved }: { call: Call; locale: Locale; contactId: string; person: PersonFamily['person']; onSaved: () => Promise<void> }) {
  const x = familyStrings(locale);
  const [dob, setDob] = useState(person.dateOfBirth ?? '');
  const [lang, setLang] = useState(person.preferredLanguage ?? '');
  const [dod, setDod] = useState(person.deceasedOn ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const save = async () => {
    setBusy(true); setErr('');
    try { await call('PATCH', `/v1/people/${contactId}/profile`, { dateOfBirth: dob || null, preferredLanguage: lang.trim() || null, deceasedOn: dod || null }); await onSaved(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div>
      <label for={`dob-${contactId}`}>{x.dob}</label>
      <input id={`dob-${contactId}`} type="date" max={today} value={dob} onInput={(e) => setDob((e.target as HTMLInputElement).value)} />
      <label for={`lang-${contactId}`}>{x.lang}</label>
      <input id={`lang-${contactId}`} maxLength={20} value={lang} onInput={(e) => setLang((e.target as HTMLInputElement).value)} />
      <label for={`dod-${contactId}`}>{x.deceased}</label>
      <input id={`dod-${contactId}`} type="date" max={today} value={dod} onInput={(e) => setDod((e.target as HTMLInputElement).value)} />
      {err && <p class="err" role="alert" style={{ padding: '8px 0 0' }}>{err}</p>}
      <div class="actions"><button type="button" class="btn quiet" disabled={busy} onClick={save}>{x.save}</button></div>
    </div>
  );
}

/** The Family panel: header details, members with every action, past members, archive. */
export function FamilyPanel({ call, locale, familyId, onClose, onOpenPerson, onChanged }: { call: Call; locale: Locale; familyId: string; onClose: () => void; onOpenPerson?: (id: string) => void; onChanged?: () => void }) {
  const x = familyStrings(locale);
  const dlg = useDialogFocus<HTMLElement>();
  const [fam, setFam] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [history, setHistory] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Member | null>(null);
  const [form, setForm] = useState({ displayName: '', salutation: '', mailingAddress: '', mailingPreference: 'head' as 'head' | 'each_adult' });
  const load = useCallback(async () => {
    try {
      const [f, m] = await Promise.all([call('GET', `/v1/families/${familyId}`), call('GET', `/v1/families/${familyId}/members${history ? '?history=true' : ''}`)]);
      setFam(f); setMembers(m.members);
      setForm({ displayName: f.displayName, salutation: f.salutation ?? '', mailingAddress: f.mailingAddress ?? '', mailingPreference: f.mailingPreference });
    } catch (e) { setErr((e as Error).message); }
  }, [call, familyId, history]);
  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(async () => { await load(); onChanged?.(); }, [load, onChanged]);
  const act = useFamilyActions(call, familyId, reload, setErr, locale);
  const active = fam?.status === 'active';
  const current = members.filter((m) => !m.endedAt);
  const past = members.filter((m) => m.endedAt);
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={fam?.displayName ?? x.family} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      {!fam ? (err ? <p class="err" role="alert">{err}</p> : <p class="muted">{x.loading}</p>) : (
        <>
          <h2>{fam.displayName}</h2>
          <p class="muted" style={{ margin: '0 0 8px' }}>{x.members_n(fam.memberCount)}{fam.head ? ` · ${x.head}: ${fam.head.fullName ?? ''}` : ''}{!active ? ` · ${x.reasons.family_archived}` : ''}</p>
          {fam.needsHead && <p class="foot-note warn">{x.needsHead}</p>}
          <p class="muted" style={{ fontSize: '12.5px' }}>{x.headHelp}</p>
          {err && <p class="err" role="alert" style={{ padding: '0 0 8px' }}>{err}</p>}
          {edit ? (
            <div>
              <label for="f-name">{x.name}</label>
              <input id="f-name" maxLength={120} value={form.displayName} onInput={(e) => setForm({ ...form, displayName: (e.target as HTMLInputElement).value })} />
              <label for="f-sal">{x.salutation}</label>
              <input id="f-sal" maxLength={200} value={form.salutation} onInput={(e) => setForm({ ...form, salutation: (e.target as HTMLInputElement).value })} />
              <label for="f-addr">{x.address}</label>
              <input id="f-addr" maxLength={500} value={form.mailingAddress} onInput={(e) => setForm({ ...form, mailingAddress: (e.target as HTMLInputElement).value })} />
              <label for="f-pref">{x.letters}</label>
              <select id="f-pref" value={form.mailingPreference} onChange={(e) => setForm({ ...form, mailingPreference: (e.target as HTMLSelectElement).value as 'head' | 'each_adult' })}>
                <option value="head">{x.toHead}</option><option value="each_adult">{x.toAdults}</option>
              </select>
              <div class="actions">
                <button type="button" class="btn" disabled={!form.displayName.trim()} onClick={() => { setEdit(false); void act(() => call('PATCH', `/v1/families/${familyId}`, { version: fam.version, displayName: form.displayName.trim(), salutation: form.salutation.trim() || null, mailingAddress: form.mailingAddress.trim() || null, mailingPreference: form.mailingPreference })); }}>{x.save}</button>
                <button type="button" class="btn quiet" onClick={() => setEdit(false)}>{x.cancel}</button>
              </div>
            </div>
          ) : (
            <dl class="kv" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: '8px 0' }}>
              <dt>{x.salutation}</dt><dd>{fam.salutation || '—'}</dd>
              <dt>{x.address}</dt><dd>{fam.mailingAddress || '—'}</dd>
              <dt>{x.letters}</dt><dd>{fam.mailingPreference === 'head' ? x.toHead : x.toAdults}</dd>
            </dl>
          )}
          {active && !edit && <button type="button" class="linkbtn" onClick={() => setEdit(true)}>{x.editDetails}</button>}
          <h3 style={{ margin: '16px 0 4px', fontSize: '14px' }}>{x.members}</h3>
          <MemberRows members={current} locale={locale} editable={active} onOpenPerson={onOpenPerson}
            onHead={(m, former) => act(() => call('POST', `/v1/families/${familyId}/change-head`, { version: fam.version, contactId: m.contactId, formerHeadRole: former }))}
            onRole={(m, r) => act(() => call('PATCH', `/v1/families/${familyId}/members/${m.id}`, { version: fam.version, role: r }))}
            onEnd={(m, why) => act(() => call('POST', `/v1/families/${familyId}/members/${m.id}/end`, { version: fam.version, reason: why }))}
            onMove={(m) => setMoving(m)} />
          {moving && <MovePicker call={call} locale={locale} from={familyId} onCancel={() => setMoving(null)} onPick={(to, role) => { const m = moving; setMoving(null); void act(() => call('POST', `/v1/families/${familyId}/move-member`, { version: fam.version, contactId: m.contactId, toFamilyId: to.id, toVersion: to.version, role })); }} />}
          {active && (adding
            ? <AddMember call={call} locale={locale} exclude={current.map((m) => m.contactId)} onCancel={() => setAdding(false)} onAdd={(id, role) => { setAdding(false); void act(() => call('POST', `/v1/families/${familyId}/members`, { version: fam.version, contactId: id, role: fam.head ? role : 'head' })); }} />
            : <div class="actions" style={{ marginTop: '8px' }}><button type="button" class="btn quiet" onClick={() => setAdding(true)}>{x.addMember}</button></div>)}
          <p style={{ marginTop: '14px' }}><button type="button" class="linkbtn" onClick={() => setHistory(!history)}>{history ? x.hideHistory : x.showHistory}</button></p>
          {history && (past.length === 0 ? <p class="muted">—</p> : <ul class="maplist">{past.map((m) => <li key={m.id}>{m.fullName || '—'} · {x.roles[m.role]} · {x.reasons[m.endReason ?? ''] ?? m.endReason} {day(m.endedAt, locale)}</li>)}</ul>)}
          {active && <FamilyInsurance key={`${familyId}:${fam.version}`} call={call} locale={locale} familyId={familyId} />}
          {active && <FamilyCompliance key={`fc:${familyId}:${fam.version}`} call={call} locale={locale} familyId={familyId} onOpenPerson={onOpenPerson} />}
          {active && (
            <details style={{ marginTop: '14px' }}>
              <summary class="muted" style={{ cursor: 'pointer' }}>{x.archive}</summary>
              <p class="muted" style={{ fontSize: '12.5px' }}>{x.archiveWarn}</p>
              <button type="button" class="btn quiet" onClick={() => act(() => call('POST', `/v1/families/${familyId}/archive`, { version: fam.version }))}>{x.archive}</button>
            </details>
          )}
        </>
      )}
      <div class="actions"><button type="button" class="btn quiet" onClick={onClose}>{x.close}</button></div>
    </aside>
  );
}

export { ROLES };
