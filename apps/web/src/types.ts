export type Locale = 'en' | 'fr-CA';
export interface Stage { id: string; name: string; position: number; color: string | null; isWon: boolean; isLost: boolean }
export interface FieldDef { id: string; key: string; labels: Record<string, string>; type: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | string; options: string[] | null; required: boolean; position: number }
export interface Pipeline { id: string; name: string; colorTheme: Theme; sharedDown: boolean; ownerNodeId: string; stages: Stage[]; fields: FieldDef[] }
export type Theme = 'rainbow' | 'ocean' | 'forest' | 'sunset' | 'mono';
export interface Box {
  id: string; pipelineId: string; stageId: string; ownerNodeId: string; contextNodeId: string; name: string;
  valueAmount: number | null; currency: string; closeDate: string | null; custom: Record<string, unknown>;
  updatedAt: string; createdAt: string; stageEnteredAt: string; lastEmailAt: string | null; lastEmailFrom: string | null; daysInStage: number; position: number;
}
export interface BoxEvent { id: string; kind: 'created' | 'stage_changed'; fromStage: string | null; toStage: string | null; createdAt: string }
export interface Me { needsConsent: boolean; user: { displayName: string | null; email: string; locale: Locale }; tenant: { name: string }; product: { name: string; logoUrl: string } }
export type Scope = 'all' | 'mine' | 'below';
export type SortKey = 'updated' | 'name' | 'value' | 'closeDate' | 'daysInStage' | 'created' | 'lastEmail';

export interface TransportResult { status: number; json: any }
/** How the app reaches the server. Standalone: fetch. Inside Gmail: a message to the extension's background worker. */
export type Transport = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<TransportResult>;
export interface HostOptions { transport: Transport; onSignIn: () => void; assetBase?: string }
