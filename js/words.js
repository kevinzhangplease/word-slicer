// Hand-checked syllable splits (Canadian spelling). "-" separates syllables, "+" separates the two words of
// a compound word, "|" adds an accepted alternative split (dictionaries and phonics programs sometimes
// disagree). Level is derived from the syllable count, so a word can never be filed under the wrong level.
const LIST = [
  // 2 syllables (easy)
  'rab-bit', 'sun+set', 'pic-nic', 'bas-ket', 'pen-cil', 'sis-ter', 'win-ter', 'mon-key', 'pup-py', 'tur-tle',
  'ta-ble', 'ti-ger', 'pa-per', 'spi-der', 'ro-bot|rob-ot', 'cot-ton', 'kit-ten', 'but-ter', 'dol-lar', 'sum-mer',
  'lad-der', 'hap-py', 'fun-ny', 'can-dy', 'mar-ket', 'gar-den', 'cir-cus', 'drag-on|dra-gon', 'pi-rate', 'wiz-ard',
  'cas-tle', 'jun-gle', 'pur-ple', 'rain+bow', 'cup+cake', 'foot+ball', 'pan+cake', 'sand+wich', 'lem-on',
  'mag-net', 'nap-kin', 'pump-kin', 'rock-et', 'gi-ant', 'pi-lot', 'mu-sic', 'si-lent', 'o-pen', 'fro-zen',
  'li-on', 'ze-bra', 'po-ny', 'ba-by', 'lit-tle', 'yel-low', 'can-yon', 'pret-zel', 'but-ton', 'flow-er',
  'sil-ver', 'puz-zle', 'bub-ble', 'ham-mer', 'tun-nel', 'wag-on', 'mir-ror', 'pen-guin', 'dol-phin', 'mon-ster',
  'tur-key', 'hock-ey', 'ma-ple', 'ca-noe', 'bea-ver', 'neigh-bour', 'har-bour',
  // 3 syllables (medium)
  'el-e-phant', 'com-put-er|com-pu-ter', 'but-ter+fly', 'di-no-saur', 'hos-pi-tal', 'ba-na-na', 'to-ma-to',
  'po-ta-to', 'to-mor-row', 'yes-ter+day', 'va-ca-tion', 'car-ni-val', 'choc-o-late|cho-co-late', 'ham-bur-ger',
  'kan-ga-roo', 'cu-cum-ber', 'dan-ger-ous', 'fa-vour-ite', 'ad-ven-ture', 'beau-ti-ful', 'won-der-ful',
  'ex-cit-ed', 'an-i-mal', 'fam-i-ly', 'cal-en-dar', 'dif-fer-ent', 'im-por-tant', 'in-ter-est', 're-mem-ber',
  'sep-tem-ber', 'dec-em-ber', 'um-brel-la', 'i-de-a', 'cap-i-tal', 'ho-ri-zon', 'vol-ca-no', 'mys-ter-y',
  'bi-cy-cle', 'oc-to-pus', 'croc-o-dile|cro-co-dile', 'por-cu-pine', 'un-hap-py', 'py-ja-mas', 'sat-ur-day',
  'mu-se-um', 'va-nil-la', 'ra-di-o', 'to-geth-er', 'hol-i-day', 'de-li-cious', 'vi-o-lin', 'gro-cer-y',
  'to-bog-gan', 'car-i-bou', 'col-our-ful',
  // 4+ syllables (hard)
  'in-sti-tu-tion', 'cel-e-bra-tion', 'im-pos-si-ble', 'un-be-liev-a-ble', 'ex-cep-tion-al', 'hel-i-cop-ter',
  'wa-ter+mel-on', 'al-li-ga-tor', 'dan-de-li-on', 'cat-er-pil-lar', 'math-e-mat-ics', 'vo-cab-u-lar-y',
  'im-ag-i-na-tion', 'ed-u-ca-tion', 'in-for-ma-tion', 'com-mu-ni-ty', 'tem-per-a-ture', 'ref-ri-ger-a-tor',
  'hip-po-pot-a-mus', 'en-vi-ron-ment', 'ex-per-i-ment', 'el-e-men-ta-ry', 'in-cred-i-ble', 'dic-tion-ar-y',
  'con-grat-u-la-tions', 'ad-ven-tur-ous', 'sci-en-tif-ic', 'ge-og-ra-phy', 'e-le-va-tor', 'ar-chi-tec-ture',
  'ma-te-ri-al', 'tel-e-vi-sion', 'li-brar-i-an', 'mul-ti-pli-ca-tion', 'pro-nun-ci-a-tion', 'dem-on-stra-tion',
  'or-gan-i-za-tion', 'un-der+stand-ing', 'ex-pe-ri-ence',
];

