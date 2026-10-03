import { useState } from 'preact/hooks';
import { money, stageColor } from './theme.ts';
import type { Strings } from './i18n.ts';
import type { Box, Locale, Pipeline } from './types.ts';

/** Columns per stage; drag a card to another column (or between cards) to move it. */
export function Board({ pipeline, boxes, summary, t, locale, onOpen, onMove }: {
  pipeline: Pipeline; boxes: Box[]; summary: Record<string, { count: number; value: number }>; t: Strings; locale: Locale;
  onOpen: (id: string) => void; onMove: (boxId: string, stageId: string, position: number) => void;
}) {
  const [drag, setDrag] = useState('');
  const [over, setOver] = useState('');
  const by = new Map<string, Box[]>();
  for (const s of pipeline.stages) by.set(s.id, []);
  for (const b of boxes) by.get(b.stageId)?.push(b);
  for (const list of by.values()) list.sort((a, b) => a.position - b.position || b.updatedAt.localeCompare(a.updatedAt));

  const drop = (stageId: string, beforeId?: string) => {
    const id = drag; setDrag(''); setOver('');
    if (!id) return;
    const list = (by.get(stageId) ?? []).filter((b) => b.id !== id);
    let pos: number;
    const i = beforeId ? list.findIndex((b) => b.id === beforeId) : -1;
    if (i === -1) pos = (list[list.length - 1]?.position ?? 0) + 1;
    else pos = i === 0 ? list[0]!.position - 1 : (list[i - 1]!.position + list[i]!.position) / 2;
    onMove(id, stageId, pos);
  };

  return (
    <div class="board">
      {pipeline.stages.map((s, i) => {
        const color = stageColor(pipeline.colorTheme, s, i);
        const list = by.get(s.id) ?? [];
        const sum = summary[s.id];
        return (
          <section class={`col${over === s.id ? ' over' : ''}`} key={s.id} aria-label={s.name}
            onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver((o) => (o === s.id ? '' : o))}
            onDrop={(e) => { e.preventDefault(); drop(s.id); }}>
            <header style={{ borderTopColor: color }}>
              <b>{s.name}</b>
              <span>{sum?.count ?? list.length}{sum && sum.value > 0 ? ` · ${money(sum.value, list[0]?.currency ?? 'CAD', locale)}` : ''}</span>
            </header>
            {list.map((b) => (
              <article class="card" draggable tabIndex={0} key={b.id} onClick={() => onOpen(b.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(b.id); }}
                onDragStart={() => setDrag(b.id)} onDragEnd={() => { setDrag(''); setOver(''); }}
                onDragOver={(e) => { if (drag) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop(s.id, b.id); }}>
                <div class="cname">{b.name}</div>
                <div class="cmeta">
                  <span>{money(b.valueAmount, b.currency, locale)}</span>
                  <span class={`age${b.daysInStage >= 30 ? ' bad' : b.daysInStage >= 14 ? ' warn' : ''}`}>{b.daysInStage === 0 ? t.today : t.days(b.daysInStage)}</span>
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
