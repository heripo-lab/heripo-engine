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
 * Minimum ratio of Hangul/CJK characters when documentLanguage is 'ko'.
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

/** Matches Hangul Syllables and Hangul Jamo */
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF]/g;

/** Matches CJK Unified Ideographs (Hanja / Kanji / Hanzi) */
const CJK_REGEX = /[\u4E00-\u9FFF]/g;

/**
 * Lightweight, stateless validator for VLM page extraction responses.
 *
 * Detects two categories of hallucination without any additional VLM calls:
 * 1. Placeholder text (Lorem ipsum and variants)
 * 2. Script anomaly (expected Korean but got Latin-only text)
 */
export class VlmResponseValidator {
  /**
   * Validate VLM page result quality.
   *
   * @param elements - Extracted page elements to validate
   * @param documentLanguage - Expected document language (ISO 639-1, e.g., 'ko')
   * @returns Validation result with issues list
   */
  static validate(
    elements: VlmPageElement[],
    documentLanguage?: string,
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

    if (documentLanguage === 'ko') {
      const scriptIssue = this.detectScriptAnomaly(textElements);
      if (scriptIssue) {
        issues.push(scriptIssue);
      }
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
}
