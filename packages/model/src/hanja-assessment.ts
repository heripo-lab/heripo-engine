/**
 * Result of Hanja role assessment in the document.
 *
 * Determines whether Hanja characters play an essential role (mixed Korean-Hanja text)
 * or merely a supplementary role (parenthetical annotations), which decides
 * whether VLM re-parsing is needed for accurate text extraction.
 */
export interface HanjaAssessment {
  /**
   * Whether the document should be re-parsed using VLM pipeline.
   * True when Hanja plays an essential role in the document content.
   */
  needsVlmReparse: boolean;

  /**
   * Role of Hanja characters in the document:
   * - 'none': No Hanja characters found in sampled pages
   * - 'supplementary': Hanja appears as parenthetical annotations after Korean text (e.g., "한글(漢字)")
   * - 'essential': Document uses mixed Korean-Hanja text where Hanja is integral to meaning
   */
  hanjaRole: 'none' | 'supplementary' | 'essential';

  /**
   * Total number of text pages containing Hanja, considered as candidates for assessment
   */
  hanjaPageCount: number;

  /**
   * Number of pages actually sampled for role assessment
   */
  sampledPageCount: number;

  /**
   * Human-readable reason for the assessment result
   */
  reason: string;
}
