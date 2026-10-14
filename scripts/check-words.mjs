// Sanity checks for the word list. Run: node scripts/check-words.mjs
import { WORDS, isVowel, gapsOf, allowedSplits } from '../js/words.js';

let failed = 0;
const fail = (m) => { failed++; console.error('FAIL', m); };

const seen = new Set();
for (const e of WORDS) {
  if (seen.has(e.word)) fail(`duplicate word ${e.word}`);
  seen.add(e.word);
  if (e.parts.join('') !== e.word) fail(`parts do not join: ${e.parts}`);
  if (e.parts.some((p) => !p.length)) fail(`empty syllable in ${e.word}`);
  if (!/^[a-z]+$/.test(e.word)) fail(`non-lowercase letters in ${e.word}`);
  for (const alt of e.alts) if (alt.join('') !== e.word) fail(`alt does not join: ${alt}`);
  // every syllable needs a vowel sound
  e.parts.forEach((p, i) => {
    const off = e.parts.slice(0, i).join('').length;
    if (![...p].some((_, j) => isVowel(e, off + j))) fail(`syllable "${p}" in ${e.word} has no vowel`);
  });
  if (allowedSplits(e).length !== 1 + e.alts.length) fail(`allowedSplits mismatch ${e.word}`);
}

// y rule
const kinds = (w) => {
  const e = WORDS.find((x) => x.word === w);
  return [...w].map((c, i) => (isVowel(e, i) ? 'V' : 'c')).join('');
};
const checks = [['hap-py', 'cVccV'], ['yel-low', 'cVccVc'], ['can-yon', 'cVccVc'], ['mys-ter-y', 'cVccVcV']];
for (const [split, want] of checks) {
  const w = split.replace(/-/g, '');
  const got = kinds(w);
  if (got !== want) fail(`${w}: expected ${want} got ${got}`);
}

const counts = { easy: 0, medium: 0, hard: 0 };
WORDS.forEach((e) => counts[e.level]++);
console.log(`${WORDS.length} words`, counts, 'longest', Math.max(...WORDS.map((e) => e.word.length)));
if (gapsOf(['in', 'sti', 'tu', 'tion']).size !== 3) fail('gapsOf');
if (failed) { console.error(`${failed} problem(s)`); process.exit(1); }
console.log('word list OK');