const VOWELS = 'aeiou';

function starts(parts) {
  const out = new Set();
  let n = 0;
  for (const p of parts) { out.add(n); n += p.length; }
  return out;
}

// One line of the list (or of a custom list): "but-ter+fly", "ro-bot|rob-ot".
// Returns { entry } or { error } with a message a parent can act on.
export function parseLine(raw) {
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return { error: 'empty line' };
  if (!/^[a-z+|-]+$/.test(s)) return { error: `"${raw.trim()}": use only letters, "-" between syllables (and "+" between the words of a compound)` };
  const [main, ...alts] = s.split('|');
  const parts = main.split(/[-+]/);
  if (parts.some((p) => !p)) return { error: `"${raw.trim()}": a syllable is empty (check for "--" or a "-" at the start or end)` };
  const word = parts.join('');
  const compound = new Set();
  let n = 0;
  for (const tok of main.split(/(?=[-+])/)) {
    if (tok[0] === '+') compound.add(n);
    n += tok.replace(/^[-+]/, '').length;
  }
  const altParts = [];
  for (const a of alts) {
    const ap = a.split(/[-+]/);
    if (ap.join('') !== word || ap.some((p) => !p)) return { error: `"${raw.trim()}": the alternative "${a}" does not spell ${word}` };
    altParts.push(ap);
  }
  return {
    entry: {
      word,
      parts,
      alts: altParts,
      compound,
      starts: starts(parts),
      syllables: parts.length,
      level: parts.length <= 2 ? 'easy' : parts.length === 3 ? 'medium' : 'hard',
    },
  };
}

export const WORDS = LIST.map((s) => parseLine(s).entry);

// Words a parent or teacher typed in (or sent with ?words=...). Set by the game.
let CUSTOM = [];
export function setCustom(entries) { CUSTOM = entries; }
export function customWords() { return CUSTOM; }

export function parseList(text) {
  const entries = [];
  const errors = [];
  const seen = new Set();
  for (const line of String(text).split(/[\n,]+/)) {
    if (!line.trim()) continue;
    const r = parseLine(line);
    if (r.error) errors.push(r.error);
    else if (!seen.has(r.entry.word)) { seen.add(r.entry.word); entries.push(r.entry); }
  }
  return { entries, errors };
}

// Gap i sits between letter i-1 and letter i. A split is the set of gaps that are cut.
export function gapsOf(parts) {
  const gaps = new Set();
  let n = 0;
  for (let i = 0; i < parts.length - 1; i++) { n += parts[i].length; gaps.add(n); }
  return gaps;
}

export function allowedSplits(entry) {
  return [gapsOf(entry.parts), ...entry.alts.map(gapsOf)];
}

// "y" is a consonant when it starts a syllable and a vowel follows (yel-low, can-yon);
// otherwise it acts as a vowel (hap-py, gym). "w" is always treated as a consonant.
export function isVowel(entry, i) {
  const ch = entry.word[i];
  if (VOWELS.includes(ch)) return true;
  if (ch !== 'y') return false;
  const next = entry.word[i + 1];
  return !(entry.starts.has(i) && next && VOWELS.includes(next));
}

// ---------- why a split is where it is ----------
const DIGRAPHS = ['ph', 'th', 'sh', 'ch', 'ck', 'wh', 'qu', 'ng', 'gh'];
const TEAMS = ['ai', 'ay', 'ea', 'ee', 'oa', 'oo', 'ou', 'ow', 'oi', 'oy', 'ew', 'aw', 'au', 'ey', 'ie', 'ue', 'eau'];
const SUFFIXES = ['tion', 'sion', 'ture', 'cious', 'tious'];

function partAround(entry, gap) {
  let n = 0;
  for (let i = 0; i < entry.parts.length; i++) {
    n += entry.parts[i].length;
    if (n === gap) return { left: entry.parts[i], right: entry.parts[i + 1], index: i };
  }
  return null;
}

