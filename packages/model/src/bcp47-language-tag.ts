/**
 * Language tags supported by the ocrmac OCR engine (via docling-serve).
 * These are the only tags that can be passed to the Docling pipeline without
 * triggering "Invalid language preference" errors.
 */
export const BCP47_LANGUAGE_TAGS = [
  'ar-SA',
  'ars-SA',
  'cs-CZ',
  'da-DK',
  'de-DE',
  'en-US',
  'es-ES',
  'fr-FR',
  'id-ID',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'ms-MY',
  'nb-NO',
  'nl-NL',
  'nn-NO',
  'no-NO',
  'pl-PL',
  'pt-BR',
  'ro-RO',
  'ru-RU',
  'sv-SE',
  'th-TH',
  'tr-TR',
  'uk-UA',
  'vi-VT',
  'yue-Hans',
  'yue-Hant',
  'zh-Hans',
  'zh-Hant',
] as const;

/** Union type of all supported BCP 47 language tags */
export type Bcp47LanguageTag = (typeof BCP47_LANGUAGE_TAGS)[number];

/** Set for O(1) lookup of valid BCP 47 tags */
export const BCP47_LANGUAGE_TAG_SET: ReadonlySet<string> = new Set(
  BCP47_LANGUAGE_TAGS,
);

/** Check whether a string is a valid BCP 47 language tag */
export function isValidBcp47Tag(tag: string): tag is Bcp47LanguageTag {
  return BCP47_LANGUAGE_TAG_SET.has(tag);
}

/**
 * Maps bare language codes to their default BCP 47 tag.
 * Used when VLM returns only a language code without a region subtag.
 */
const DEFAULT_REGION_MAP: Record<string, Bcp47LanguageTag> = {
  ar: 'ar-SA',
  cs: 'cs-CZ',
  da: 'da-DK',
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  id: 'id-ID',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ms: 'ms-MY',
  nl: 'nl-NL',
  no: 'no-NO',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ro: 'ro-RO',
  ru: 'ru-RU',
  sv: 'sv-SE',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  vi: 'vi-VT',
  zh: 'zh-Hans',
};

/**
 * Normalize a language string to a valid BCP 47 tag.
 *
 * - If the input is already a valid full tag (e.g. "en-US"), return it as-is.
 * - If it is a bare language code (e.g. "en", "ko"), map it to the default region.
 * - Otherwise return null (e.g. "und", "unknown", empty string).
 */
export function normalizeToBcp47(tag: string): Bcp47LanguageTag | null {
  if (isValidBcp47Tag(tag)) {
    return tag;
  }

  const lower = tag.toLowerCase();
  const mapped = DEFAULT_REGION_MAP[lower];
  if (mapped) {
    return mapped;
  }

  return null;
}
