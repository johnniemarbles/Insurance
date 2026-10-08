/** Fictional mailbox for the demo inbox. Times are hours before now so the inbox always looks current. */
export interface DemoMsg { id: string; from: { name: string; email: string }; hoursAgo: number; body: string; attachments?: string[] }
export interface DemoThread { /** The shared address the email was sent to; the sidebar suggests a pipeline from it. */ via: string; id: string; lang: 'en' | 'fr'; unread: boolean; subject: string; messages: DemoMsg[] }

const p = (name: string, email: string) => ({ name, email });
const S = {
  anita: p('Anita Verma', 'anita.verma@example.com'), raj: p('Raj Malhotra', 'raj.malhotra@example.com'), chloe: p('Chloe Bennett', 'chloe.bennett@example.com'),
  omar: p('Omar Haddad', 'omar.haddad@example.com'), priya: p('Priya Raman', 'priya.raman@example.com'), tom: p('Tom Okafor', 'tom.okafor@example.com'),
  mei: p('Mei Lin', 'mei.lin@example.com'), harjit: p('Harjit Brar', 'harjit.brar@example.com'), camille: p('Camille Gauthier', 'camille.gauthier@example.com'),
  mathieu: p('Mathieu Fortin', 'mathieu.fortin@example.com'), sofia: p('Sofia Alvarez', 'sofia.alvarez@example.com'),
};

export const DEMO_THREADS: DemoThread[] = [
  { via: 'supervisa@maple-demo.example.com', id: 'demo-inbox-1', lang: 'en', unread: true, subject: 'Super Visa insurance for my parents', messages: [
    { id: 'm1a', from: S.anita, hoursAgo: 3, body: 'Hello,\n\nMy parents (ages 63 and 66) are arriving from Chandigarh on 12 December for 14 months. We need Super Visa insurance with at least $100,000 of emergency coverage. My father takes medication for blood pressure and my mother has no conditions.\n\nCould you send me a few options with monthly payment plans? We would like to apply for the visa by next week.\n\nThank you,\nAnita Verma' },
  ] },
  { via: 'travel@maple-demo.example.com', id: 'demo-inbox-2', lang: 'en', unread: true, subject: 'Re: Quote for visitor insurance, mother arriving in March', messages: [
    { id: 'm2a', from: S.raj, hoursAgo: 30, body: 'Hi, I would like a quote for my mother (age 71) visiting Toronto for 5 months starting 3 March. She is healthy but has had a knee replacement three years ago. Please include trip interruption.\n\nRaj' },
    { id: 'm2b', from: S.raj, hoursAgo: 5, body: 'Following up on this. Another broker quoted $1,420 for the same dates. Can you match or explain the difference in coverage?\n\nRaj' },
  ] },
  { via: 'travel@maple-demo.example.com', id: 'demo-inbox-3', lang: 'en', unread: false, subject: 'Policy documents received, thank you', messages: [
    { id: 'm3a', from: S.chloe, hoursAgo: 52, body: 'Thanks for sending the policy documents this morning. Just confirming the coverage starts on the 18th and that my husband is also covered as a second traveller. Also, how do I make a claim if we need medical care abroad?\n\nChloe', attachments: ['Policy-confirmation.pdf'] },
  ] },
  { via: 'life@maple-demo.example.com', id: 'demo-inbox-4', lang: 'en', unread: true, subject: 'Term life 20 years: what would it cost?', messages: [
    { id: 'm4a', from: S.omar, hoursAgo: 8, body: 'Good afternoon. I am 38, non-smoker, two kids, mortgage of about $480,000. I am looking at $750,000 of term life for 20 years, and possibly living benefits. Could we book a call this week? I am free Thursday after 4pm.\n\nOmar Haddad' },
  ] },
  { via: 'travel@maple-demo.example.com', id: 'demo-inbox-5', lang: 'en', unread: false, subject: 'Renewal reminder: annual multi-trip plan', messages: [
    { id: 'm5a', from: S.priya, hoursAgo: 80, body: 'Hi, my annual multi-trip plan renews next month. I travel to the UK and India about four times a year. Can you check whether a higher deductible would lower the premium, and send the renewal quote?\n\nPriya' },
    { id: 'm5b', from: S.priya, hoursAgo: 26, body: 'Also, I will be adding my daughter (age 19, studying abroad) to the plan. Do I need a separate student policy?\n\nPriya' },
  ] },
  { via: 'life@maple-demo.example.com', id: 'demo-inbox-6', lang: 'en', unread: true, subject: 'Group health benefits for a 9-person company', messages: [
    { id: 'm6a', from: S.tom, hoursAgo: 14, body: 'Hello, we run a small landscaping company with nine employees and no benefits plan yet. We want health and dental, maybe a small life component. Budget is roughly $150 per employee per month. What are the next steps and what information do you need from us?\n\nTom Okafor\nGreen Row Landscaping' },
  ] },
  { via: 'travel@maple-demo.example.com', id: 'demo-inbox-7', lang: 'en', unread: false, subject: 'Student insurance: arriving in September', messages: [
    { id: 'm7a', from: S.mei, hoursAgo: 120, body: 'Hi, I am an international student starting at UBC in September. My university plan does not cover my spouse. Can you quote a plan for her for 12 months, with no pre-existing conditions?\n\nMei Lin' },
  ] },
  { via: 'travel@maple-demo.example.com', id: 'demo-inbox-8', lang: 'en', unread: false, subject: 'Payment confirmation, policy 4471-TR', messages: [
    { id: 'm8a', from: S.harjit, hoursAgo: 200, body: 'I paid the premium by e-transfer this morning, reference HB-20931. Please confirm you received it and send the final documents when ready.\n\nHarjit', attachments: ['etransfer-receipt.png'] },
  ] },
  { via: 'travel@maple-demo.example.com', id: 'demo-inbox-9', lang: 'fr', unread: true, subject: 'Assurance voyage: demande de soumission', messages: [
    { id: 'm9a', from: S.camille, hoursAgo: 6, body: 'Bonjour,\n\nNous partons en famille (2 adultes, 2 enfants de 8 et 11 ans) en Floride du 20 décembre au 3 janvier. Pouvez-vous nous envoyer une soumission d’assurance voyage avec annulation de voyage? Mon conjoint prend des médicaments pour le cholestérol.\n\nMerci,\nCamille Gauthier' },
  ] },
  { via: 'life@maple-demo.example.com', id: 'demo-inbox-10', lang: 'fr', unread: false, subject: 'Renouvellement de ma police', messages: [
    { id: 'm10a', from: S.mathieu, hoursAgo: 70, body: 'Bonjour, ma police d’assurance vie arrive à échéance le mois prochain. Est-ce possible de la renouveler avec une prime plus basse? Mes besoins ont changé depuis que mes enfants sont partis de la maison.\n\nMathieu Fortin' },
  ] },
  { via: 'supervisa@maple-demo.example.com', id: 'demo-inbox-11', lang: 'en', unread: false, subject: 'Question about the stability period', messages: [
    { id: 'm11a', from: S.sofia, hoursAgo: 150, body: 'Hi, my father was recently prescribed a new medication. Does this affect the stability period for his Super Visa policy? He arrives in six weeks and we want to avoid a denied claim.\n\nSofia Alvarez' },
  ] },
];
