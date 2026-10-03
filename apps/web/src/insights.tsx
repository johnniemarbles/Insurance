import { useEffect, useRef, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Strings } from './i18n.ts';
import { money } from './theme.ts';
import type { Box, Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

export interface Report {
  stages: { stageId: string; name: string; isWon: boolean; isLost: boolean; count: number; value: number; avgDays: number; reached: number }[];
  weekly: { week: string; created: number }[];
  owners: { name: string; count: number; value: number; won: number }[];
  forecast: { month: string; count: number; value: number }[];
  totals: { open: number; openValue: number; won: number; wonValue: number; lost: number; winRate: number | null; daysToWin: number | null };
}

export type Viz = 'none' | 'pie' | 'column' | 'line';

/** Stage share as a donut or as columns, either by record count or by money. */
export function StageChart({ mode, data, t, locale, currency }: { mode: 'pie' | 'column'; data: { name: string; color: string; count: number; value: number }[]; t: Strings; locale: Locale; currency: string }) {
  const [metric, setMetric] = useState<'count' | 'value'>('count');
  const pick = (d: { count: number; value: number }) => (metric === 'count' ? d.count : d.value);
  const total = data.reduce((n, d) => n + pick(d), 0);
  const fmt = (n: number) => (metric === 'count' ? String(n) : money(n, currency, locale));
  return (
    <figure class="viz" aria-label={t.vizStage}>
      <div class="vizbar"><div class="seg" role="group" aria-label={t.vizMetric}>
        <button aria-pressed={metric === 'count'} onClick={() => setMetric('count')}>{t.vizCount}</button>
        <button aria-pressed={metric === 'value'} onClick={() => setMetric('value')}>{t.value}</button>
      </div></div>
      {total === 0 ? <p class="muted">{t.vizEmpty}</p> : mode === 'pie' ? <Donut data={data} pick={pick} total={total} fmt={fmt} /> : <Columns data={data} pick={pick} fmt={fmt} />}
    </figure>
  );
}

function Donut({ data, pick, total, fmt }: { data: { name: string; color: string; count: number; value: number }[]; pick: (d: any) => number; total: number; fmt: (n: number) => string }) {
  const R = 60, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div class="donut">
      <svg viewBox="0 0 160 160" width="170" height="170" role="img" aria-label={data.map((d) => `${d.name} ${fmt(pick(d))}`).join(', ')}>
        <g transform="rotate(-90 80 80)">
          {data.filter((d) => pick(d) > 0).map((d) => {
            const len = (pick(d) / total) * C;
            const el = <circle key={d.name} cx="80" cy="80" r={R} fill="none" stroke={d.color} stroke-width="26" stroke-dasharray={`${len} ${C - len}`} stroke-dashoffset={-acc} />;
            acc += len; return el;
          })}
        </g>
        <text x="80" y="86" text-anchor="middle" font-size="18" font-weight="600" fill="#111827">{fmt(total)}</text>
      </svg>
      <ul class="legend">{data.map((d) => <li key={d.name}><i style={{ background: d.color }} />{d.name} <b>{fmt(pick(d))}</b></li>)}</ul>
    </div>
  );
}

function Columns({ data, pick, fmt }: { data: { name: string; color: string; count: number; value: number }[]; pick: (d: any) => number; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map(pick));
  return (
    <div class="cols" role="img" aria-label={data.map((d) => `${d.name} ${fmt(pick(d))}`).join(', ')}>
      {data.map((d) => (
        <div class="colbar" key={d.name}>
          <span class="colval">{fmt(pick(d))}</span>
          <div class="colfill" style={{ height: `${Math.max(2, (pick(d) / max) * 100)}%`, background: d.color }} />
          <span class="collab" title={d.name}>{d.name}</span>
        </div>
      ))}
    </div>
  );
}

