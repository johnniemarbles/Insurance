export interface ApiRequest { type: 'pii:api'; method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown; region?: string }
export interface ApiResponse { status: number; json: any }
export interface OpenSignIn { type: 'pii:signin'; region?: string; keep?: boolean }
export type Message = ApiRequest | OpenSignIn;
