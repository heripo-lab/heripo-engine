/** Language display names for prompt context (keyed by ISO 639-1 base language code) */
export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  ko: 'Korean (한국어)',
  ja: 'Japanese (日本語)',
  zh: 'Chinese (中文)',
  en: 'English',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  ru: 'Russian (Русский)',
  uk: 'Ukrainian (Українська)',
  it: 'Italian (Italiano)',
};

/**
 * Get human-readable display name for a BCP 47 or ISO 639-1 language code.
 */
export function getLanguageDisplayName(code?: string): string {
  if (!code) return 'unknown';
  const baseCode = code.split('-')[0];
  return LANGUAGE_DISPLAY_NAMES[baseCode] ?? code;
}

/**
 * Build language description string from document languages.
 * @returns e.g. "primarily written in Korean (한국어), with English also present"
 */
export function buildLanguageDescription(documentLanguages: string[]): string {
  const primaryName = getLanguageDisplayName(documentLanguages[0]);
  const otherNames = documentLanguages
    .slice(1)
    .map((code) => getLanguageDisplayName(code));
  return otherNames.length > 0
    ? `primarily written in ${primaryName}, with ${otherNames.join(', ')} also present`
    : `written in ${primaryName}`;
}
