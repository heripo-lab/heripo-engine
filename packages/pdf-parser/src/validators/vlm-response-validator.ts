import type {
  VlmPageElement,
  VlmQualityIssueType,
} from '../types/vlm-page-result';

/** A single quality issue found during validation */
export interface VlmQualityIssue {
  /** Type of issue detected */
  type: VlmQualityIssueType;
  /** Human-readable description of the issue */
  message: string;
  /** Element reading-order indices that triggered the issue */
  affectedElements: number[];
}

/** Result of VLM response quality validation */
export interface VlmValidationResult {
  /** Whether the response passes quality validation */
  isValid: boolean;
  /** List of quality issues found (empty if valid) */
  issues: VlmQualityIssue[];
}

/** Minimum non-whitespace characters required for script anomaly check */
const MIN_CONTENT_LENGTH = 20;

/**
 * Minimum ratio of Hangul/CJK characters when primary language starts with 'ko'.
 * 10% is very permissive — catches pure-Latin hallucinations while
 * allowing mixed content with numbers, coordinates, and English terms.
 */
const KOREAN_SCRIPT_RATIO_THRESHOLD = 0.1;

/** Known placeholder text patterns (case-insensitive) */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /lorem\s+ipsum/i,
  /dolor\s+sit\s+amet/i,
  /consectetur\s+adipiscing/i,
  /sed\s+do\s+eiusmod/i,
  /ut\s+labore\s+et\s+dolore/i,
];

/** Patterns indicating VLM described the image instead of transcribing text (Korean) */
const META_DESCRIPTION_PATTERNS_KO: RegExp[] = [
  /이미지\s*해상도/,
  /판독하기?\s*어렵/,
  /해상도가?\s*(매우\s*)?(낮|부족)/,
  /텍스트를?\s*판독/,
  /글자를?\s*읽기?\s*어렵/,
  /정확한?\s*판독이?\s*(불가|어렵)/,
];

/** Patterns indicating VLM described the image instead of transcribing text (English) */
const META_DESCRIPTION_PATTERNS_EN: RegExp[] = [
  /the image contains/i,
  /unable to (read|transcribe)/i,
  /resolution.*(too low|insufficient)/i,
  /cannot (read|make out|decipher)/i,
  /text is (not |un)?(legible|readable)/i,
  /exact transcription is not possible/i,
];

/**
 * Minimum ratio of repetitive pattern characters to total content
 * for flagging as repetitive.
 */
const REPETITIVE_PATTERN_RATIO_THRESHOLD = 0.3;

/** Minimum number of repetitions to consider a pattern repetitive */
const REPETITIVE_PATTERN_MIN_REPEATS = 5;

/** Matches Hangul Syllables and Hangul Jamo */
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF]/g;

/** Matches CJK Unified Ideographs (Hanja / Kanji / Hanzi) */
const CJK_REGEX = /[\u4E00-\u9FFF]/g;

/**
 * Lightweight, stateless validator for VLM page extraction responses.
 *
 * Detects four categories of hallucination without any additional VLM calls:
 * 1. Placeholder text (Lorem ipsum and variants)
 * 2. Script anomaly (expected Korean but got Latin-only text)
 * 3. Meta description (VLM described the image instead of transcribing text)
 * 4. Repetitive pattern (repeated character patterns like `: : : : :`)
 */
export class VlmResponseValidator {
  /**
   * Validate VLM page result quality.
   *
   * @param elements - Extracted page elements to validate
   * @param documentLanguages - BCP 47 language tags (e.g., ['ko-KR', 'en-US'])
   * @returns Validation result with issues list
   */
  static validate(
    elements: VlmPageElement[],
    documentLanguages?: string[],
  ): VlmValidationResult {
    const issues: VlmQualityIssue[] = [];

    const textElements = elements.filter(
      (el) => el.type !== 'picture' && el.content.length > 0,
    );

    if (textElements.length === 0) {
      return { isValid: true, issues: [] };
    }

    const placeholderIssue = this.detectPlaceholderText(textElements);
    if (placeholderIssue) {
      issues.push(placeholderIssue);
    }

    if (documentLanguages?.[0]?.startsWith('ko')) {
      const scriptIssue = this.detectScriptAnomaly(textElements);
      if (scriptIssue) {
        issues.push(scriptIssue);
      }
    }

    const metaIssue = this.detectMetaDescription(textElements);
    if (metaIssue) {
      issues.push(metaIssue);
    }

    const repetitiveIssue = this.detectRepetitivePattern(textElements);
    if (repetitiveIssue) {
      issues.push(repetitiveIssue);
    }

    return { isValid: issues.length === 0, issues };
  }

