import type { LoggerMethods } from '@heripo/logger';
import type { TokenUsageReport } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { VlmPageResult } from '../types/vlm-page-result';
import type { VlmPageOutput } from '../types/vlm-page-schema';
import type { VlmQualityIssue } from '../validators/vlm-response-validator';

import {
  buildLanguageDescription,
  getLanguageDisplayName,
} from '@heripo/model';
import { ConcurrentPool, LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';

import {
  PAGE_ANALYSIS_PROMPT,
  TEXT_REFERENCE_PROMPT,
} from '../prompts/page-analysis-prompt';
import { toVlmPageResult, vlmPageOutputSchema } from '../types/vlm-page-schema';
import { VlmResponseValidator } from '../validators/vlm-response-validator';

/** Default concurrency for parallel page processing */
const DEFAULT_CONCURRENCY = 1;

/** Default max retries per VLM call */
const DEFAULT_MAX_RETRIES = 3;

/** Default temperature for VLM generation */
const DEFAULT_TEMPERATURE = 0;

/** Temperature for retrying pages that returned 0 elements */
const EMPTY_PAGE_RETRY_TEMPERATURE = 0.3;

/** Temperature for retrying pages that failed quality validation */
const QUALITY_RETRY_TEMPERATURE = 0.5;

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
  /** Callback fired after each page completes, with cumulative token usage */
  onTokenUsage?: (report: TokenUsageReport) => void;
  /** BCP 47 language tags detected during sampling (e.g., ['ko-KR', 'en-US']) */
  documentLanguages?: string[];
  /** Pre-extracted page texts from pdftotext (1-based pageNo → text) */
  pageTexts?: Map<number, string>;
}

