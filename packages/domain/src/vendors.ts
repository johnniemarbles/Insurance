// Certified e-signature options for paperwork that must not use the built-in signature (beneficiary designations, replacements).
// Today PII records that a vendor signed and keeps the completed document and the vendor's reference. A live connection is a later step per vendor.
export const SIGNING_VENDORS = ['docusign', 'onespan', 'adobe_sign', 'notarius', 'carrier_eapp', 'dropbox_sign', 'signnow', 'other'] as const;
export type SigningVendor = (typeof SIGNING_VENDORS)[number];
export interface VendorInfo { id: SigningVendor; name: string; fit: 'main' | 'carrier' | 'budget' | 'other'; note: { en: string; 'fr-CA': string }; connected: boolean }
export const VENDOR_CATALOG: VendorInfo[] = [
  { id: 'docusign', name: 'DocuSign', fit: 'main', connected: false, note: { en: 'Most widely used; widely accepted by Life carriers. Confirm Canadian data residency on your plan.', 'fr-CA': 'Le plus répandu; largement accepté des assureurs vie. Confirmez la résidence des données au Canada selon votre forfait.' } },
  { id: 'onespan', name: 'OneSpan Sign', fit: 'main', connected: false, note: { en: 'Common with banks and insurers; strong audit trail. Check API access on your plan.', 'fr-CA': 'Courant chez les banques et assureurs; piste d’audit solide. Vérifiez l’accès à l’API selon votre forfait.' } },
  { id: 'adobe_sign', name: 'Adobe Acrobat Sign', fit: 'main', connected: false, note: { en: 'Widely accepted; often already licensed. Confirm the Canadian region and carrier acceptance.', 'fr-CA': 'Largement accepté; souvent déjà sous licence. Confirmez la région canadienne et l’acceptation par l’assureur.' } },
  { id: 'notarius', name: 'Notarius', fit: 'main', connected: false, note: { en: 'Canadian certification authority; strong in Quebec and for AMF-regulated files.', 'fr-CA': 'Autorité de certification canadienne; forte au Québec et pour les dossiers réglementés par l’AMF.' } },
  { id: 'carrier_eapp', name: 'Carrier e-application', fit: 'carrier', connected: false, note: { en: 'The Life carrier’s own signing. Often required and free. It happens outside PII; record the carrier’s confirmation and reference here.', 'fr-CA': 'La signature de l’assureur vie. Souvent exigée et gratuite. Elle se fait hors de PII; consignez ici la confirmation et la référence de l’assureur.' } },
  { id: 'dropbox_sign', name: 'Dropbox Sign', fit: 'budget', connected: false, note: { en: 'Lower cost, but less likely to be on a carrier’s approved list.', 'fr-CA': 'Moins coûteux, mais moins susceptible de figurer sur la liste approuvée d’un assureur.' } },
  { id: 'signnow', name: 'signNow', fit: 'budget', connected: false, note: { en: 'Lower cost, but less likely to be on a carrier’s approved list.', 'fr-CA': 'Moins coûteux, mais moins susceptible de figurer sur la liste approuvée d’un assureur.' } },
  { id: 'other', name: 'Other', fit: 'other', connected: false, note: { en: 'Any other certified vendor. Name it in the record.', 'fr-CA': 'Tout autre fournisseur certifié. Nommez-le dans le dossier.' } },
];
export const vendorName = (id: string | null | undefined): string => VENDOR_CATALOG.find((v) => v.id === id)?.name ?? (id ?? '');
