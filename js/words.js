// Hand-checked syllable splits. "-" separates syllables, "|" adds an accepted alternative split
// (dictionaries and phonics programs sometimes disagree). Level is derived from the syllable count,
// so a word can never be filed under the wrong level.
const LIST = [
  // 2 syllables (easy)
  'rab-bit', 'sun-set', 'pic-nic', 'bas-ket', 'pen-cil', 'sis-ter', 'win-ter', 'mon-key', 'pup-py', 'tur-tle',
  'ta-ble', 'ti-ger', 'pa-per', 'spi-der', 'ro-bot|rob-ot', 'cot-ton', 'kit-ten', 'but-ter', 'dol-lar', 'sum-mer',
  'lad-der', 'hap-py', 'fun-ny', 'can-dy', 'mar-ket', 'gar-den', 'cir-cus', 'dra-gon', 'pi-rate', 'wiz-ard',
  'cas-tle', 'jun-gle', 'pur-ple', 'rain-bow', 'cup-cake', 'foot-ball', 'pan-cake', 'sand-wich', 'lem-on',
  'mag-net', 'nap-kin', 'pump-kin', 'rock-et', 'gi-ant', 'pi-lot', 'mu-sic', 'si-lent', 'o-pen', 'fro-zen',
  'li-on', 'ze-bra', 'po-ny', 'ba-by', 'lit-tle', 'yel-low', 'can-yon', 'pret-zel', 'but-ton', 'flow-er',
  'sil-ver', 'puz-zle', 'bub-ble', 'ham-mer', 'tun-nel', 'wag-on', 'mir-ror', 'pen-guin', 'dol-phin', 'mon-ster',
  'tur-key',
  // 3 syllables (medium)
  'el-e-phant', 'com-put-er|com-pu-ter', 'but-ter-fly', 'di-no-saur', 'hos-pi-tal', 'ba-na-na', 'to-ma-to',
  'po-ta-to', 'to-mor-row', 'yes-ter-day', 'va-ca-tion', 'car-ni-val', 'choc-o-late|cho-co-late', 'ham-bur-ger',
  'kan-ga-roo', 'cu-cum-ber', 'dan-ger-ous', 'fa-vor-ite', 'ad-ven-ture', 'beau-ti-ful', 'won-der-ful',
  'ex-cit-ed', 'an-i-mal', 'fam-i-ly', 'cal-en-dar', 'dif-fer-ent', 'im-por-tant', 'in-ter-est', 're-mem-ber',
  'sep-tem-ber', 'dec-em-ber', 'um-brel-la', 'i-de-a', 'cap-i-tal', 'ho-ri-zon', 'vol-ca-no', 'mys-ter-y',
  'bi-cy-cle', 'oc-to-pus', 'croc-o-dile|cro-co-dile', 'por-cu-pine', 'un-hap-py', 'pa-ja-mas', 'sat-ur-day',
  'mu-se-um', 'va-nil-la', 'ra-di-o', 'to-geth-er', 'hol-i-day', 'de-li-cious', 'vi-o-lin', 'gro-cer-y',
  // 4+ syllables (hard)
  'in-sti-tu-tion', 'cel-e-bra-tion', 'im-pos-si-ble', 'un-be-liev-a-ble', 'ex-cep-tion-al', 'hel-i-cop-ter',
  'wa-ter-mel-on', 'al-li-ga-tor', 'dan-de-li-on', 'cat-er-pil-lar', 'math-e-mat-ics', 'vo-cab-u-lar-y',
  'im-ag-i-na-tion', 'ed-u-ca-tion', 'in-for-ma-tion', 'com-mu-ni-ty', 'tem-per-a-ture', 'ref-ri-ger-a-tor',
  'hip-po-pot-a-mus', 'en-vi-ron-ment', 'ex-per-i-ment', 'el-e-men-ta-ry', 'in-cred-i-ble', 'dic-tion-ar-y',
  'con-grat-u-la-tions', 'ad-ven-tur-ous', 'sci-en-tif-ic', 'ge-og-ra-phy', 'e-le-va-tor', 'ar-chi-tec-ture',
  'ma-te-ri-al', 'tel-e-vi-sion', 'li-brar-i-an', 'mul-ti-pli-ca-tion', 'pro-nun-ci-a-tion', 'dem-on-stra-tion',
  'or-gan-i-za-tion', 'un-der-stand-ing', 'ex-pe-ri-ence',
];

const VOWELS = 'aeiou';

function starts(parts) {
  const out = new Set();
  let n = 0;
  for (const p of parts) { out.add(n); n += p.length; }
  return out;
}

function parse(s) {
  const [main, ...alts] = s.split('|');
  const parts = main.split('-');
  const word = parts.join('');
  const altParts = alts.map((a) => a.split('-')).filter((a) => a.join('') === word);
  return {
    word,
    parts,
    alts: altParts,
    starts: starts(parts),
    syllables: parts.length,
    level: parts.length === 2 ? 'easy' : parts.length === 3 ? 'medium' : 'hard',
  };
}

export const WORDS = LIST.map(parse);

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

export function pickWord(level, maxLetters, recent = []) {
  let pool = WORDS.filter((w) => (level === 'mixed' || w.level === level));
  const fits = pool.filter((w) => w.word.length <= maxLetters);
  if (fits.length) pool = fits;
  const fresh = pool.filter((w) => !recent.includes(w.word));
  const src = fresh.length ? fresh : pool;
  return src[Math.floor(Math.random() * src.length)];
}
