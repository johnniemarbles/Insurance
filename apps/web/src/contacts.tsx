import { ErrorBar } from './errorbar.tsx';
import { useEffect, useState } from 'preact/hooks';
import type { Strings } from './i18n.ts';

type Call = (method: 'GET', path: string) => Promise<any>;
interface Row { id: string; fullName: string | null; email: string | null; phone: string | null; custom: { title?: string } }

export function ContactsView({ call, t }: { call: Call; t: Strings }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { const h = setTimeout(() => setDq(q), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    let live = true;
    call('GET', `/v1/contacts?limit=200${dq ? `&q=${encodeURIComponent(dq)}` : ''}`).then((r) => live && setRows(r.contacts), (e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [call, dq]);
  return (
    <div class="tpad">
      <div class="bar" style={{ padding: 0, border: 0 }}>
        <h1>{t.contacts}</h1>
        <input class="search" type="search" placeholder={t.search} aria-label={t.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      {err && <ErrorBar msg={err} retry={t.retry} />}
      {!rows ? (err ? null : <div class="msg">{t.loading}</div>) : rows.length === 0 ? <div class="msg">{t.empty}</div> : (
        <table>
          <caption class="sr">{t.contacts}</caption>
          <thead><tr><th>{t.name}</th><th>Email</th><th>{t.phone}</th><th>{t.jobTitle}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td class="name">{r.fullName ?? ''}</td><td>{r.email ?? ''}</td><td>{r.phone ?? ''}</td><td>{r.custom?.title ?? ''}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}
