// The structured needs analysis and recommendation forms. The questions come from the server (one list for the screens, the checks and
// the sealed PDF), so this file only draws them. The live figures here are a guide; the server's calculation is the one that is kept.
import type { Locale } from './types.ts';

type L = Record<Locale, string>;
export interface FormField { key: string; type: 'money' | 'int' | 'text' | 'longtext' | 'bool' | 'check' | 'choice' | 'multi'; label: L; options?: { value: string; label: L }[]; max?: number }
export interface FormSection { key: string; title: L; fields: FormField[] }
export interface AdviceForm { needs: FormSection[]; recommendation: FormField[]; flags: Record<string, L> }
export type Answers = Record<string, unknown>;

const S = {
  'en': { yes: 'Yes', no: 'No', calc: 'Need calculation', total: 'Total need', existing: 'Cover in force and money available', gap: 'Gap to cover', guide: 'A guide while you type. The saved figures are calculated by PII.', below: 'The cover is below the calculated gap of', over: 'The premium is over the client’s monthly budget of', link: 'Needs analysis this answers', pick: 'Choose…', noNeeds: 'Add a needs analysis to this record first.', needsGap: 'Gap', budget: 'Budget', unsigned: 'not signed yet' },
  'fr-CA': { yes: 'Oui', no: 'Non', calc: 'Calcul du besoin', total: 'Besoin total', existing: 'Garanties en vigueur et fonds disponibles', gap: 'Écart à couvrir', guide: 'Un repère pendant la saisie. Les montants conservés sont calculés par PII.', below: 'La garantie est inférieure à l’écart calculé de', over: 'La prime dépasse le budget mensuel du client de', link: 'Analyse des besoins visée', pick: 'Choisir…', noNeeds: 'Ajoutez d’abord une analyse des besoins à ce dossier.', needsGap: 'Écart', budget: 'Budget', unsigned: 'pas encore signée' },
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const has = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
export const money = (v: number, locale: Locale) => v.toLocaleString(locale === 'fr-CA' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

/** Mirrors the server's capital-needs calculation, for live feedback only. */
export function liveCalc(a: Answers): { totalNeed: number; existing: number; gap: number } {
  const built = num(a.annualIncome) * num(a.incomeYears) + num(a.mortgage) + num(a.otherDebts) + num(a.finalExpenses) + num(a.educationFund) + num(a.otherNeeds);
  const totalNeed = has(a.needOverride) ? num(a.needOverride) : built;
  const existing = num(a.existingIndividual) + num(a.existingGroup) + num(a.liquidAssets);
  return { totalNeed, existing, gap: Math.max(0, totalNeed - existing) };
}

/** Which questions are on screen, given the answers so far (the same rules the server checks). */
function visible(sectionKey: string, f: FormField, a: Answers): boolean {
  const objectives = Array.isArray(a.objectives) ? (a.objectives as string[]) : [];
  if (sectionKey === 'risk') {
    const risk = a.productLine === 'annuity' || objectives.includes('savings_retirement');
    if (!risk) return false;
    if (['taxStatus', 'sourceOfFunds', 'financialExperience', 'liquidityNeeds'].includes(f.key)) return a.productLine === 'annuity' || f.key === 'liquidityNeeds';
  }
  if (f.key === 'replacingNote') return a.replacing === true;
  if (f.key === 'conflictNote') return a.hasConflict === true;
  if (f.key === 'needOverrideReason') return has(a.needOverride);
  if (f.key === 'clientAcknowledgement') return a.clientDecision === 'accepted_less' || a.clientDecision === 'declined';
  if (f.key === 'incomeYears' && a.productLine === 'annuity') return false;
  return true;
}

function Field({ f, value, set, locale, missing }: { f: FormField; value: unknown; set: (v: unknown) => void; locale: Locale; missing: boolean }) {
  const s = S[locale];
  const lbl = <>{f.label[locale]}{missing && <span style={{ color: '#b3261e' }} aria-hidden="true"> *</span>}</>;
  const style = missing ? { outline: '1px solid #f2b8b5', borderRadius: '8px' } : undefined;
  switch (f.type) {
    case 'money': case 'int':
      return <label class="fld">{lbl}<input type="number" min={0} step={f.type === 'int' ? 1 : 'any'} inputMode="decimal" value={value === undefined ? '' : String(value)} style={style}
        onInput={(e) => { const v = (e.target as HTMLInputElement).value; set(v === '' ? undefined : Number(v)); }} /></label>;
    case 'text':
      return <label class="fld">{lbl}<input maxLength={500} value={String(value ?? '')} style={style} onInput={(e) => set((e.target as HTMLInputElement).value || undefined)} /></label>;
    case 'longtext':
      return <label class="fld">{lbl}<textarea rows={3} maxLength={4000} value={String(value ?? '')} style={{ width: '100%', ...(style ?? {}) }} onInput={(e) => set((e.target as HTMLTextAreaElement).value || undefined)} /></label>;
    case 'check':
      return <label class="check" style={{ display: 'block', margin: '0 0 8px', ...(style ?? {}) }}><input type="checkbox" checked={value === true} onChange={(e) => set((e.target as HTMLInputElement).checked)} /> {lbl}</label>;
    case 'bool':
      return <fieldset class="fld" style={{ border: 0, padding: 0, ...(style ?? {}) }}><legend>{lbl}</legend>
        <label class="check" style={{ marginRight: '14px' }}><input type="radio" name={f.key} checked={value === true} onChange={() => set(true)} /> {s.yes}</label>
        <label class="check"><input type="radio" name={f.key} checked={value === false} onChange={() => set(false)} /> {s.no}</label></fieldset>;
    case 'choice':
      return <label class="fld">{lbl}<select value={String(value ?? '')} style={style} onChange={(e) => set((e.target as HTMLSelectElement).value || undefined)}>
        <option value="">{s.pick}</option>{(f.options ?? []).map((o) => <option value={o.value}>{o.label[locale]}</option>)}</select></label>;
    case 'multi': {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return <fieldset class="fld" style={{ border: 0, padding: 0, ...(style ?? {}) }}><legend>{lbl}</legend>
        {(f.options ?? []).map((o) => <label class="check" style={{ display: 'block' }}><input type="checkbox" checked={cur.includes(o.value)} onChange={(e) => {
          const on = (e.target as HTMLInputElement).checked; const next = on ? [...cur, o.value] : cur.filter((x) => x !== o.value); set(next.length ? next : undefined);
        }} /> {o.label[locale]}</label>)}</fieldset>;
    }
  }
}

/** The needs analysis, section by section, with the calculation as you type. `missing` marks what the server still needs. */
export function NeedsForm({ form, value, onChange, locale, missing = [] }: { form: AdviceForm; value: Answers; onChange: (a: Answers) => void; locale: Locale; missing?: string[] }) {
  const s = S[locale];
  const c = liveCalc(value);
  return (
    <div>
      {form.needs.map((sec) => {
        const fields = sec.fields.filter((f) => visible(sec.key, f, value));
        if (!fields.length) return null;
        return (
          <fieldset key={sec.key} style={{ border: '1px solid var(--line2, #e5e7eb)', borderRadius: '10px', padding: '10px 12px', margin: '0 0 12px' }}>
            <legend style={{ fontWeight: 700, padding: '0 6px' }}>{sec.title[locale]}</legend>
            {fields.map((f) => <Field key={f.key} f={f} value={value[f.key]} locale={locale} missing={missing.includes(f.key)} set={(v) => { const n = { ...value }; if (v === undefined) delete n[f.key]; else n[f.key] = v; onChange(n); }} />)}
            {sec.key === 'calculation' && (
              <div role="status" style={{ background: 'var(--tint, #f3f4f6)', borderRadius: '8px', padding: '8px 10px' }}>
                <strong>{s.calc}</strong>
                <div>{s.total}: {money(c.totalNeed, locale)} · {s.existing}: {money(c.existing, locale)} · <strong>{s.gap}: {money(c.gap, locale)}</strong></div>
                <small class="muted">{s.guide}</small>
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

export interface NeedsOption { id: string; title: string; signed: boolean; gap: number | null; budget: number | null }
/** The recommendation, tied to the needs analysis it answers, with a warning when it falls short of the need or over the budget. */
export function RecommendationForm({ form, value, onChange, locale, missing = [], needs, linked, onLink }: { form: AdviceForm; value: Answers; onChange: (a: Answers) => void; locale: Locale; missing?: string[]; needs: NeedsOption[]; linked: string; onLink: (id: string) => void }) {
  const s = S[locale];
  const na = needs.find((n) => n.id === linked);
  const below = na?.gap != null && has(value.coverageAmount) && value.clientDecision !== 'declined' && num(value.coverageAmount) < na.gap;
  const over = na?.budget != null && has(value.monthlyPremium) && num(value.monthlyPremium) > na.budget;
  return (
    <div>
      {needs.length === 0 ? <p class="err" role="alert">{s.noNeeds}</p> : (
        <label class="fld">{s.link}<select value={linked} onChange={(e) => onLink((e.target as HTMLSelectElement).value)}>
          <option value="">{s.pick}</option>
          {needs.map((n) => <option value={n.id}>{n.title}{n.signed ? '' : ` (${s.unsigned})`}{n.gap != null ? ` · ${s.needsGap} ${money(n.gap, locale)}` : ''}{n.budget != null ? ` · ${s.budget} ${money(n.budget, locale)}` : ''}</option>)}
        </select></label>
      )}
      {form.recommendation.filter((f) => visible('rec', f, value)).map((f) => <Field key={f.key} f={f} value={value[f.key]} locale={locale} missing={missing.includes(f.key)} set={(v) => { const n = { ...value }; if (v === undefined) delete n[f.key]; else n[f.key] = v; onChange(n); }} />)}
      {below && <p role="status" style={{ color: '#8a5a00' }}>⚠ {s.below} {money(na!.gap!, locale)}.</p>}
      {over && <p role="status" style={{ color: '#8a5a00' }}>⚠ {s.over} {money(na!.budget!, locale)}.</p>}
    </div>
  );
}
