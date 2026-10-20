// Structured needs analysis and recommendation: the fact-find the Code of Conduct asks for, the need calculation, the checks that make a
// file signable, the flags that send it to a compliance review, and how long a needs analysis stays current. Pure logic, shared by the
// server, the sealed PDF and the screens.
//
// Sources: PIA Compliance Manual (Feb 2026) — Broker Agreement "need-based selling process"; Code of Conduct: Sincerity (b) collect and
// analyse needs, objectives and financial circumstances and update them, (c) recommend what suits them, disclosure list, point-of-sale
// documents; Competence: adequate fact finding; Priority of Client Interest: complete analysis before any replacement; Client Service:
// periodic review; Manual §8 patterns in needs-based sales; §14 sampling of client files.

type L = { en: string; 'fr-CA': string };

export const PRODUCT_LINES = ['life_health', 'annuity'] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

export const OBJECTIVES = ['income_replacement', 'debt_payoff', 'final_expenses', 'education', 'estate', 'business', 'critical_illness', 'disability_income', 'health_dental', 'savings_retirement'] as const;
export type Objective = (typeof OBJECTIVES)[number];
/** Objectives that put money at market risk, so a risk profile is needed. */
const INVESTMENT_OBJECTIVES: readonly Objective[] = ['savings_retirement'];

export interface NeedsAnswers {
  productLine: ProductLine;
  // 1. Client profile
  maritalStatus?: 'single' | 'married' | 'common_law' | 'separated' | 'divorced' | 'widowed';
  dependants?: number; dependantsNote?: string; occupation?: string;
  // 2. Financial position
  annualIncome?: number; spouseIncome?: number; monthlyExpenses?: number; liquidAssets?: number; mortgage?: number; otherDebts?: number;
  // 3. Existing coverage
  existingIndividual?: number; existingGroup?: number; existingPolicies?: string; replacing?: boolean; replacingNote?: string;
  // 4. Objectives
  objectives?: Objective[]; objectivesNote?: string;
  // 5. Need calculation
  method?: 'capital_needs' | 'income_multiple' | 'dime' | 'other'; incomeYears?: number; finalExpenses?: number; educationFund?: number; otherNeeds?: number;
  needOverride?: number; needOverrideReason?: string;
  // 6. Budget
  monthlyBudget?: number;
  // 7. Risk and suitability (investment-linked products and annuities)
  riskTolerance?: 'low' | 'medium' | 'high'; horizonYears?: number; liquidityNeeds?: string;
  taxStatus?: 'qualified' | 'non_qualified'; sourceOfFunds?: string; financialExperience?: 'none' | 'limited' | 'moderate' | 'extensive';
  // 8. Disclosures made to the client
  licenceDisclosed?: boolean; insurersDisclosed?: boolean; compensationDisclosed?: boolean; conflictsDisclosed?: boolean; hasConflict?: boolean; conflictNote?: string;
  // 9. Advisor attestation
  advisorLicence?: string; advisorProvince?: string; attestation?: boolean;
}

export interface RecommendationAnswers {
  product?: string; insurer?: string; coverageAmount?: number; monthlyPremium?: number;
  reasons?: string; alternatives?: string;
  clientDecision?: 'accepted' | 'accepted_less' | 'declined'; clientAcknowledgement?: string;
  illustrationDelivered?: boolean; summaryDelivered?: boolean; applicationCopyDelivered?: boolean;
}

export type NaFieldType = 'money' | 'int' | 'text' | 'longtext' | 'bool' | 'check' | 'choice' | 'multi';
export interface FormField { key: string; type: NaFieldType; label: L; options?: readonly { value: string; label: L }[]; max?: number }
export interface FormSection { key: string; title: L; fields: readonly FormField[] }

const o = (value: string, en: string, fr: string) => ({ value, label: { en, 'fr-CA': fr } });
const f = (key: string, type: NaFieldType, en: string, fr: string, extra: Partial<FormField> = {}): FormField => ({ key, type, label: { en, 'fr-CA': fr }, ...extra });

