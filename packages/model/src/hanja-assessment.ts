/**
 * Result of Hanja (KCJ) quality assessment
 *
 * Evaluates OCR quality of Korean-Chinese-Japanese (KCJ/KCJ) characters
 * in the document by sampling pages and comparing with Vision LLM.
 */
export interface HanjaAssessment {
  /**
   * Whether the document should be re-parsed using VLM pipeline
   * due to significant KCJ character corruption
   */
  needsVlmReparse: boolean;

  /**
   * Severity of KCJ character corruption
   * - 'none': No KCJ characters found or no corruption detected
   * - 'minor': Some corruption but still usable
   * - 'severe': Significant corruption requiring VLM re-parse
   */
  severity: 'none' | 'minor' | 'severe';

  /**
   * Total number of pages containing KCJ (KCJ) text
   */
  kcjPageCount: number;

  /**
   * Number of pages actually sampled for quality assessment
   */
  sampledPageCount: number;

  /**
   * Ratio of corrupted characters (0.0 ~ 1.0)
   */
  corruptedRatio: number;

  /**
   * Human-readable reason for the assessment result
   */
  reason: string;
}