/**
 * Processes page images through VLM to extract structured content.
 *
 * Sends each page image to a vision language model with a structured
 * output schema. The VLM analyzes the page and returns classified elements
 * (text, headers, pictures, tables, etc.) with reading order and bounding boxes.
 *
 * Uses a worker pool for concurrent page handling and tracks token usage
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

    // Process pages using a worker pool for optimal concurrency.
    // Workers pull from a shared queue; when one finishes, it immediately takes the next item.
    const results = await ConcurrentPool.run(
      pageInputs,
      concurrency,
      (input) => this.processPage(input.pageNo, input.filePath, model, options),
      () => {
        // Emit incremental token usage after each page completes
        if (options?.onTokenUsage && options?.aggregator) {
          options.onTokenUsage(
            options.aggregator.getReport() as TokenUsageReport,
          );
        }
      },
    );

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
   * Validates response quality and retries once if issues are detected.
   */
  private async processPage(
    pageNo: number,
    filePath: string,
    model: LanguageModel,
    options?: VlmPageProcessorOptions,
  ): Promise<VlmPageResult> {
    this.logger.debug(`[VlmPageProcessor] Processing page ${pageNo}...`);

    const imageData = new Uint8Array(readFileSync(filePath));

    const basePrompt = options?.documentLanguages?.length
      ? this.buildLanguageAwarePrompt(options.documentLanguages)
      : PAGE_ANALYSIS_PROMPT;

    const initialPrompt = this.injectTextContext(
      basePrompt,
      options?.pageTexts?.get(pageNo),
    );

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: initialPrompt },
          {
            type: 'image' as const,
            image: imageData,
            mediaType: 'image/png' as const,
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

    const initialPageResult = toVlmPageResult(
      pageNo,
      result.output as VlmPageOutput,
    );

    // Retry once with higher temperature if VLM returned no elements
    const pageResult =
      initialPageResult.elements.length === 0
        ? await this.retryForEmptyPage(pageNo, messages, model, options)
        : initialPageResult;

    if (pageResult.elements.length === 0) {
      return pageResult;
    }

    // Quality validation: detect hallucination and script anomalies
    const validation = VlmResponseValidator.validate(
      pageResult.elements,
      options?.documentLanguages,
    );

    if (!validation.isValid) {
      return this.retryForQuality(
        pageNo,
        imageData,
        model,
        validation,
        options,
      );
    }

    this.logger.debug(
      `[VlmPageProcessor] Page ${pageNo}: ${pageResult.elements.length} elements extracted`,
    );

    return pageResult;
  }

  /**
   * Retry a page with higher temperature when initial VLM call returned no elements.
   */
  private async retryForEmptyPage(
    pageNo: number,
    messages: Array<{
      role: 'user';
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; image: Uint8Array; mediaType: 'image/png' }
      >;
    }>,
    model: LanguageModel,
    options?: VlmPageProcessorOptions,
  ): Promise<VlmPageResult> {
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
    } else {
      this.logger.warn(
        `[VlmPageProcessor] Page ${pageNo}: still 0 elements after retry`,
      );
    }

    return retryPageResult;
  }

  /**
   * Retry a page with an enhanced prompt after quality validation failure.
   */
  private async retryForQuality(
    pageNo: number,
    imageData: Uint8Array,
    model: LanguageModel,
    validation: { issues: VlmQualityIssue[] },
    options?: VlmPageProcessorOptions,
  ): Promise<VlmPageResult> {
    const issueTypes = validation.issues.map((i) => i.type);

    this.logger.warn(
      `[VlmPageProcessor] Page ${pageNo}: quality issues detected: ${issueTypes.join(', ')}`,
    );

    const baseRetryPrompt = this.buildQualityRetryPrompt(
      validation.issues,
      options?.documentLanguages,
    );

    const retryPrompt = this.injectTextContext(
      baseRetryPrompt,
      options?.pageTexts?.get(pageNo),
    );

    const retryMessages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: retryPrompt },
          {
            type: 'image' as const,
            image: imageData,
            mediaType: 'image/png' as const,
          },
        ],
      },
    ];

    const retryResult = await LLMCaller.callVision({
      schema: vlmPageOutputSchema as any,
      messages: retryMessages,
      primaryModel: model,
      fallbackModel: options?.fallbackModel,
      maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
      temperature: QUALITY_RETRY_TEMPERATURE,
      abortSignal: options?.abortSignal,
      component: 'VlmPageProcessor',
      phase: 'page-analysis-quality-retry',
    });

    if (options?.aggregator) {
      options.aggregator.track(retryResult.usage);
    }

    const retryPageResult = toVlmPageResult(
      pageNo,
      retryResult.output as VlmPageOutput,
    );

    const retryValidation = VlmResponseValidator.validate(
      retryPageResult.elements,
      options?.documentLanguages,
    );

    if (retryValidation.isValid) {
      this.logger.debug(
        `[VlmPageProcessor] Page ${pageNo}: quality issues resolved after retry (${retryPageResult.elements.length} elements)`,
      );
      return {
        ...retryPageResult,
        quality: { isValid: true, retried: true, issueTypes: [] },
      };
    }

    this.logger.warn(
      `[VlmPageProcessor] Page ${pageNo}: quality issues persist after retry: ${retryValidation.issues.map((i) => i.type).join(', ')}`,
    );
    return {
      ...retryPageResult,
      quality: {
        isValid: false,
        retried: true,
        issueTypes: retryValidation.issues.map((i) => i.type),
      },
    };
  }

  /**
   * Inject pdftotext reference text into the prompt.
   * If the page text is empty or undefined, the original prompt is returned unchanged.
   */
  private injectTextContext(prompt: string, pageText?: string): string {
    if (!pageText || pageText.trim().length === 0) {
      return prompt;
    }

    return (
      TEXT_REFERENCE_PROMPT + '\n\n```\n' + pageText + '\n```\n\n' + prompt
    );
  }

  /**
   * Build the initial prompt with language context prepended.
   */
  private buildLanguageAwarePrompt(documentLanguages: string[]): string {
    const languageDesc = buildLanguageDescription(documentLanguages);
    const prefix =
      `LANGUAGE CONTEXT: This document is ${languageDesc}. ` +
      'The extracted text MUST be in this language. ' +
      'Do not output text in other languages unless it is actually visible on the page.\n\n';
    return prefix + PAGE_ANALYSIS_PROMPT;
  }

  /**
   * Build an enhanced prompt with quality warnings for retry.
   */
  private buildQualityRetryPrompt(
    issues: VlmQualityIssue[],
    documentLanguages?: string[],
  ): string {
    const warnings: string[] = [
      'IMPORTANT: Your previous response had quality issues. Please re-analyze this page carefully.',
    ];

    const primaryDisplayName = documentLanguages?.length
      ? getLanguageDisplayName(documentLanguages[0])
      : 'unknown';

    /* v8 ignore start -- all branches tested; V8 undercounts if/else-if per call site */
    for (const issue of issues) {
      if (issue.type === 'placeholder_text') {
        warnings.push(
          '- WARNING: Your previous response contained placeholder text (Lorem ipsum). ' +
            'This is NOT acceptable. You must transcribe the ACTUAL text visible on the page.',
        );
      } else if (issue.type === 'script_anomaly') {
        warnings.push(
          '- WARNING: Your previous response contained text in the wrong language/script. ' +
            `This document is in ${primaryDisplayName}. ` +
            'Transcribe the actual characters visible on the page, not translated or fabricated text.',
        );
      } else if (issue.type === 'meta_description') {
        warnings.push(
          '- WARNING: Your previous response described the image instead of transcribing text. ' +
            'You are an OCR engine. Output the ACTUAL text characters visible on the page, ' +
            'not descriptions about the image quality or resolution.',
        );
      } else if (issue.type === 'repetitive_pattern') {
        warnings.push(
          '- WARNING: Your previous response contained repetitive character patterns ' +
            '(e.g., ": : : : :"). This indicates a transcription failure. ' +
            'Read each line carefully and output the actual text content.',
        );
      }
    }
    /* v8 ignore stop */

    if (documentLanguages?.length) {
      warnings.push(
        `- LANGUAGE CONTEXT: This document is written in ${primaryDisplayName}. ` +
          'The extracted text MUST be in this language. Do not output text in other languages unless it is actually visible on the page.',
      );
    }

    return warnings.join('\n') + '\n\n' + PAGE_ANALYSIS_PROMPT;
  }
}
