import type { LoggerMethods } from '@heripo/logger';
import type { TokenUsageReport } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { VlmPageResult } from '../types/vlm-page-result';
import type { VlmPageOutput } from '../types/vlm-page-schema';

import { BatchProcessor, LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';

import { toVlmPageResult, vlmPageOutputSchema } from '../types/vlm-page-schema';

/** Default concurrency for parallel page processing */
const DEFAULT_CONCURRENCY = 1;

/** Default max retries per VLM call */
const DEFAULT_MAX_RETRIES = 3;

/** Default temperature for VLM generation */
const DEFAULT_TEMPERATURE = 0;

/** Temperature for retrying pages that returned 0 elements */
const EMPTY_PAGE_RETRY_TEMPERATURE = 0.3;

/**
 * System prompt for VLM page analysis.
 *
 * Instructs the VLM to extract all content elements from a page image
 * using abbreviated field names to reduce output tokens.
 */
const PAGE_ANALYSIS_PROMPT = `Analyze the page image and extract all content elements in reading order.

You MUST respond with valid JSON only. No markdown, no code fences, no explanation — just the JSON object.

Output a JSON object with a single key "e" containing an array of element objects.
Each element object MUST include ALL six fields (no field may be omitted):
- "t": type code string — one of: "tx" (text), "sh" (section_header), "ca" (caption), "fn" (footnote), "ph" (page_header), "pf" (page_footer), "li" (list_item), "pi" (picture), "tb" (table)
- "c": text content string (empty string "" for pictures)
- "o": reading order integer (0-based, top-to-bottom, left-to-right)
- "l": heading level integer (section_header only, 1=top-level). Use null for non-header elements.
- "m": list marker string (list_item only, e.g. "1.", "•"). Use null for non-list elements.
- "b": bounding box object {"l", "t", "r", "b"} with normalized coordinates 0.0-1.0, top-left origin. REQUIRED for picture elements, null for others unless known.

## Example Output

For a page with a header, paragraph, picture, caption, and footer:

{"e":[{"t":"ph","c":"Report Title","o":0,"l":null,"m":null,"b":null},{"t":"sh","c":"Chapter 1. Introduction","o":1,"l":1,"m":null,"b":null},{"t":"tx","c":"This is the first paragraph of the document.","o":2,"l":null,"m":null,"b":null},{"t":"pi","c":"","o":3,"l":null,"m":null,"b":{"l":0.1,"t":0.4,"r":0.9,"b":0.7}},{"t":"ca","c":"Figure 1. Site overview","o":4,"l":null,"m":null,"b":null},{"t":"pf","c":"- 1 -","o":5,"l":null,"m":null,"b":null}]}

## Rules

- Every element MUST include all six fields (t, c, o, l, m, b). Use null for inapplicable fields.
- Preserve original language and characters exactly
- Follow natural reading order (top→bottom, left→right for multi-column)
- Always include bounding box for picture elements
- For tables: extract visible cell text as content
- For text-heavy pages: extract ALL visible text as "tx" elements. Never return an empty array if the page contains visible text.
- If the page contains only body text paragraphs, output each paragraph as a separate "tx" element
- CRITICAL: You are an OCR engine, NOT an image describer. The "c" field must contain the ACTUAL text characters visible on the page, transcribed verbatim. NEVER output meta-descriptions such as "The image contains...", "The text is not legible...", or "exact transcription is not possible". Always attempt to read and transcribe every visible character, regardless of text size, contrast, or resolution.
- If text appears blurry or low-contrast, still output your best-effort transcription of the actual characters rather than a description of the image.`;

/** Options for VlmPageProcessor */
export interface VlmPageProcessorOptions {
  /** Number of concurrent page processing (default: 1) */
  concurrency?: number;
  /** Maximum retries per VLM call (default: 3) */
  maxRetries?: number;
  /** Temperature for generation (default: 0) */
  temperature?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Fallback model for retry after primary exhausts maxRetries */
  fallbackModel?: LanguageModel;
  /** Token usage aggregator for tracking */
  aggregator?: LLMTokenUsageAggregator;
  /** Callback fired after each batch of pages completes, with cumulative token usage */
  onTokenUsage?: (report: TokenUsageReport) => void;
}

/**
 * Processes page images through VLM to extract structured content.
 *
 * Sends each page image to a vision language model with a structured
 * output schema. The VLM analyzes the page and returns classified elements
 * (text, headers, pictures, tables, etc.) with reading order and bounding boxes.
 *
 * Uses batch processing for concurrent page handling and tracks token usage
 * via LLMTokenUsageAggregator.
 */
export class VlmPageProcessor {
  private readonly logger: LoggerMethods;

  constructor(logger: LoggerMethods) {
    this.logger = logger;
  }

  /**
   * Process page images through VLM to extract structured content.
   *
   * @param pageFiles - Array of page image file paths (index 0 → pageNo 1)
   * @param model - Vision language model to use
   * @param options - Processing options (concurrency, retries, etc.)
   * @returns Array of VlmPageResult, one per page, in page order
   */
  async processPages(
    pageFiles: string[],
    model: LanguageModel,
    options?: VlmPageProcessorOptions,
  ): Promise<VlmPageResult[]> {
    if (pageFiles.length === 0) {
      this.logger.info('[VlmPageProcessor] No pages to process');
      return [];
    }

    const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;

    this.logger.info(
      `[VlmPageProcessor] Processing ${pageFiles.length} pages (concurrency: ${concurrency})...`,
    );

    // Create page inputs with 1-based page numbers
    const pageInputs = pageFiles.map((filePath, index) => ({
      pageNo: index + 1,
      filePath,
    }));

    // Process pages in batches for concurrency control.
    // Each batch runs concurrently; batches run sequentially.
    const batches = BatchProcessor.createBatches(pageInputs, concurrency);
    const results: VlmPageResult[] = [];

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((input) =>
          this.processPage(input.pageNo, input.filePath, model, options),
        ),
      );
      results.push(...batchResults);

      // Emit incremental token usage after each batch
      if (options?.onTokenUsage && options?.aggregator) {
        options.onTokenUsage(
          options.aggregator.getReport() as TokenUsageReport,
        );
      }
    }

    this.logger.info(
      `[VlmPageProcessor] Completed processing ${results.length} pages`,
    );

    return results;
  }

  /**
   * Process a single page image through VLM.
   *
   * Reads the image file, sends it to the VLM with the analysis prompt,
   * and converts the short-field response to a full VlmPageResult.
   */
  private async processPage(
    pageNo: number,
    filePath: string,
    model: LanguageModel,
    options?: VlmPageProcessorOptions,
  ): Promise<VlmPageResult> {
    this.logger.debug(`[VlmPageProcessor] Processing page ${pageNo}...`);

    const base64Image = readFileSync(filePath).toString('base64');

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: PAGE_ANALYSIS_PROMPT },
          {
            type: 'image' as const,
            image: `data:image/png;base64,${base64Image}`,
          },
        ],
      },
    ];

    // Cast schema for Zod v3-compat/v4 interoperability.
    // At runtime, the AI SDK uses Standard Schema protocol which both support.
    const result = await LLMCaller.callVision({
      schema: vlmPageOutputSchema as any,
      messages,
      primaryModel: model,
      fallbackModel: options?.fallbackModel,
      maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      abortSignal: options?.abortSignal,
      component: 'VlmPageProcessor',
      phase: 'page-analysis',
    });

    if (options?.aggregator) {
      options.aggregator.track(result.usage);
    }

    const pageResult = toVlmPageResult(pageNo, result.output as VlmPageOutput);

    // Retry once with higher temperature if VLM returned no elements
    if (pageResult.elements.length === 0) {
      this.logger.warn(
        `[VlmPageProcessor] Page ${pageNo}: 0 elements extracted, retrying with temperature ${EMPTY_PAGE_RETRY_TEMPERATURE}...`,
      );

      const retryResult = await LLMCaller.callVision({
        schema: vlmPageOutputSchema as any,
        messages,
        primaryModel: model,
        fallbackModel: options?.fallbackModel,
        maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
        temperature: EMPTY_PAGE_RETRY_TEMPERATURE,
        abortSignal: options?.abortSignal,
        component: 'VlmPageProcessor',
        phase: 'page-analysis-retry',
      });

      if (options?.aggregator) {
        options.aggregator.track(retryResult.usage);
      }

      const retryPageResult = toVlmPageResult(
        pageNo,
        retryResult.output as VlmPageOutput,
      );

      if (retryPageResult.elements.length > 0) {
        this.logger.debug(
          `[VlmPageProcessor] Page ${pageNo}: ${retryPageResult.elements.length} elements extracted on retry`,
        );
        return retryPageResult;
      }

      this.logger.warn(
        `[VlmPageProcessor] Page ${pageNo}: still 0 elements after retry`,
      );
      return retryPageResult;
    }

    this.logger.debug(
      `[VlmPageProcessor] Page ${pageNo}: ${pageResult.elements.length} elements extracted`,
    );

    return pageResult;
  }
}
