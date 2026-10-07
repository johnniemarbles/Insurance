import type { StarterQuestion } from './starter-courses.ts';
import { BANK_A } from './starter-banks-a.ts';
import { BANK_B } from './starter-banks-b.ts';
import { BANK_C } from './starter-banks-c.ts';

/** Extra quiz questions per starter course key. See starter-courses.ts: each quiz draws from the original questions plus these. */
export const STARTER_BANKS: Record<string, StarterQuestion[]> = { ...BANK_A, ...BANK_B, ...BANK_C };
