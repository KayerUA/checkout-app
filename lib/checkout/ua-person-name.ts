/**
 * Normalize UA person names before Shopify / Nova Poshta.
 *
 * NP Counterparty.save rejects Latin letters in FirstName/LastName
 * ("FirstName has invalid characters"). Checkout often gets:
 * - mixed Cyrillic + Latin lookalikes (Наталiя → Наталія)
 * - fully Latin names from autofill (Svitlana → Світлана)
 */

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

/** Latin glyphs that visually collide with Ukrainian Cyrillic. */
const HOMOGLYPH_MAP: Record<string, string> = {
  a: "а",
  A: "А",
  B: "В",
  c: "с",
  C: "С",
  e: "е",
  E: "Е",
  H: "Н",
  i: "і",
  I: "І",
  K: "К",
  M: "М",
  o: "о",
  O: "О",
  p: "р",
  P: "Р",
  T: "Т",
  x: "х",
  X: "Х",
  y: "у",
  Y: "У",
};

/** Digraphs first (Ukrainian passport-style Latin → Cyrillic). */
const TRANSLIT_DIGRAPHS: Array<[RegExp, string]> = [
  [/shch/gi, "щ"],
  [/sch/gi, "щ"],
  [/zh/gi, "ж"],
  [/kh/gi, "х"],
  [/ts/gi, "ц"],
  [/ch/gi, "ч"],
  [/sh/gi, "ш"],
  [/yo/gi, "йо"],
  [/ye/gi, "є"],
  [/yi/gi, "ї"],
  [/yu/gi, "ю"],
  [/ya/gi, "я"],
  [/je/gi, "є"],
  [/ju/gi, "ю"],
  [/ja/gi, "я"],
];

const TRANSLIT_SINGLE: Record<string, string> = {
  a: "а",
  b: "б",
  c: "к",
  d: "д",
  e: "е",
  f: "ф",
  g: "г",
  h: "х",
  i: "і",
  j: "й",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  q: "к",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  v: "в",
  w: "в",
  x: "кс",
  y: "и",
  z: "з",
};

function fixHomoglyphs(value: string): string {
  return value.replace(/[A-Za-z]/g, (ch) => HOMOGLYPH_MAP[ch] ?? ch);
}

function transliterateLatinToUkrainian(value: string): string {
  let out = value;
  for (const [re, repl] of TRANSLIT_DIGRAPHS) {
    out = out.replace(re, (match) =>
      match[0] === match[0].toUpperCase() ? repl.toUpperCase() : repl
    );
  }
  return out.replace(/[A-Za-z]/g, (ch) => {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT_SINGLE[lower];
    if (!mapped) return ch;
    if (ch === lower) return mapped;
    return mapped.length === 1 ? mapped.toUpperCase() : mapped[0].toUpperCase() + mapped.slice(1);
  });
}

/**
 * Returns a NP-safe person name. Preserves null/undefined; trims strings.
 */
export function normalizeUaPersonName(
  value: string | null | undefined
): string | null | undefined {
  if (value == null) return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (CYRILLIC_RE.test(trimmed) && LATIN_LETTER_RE.test(trimmed)) {
    return fixHomoglyphs(trimmed);
  }

  if (!CYRILLIC_RE.test(trimmed) && LATIN_LETTER_RE.test(trimmed)) {
    return transliterateLatinToUkrainian(trimmed);
  }

  return trimmed;
}