export const OBJECTIVE_LABELS: Record<Objective, L> = {
  income_replacement: { en: 'Replace income for the family', 'fr-CA': 'Remplacer le revenu pour la famille' },
  debt_payoff: { en: 'Pay off the mortgage and debts', 'fr-CA': 'Rembourser l’hypothèque et les dettes' },
  final_expenses: { en: 'Final expenses', 'fr-CA': 'Frais funéraires' },
  education: { en: 'Children’s education', 'fr-CA': 'Études des enfants' },
  estate: { en: 'Estate and taxes', 'fr-CA': 'Succession et impôts' },
  business: { en: 'Business needs', 'fr-CA': 'Besoins d’entreprise' },
  critical_illness: { en: 'Critical illness cover', 'fr-CA': 'Assurance maladies graves' },
  disability_income: { en: 'Income if disabled', 'fr-CA': 'Revenu en cas d’invalidité' },
  health_dental: { en: 'Health and dental', 'fr-CA': 'Soins de santé et dentaires' },
  savings_retirement: { en: 'Savings or retirement income', 'fr-CA': 'Épargne ou revenu de retraite' },
};

/** The needs analysis form, in the order a client meeting runs. The screens and the sealed PDF are both drawn from this. */
export const NEEDS_SECTIONS: readonly FormSection[] = [
  { key: 'profile', title: { en: 'Client profile', 'fr-CA': 'Profil du client' }, fields: [
    f('productLine', 'choice', 'Type of advice', 'Type de conseil', { options: [o('life_health', 'Life, critical illness, disability or health', 'Vie, maladies graves, invalidité ou santé'), o('annuity', 'Annuity', 'Rente')] }),
    f('maritalStatus', 'choice', 'Marital status', 'État civil', { options: [o('single', 'Single', 'Célibataire'), o('married', 'Married', 'Marié(e)'), o('common_law', 'Common-law', 'Conjoint de fait'), o('separated', 'Separated', 'Séparé(e)'), o('divorced', 'Divorced', 'Divorcé(e)'), o('widowed', 'Widowed', 'Veuf ou veuve')] }),
    f('dependants', 'int', 'Number of dependants', 'Nombre de personnes à charge', { max: 30 }),
    f('dependantsNote', 'text', 'About the dependants (ages, needs)', 'Personnes à charge (âges, besoins)'),
    f('occupation', 'text', 'Occupation', 'Profession'),
  ] },
  { key: 'finances', title: { en: 'Financial position', 'fr-CA': 'Situation financière' }, fields: [
    f('annualIncome', 'money', 'Client’s yearly income', 'Revenu annuel du client'),
    f('spouseIncome', 'money', 'Spouse’s yearly income', 'Revenu annuel du conjoint'),
    f('monthlyExpenses', 'money', 'Monthly household expenses', 'Dépenses mensuelles du ménage'),
    f('liquidAssets', 'money', 'Savings and investments available', 'Épargne et placements disponibles'),
    f('mortgage', 'money', 'Mortgage owing', 'Solde hypothécaire'),
    f('otherDebts', 'money', 'Other debts', 'Autres dettes'),
  ] },
  { key: 'coverage', title: { en: 'Existing coverage', 'fr-CA': 'Garanties existantes' }, fields: [
    f('existingIndividual', 'money', 'Individual life cover in force', 'Assurance vie individuelle en vigueur'),
    f('existingGroup', 'money', 'Group life cover (work)', 'Assurance vie collective (travail)'),
    f('existingPolicies', 'longtext', 'Policies in force (carrier, type, amount)', 'Polices en vigueur (assureur, type, montant)'),
    f('replacing', 'bool', 'Will any of this be replaced, lapsed or surrendered?', 'Une de ces polices sera-t-elle remplacée, résiliée ou rachetée?'),
    f('replacingNote', 'longtext', 'Which policy, and why replacing is in the client’s interest', 'Quelle police, et pourquoi le remplacement sert l’intérêt du client'),
  ] },
  { key: 'objectives', title: { en: 'Objectives', 'fr-CA': 'Objectifs' }, fields: [
    f('objectives', 'multi', 'What the client wants to achieve', 'Ce que le client veut accomplir', { options: OBJECTIVES.map((k) => ({ value: k, label: OBJECTIVE_LABELS[k] })) }),
    f('objectivesNote', 'longtext', 'In the client’s words', 'Selon les mots du client'),
  ] },
  { key: 'calculation', title: { en: 'Need calculation', 'fr-CA': 'Calcul du besoin' }, fields: [
    f('method', 'choice', 'Method', 'Méthode', { options: [o('capital_needs', 'Capital needs', 'Besoins en capital'), o('income_multiple', 'Income multiple', 'Multiple du revenu'), o('dime', 'DIME (debt, income, mortgage, education)', 'DIME (dettes, revenu, hypothèque, études)'), o('other', 'Other', 'Autre')] }),
    f('incomeYears', 'int', 'Years of income to replace', 'Années de revenu à remplacer', { max: 50 }),
    f('finalExpenses', 'money', 'Final expenses', 'Frais funéraires'),
    f('educationFund', 'money', 'Education fund', 'Fonds pour les études'),
    f('otherNeeds', 'money', 'Other needs', 'Autres besoins'),
    f('needOverride', 'money', 'Total need, if you set it yourself', 'Besoin total, si vous le fixez vous-même'),
    f('needOverrideReason', 'text', 'Why you set the total yourself', 'Pourquoi vous avez fixé le total vous-même'),
  ] },
  { key: 'budget', title: { en: 'Budget', 'fr-CA': 'Budget' }, fields: [
    f('monthlyBudget', 'money', 'What the client can pay each month', 'Ce que le client peut payer par mois'),
  ] },
  { key: 'risk', title: { en: 'Risk and suitability', 'fr-CA': 'Risque et convenance' }, fields: [
    f('riskTolerance', 'choice', 'Risk tolerance', 'Tolérance au risque', { options: [o('low', 'Low', 'Faible'), o('medium', 'Medium', 'Moyenne'), o('high', 'High', 'Élevée')] }),
    f('horizonYears', 'int', 'Time horizon (years)', 'Horizon de placement (années)', { max: 80 }),
    f('liquidityNeeds', 'text', 'Need for access to the money', 'Besoin d’accès aux fonds'),
    f('taxStatus', 'choice', 'Tax status of the money', 'Statut fiscal des fonds', { options: [o('qualified', 'Registered / qualified', 'Enregistré / admissible'), o('non_qualified', 'Non-registered / non-qualified', 'Non enregistré / non admissible')] }),
    f('sourceOfFunds', 'text', 'Source of the money', 'Provenance des fonds'),
    f('financialExperience', 'choice', 'Investment experience', 'Expérience en placement', { options: [o('none', 'None', 'Aucune'), o('limited', 'Limited', 'Limitée'), o('moderate', 'Moderate', 'Moyenne'), o('extensive', 'Extensive', 'Étendue')] }),
  ] },
  { key: 'disclosure', title: { en: 'Disclosures made', 'fr-CA': 'Divulgations faites' }, fields: [
    f('licenceDisclosed', 'check', 'I told the client my licence and registration', 'J’ai indiqué au client mon permis et mon inscription'),
    f('insurersDisclosed', 'check', 'I told the client which insurers I represent', 'J’ai indiqué au client les assureurs que je représente'),
    f('compensationDisclosed', 'check', 'I told the client how I am paid', 'J’ai indiqué au client mon mode de rémunération'),
    f('conflictsDisclosed', 'check', 'I disclosed any conflict of interest', 'J’ai divulgué tout conflit d’intérêts'),
    f('hasConflict', 'bool', 'Is there a conflict of interest?', 'Y a-t-il un conflit d’intérêts?'),
    f('conflictNote', 'text', 'The conflict, and the client’s written acceptance', 'Le conflit et l’acceptation écrite du client'),
  ] },
  { key: 'attestation', title: { en: 'Advisor', 'fr-CA': 'Conseiller' }, fields: [
    f('advisorLicence', 'text', 'Licence number', 'Numéro de permis'),
    f('advisorProvince', 'text', 'Province or state of the licence', 'Province ou État du permis'),
    f('attestation', 'check', 'I made a diligent effort to gather and analyse this client’s needs, objectives and finances', 'J’ai fait un effort diligent pour recueillir et analyser les besoins, objectifs et finances de ce client'),
  ] },
];