export function WeeklyLine({ weekly, t }: { weekly: Report['weekly']; t: Strings }) {
  const W = 560, H = 140, P = 24;
  const max = Math.max(1, ...weekly.map((w) => w.created));
  const pts = weekly.map((w, i) => [P + (i * (W - 2 * P)) / Math.max(1, weekly.length - 1), H - P - (w.created / max) * (H - 2 * P)] as const);
  return (
    <figure class="viz" aria-label={t.vizWeekly}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={weekly.map((w) => `${w.week}: ${w.created}`).join(', ')}>
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#e5e7eb" />
        <polyline fill="none" stroke="#1d4ed8" stroke-width="2.5" points={pts.map((p) => p.join(',')).join(' ')} />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#1d4ed8"><title>{`${weekly[i]!.week}: ${weekly[i]!.created}`}</title></circle>)}
        <text x={P} y={H - 6} font-size="11" fill="#6b7280">{weekly[0]?.week}</text>
        <text x={W - P} y={H - 6} font-size="11" text-anchor="end" fill="#6b7280">{weekly[weekly.length - 1]?.week}</text>
        <text x={W - P} y="14" font-size="11" text-anchor="end" fill="#6b7280">{t.vizMax(max)}</text>
      </svg>
    </figure>
  );
}

export function ReportsPanel({ pipelineId, scope, call, t, locale, colorOf, onClose }: { pipelineId: string; scope: string; call: Call; t: Strings; locale: Locale; colorOf: (id: string) => string; onClose: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', `/v1/pipelines/${pipelineId}/report?scope=${scope}`).then(setR, (e) => setErr((e as Error).message)); }, [call, pipelineId, scope]);
  const cur = 'CAD';
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={t.reports}>
      <h2>{t.reports}</h2>
      {err && <div class="err" role="alert">{err}</div>}
      {!r && !err && <p class="muted">{t.loading}</p>}
      {r && (
        <>
          <div class="kpis">
            <div><b>{r.totals.open}</b><span>{t.kOpen}</span><small>{money(r.totals.openValue, cur, locale)}</small></div>
            <div><b>{r.totals.won}</b><span>{t.kWon}</span><small>{money(r.totals.wonValue, cur, locale)}</small></div>
            <div><b>{r.totals.winRate == null ? '—' : pct(r.totals.winRate)}</b><span>{t.kWinRate}</span><small>{r.totals.lost} {t.kLost}</small></div>
            <div><b>{r.totals.daysToWin == null ? '—' : Math.round(r.totals.daysToWin)}</b><span>{t.kDaysToWin}</span></div>
          </div>
          <h3>{t.funnel}</h3>
          <div class="funnel">
            {r.stages.map((s, i) => {
              const top = Math.max(1, r.stages[0]!.reached);
              const prev = i > 0 ? r.stages[i - 1]!.reached : 0;
              return (
                <div class="frowx" key={s.stageId}>
                  <span class="fname">{s.name}</span>
                  <div class="fbarx"><i style={{ width: `${Math.max(2, (s.reached / top) * 100)}%`, background: colorOf(s.stageId) }} /></div>
                  <span class="fnum">{s.reached}{i > 0 && prev > 0 ? <small> · {pct(s.reached / prev)}</small> : null}</span>
                  <span class="fdays muted">{Math.round(s.avgDays)} {t.daysWord}</span>
                </div>
              );
            })}
          </div>
          <p class="muted">{t.funnelHelp}</p>
          <h3>{t.vizWeekly}</h3>
          <WeeklyLine weekly={r.weekly} t={t} />
          <h3>{t.forecast}</h3>
          <table class="mt"><thead><tr><th>{t.closeMonth}</th><th>{t.vizCount}</th><th>{t.value}</th></tr></thead>
            <tbody>{r.forecast.map((f) => <tr key={f.month}><td>{f.month || t.noCloseDate}</td><td>{f.count}</td><td>{money(f.value, cur, locale)}</td></tr>)}</tbody></table>
          <h3>{t.byOwner}</h3>
          <table class="mt"><thead><tr><th>{t.owner}</th><th>{t.vizCount}</th><th>{t.kWon}</th><th>{t.value}</th></tr></thead>
            <tbody>{r.owners.map((o) => <tr key={o.name}><td>{o.name}</td><td>{o.count}</td><td>{o.won}</td><td>{money(o.value, cur, locale)}</td></tr>)}</tbody></table>
        </>
      )}
      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
    </aside>
  );
}

