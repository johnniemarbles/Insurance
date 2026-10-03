export interface TemplateField { key: string; labels: { en: string; 'fr-CA': string }; type: 'text' | 'number' | 'currency' | 'date' | 'dropdown'; options?: string[] }
export interface Template { id: string; name: { en: string; 'fr-CA': string }; about: { en: string; 'fr-CA': string }; stages: { name: string; isWon?: boolean; isLost?: boolean }[]; fields: TemplateField[] }

const F = (key: string, en: string, fr: string, type: TemplateField['type'], options?: string[]): TemplateField => ({ key, labels: { en, 'fr-CA': fr }, type, ...(options ? { options } : {}) });
const POLICY = ['Auto', 'Home', 'Life', 'Health', 'Commercial', 'Travel'];

export const TEMPLATES: Template[] = [
  {
    id: 'new-business', name: { en: 'New business', 'fr-CA': 'Nouvelles affaires' },
    about: { en: 'Leads from first contact to policy issued.', 'fr-CA': 'Des pistes jusqu’à l’émission de la police.' },
    stages: [{ name: 'New lead' }, { name: 'Contacted' }, { name: 'Quote sent' }, { name: 'Application' }, { name: 'Policy issued', isWon: true }, { name: 'Lost', isLost: true }],
    fields: [F('policy_type', 'Policy type', 'Type de police', 'dropdown', POLICY), F('lead_source', 'Lead source', 'Source de la piste', 'dropdown', ['Referral', 'Website', 'Walk-in', 'Event', 'Other']), F('premium', 'Annual premium', 'Prime annuelle', 'currency'), F('renewal_date', 'Renewal date', 'Date de renouvellement', 'date')],
  },
  {
    id: 'renewals', name: { en: 'Renewals', 'fr-CA': 'Renouvellements' },
    about: { en: 'Contact clients ahead of their renewal date.', 'fr-CA': 'Joindre les clients avant leur date de renouvellement.' },
    stages: [{ name: '90 days out' }, { name: '60 days out' }, { name: '30 days out' }, { name: 'Quote ready' }, { name: 'Renewed', isWon: true }, { name: 'Not renewed', isLost: true }],
    fields: [F('policy_type', 'Policy type', 'Type de police', 'dropdown', POLICY), F('insurer', 'Insurer', 'Assureur', 'text'), F('renewal_date', 'Renewal date', 'Date de renouvellement', 'date'), F('current_premium', 'Current premium', 'Prime actuelle', 'currency'), F('new_premium', 'New premium', 'Nouvelle prime', 'currency')],
  },
  {
    id: 'claims', name: { en: 'Claims follow-up', 'fr-CA': 'Suivi des réclamations' },
    about: { en: 'Keep every claim moving until it is closed.', 'fr-CA': 'Faire avancer chaque réclamation jusqu’à sa clôture.' },
    stages: [{ name: 'Reported' }, { name: 'Documents requested' }, { name: 'With insurer' }, { name: 'Settlement offered' }, { name: 'Closed', isWon: true }],
    fields: [F('claim_no', 'Claim number', 'Numéro de réclamation', 'text'), F('claim_type', 'Claim type', 'Type de réclamation', 'dropdown', ['Auto', 'Home', 'Liability', 'Health', 'Other']), F('date_of_loss', 'Date of loss', 'Date du sinistre', 'date'), F('insurer', 'Insurer', 'Assureur', 'text')],
  },
  {
    id: 'referrals', name: { en: 'Referral partners', 'fr-CA': 'Partenaires référents' },
    about: { en: 'Recruit and onboard partners who send you business.', 'fr-CA': 'Recruter et accueillir les partenaires qui vous réfèrent des clients.' },
    stages: [{ name: 'Identified' }, { name: 'Introduced' }, { name: 'Onboarding' }, { name: 'Active partner', isWon: true }, { name: 'Inactive', isLost: true }],
    fields: [F('partner_type', 'Partner type', 'Type de partenaire', 'dropdown', ['Broker', 'Accountant', 'Realtor', 'Lawyer', 'Community', 'Other']), F('region', 'Region', 'Région', 'text'), F('referrals', 'Referrals per month', 'Références par mois', 'number')],
  },
];
