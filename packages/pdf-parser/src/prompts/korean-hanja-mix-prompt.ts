/** System prompt for Korean-Hanja mix detection */
export const KOREAN_HANJA_MIX_PROMPT = `Look at this page image carefully. Does it contain any Hanja (漢字/Chinese characters) mixed with Korean text?

Hanja examples: 遺蹟, 發掘, 調査, 報告書, 文化財
Note: Hanja are Chinese characters used in Korean documents, different from modern Korean (한글).

Answer whether any Hanja characters are present on this page.

Also identify all languages present on this page. Return an array of ocrmac-compatible language tags ordered by prevalence (primary language first).
Supported tags: ar-SA, ars-SA, cs-CZ, da-DK, de-DE, en-US, es-ES, fr-FR, id-ID, it-IT, ja-JP, ko-KR, ms-MY, nb-NO, nl-NL, nn-NO, no-NO, pl-PL, pt-BR, ro-RO, ru-RU, sv-SE, th-TH, tr-TR, uk-UA, vi-VT, yue-Hans, yue-Hant, zh-Hans, zh-Hant.
Examples: ["ko-KR", "en-US"], ["ja-JP"], ["zh-Hant", "en-US"]`;
