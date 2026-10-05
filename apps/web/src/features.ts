/** Phase 1 ships the CRM only. Flip to true in Phase 2 to bring the learning side back everywhere at once. */
export const LMS = false;
export const lmsOnly = (id: string) => id === 'training' || id === 'trainer' || id === 'learner';
