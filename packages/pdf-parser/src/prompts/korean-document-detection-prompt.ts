/** System prompt for Korean document language detection */
export const KOREAN_DOCUMENT_DETECTION_PROMPT = `Look at this page image carefully and identify all languages present on this page.

Return an array of ocrmac-compatible language tags ordered by prevalence (primary language first).
Use ko-KR when Korean text is present, even when the page also contains Hanja (漢字/Chinese characters), English, numbers, tables, or captions.

Supported tags: ar-SA, ars-SA, cs-CZ, da-DK, de-DE, en-US, es-ES, fr-FR, id-ID, it-IT, ja-JP, ko-KR, ms-MY, nb-NO, nl-NL, nn-NO, no-NO, pl-PL, pt-BR, ro-RO, ru-RU, sv-SE, th-TH, tr-TR, uk-UA, vi-VT, yue-Hans, yue-Hant, zh-Hans, zh-Hant.
Examples: ["ko-KR", "en-US"], ["ja-JP"], ["zh-Hant", "en-US"]`;