interface FeedItem { id: string; kind: 'created' | 'stage_changed' | 'note'; at: string; boxId: string; boxName: string; actor: string | null; fromStage: string | null; toStage: string | null; body: string | null }
export function FeedPanel({ pipelineId, scope, call, t, locale, onOpen, onClose }: { pipelineId: string; scope: string; call: Call; t: Strings; locale: Locale; onOpen: (id: string) => void; onClose: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', `/v1/newsfeed?pipelineId=${pipelineId}&scope=${scope}&limit=60`).then((r) => setItems(r.items), (e) => setErr((e as Error).message)); }, [call, pipelineId, scope]);
  const line = (i: FeedItem) => i.kind === 'created' ? t.feedCreated(i.toStage) : i.kind === 'stage_changed' ? t.movedTo(i.fromStage, i.toStage) : t.feedNote;
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer" role="dialog" aria-label={t.newsfeed}>
      <h2>{t.newsfeed}</h2>
      {err && <div class="err" role="alert">{err}</div>}
      {items && items.length === 0 && <p class="muted">{t.feedEmpty}</p>}
      {items?.map((i) => (
        <div class="feed" key={`${i.kind}-${i.id}`}>
          <small class="muted">{new Date(i.at).toLocaleString(locale)} · {i.actor ?? '—'}</small>
          <div><button class="link" onClick={() => { onOpen(i.boxId); }}>{i.boxName}</button> — {line(i)}</div>
          {i.body && <blockquote>{i.body}</blockquote>}
        </div>
      ))}
      <div class="actions"><button class="btn quiet" onClick={onClose}>{t.close}</button></div>
    </aside>
  );
}

export interface PaletteAction { id: string; label: string; hint?: string; run: () => void }
/** Ctrl/Cmd+K: type to run an action, switch pipeline, or jump to a record. */
export function Palette({ actions, call, pipelineId, t, onPickBox, onClose }: { actions: PaletteAction[]; call: Call; pipelineId: string; t: Strings; onPickBox: (b: Box) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Box[]>([]);
  const [idx, setIdx] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const needle = text.trim().toLowerCase();
  useEffect(() => {
    if (needle.length < 2) { setFound([]); return; }
    let live = true;
    const h = setTimeout(() => { call('GET', `/v1/boxes?pipelineId=${pipelineId}&q=${encodeURIComponent(text.trim())}&limit=6&sorts=name:asc`).then((r) => live && setFound(r.boxes), () => undefined); }, 200);
    return () => { live = false; clearTimeout(h); };
  }, [text, pipelineId, call]);
  const acts = actions.filter((a) => !needle || a.label.toLowerCase().includes(needle));
  const rows: { key: string; label: string; hint?: string; run: () => void }[] = [
    ...acts.map((a) => ({ key: a.id, label: a.label, hint: a.hint, run: a.run })),
    ...found.map((b) => ({ key: `b-${b.id}`, label: b.name, hint: t.paletteRecord, run: () => onPickBox(b) })),
  ];
  const go = (r?: { run: () => void }) => { if (r) { onClose(); r.run(); } };
  return (
    <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="palette" role="dialog" aria-label={t.palette} ref={box}>
        <input
          autofocus ref={(el) => el?.focus()} role="combobox" aria-expanded="true" aria-controls="pii-pal" placeholder={t.palettePlaceholder} value={text}
          onInput={(e) => { setText((e.target as HTMLInputElement).value); setIdx(0); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(rows.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(rows[idx]); }
          }}
        />
        <div id="pii-pal" role="listbox">
          {rows.map((r, i) => (
            <button role="option" aria-selected={i === idx} class={`palrow${i === idx ? ' on' : ''}`} key={r.key} onMouseEnter={() => setIdx(i)} onClick={() => go(r)}>
              <span>{r.label}</span>{r.hint && <small>{r.hint}</small>}
            </button>
          ))}
          {rows.length === 0 && <div class="msg">{t.paletteNone}</div>}
        </div>
      </div>
    </div>
  );
}
