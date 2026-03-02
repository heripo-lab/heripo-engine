import type { LoggerMethods } from '@heripo/logger';
import type { TokenUsageReport } from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import type { VlmPageResult } from '../types/vlm-page-result';
import type { VlmPageOutput } from '../types/vlm-page-schema';
import type { VlmQualityIssue } from '../validators/vlm-response-validator';

import { ConcurrentPool, LLMCaller } from '@heripo/shared';
import { readFileSync } from 'node:fs';

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

/** Language display names for VLM prompt context (keyed by ISO 639-1 base language code) */
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
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

/** Prompt block for injecting pdftotext reference text */
const TEXT_REFERENCE_PROMPT =
  `TEXT REFERENCE: The following text was extracted from the PDF text layer of this page. ` +
  `This text may be accurate, partially correct, or completely garbled/empty depending ` +
  `on how the PDF was created. Scanned or image-based PDFs may produce no text or garbage characters.\n\n` +
  `- If the extracted text looks correct and matches the page image, use it as-is for the "c" field. ` +
  `Focus on identifying element types, reading order, and bounding boxes.\n` +
  `- If the extracted text is garbled, empty, or clearly wrong, IGNORE it entirely ` +
  `and perform OCR from the image as usual.\n` +
  `- Do NOT blindly trust the extracted text — always verify against what you see in the image.`;

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

    const base64Image = readFileSync(filePath).toString('base64');

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

    let pageResult = toVlmPageResult(pageNo, result.output as VlmPageOutput);

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

      pageResult = toVlmPageResult(pageNo, retryResult.output as VlmPageOutput);

      if (pageResult.elements.length > 0) {
        this.logger.debug(
          `[VlmPageProcessor] Page ${pageNo}: ${pageResult.elements.length} elements extracted on retry`,
        );
      } else {
        this.logger.warn(
          `[VlmPageProcessor] Page ${pageNo}: still 0 elements after retry`,
        );
        return pageResult;
      }
    }

    // Quality validation: detect hallucination and script anomalies
    const validation = VlmResponseValidator.validate(
      pageResult.elements,
      options?.documentLanguages,
    );

    if (!validation.isValid) {
      return this.retryForQuality(
        pageNo,
        base64Image,
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
   * Retry a page with an enhanced prompt after quality validation failure.
   */
  private async retryForQuality(
    pageNo: number,
    base64Image: string,
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
            image: `data:image/png;base64,${base64Image}`,
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
    const primaryName = this.getLanguageDisplayName(documentLanguages[0]);
    const otherNames = documentLanguages
      .slice(1)
      .map((code) => this.getLanguageDisplayName(code));
    const languageDesc =
      otherNames.length > 0
        ? `primarily written in ${primaryName}, with ${otherNames.join(', ')} also present`
        : `written in ${primaryName}`;
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
      ? this.getLanguageDisplayName(documentLanguages[0])
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

  /**
   * Get human-readable display name for a BCP 47 or ISO 639-1 language code.
   */
  /* v8 ignore start -- defensive fallback; script_anomaly always implies documentLanguages is set */
  private getLanguageDisplayName(code?: string): string {
    if (!code) return 'unknown';
    const baseCode = code.split('-')[0];
    return LANGUAGE_DISPLAY_NAMES[baseCode] ?? code;
  }
  /* v8 ignore stop */
}