export const RECOMMENDATION_FIELDS: readonly FormField[] = [
  f('product', 'text', 'Product recommended', 'Produit recommandé'),
  f('insurer', 'text', 'Insurer', 'Assureur'),
  f('coverageAmount', 'money', 'Amount of cover', 'Montant de la garantie'),
  f('monthlyPremium', 'money', 'Monthly premium', 'Prime mensuelle'),
  f('reasons', 'longtext', 'Why this meets the need found', 'Pourquoi ce choix répond au besoin établi'),
  f('alternatives', 'longtext', 'Other options considered and why not chosen', 'Autres options examinées et pourquoi elles n’ont pas été retenues'),
  f('clientDecision', 'choice', 'Client’s decision', 'Décision du client', { options: [o('accepted', 'Accepted the recommendation', 'A accepté la recommandation'), o('accepted_less', 'Chose less than recommended', 'A choisi moins que recommandé'), o('declined', 'Declined', 'A refusé')] }),
  f('clientAcknowledgement', 'longtext', 'Client’s acknowledgement of choosing less or declining', 'Reconnaissance du client d’avoir choisi moins ou refusé'),
  f('illustrationDelivered', 'check', 'Illustration given to the client', 'Illustration remise au client'),
  f('summaryDelivered', 'check', 'Product summary or information folder given', 'Sommaire ou fiche de renseignements remis'),
  f('applicationCopyDelivered', 'check', 'Copy of the application given', 'Copie de la proposition remise'),
];

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const has = (v: unknown) => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' ? v.trim().length > 0 : typeof v === 'boolean' ? true : Array.isArray(v) ? v.length > 0 : false);

