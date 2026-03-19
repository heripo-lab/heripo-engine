import type { LoggerMethods } from '@heripo/logger';
import type { DoclingDocument } from '@heripo/model';
import type {
  ExtendedTokenUsage,
  LLMTokenUsageAggregator,
} from '@heripo/shared';

import type { TocExtractor } from '../extractors';
import type { TocFinder } from '../extractors';
import type { VisionTocExtractor } from '../extractors';
import type { TocEntry } from '../types';
import type { RefResolver } from '../utils';
import type { TocContentValidator } from '../validators';

import { TocNotFoundError, TocValidationError } from '../extractors';
import { MarkdownConverter } from '../utils';
import { extractMaxPageNumber } from '../utils';

/**
 * Dependencies required by TocExtractionPipeline
 */
export interface TocExtractionPipelineDeps {
  logger: LoggerMethods;
  tocFinder: TocFinder;
  tocExtractor: TocExtractor;
  tocContentValidator: TocContentValidator;
  visionTocExtractor: VisionTocExtractor;
  refResolver: RefResolver;
  usageAggregator: LLMTokenUsageAggregator;
}

/**
 * TocExtractionPipeline
 *
 * Orchestrates the multi-stage TOC extraction process:
 * 1. Rule-based extraction (TocFinder + MarkdownConverter)
 * 2. Content validation (TocContentValidator)
 * 3. Vision fallback (VisionTocExtractor)
 * 4. Structured extraction with validation retry (TocExtractor)
 * 5. Vision fallback retry when text-based extraction yields 0 entries
 */
export class TocExtractionPipeline {
  private readonly logger: LoggerMethods;
  private readonly tocFinder: TocFinder;
  private readonly tocExtractor: TocExtractor;
  private readonly tocContentValidator: TocContentValidator;
  private readonly visionTocExtractor: VisionTocExtractor;
  private readonly refResolver: RefResolver;
  private readonly usageAggregator: LLMTokenUsageAggregator;

  constructor(deps: TocExtractionPipelineDeps) {
    this.logger = deps.logger;
    this.tocFinder = deps.tocFinder;
    this.tocExtractor = deps.tocExtractor;
    this.tocContentValidator = deps.tocContentValidator;
    this.visionTocExtractor = deps.visionTocExtractor;
    this.refResolver = deps.refResolver;
    this.usageAggregator = deps.usageAggregator;
  }

  /**
   * Execute the TOC extraction pipeline
   *
   * @param doclingDoc - Document containing texts, pages, etc.
   * @param _filteredTexts - Pre-filtered texts (reserved for future use)
   * @returns Extracted TOC entries
   * @throws {TocNotFoundError} When TOC cannot be found or extracted
   */
  async extract(
    doclingDoc: DoclingDocument,
    _filteredTexts: string[],
  ): Promise<TocEntry[]> {
    this.logger.info('[TocExtractionPipeline] Extracting TOC...');

    let markdown: string | null = null;

    // Stage 1: Try rule-based extraction
    try {
      const tocArea = this.tocFinder.find(doclingDoc);
      this.logger.info(
        `[TocExtractionPipeline] Found TOC area: pages ${tocArea.startPage}-${tocArea.endPage}`,
      );

      // Stage 2: Convert to Markdown
      markdown = MarkdownConverter.convert(tocArea.itemRefs, this.refResolver);
      this.logger.info(
        `[TocExtractionPipeline] Converted TOC to Markdown (${markdown.length} chars)`,
      );

      // Stage 3: Validate with LLM
      const validation = await this.tocContentValidator.validate(markdown);
      if (!this.tocContentValidator.isValid(validation)) {
        this.logger.warn(
          `[TocExtractionPipeline] TOC validation failed: ${validation.reason}`,
        );
        markdown = null;
      } else {
        const validMarkdown =
          this.tocContentValidator.getValidMarkdown(validation);
        if (validMarkdown) {
          if (validation.contentType === 'mixed') {
            this.logger.info(
              `[TocExtractionPipeline] Mixed TOC detected, using extracted main TOC (${validMarkdown.length} chars)`,
            );
          }
          markdown = validMarkdown;
          this.logger.info(
            `[TocExtractionPipeline] TOC validation passed (confidence: ${validation.confidence})`,
          );
        } else {
          markdown = null;
        }
      }
    } catch (error) {
      if (error instanceof TocNotFoundError) {
        this.logger.info(
          '[TocExtractionPipeline] Rule-based TOC not found, will try vision fallback',
        );
      } else {
        throw error;
      }
    }

    // Stage 4: Vision fallback if needed
    let fromVision = false;
    const totalPages = Object.keys(doclingDoc.pages).length;

    if (!markdown) {
      fromVision = true;
      this.logger.info('[TocExtractionPipeline] Using vision fallback for TOC');
      markdown = await this.visionTocExtractor.extract(totalPages);

      if (!markdown) {
        const reason =
          'Both rule-based search and vision fallback failed to locate TOC';
        this.logger.error(
          `[TocExtractionPipeline] TOC extraction failed: ${reason}`,
        );
        throw new TocNotFoundError(
          `Table of contents not found in the document. ${reason}.`,
        );
      }

      this.logger.info(
        `[TocExtractionPipeline] Vision extracted TOC markdown (${markdown.length} chars)`,
      );
    }

    // Stage 5: Extract structure with LLM
    const maxTocPageNo = extractMaxPageNumber(markdown);
    const effectiveTotalPages =
      maxTocPageNo > totalPages ? undefined : totalPages;

    let tocResult: { entries: TocEntry[]; usages: ExtendedTokenUsage[] };
    try {
      tocResult = await this.tocExtractor.extract(markdown, {
        totalPages: effectiveTotalPages,
      });
    } catch (error) {
      if (error instanceof TocValidationError) {
        this.logger.warn(
          `[TocExtractionPipeline] TOC extraction validation failed: ${error.message}`,
        );
        tocResult = { entries: [], usages: [] };
      } else {
        throw error;
      }
    }

    // Track token usage
    for (const usage of tocResult.usages) {
      this.usageAggregator.track(usage);
    }

    // Stage 5b: Vision fallback when text-based extraction yields 0 entries
    if (tocResult.entries.length === 0 && !fromVision) {
      this.logger.warn(
        '[TocExtractionPipeline] Text-based TOC extraction yielded 0 entries, retrying with vision',
      );
      const visionMarkdown = await this.visionTocExtractor.extract(totalPages);
      if (visionMarkdown) {
        this.logger.info(
          `[TocExtractionPipeline] Vision extracted TOC markdown (${visionMarkdown.length} chars)`,
        );
        const visionMaxPageNo = extractMaxPageNumber(visionMarkdown);
        const visionEffectivePages =
          visionMaxPageNo > totalPages ? undefined : totalPages;

        try {
          const visionResult = await this.tocExtractor.extract(visionMarkdown, {
            totalPages: visionEffectivePages,
          });
          for (const usage of visionResult.usages) {
            this.usageAggregator.track(usage);
          }
          if (visionResult.entries.length > 0) {
            tocResult = visionResult;
          }
        } catch {
          // Vision retry also failed, will fall through to error below
        }
      }
    }

    if (tocResult.entries.length === 0) {
      const reason =
        'TOC area was detected but LLM could not extract any structured entries';
      this.logger.error(
        `[TocExtractionPipeline] TOC extraction failed: ${reason}`,
      );
      throw new TocNotFoundError(`${reason}.`);
    }

    this.logger.info(
      `[TocExtractionPipeline] Extracted ${tocResult.entries.length} top-level TOC entries`,
    );

    return tocResult.entries;
  }
}
