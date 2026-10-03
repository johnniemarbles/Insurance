import { useDialogFocus } from './a11y.ts';
import { useEffect, useState } from 'preact/hooks';
import readXlsx from 'read-excel-file/universal';
import type { Strings } from './i18n.ts';
import type { Pipeline } from './types.ts';

type Cell = string | number | boolean | Date | null;
interface ContactRow { boxName: string; fullName: string | null; email: string | null; phone: string | null; title: string | null }
interface Parsed { headers: string[]; rows: Cell[][]; contacts: ContactRow[] }
interface Result { contactsCreated?: number; contactsLinked?: number; created: number; skipped: { row: number; reason: string }[]; stagesCreated: number; fieldsCreated: number }

export function parseCsv(text: string): Cell[][] {
  const out: Cell[][] = []; let row: Cell[] = []; let cur = ''; let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((x) => x !== '' && x != null));
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const KNOWN: Record<string, 'name' | 'stage' | 'value' | 'closeDate' | 'assigned' | 'days' | 'ignore'> = {
  name: 'name', 'box name': 'name', stage: 'stage', 'deal size': 'value', value: 'value', 'close date': 'closeDate', 'assigned to': 'assigned',
  'days in stage': 'days', 'box key': 'ignore', 'date of last email': 'ignore', 'last email from': 'ignore',
};
const slug = (h: string) => { const k = norm(h).replace(/ /g, '_'); return /^[a-z]/.test(k) ? k.slice(0, 40) : `f_${k}`.slice(0, 40); };
const iso = (v: Cell): string | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};
const num = (v: Cell): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function ImportDialog({ pipeline, call, t, onClose, onDone }: {
  pipeline: Pipeline; call: (m: 'GET' | 'POST', p: string, b?: unknown) => Promise<any>; t: Strings; onClose: () => void; onDone: () => void;
}) {
  const dlg = useDialogFocus<HTMLElement>();
  const [data, setData] = useState<Parsed | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]);
  const [loc, setLoc] = useState('');
  useEffect(() => { call('GET', '/v1/org/contexts').then((r) => setLocs(r.locations ?? []), () => undefined); }, [call]);

  const onFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    setErr(''); setRes(null); setFileName(f.name);
    try {
      let contacts: ContactRow[] = [];
      let raw: Cell[][];
      if (/\.xlsx$/i.test(f.name)) {
        const sheets = (await readXlsx(f)) as unknown as { sheet: string; data: Cell[][] }[];
        raw = sheets[0]?.data ?? [];
        const cs = sheets.find((s) => /^contacts/i.test(s.sheet));
        if (cs && cs.data.length > 1) {
          const h = cs.data[0]!.map((x) => norm(String(x ?? '')));
          const at = (...names: string[]) => h.findIndex((x) => names.includes(x));
          const [bn, fn, ln, em, ph, ti] = [at('box name'), at('first name'), at('last name'), at('email addresses', 'email'), at('phone numbers', 'phone'), at('title')];
          const v = (r: Cell[], i: number) => (i < 0 || r[i] == null || r[i] === '' ? null : String(r[i]));
          contacts = cs.data.slice(1).map((r) => ({ boxName: v(r, bn) ?? '', fullName: [v(r, fn), v(r, ln)].filter(Boolean).join(' ') || null, email: v(r, em), phone: v(r, ph), title: v(r, ti) })).filter((c) => c.boxName);
        }
      } else raw = parseCsv(await f.text());
      if (raw.length < 2) throw new Error(t.importEmpty);
      const headers = raw[0]!.map((h) => String(h ?? '').trim());
      if (!headers.some((h) => KNOWN[norm(h)] === 'name')) throw new Error(t.importNoName);
      setData({ headers, contacts, rows: raw.slice(1).filter((r) => r.some((x) => x != null && x !== '')) });
    } catch (x) { setData(null); setErr((x as Error).message); }
  };

  const plan = data && data.headers.map((h, i) => ({ h, i, kind: KNOWN[norm(h)] ?? 'custom' as const })).filter((c) => c.h);
  const customCols = plan?.filter((c) => c.kind === 'custom') ?? [];

  const go = async () => {
    if (!data || !plan) return;
    setBusy(true); setErr('');
    const col = (k: string) => plan.find((c) => c.kind === k)?.i;
    const keyOf = new Map(customCols.map((c) => [c.i, slug(c.h)]));
    const rows = data.rows.map((r) => {
      const custom: Record<string, string | number | null> = {};
      for (const c of customCols) { const v = r[c.i]; if (v != null && v !== '') custom[keyOf.get(c.i)!] = v instanceof Date ? iso(v) : typeof v === 'boolean' ? String(v) : v; }
      const get = (k: string) => (col(k) === undefined ? null : r[col(k)!] ?? null);
      return {
        name: String(get('name') ?? ''), stage: get('stage') != null ? String(get('stage')) : undefined, valueAmount: num(get('value')),
        closeDate: iso(get('closeDate')), assignedEmail: get('assigned') != null ? String(get('assigned')) : undefined, daysInStage: num(get('days')), custom,
      };
    });
    // chunks keep each request small; names already imported are skipped, so a retry is safe
    const total: Result = { created: 0, skipped: [], stagesCreated: 0, fieldsCreated: 0 };
    try {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const r = (await call('POST', `/v1/pipelines/${pipeline.id}/import`, { ...(loc ? { contextNodeId: loc } : {}), columns: customCols.map((c) => ({ key: keyOf.get(c.i)!, label: c.h })), rows: chunk })) as Result;
        total.created += r.created; total.stagesCreated += r.stagesCreated; total.fieldsCreated += r.fieldsCreated;
        total.skipped.push(...r.skipped.map((s) => ({ row: s.row + i, reason: s.reason })));
      }
      for (let i = 0; i < data.contacts.length; i += 500) {
        const r = (await call('POST', `/v1/pipelines/${pipeline.id}/import`, { ...(loc ? { contextNodeId: loc } : {}), rows: [], contacts: data.contacts.slice(i, i + 500) })) as Result;
        total.contactsCreated = (total.contactsCreated ?? 0) + (r.contactsCreated ?? 0);
      }
      setRes(total); onDone();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  return (
    <aside ref={dlg} tabIndex={-1} class="drawer" role="dialog" aria-label={t.import}>
      <h2>{t.import}</h2>
      <p class="muted">{t.importHelp}</p>
      <input type="file" accept=".csv,.xlsx" aria-label={t.chooseFile} onChange={onFile} />
      {err && <div class="err" role="alert">{err}</div>}
      {data && plan && !res && (
        <>
          <p><b>{fileName}</b>: {t.rows(data.rows.length)}{data.contacts.length > 0 && <> · {t.importContacts(data.contacts.length)}</>}</p>
          <ul class="maplist">
            {plan.map((c) => (
              <li><span>{c.h}</span> → <b>{c.kind === 'ignore' ? t.importIgnored : c.kind === 'custom' ? t.importAsColumn : t.importFields[c.kind]}</b></li>
            ))}
          </ul>
          {locs.length > 1 && (
            <><label for="il">{t.location}</label>
            <select id="il" value={loc} onChange={(e) => setLoc((e.target as HTMLSelectElement).value)}><option value="">{t.chooseLocation}</option>{locs.map((l) => <option value={l.id}>{l.name}</option>)}</select></>
          )}
          <div class="actions"><button class="btn" disabled={busy || (locs.length > 1 && !loc)} onClick={go}>{busy ? t.loading : t.importGo(data.rows.length)}</button><button class="btn quiet" onClick={onClose}>{t.cancel}</button></div>
        </>
      )}
      {res && (
        <>
          <p class="ok" role="status">{t.importDone(res.created, res.stagesCreated, res.fieldsCreated)}{res.contactsCreated ? ` ${t.importContactsDone(res.contactsCreated)}` : ''}</p>
          {res.skipped.length > 0 && <><h3>{t.importSkipped(res.skipped.length)}</h3><ul class="maplist">{res.skipped.slice(0, 20).map((s) => <li>#{s.row}: {s.reason}</li>)}</ul></>}
          <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
        </>
      )}
    </aside>
  );
}
