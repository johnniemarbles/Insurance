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
    <div class="tpad" style={{ maxWidth: '1200px' }}>
      <div class="bar" style={{ padding: '0 0 16px 0', border: 0, justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--navy)', margin: 0 }}>{t.contacts}</h1>
        <div style={{ position: 'relative', width: '280px' }}>
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
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} class="row">
                  <td class="name" style={{ padding: '12px 18px', fontWeight: 600, color: 'var(--navy)' }}>{r.fullName || '—'}</td>
                  <td style={{ padding: '12px 18px', color: 'var(--ink)' }}>{r.email ? <a href={`mailto:${r.email}`} style={{ color: 'var(--pri)', textDecoration: 'none' }}>{r.email}</a> : '—'}</td>
                  <td style={{ padding: '12px 18px', color: 'var(--mute)' }}>{r.phone || '—'}</td>
                  <td style={{ padding: '12px 18px', color: 'var(--mute)' }}>{r.custom?.title || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