export interface NeedCalc { totalNeed: number; existing: number; gap: number }
/** Capital-needs style: income for the years chosen plus debts and one-off costs, less cover in force and money already available. */
export function calcNeed(a: NeedsAnswers): NeedCalc {
  const built = n(a.annualIncome) * n(a.incomeYears) + n(a.mortgage) + n(a.otherDebts) + n(a.finalExpenses) + n(a.educationFund) + n(a.otherNeeds);
  const totalNeed = has(a.needOverride) ? n(a.needOverride) : built;
  const existing = n(a.existingIndividual) + n(a.existingGroup) + n(a.liquidAssets);
  return { totalNeed, existing, gap: Math.max(0, totalNeed - existing) };
}

export const needsRiskProfileRequired = (a: NeedsAnswers) => a.productLine === 'annuity' || (a.objectives ?? []).some((x) => INVESTMENT_OBJECTIVES.includes(x));

/** What still has to be filled in before the client can sign. Empty means signable. */
export function missingNeeds(a: NeedsAnswers): string[] {
  const out: string[] = [];
  const need = (k: keyof NeedsAnswers) => { if (!has(a[k])) out.push(k); };
  const tick = (k: keyof NeedsAnswers) => { if (a[k] !== true) out.push(k); };
  need('maritalStatus'); need('dependants'); need('occupation');
  need('annualIncome'); need('monthlyExpenses');
  need('existingIndividual'); need('existingGroup'); need('replacing');
  if (a.replacing === true) need('replacingNote');
  need('objectives');
  need('method');
  if (a.productLine !== 'annuity' && !has(a.needOverride)) need('incomeYears');
  if (has(a.needOverride)) need('needOverrideReason');
  need('monthlyBudget');
  if (needsRiskProfileRequired(a)) { need('riskTolerance'); need('horizonYears'); }
  if (a.productLine === 'annuity') { need('liquidityNeeds'); need('taxStatus'); need('sourceOfFunds'); need('financialExperience'); }
  tick('licenceDisclosed'); tick('insurersDisclosed'); tick('compensationDisclosed'); tick('conflictsDisclosed');
  if (a.hasConflict === true) need('conflictNote');
  need('advisorLicence'); need('advisorProvince'); tick('attestation');
  return out;
}

