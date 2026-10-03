import type { Stage, Theme } from './types.ts';

const PALETTES: Record<Theme, string[]> = {
  rainbow: ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'],
  ocean: ['#0c4a6e', '#075985', '#0369a1', '#0284c7', '#0ea5e9', '#38bdf8', '#7dd3fc', '#0891b2'],
  forest: ['#14532d', '#166534', '#15803d', '#16a34a', '#22c55e', '#4ade80', '#65a30d', '#84cc16'],
  sunset: ['#7c2d12', '#c2410c', '#ea580c', '#f97316', '#fb923c', '#f59e0b', '#e11d48', '#be185d'],
  mono: ['#1f2937', '#374151', '#4b5563', '#6b7280', '#6b7280', '#4b5563', '#374151', '#1f2937'],
};
export const stageColor = (theme: Theme, stage: Stage, index: number): string => {
  if (stage.color) return stage.color;
  if (stage.isWon) return '#16a34a';
  if (stage.isLost) return '#6b7280';
  const p = PALETTES[theme] ?? PALETTES.rainbow;
  return p[index % p.length]!;
};
export const money = (v: number | null | undefined, cur: string, locale: string): string =>
  v == null ? '' : new Intl.NumberFormat(locale, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v);

/** Readable text colour (dark or white) for a given background, by WCAG contrast. */
export const ink = (hex: string): string => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return L > 0.4 ? '#111827' : '#ffffff';
};
