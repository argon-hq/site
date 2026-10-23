// The title's signature: a MinHash over its words, so the same fact told by two outlets — or by the
// same one two days later — is found without a model and without an embedding. A title is short,
// so the words themselves are the shingles; with 64 hashes the Jaccard estimate is within ~0.06.
export const SIGNATURE_SIZE = 64;

// Words that say nothing about the fact. Short on purpose: a word that carries the fact in one
// title must not vanish from every other.
const STOPWORDS = new Set(
  (
    "a as o os um uma uns umas de da das do dos e em no na nos nas por para pra pelo pela pelos pelas com sem " +
    "ao aos à às que se sua seu suas seus mais menos após ante até sobre entre como diz dizem segundo " +
    "é são foi será ser ter tem têm vai vão já ainda também isso esse essa este esta"
  ).split(" "),
);

// Lowercase, no accents, no punctuation, no stopwords, and a crude plural fold so `juros`/`juro` and
// `empresas`/`empresa` meet. Numbers stay: `12%` is often what makes two titles the same fact.
export function titleTokens(title: string): string[] {
  const words = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .split(" ")
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
  return [...new Set(words.map(fold))];
}

function fold(word: string): string {
  if (word.length > 4 && word.endsWith("oes")) return `${word.slice(0, -3)}ao`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// FNV-1a, 32 bits: fast, stable across runs and machines — the signature of an article published
// yesterday is compared against today's, so it must never depend on the process.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// One base hash per word, remixed with a seed per slot (murmur3's finalizer), keeping the minimum.
function mix(hash: number, seed: number): number {
  let h = (hash ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Signed 32-bit values, the shape a Postgres `integer[]` stores. An empty title has no signature.
export function titleSignature(title: string): number[] {
  const tokens = titleTokens(title);
  if (tokens.length === 0) return [];
  const bases = tokens.map(fnv1a);
  const signature: number[] = [];
  for (let slot = 0; slot < SIGNATURE_SIZE; slot++) {
    let min = 0xffffffff;
    for (const base of bases) min = Math.min(min, mix(base, slot + 1));
    signature.push(min | 0);
  }
  return signature;
}

// The estimated Jaccard similarity of two titles: the share of slots where the minimum agrees.
export function similarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== SIGNATURE_SIZE || b.length !== SIGNATURE_SIZE) return 0;
  let same = 0;
  for (let i = 0; i < SIGNATURE_SIZE; i++) if (a[i] === b[i]) same++;
  return same / SIGNATURE_SIZE;
}
