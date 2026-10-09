import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_COURSES } from '../src/starter-courses.ts';
import { STARTER_BANKS } from '../src/starter-banks.ts';

// A quiz that can be passed by picking the longest answer teaches nothing. The right answer may be a little longer, never a lot.
const MAX_RATIO = 1.25;
const all = () => {
  const out: { where: string; q: any }[] = [];
  for (const c of STARTER_COURSES) for (const q of c.quiz) out.push({ where: c.key, q });
  for (const [k, qs] of Object.entries(STARTER_BANKS)) for (const q of qs) out.push({ where: `${k} (bank)`, q });
  return out;
};
test('starter quizzes: the right answer is not noticeably longer than the wrong ones, in either language', () => {
  const bad: string[] = [];
  for (const { where, q } of all()) {
    for (const lang of ['en', 'fr'] as const) {
      const L = q.options.map((o: any) => String(o[lang]).length);
      const right = L[q.correct]; const wrong = Math.max(...L.filter((_: number, i: number) => i !== q.correct));
      if (right > wrong * MAX_RATIO) bad.push(`${where} [${lang}] "${String(q.options[q.correct][lang]).slice(0, 50)}" ${right} vs ${wrong}`);
    }
  }
  assert.equal(bad.length, 0, `${bad.length} questions give the answer away by length:\n${bad.join('\n')}`);
});
