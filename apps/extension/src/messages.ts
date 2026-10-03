export interface ApiRequest { type: 'pii:api'; method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown }
export interface ApiResponse { status: number; json: any }
export interface OpenSignIn { type: 'pii:signin' }
export type Message = ApiRequest | OpenSignIn;
