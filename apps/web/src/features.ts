/** The learning side: courses, CE tracking and the compliance officer view. */
export const LMS = true;
export const lmsOnly = (id: string) => id === 'training' || id === 'trainer' || id === 'learner';
