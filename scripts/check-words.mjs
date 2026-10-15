// Sanity checks for the word list. Run: node scripts/check-words.mjs
import { WORDS, isVowel, gapsOf, allowedSplits, ruleFor, mistakeFor, parseList, parseLine } from '../js/words.js';

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

// every syllable break has a rule, and the rule is the expected one for clear cases
const ruleIds = {};
for (const e of WORDS) {
  for (const g of gapsOf(e.parts)) {
    const r = ruleFor(e, g);
    if (!r) fail(`no rule for ${e.word} gap ${g}`);
    else ruleIds[r.id] = (ruleIds[r.id] || 0) + 1;
  }
}
const ruleOf = (w, gap) => ruleFor(WORDS.find((x) => x.word === w), gap).id;
const want = [['rabbit', 3, 'double'], ['tiger', 2, 'open'], ['table', 2, 'cle'], ['lemon', 3, 'closed'],
  ['lion', 2, 'vv'], ['rainbow', 4, 'compound'], ['vacation', 4, 'suffix'], ['pencil', 3, 'vccv'], ['flower', 4, 'team']];
for (const [w, g, id] of want) if (ruleOf(w, g) !== id) fail(`${w} gap ${g}: expected ${id}, got ${ruleOf(w, g)}`);
const ele = WORDS.find((x) => x.word === 'elephant');
if (!/ph/.test(mistakeFor(ele, 4, new Set([4])))) fail('elephant cut inside "ph" should explain the digraph');
if (!/no vowel/.test(mistakeFor(WORDS.find((x) => x.word === 'basket'), 2, new Set([2, 3])))) fail('"s" alone should be called out as having no vowel');

// custom lists
const pl = parseList('but-ter+fly\nro-bot|rob-ot\nhel lo\nbad--word\nx1-y\n\nsun+set, rab-bit');
if (pl.entries.length !== 5) fail(`custom list: expected 5 good words, got ${pl.entries.map((e) => e.word)}`);
if (pl.errors.length !== 2) fail(`custom list: expected 2 errors, got ${pl.errors}`);
if (!parseLine('rob-ot|ro-bat').error) fail('alternative that spells a different word must be rejected');
if (WORDS.some((e) => /favor|pajam/.test(e.word))) fail('US spelling left in the list');
console.log('rules:', ruleIds);

const counts = { easy: 0, medium: 0, hard: 0 };
WORDS.forEach((e) => counts[e.level]++);
console.log(`${WORDS.length} words`, counts, 'longest', Math.max(...WORDS.map((e) => e.word.length)));
if (gapsOf(['in', 'sti', 'tu', 'tion']).size !== 3) fail('gapsOf');
if (failed) { console.error(`${failed} problem(s)`); process.exit(1); }
console.log('word list OK');
