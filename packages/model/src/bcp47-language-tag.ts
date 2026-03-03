/**
 * BCP 47 language tags supported by Docling OCR engines.
 * Covers major languages encountered in archaeological report processing.
 */
export const BCP47_LANGUAGE_TAGS = [
  'af-ZA',
  'am-ET',
  'ar-SA',
  'as-IN',
  'az-AZ',
  'be-BY',
  'bg-BG',
  'bn-IN',
  'bs-BA',
  'ca-ES',
  'cs-CZ',
  'cy-GB',
  'da-DK',
  'de-DE',
  'el-GR',
  'en-US',
  'es-ES',
  'et-EE',
  'eu-ES',
  'fa-IR',
  'fi-FI',
  'fr-FR',
  'ga-IE',
  'gl-ES',
  'gu-IN',
  'he-IL',
  'hi-IN',
  'hr-HR',
  'hu-HU',
  'hy-AM',
  'id-ID',
  'is-IS',
  'it-IT',
  'ja-JP',
  'ka-GE',
  'kk-KZ',
  'km-KH',
  'kn-IN',
  'ko-KR',
  'lo-LA',
  'lt-LT',
  'lv-LV',
  'mk-MK',
  'ml-IN',
  'mn-MN',
  'mr-IN',
  'ms-MY',
  'my-MM',
  'ne-NP',
  'nl-NL',
  'no-NO',
  'or-IN',
  'pa-IN',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'ro-RO',
  'ru-RU',
  'si-LK',
  'sk-SK',
  'sl-SI',
  'sq-AL',
  'sr-RS',
  'sv-SE',
  'sw-KE',
  'ta-IN',
  'te-IN',
  'th-TH',
  'tr-TR',
  'uk-UA',
  'ur-PK',
  'uz-UZ',
  'vi-VN',
  'zh-CN',
  'zh-Hant',
  'zh-TW',
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
  af: 'af-ZA',
  am: 'am-ET',
  ar: 'ar-SA',
  as: 'as-IN',
  az: 'az-AZ',
  be: 'be-BY',
  bg: 'bg-BG',
  bn: 'bn-IN',
  bs: 'bs-BA',
  ca: 'ca-ES',
  cs: 'cs-CZ',
  cy: 'cy-GB',
  da: 'da-DK',
  de: 'de-DE',
  el: 'el-GR',
  en: 'en-US',
  es: 'es-ES',
  et: 'et-EE',
  eu: 'eu-ES',
  fa: 'fa-IR',
  fi: 'fi-FI',
  fr: 'fr-FR',
  ga: 'ga-IE',
  gl: 'gl-ES',
  gu: 'gu-IN',
  he: 'he-IL',
  hi: 'hi-IN',
  hr: 'hr-HR',
  hu: 'hu-HU',
  hy: 'hy-AM',
  id: 'id-ID',
  is: 'is-IS',
  it: 'it-IT',
  ja: 'ja-JP',
  ka: 'ka-GE',
  kk: 'kk-KZ',
  km: 'km-KH',
  kn: 'kn-IN',
  ko: 'ko-KR',
  lo: 'lo-LA',
  lt: 'lt-LT',
  lv: 'lv-LV',
  mk: 'mk-MK',
  ml: 'ml-IN',
  mn: 'mn-MN',
  mr: 'mr-IN',
  ms: 'ms-MY',
  my: 'my-MM',
  ne: 'ne-NP',
  nl: 'nl-NL',
  no: 'no-NO',
  or: 'or-IN',
  pa: 'pa-IN',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ro: 'ro-RO',
  ru: 'ru-RU',
  si: 'si-LK',
  sk: 'sk-SK',
  sl: 'sl-SI',
  sq: 'sq-AL',
  sr: 'sr-RS',
  sv: 'sv-SE',
  sw: 'sw-KE',
  ta: 'ta-IN',
  te: 'te-IN',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  ur: 'ur-PK',
  uz: 'uz-UZ',
  vi: 'vi-VN',
  zh: 'zh-CN',
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