// A hint for each rule that points at the pattern without giving the answer away.
export const TIPS = {
  compound: 'Is this word made of two little words? Cut between them.',
  cle: 'Does it end in a consonant + "le"? That consonant goes with the "le".',
  suffix: 'Endings like "tion" and "ture" stay together in one piece.',
  team: 'Two vowels that make one sound (a vowel team) stay in the same piece.',
  double: 'See a double letter? Cut between the two.',
  vccv: 'Find two consonants standing between two vowels. Cut between the consonants.',
  open: 'One consonant between two vowels? Try cutting before it, so the first vowel says its name.',
  closed: 'One consonant between two vowels, and the first vowel sounds short? The consonant stays with it.',
  vv: 'Two vowels side by side that make separate sounds? Cut between them.',
};

// The phonics rule behind one syllable break of the word's main split, in kid language.
// Returns { id, text } where text uses the word's own letters ("rab | bit").
export function ruleFor(entry, gap) {
  const r = classify(entry, gap);
  return r && { ...r, tip: TIPS[r.id] };
}

function classify(entry, gap) {
  const around = partAround(entry, gap);
  if (!around) return null;
  const { left, right, index } = around;
  const ex = `${left} | ${right}`;
  const L = entry.word[gap - 1];
  const R = entry.word[gap];
  const vL = isVowel(entry, gap - 1);
  const vR = isVowel(entry, gap);
  if (entry.compound && entry.compound.has(gap)) {
    // the two little words: everything up to this gap, and everything after it up to the next compound join
    const after = [...entry.compound].filter((g) => g > gap).sort((a, b) => a - b)[0] || entry.word.length;
    const before = [...entry.compound].filter((g) => g < gap).sort((a, b) => b - a)[0] || 0;
    return { id: 'compound', text: `It is two little words stuck together, so split between them: ${entry.word.slice(before, gap)} | ${entry.word.slice(gap, after)}` };
  }
  if (index === entry.parts.length - 2 && /^[^aeiouy]le$/.test(right)) {
    return { id: 'cle', text: `A word ending in "-${right.slice(1)}" takes the consonant before it: ${ex}` };
  }
  const suf = SUFFIXES.find((s) => right.startsWith(s));
  if (suf) return { id: 'suffix', text: `"${suf}" is a chunk that stays together: ${ex}` };
  const team = TEAMS.find((t) => left.endsWith(t));
  if (team) return { id: 'team', text: `"${team}" makes one vowel sound, so it stays in one piece: ${ex}` };
  if (L === R && !vL) return { id: 'double', text: `Split between the double letters: ${ex}` };
  if (!vL && !vR) return { id: 'vccv', text: `Two consonants stand between the vowels, so split between them: ${ex}` };
  if (vL && !vR) return { id: 'open', text: `The first part ends with its vowel (an open syllable), so the vowel often says its name: ${ex}` };
  if (!vL && vR) return { id: 'closed', text: `The consonant stays with the vowel before it and closes it in (a closed syllable): ${ex}` };
  return { id: 'vv', text: `Two vowels side by side that make separate sounds get split: ${ex}` };
}

// Why a cut at `gap` is wrong, given all current cuts.
export function mistakeFor(entry, gap, cuts) {
  const w = entry.word;
  const pair = w.slice(gap - 1, gap + 1);
  if (DIGRAPHS.includes(pair)) return `"${pair}" makes one sound, so keep it together.`;
  if (TEAMS.some((t) => t.length === 2 && t === pair) || w.slice(gap - 2, gap + 1) === 'eau' || w.slice(gap - 1, gap + 2) === 'eau') {
    return `"${pair}" is a vowel team that makes one sound, so keep it together.`;
  }
  const bounds = [0, ...[...cuts].sort((a, b) => a - b), w.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i] !== gap && bounds[i + 1] !== gap) continue;
    let hasVowel = false;
    for (let j = bounds[i]; j < bounds[i + 1]; j++) if (isVowel(entry, j)) hasVowel = true;
    const piece = w.slice(bounds[i], bounds[i + 1]);
    if (!hasVowel) return `"${piece}" has no vowel sound, and every syllable needs one.`;
  }
  return `There is no syllable break between "${w[gap - 1]}" and "${w[gap]}" here.`;
}

export function pickWord(level, maxLetters, recent = []) {
  let pool = level === 'custom' ? CUSTOM.slice() : WORDS.filter((w) => (level === 'mixed' || w.level === level));
  if (!pool.length) pool = WORDS.slice();
  const fits = pool.filter((w) => w.word.length <= maxLetters);
  if (fits.length) pool = fits;
  const fresh = pool.filter((w) => !recent.includes(w.word));
  const src = fresh.length ? fresh : pool;
  return src[Math.floor(Math.random() * src.length)];
}