export function missingRecommendation(r: RecommendationAnswers): string[] {
  const out: string[] = [];
  for (const k of ['product', 'insurer', 'coverageAmount', 'monthlyPremium', 'reasons', 'alternatives', 'clientDecision'] as const) if (!has(r[k])) out.push(k);
  if (r.clientDecision === 'accepted_less' || r.clientDecision === 'declined') { if (!has(r.clientAcknowledgement)) out.push('clientAcknowledgement'); }
  for (const k of ['illustrationDelivered', 'summaryDelivered', 'applicationCopyDelivered'] as const) if (r[k] !== true) out.push(k);
  return out;
}

export const ADVICE_FLAGS = ['below_need', 'over_budget', 'replacement', 'client_chose_less', 'need_overridden'] as const;
export type AdviceFlag = (typeof ADVICE_FLAGS)[number];
export const ADVICE_FLAG_LABELS: Record<AdviceFlag, L> = {
  below_need: { en: 'Cover is below the calculated need', 'fr-CA': 'La garantie est inférieure au besoin calculé' },
  over_budget: { en: 'Premium is over the client’s budget', 'fr-CA': 'La prime dépasse le budget du client' },
  replacement: { en: 'Replaces existing coverage', 'fr-CA': 'Remplace une garantie existante' },
  client_chose_less: { en: 'Client chose less or declined', 'fr-CA': 'Le client a choisi moins ou a refusé' },
  need_overridden: { en: 'Need set by the advisor, not calculated', 'fr-CA': 'Besoin fixé par le conseiller, non calculé' },
};

/** What a compliance reviewer should look at. A recommendation is judged against the needs analysis it answers. */
export function adviceFlags(na: NeedsAnswers | null, rec: RecommendationAnswers | null): AdviceFlag[] {
  const out = new Set<AdviceFlag>();
  if (na?.replacing === true) out.add('replacement');
  if (na && has(na.needOverride)) out.add('need_overridden');
  if (na && rec) {
    if (rec.clientDecision !== 'declined' && has(rec.coverageAmount) && n(rec.coverageAmount) < calcNeed(na).gap) out.add('below_need');
    if (has(rec.monthlyPremium) && has(na.monthlyBudget) && n(rec.monthlyPremium) > n(na.monthlyBudget)) out.add('over_budget');
  }
  if (rec && (rec.clientDecision === 'accepted_less' || rec.clientDecision === 'declined')) out.add('client_chose_less');
  return [...out];
}

