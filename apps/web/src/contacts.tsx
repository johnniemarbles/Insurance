import { ErrorBar } from './errorbar.tsx';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Strings } from './i18n.ts';
import type { Locale } from './types.ts';
import { FamilyCard, FamilyPanel, familyStrings, type Call, type Role } from './families.tsx';
import { MissingPeopleQueue, useFamilyInsuranceOn } from './family-insurance.tsx';
import { PersonCompliance, ReviewsQueue, useFamilyComplianceOn } from './family-compliance.tsx';
import { FamilyEmail, FamilyImport, useFamilyToolsOn } from './family-tools.tsx';
import { MergePanel } from './merge.tsx';
import type { ComposeApi } from './types.ts';

interface Row { id: string; fullName: string | null; email: string | null; phone: string | null; custom: { title?: string } }
interface Mship { contactId: string; familyId: string; familyName: string; role: Role }

const G = {
  en: { group: 'Group by family', headsOnly: 'Heads only', counts: (p: number, f: number) => `${p} ${p === 1 ? 'person' : 'people'} · ${f} ${f === 1 ? 'family' : 'families'}`, noFamily: 'Not in a family', familyOfOne: 'Family of one', open: 'Open', client: 'Client', missingPeople: 'Policies missing people', reviews: 'Compliance reviews', email: 'Email families', importF: 'Import families' },
  'fr-CA': { group: 'Regrouper par famille', headsOnly: 'Chefs de famille seulement', counts: (p: number, f: number) => `${p} ${p === 1 ? 'personne' : 'personnes'} · ${f} ${f === 1 ? 'famille' : 'familles'}`, noFamily: 'Pas dans une famille', familyOfOne: 'Famille d’une personne', open: 'Ouvrir', client: 'Client', missingPeople: 'Polices sans personnes', reviews: 'Examens de conformité', email: 'Écrire aux familles', importF: 'Importer des familles' },
};
const ROLE_ORDER: Record<Role, number> = { head: 0, spouse_partner: 1, child: 2, dependent: 3, other: 4 };

/** Client panel: contact details plus the Family card. Opens from the Contacts list when families are switched on. */
function ClientPanel({ call, locale, row, onClose, onOpenFamily, onOpenPerson, onChanged }: { call: Call; locale: Locale; row: Row; onClose: () => void; onOpenFamily: (id: string) => void; onOpenPerson: (id: string) => void; onChanged: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const x = familyStrings(locale);
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={row.fullName ?? G[locale].client} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <h2>{row.fullName || row.email || '—'}</h2>
      <p class="muted" style={{ margin: '0 0 12px' }}>{[row.email, row.phone, row.custom?.title].filter(Boolean).join(' · ') || '—'}</p>
      <FamilyCard key={row.id} call={call} locale={locale} contactId={row.id} contactName={row.fullName ?? row.email ?? ''} onOpenFamily={onOpenFamily} onOpenPerson={onOpenPerson} onChanged={onChanged} />
      <PersonCompliance key={`c:${row.id}`} call={call} locale={locale} contactId={row.id} />
      <div class="actions"><button type="button" class="btn quiet" onClick={onClose}>{x.close}</button></div>
    </aside>
  );
}

