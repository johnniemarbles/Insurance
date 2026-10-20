export interface ApiRequest { type: 'pii:api'; method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown; region?: string }
export interface ApiResponse { status: number; json: any }
export interface OpenSignIn { type: 'pii:signin'; region?: string; keep?: boolean; hint?: string; fresh?: boolean }
/** Which server the Gmail page should frame, by the same rule API calls use. */
export interface BaseRequest { type: 'pii:base'; region?: string }
export type Message = ApiRequest | OpenSignIn | BaseRequest;