export type ReviewReason = 'flagged' | 'new_advisor' | 'random' | 'requested';
/** Manual §8 and §14: every flagged file and every file from an advisor in their first days is reviewed; the rest are sampled. */
export function reviewReasonFor(i: { flags: readonly string[]; advisorDays: number; samplePct: number; roll: number; newAdvisorDays?: number }): ReviewReason | null {
  if (i.flags.length > 0) return 'flagged';
  if (i.advisorDays < (i.newAdvisorDays ?? 90)) return 'new_advisor';
  if (i.roll * 100 < i.samplePct) return 'random';
  return null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** The day a needs analysis signed on `signed` stops being current, `months` later (month ends clamp: 31 Jan + 1 month = 28 Feb). */
export function validUntil(signed: Date, months: number): string {
  const y = signed.getUTCFullYear(), m = signed.getUTCMonth() + months, d = signed.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return ymd(new Date(Date.UTC(y, m, Math.min(d, last))));
}
export const isNaCurrent = (until: string | null, now: Date = new Date()) => until === null || ymd(now) <= until;

/** Plain-language names for the checks, for error messages. */
export function fieldLabel(key: string, locale: 'en' | 'fr-CA' = 'en'): string {
  for (const s of NEEDS_SECTIONS) for (const x of s.fields) if (x.key === key) return x.label[locale];
  for (const x of RECOMMENDATION_FIELDS) if (x.key === key) return x.label[locale];
  return key;
}

const NEEDS_FIELDS: readonly FormField[] = NEEDS_SECTIONS.flatMap((s) => s.fields);
/** Keeps only known answers of the right shape; anything else is dropped. Money and counts are whole, non-negative numbers. */
function clean(fields: readonly FormField[], raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const x of fields) {
    const v = src[x.key];
    if (v === undefined || v === null || v === '') continue;
    switch (x.type) {
      case 'money': case 'int': {
        const num = typeof v === 'string' ? Number(v) : v;
        if (typeof num === 'number' && Number.isFinite(num) && num >= 0 && num <= (x.type === 'int' ? (x.max ?? 1000) : 1e11)) out[x.key] = x.type === 'int' ? Math.round(num) : Math.round(num * 100) / 100;
        break;
      }
      case 'text': if (typeof v === 'string' && v.trim()) out[x.key] = v.trim().slice(0, 500); break;
      case 'longtext': if (typeof v === 'string' && v.trim()) out[x.key] = v.trim().slice(0, 4000); break;
      case 'bool': case 'check': if (typeof v === 'boolean') out[x.key] = v; break;
      case 'choice': if (typeof v === 'string' && x.options?.some((p) => p.value === v)) out[x.key] = v; break;
      case 'multi': if (Array.isArray(v)) { const ok = [...new Set(v.filter((y): y is string => typeof y === 'string' && !!x.options?.some((p) => p.value === y)))]; if (ok.length) out[x.key] = ok; } break;
    }
  }
  return out;
}
export function cleanNeeds(raw: unknown): NeedsAnswers {
  const a = clean(NEEDS_FIELDS, raw) as unknown as NeedsAnswers;
  if (!a.productLine) a.productLine = 'life_health';
  return a;
}
export const cleanRecommendation = (raw: unknown): RecommendationAnswers => clean(RECOMMENDATION_FIELDS, raw) as RecommendationAnswers;

/** A one-paragraph summary for the record list and for older screens that show only the wording. */
export function needsSummary(a: NeedsAnswers, locale: 'en' | 'fr-CA' = 'en'): string {
  const c = calcNeed(a);
  const goals = (a.objectives ?? []).map((k) => OBJECTIVE_LABELS[k][locale]).join(', ');
  const money = (v: number) => v.toLocaleString(locale === 'fr-CA' ? 'fr-CA' : 'en-CA', { maximumFractionDigits: 0 });
  return locale === 'fr-CA'
    ? `Objectifs : ${goals || '—'}. Besoin total ${money(c.totalNeed)}, garanties et avoirs ${money(c.existing)}, écart ${money(c.gap)}. Budget mensuel ${money(n(a.monthlyBudget))}.${a.replacing ? ' Remplacement prévu.' : ''}`
    : `Goals: ${goals || '—'}. Total need ${money(c.totalNeed)}, cover and assets ${money(c.existing)}, gap ${money(c.gap)}. Monthly budget ${money(n(a.monthlyBudget))}.${a.replacing ? ' A replacement is planned.' : ''}`;
}
export function recommendationSummary(r: RecommendationAnswers): string {
  return `${r.product ?? '—'} with ${r.insurer ?? '—'}: cover ${n(r.coverageAmount).toLocaleString('en-CA')}, premium ${n(r.monthlyPremium).toLocaleString('en-CA')} a month. ${r.reasons ?? ''}`.trim();
}