  /**
   * Detect known placeholder / filler text in elements.
   */
  private static detectPlaceholderText(
    elements: VlmPageElement[],
  ): VlmQualityIssue | null {
    const affectedElements: number[] = [];

    for (const el of elements) {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        if (pattern.test(el.content)) {
          affectedElements.push(el.order);
          break;
        }
      }
    }

    if (affectedElements.length === 0) return null;

    return {
      type: 'placeholder_text',
      message: `Detected placeholder text (e.g., Lorem ipsum) in ${affectedElements.length} element(s)`,
      affectedElements,
    };
  }

  /**
   * Detect script anomaly: expected Korean content but found mostly Latin text.
   * Counts Hangul + CJK characters and flags if the ratio is below threshold.
   */
  private static detectScriptAnomaly(
    elements: VlmPageElement[],
  ): VlmQualityIssue | null {
    const allContent = elements.map((el) => el.content).join('');
    const nonWhitespace = allContent.replace(/\s/g, '');

    if (nonWhitespace.length < MIN_CONTENT_LENGTH) {
      return null;
    }

    const hangulCount = allContent.match(HANGUL_REGEX)?.length ?? 0;
    const cjkCount = allContent.match(CJK_REGEX)?.length ?? 0;
    const koreanCjkCount = hangulCount + cjkCount;
    const ratio = koreanCjkCount / nonWhitespace.length;

    if (ratio < KOREAN_SCRIPT_RATIO_THRESHOLD) {
      return {
        type: 'script_anomaly',
        message: `Expected Korean text but found ${(ratio * 100).toFixed(1)}% Korean/CJK characters (threshold: ${KOREAN_SCRIPT_RATIO_THRESHOLD * 100}%)`,
        affectedElements: elements.map((el) => el.order),
      };
    }

    return null;
  }

  /**
   * Detect meta description: VLM described the image/resolution instead
   * of transcribing actual text content.
   */
  private static detectMetaDescription(
    elements: VlmPageElement[],
  ): VlmQualityIssue | null {
    const affectedElements: number[] = [];
    const allPatterns = [
      ...META_DESCRIPTION_PATTERNS_KO,
      ...META_DESCRIPTION_PATTERNS_EN,
    ];

    for (const el of elements) {
      for (const pattern of allPatterns) {
        if (pattern.test(el.content)) {
          affectedElements.push(el.order);
          break;
        }
      }
    }

    if (affectedElements.length === 0) return null;

    return {
      type: 'meta_description',
      message: `Detected meta-description of image instead of text transcription in ${affectedElements.length} element(s)`,
      affectedElements,
    };
  }

  /**
   * Detect repetitive character patterns (e.g., `: : : : :` or `= = = = =`).
   * Flags when the same character repeats with spaces 5+ times and the
   * repetitive portion exceeds 30% of total content.
   */
  private static detectRepetitivePattern(
    elements: VlmPageElement[],
  ): VlmQualityIssue | null {
    const allContent = elements.map((el) => el.content).join('\n');

    if (allContent.trim().length === 0) return null;

    // Match patterns like "x x x x x" where x is a non-whitespace character
    const repetitiveRegex = /(\S)(\s+\1){4,}/g;
    let totalRepetitiveLength = 0;

    let match: RegExpExecArray | null;
    while ((match = repetitiveRegex.exec(allContent)) !== null) {
      const repeatedChar = match[1];
      // Count actual repetitions: split by the repeated character
      const segment = match[0];
      const parts = segment.split(/\s+/).filter((p) => p === repeatedChar);
      /* v8 ignore start -- regex {4,} guarantees ≥5 parts; defensive guard only */
      if (parts.length >= REPETITIVE_PATTERN_MIN_REPEATS) {
        /* v8 ignore stop */
        totalRepetitiveLength += segment.length;
      }
    }

    if (totalRepetitiveLength === 0) return null;

    const ratio = totalRepetitiveLength / allContent.length;

    if (ratio < REPETITIVE_PATTERN_RATIO_THRESHOLD) return null;

    return {
      type: 'repetitive_pattern',
      message: `Detected repetitive character patterns (${(ratio * 100).toFixed(0)}% of content)`,
      affectedElements: elements.map((el) => el.order),
    };
  }
}