export function ContactsView({ call, t, locale = 'en', compose, familiesPage = false }: { call: Call; t: Strings; locale?: Locale; compose?: ComposeApi; familiesPage?: boolean }) {
  const g = G[locale] ?? G.en;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [err, setErr] = useState('');
  // Families exist only where the server has them switched on: a 404 here means off, and nothing family-related shows.
  const [famOn, setFamOn] = useState<boolean | null>(null);
  const [mships, setMships] = useState<Record<string, Mship>>({});
  const [grouped, setGrouped] = useState(familiesPage);
  const [headsOnly, setHeadsOnly] = useState(false);
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const insuranceOn = useFamilyInsuranceOn(call);
  const [queue, setQueue] = useState(false);
  const complianceOn = useFamilyComplianceOn(call);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const toolsOn = useFamilyToolsOn(call);
  const [listNonce, setListNonce] = useState(0);
  const [tool, setTool] = useState<'' | 'email' | 'import' | 'merges'>('');
  useEffect(() => { const h = setTimeout(() => setDq(q), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    let live = true;
    call('GET', `/v1/contacts?limit=200${dq ? `&q=${encodeURIComponent(dq)}` : ''}`).then((r) => live && setRows(r.contacts), (e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [call, dq, listNonce]);
  useEffect(() => {
    if (!rows || rows.length === 0 || famOn === false) return;
    let live = true;
    call('GET', `/v1/family-memberships?contactIds=${rows.map((r) => r.id).join(',')}`).then(
      (r) => { if (!live) return; setFamOn(true); setMships(Object.fromEntries((r.memberships as Mship[]).map((m) => [m.contactId, m]))); },
      (e) => { if (live && (e as { status?: number }).status === 404) setFamOn(false); },
    );
    return () => { live = false; };
  }, [call, rows, famOn, nonce]);
  const changed = useCallback(() => setNonce((n) => n + 1), []);
  const byId = useMemo(() => Object.fromEntries((rows ?? []).map((r) => [r.id, r])), [rows]);

  // Grouped view: one block per family (Head first), then everyone not in a family, each a family of one.
  const groups = useMemo(() => {
    if (!rows) return [];
    const fams = new Map<string, { id: string; name: string; people: Row[] }>();
    const single: Row[] = [];
    for (const r of rows) {
      const m = mships[r.id];
      if (!m) { single.push(r); continue; }
      if (!fams.has(m.familyId)) fams.set(m.familyId, { id: m.familyId, name: m.familyName, people: [] });
      fams.get(m.familyId)!.people.push(r);
    }
    const list = [...fams.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const f of list) f.people.sort((a, b) => ROLE_ORDER[mships[a.id]!.role] - ROLE_ORDER[mships[b.id]!.role] || (a.fullName ?? '').localeCompare(b.fullName ?? ''));
    return [...list.map((f) => ({ ...f, people: headsOnly ? f.people.filter((p) => mships[p.id]?.role === 'head') : f.people })), { id: '', name: g.noFamily, people: single }];
  }, [rows, mships, headsOnly, g.noFamily]);
  const familyCount = new Set(Object.values(mships).map((m) => m.familyId)).size;

  const nameCell = (r: Row) => famOn
    ? <button type="button" class="linkbtn" style={{ fontWeight: 600, color: 'var(--navy)', textDecoration: 'none' }} onClick={() => setOpenRow(r)}>{r.fullName || r.email || '—'}</button>
    : (r.fullName || '—');
  const line = (r: Row, role?: Role) => (
    <tr key={r.id} class="row">
      <td class="name" style={{ padding: '12px 18px', fontWeight: 600, color: 'var(--navy)' }}>{nameCell(r)}{role && <span class="muted" style={{ fontWeight: 400, marginLeft: '8px', fontSize: '12.5px' }}>{familyStrings(locale).roles[role]}</span>}</td>
      <td style={{ padding: '12px 18px', color: 'var(--ink)' }}>{r.email ? <a href={`mailto:${r.email}`} style={{ color: 'var(--pri)', textDecoration: 'none' }}>{r.email}</a> : '—'}</td>
      <td style={{ padding: '12px 18px', color: 'var(--mute)' }}>{r.phone || '—'}</td>
      <td style={{ padding: '12px 18px', color: 'var(--mute)' }}>{r.custom?.title || '—'}</td>
    </tr>
  );

  return (
    <div class="tpad" style={{ maxWidth: '1200px' }}>
      <div class="bar" style={{ padding: '0 0 16px 0', border: 0, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--navy)', margin: 0 }}>{t.contacts}</h1>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          {famOn && insuranceOn && <button type="button" class="linkbtn" style={{ fontSize: '13px' }} onClick={() => setQueue(true)}>{g.missingPeople}</button>}
          {famOn && complianceOn && <button type="button" class="linkbtn" style={{ fontSize: '13px' }} onClick={() => setReviewsOpen(true)}>{g.reviews}</button>}
          {famOn && toolsOn && <button type="button" class="linkbtn" style={{ fontSize: '13px' }} onClick={() => setTool('email')}>{g.email}</button>}
          {famOn && toolsOn && <button type="button" class="linkbtn" style={{ fontSize: '13px' }} onClick={() => setTool('import')}>{g.importF}</button>}
          {famOn && (
            <>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', color: 'var(--ink)' }}>
                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped((e.target as HTMLInputElement).checked)} />{g.group}
              </label>
              {grouped && (
                <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', color: 'var(--ink)' }}>
                  <input type="checkbox" checked={headsOnly} onChange={(e) => setHeadsOnly((e.target as HTMLInputElement).checked)} />{g.headsOnly}
                </label>
              )}
            </>
          )}
          <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
            <input
              class="search"
              style={{ width: '100%', maxWidth: 'none', paddingLeft: '34px', height: '38px', borderRadius: '10px' }}
              type="search"
              placeholder={t.search}
              aria-label={t.search}
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
            <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '15px', height: '15px', stroke: 'var(--mute)', fill: 'none', strokeWidth: 2, pointerEvents: 'none' }} viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>
      </div>
      {famOn && grouped && rows && <p class="muted" style={{ margin: '0 0 10px' }}>{g.counts(rows.length, familyCount)}</p>}
      {err && <ErrorBar msg={err} retry={t.retry} />}
      {!rows ? (
        err ? null : <div class="msg">{t.loading}</div>
      ) : rows.length === 0 ? (
        <div class="contacts-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--mute)' }}>{t.empty}</div>
      ) : (
        <div class="contacts-card">
          <table>
            <caption class="sr">{t.contacts}</caption>
            <thead>
              <tr>
                <th style={{ padding: '12px 18px' }}>{t.name}</th>
                <th style={{ padding: '12px 18px' }}>Email</th>
                <th style={{ padding: '12px 18px' }}>{t.phone}</th>
                <th style={{ padding: '12px 18px' }}>{t.jobTitle}</th>
              </tr>
            </thead>
            {famOn && grouped ? groups.filter((f) => f.people.length > 0).map((f) => (
              <tbody key={f.id || 'none'}>
                <tr>
                  <th colSpan={4} scope="rowgroup" style={{ padding: '10px 18px', background: 'var(--tint)', position: 'static' }}>
                    {f.id ? <button type="button" class="linkbtn" style={{ fontWeight: 600, fontSize: '14px', textDecoration: 'none', color: 'var(--navy)' }} onClick={() => setOpenFamily(f.id)}>{f.name}<span class="muted" style={{ fontWeight: 400, fontSize: '12.5px' }}>{' · '}{g.open} →</span></button> : <span style={{ fontSize: '14px' }}>{f.name}</span>}
                    {!f.id && <span class="muted" style={{ fontWeight: 400 }}> · {g.familyOfOne}</span>}
                  </th>
                </tr>
                {f.people.map((r) => line(r, f.id ? mships[r.id]?.role : undefined))}
              </tbody>
            )) : (
              <tbody>{rows.map((r) => line(r))}</tbody>
            )}
          </table>
        </div>
      )}
      {openRow && !openFamily && (
        <ClientPanel call={call} locale={locale} row={openRow} onClose={() => setOpenRow(null)} onChanged={changed}
          onOpenFamily={(id) => setOpenFamily(id)} onOpenPerson={(id) => { const r = byId[id]; if (r) setOpenRow(r); }} />
      )}
      {queue && <MissingPeopleQueue call={call} locale={locale} onClose={() => setQueue(false)} />}
      {reviewsOpen && <ReviewsQueue call={call} locale={locale} onClose={() => setReviewsOpen(false)} />}
      {tool === 'email' && <FamilyEmail call={call} locale={locale} onClose={() => setTool('')} onCreated={() => setTool('merges')} />}
      {tool === 'import' && <FamilyImport call={call} locale={locale} onClose={() => setTool('')} onDone={() => { setListNonce((n) => n + 1); changed(); }} />}
      {tool === 'merges' && <MergePanel call={call} locale={locale} compose={compose} boxIds={[]} onClose={() => setTool('')} onOpenBox={() => undefined} />}
      {openFamily && (
        <FamilyPanel call={call} locale={locale} familyId={openFamily} onChanged={changed}
          onClose={() => setOpenFamily(null)} onOpenPerson={(id) => { const r = byId[id]; setOpenFamily(null); if (r) setOpenRow(r); }} />
      )}
    </div>
  );
}
