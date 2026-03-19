import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingTableItem,
  DoclingTextItem,
  TokenUsageReport,
} from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { buildLanguageDescription } from '@heripo/model';
import { ConcurrentPool, LLMCaller } from '@heripo/shared';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEXT_CORRECTION_SYSTEM_PROMPT } from '../prompts/text-correction-prompt';
import {
  type VlmTextCorrectionOutput,
  vlmTextCorrectionSchema,
} from '../types/vlm-text-correction-schema';
import { matchTextToReferenceWithUnused } from '../utils/text-reference-matcher';
import {
  LABEL_TO_TYPE_CODE,
  applyCorrections,
  getPageTables,
  getPageTexts,
} from './correction-applier';

/** Default concurrency for parallel page processing */
const DEFAULT_CONCURRENCY = 1;

/** Default max retries per VLM call */
const DEFAULT_MAX_RETRIES = 3;

/** Default temperature for VLM generation */
const DEFAULT_TEMPERATURE = 0;

/** Options for VlmTextCorrector */
export interface VlmTextCorrectorOptions {
  /** Number of concurrent page processing (default: 1) */
  concurrency?: number;
  /** Maximum retries per VLM call (default: 3) */
  maxRetries?: number;
  /** Temperature for generation (default: 0) */
  temperature?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Token usage aggregator for tracking */
  aggregator?: LLMTokenUsageAggregator;
  /** Callback fired after each page completes, with cumulative token usage */
  onTokenUsage?: (report: TokenUsageReport) => void;
  /** BCP 47 language tags detected during sampling (e.g., ['ko-KR', 'en-US']) */
  documentLanguages?: string[];
  /** Pre-extracted page texts from pdftotext (1-based pageNo → text) */
  pageTexts?: Map<number, string>;
  /** Pages containing Hanja detected from text layer (1-based). Only these pages get VLM correction. */
  koreanHanjaMixPages?: number[];
}

/** Result of VLM text correction */
export interface VlmTextCorrectionResult {
  /** Total number of text corrections applied */
  textCorrections: number;
  /** Total number of cell corrections applied */
  cellCorrections: number;
  /** Number of pages processed */
  pagesProcessed: number;
  /** Number of pages that failed VLM correction (OCR text kept as-is) */
  pagesFailed: number;
}

/**
 * VLM text corrector that fixes OCR errors by comparing page images
 * against OCR-extracted text.
 *
 * Reads the DoclingDocument from the OCR output directory, sends each page's
 * text elements and table cells to a VLM for correction, then merges
 * corrections back and saves the updated document.
 */
export class VlmTextCorrector {
  constructor(private readonly logger: LoggerMethods) {}

  /**
   * Read DoclingDocument from output directory, correct text via VLM,
   * and save the corrected document back.
   *
   * @param outputDir - Directory containing result.json and pages/
   * @param model - Vision language model for text correction
   * @param options - Processing options
   * @returns Correction statistics
   */
  async correctAndSave(
    outputDir: string,
    model: LanguageModel,
    options?: VlmTextCorrectorOptions,
  ): Promise<VlmTextCorrectionResult> {
    this.logger.info('[VlmTextCorrector] Starting text correction...');

    const resultPath = join(outputDir, 'result.json');
    const doc: DoclingDocument = JSON.parse(readFileSync(resultPath, 'utf-8'));

    const allPageNumbers = this.getPageNumbers(doc);
    if (allPageNumbers.length === 0) {
      this.logger.info('[VlmTextCorrector] No pages to process');
      return {
        textCorrections: 0,
        cellCorrections: 0,
        pagesProcessed: 0,
        pagesFailed: 0,
      };
    }

    let pageNumbers: number[];
    if (
      options?.koreanHanjaMixPages &&
      options.koreanHanjaMixPages.length > 0
    ) {
      const hanjaSet = new Set(options.koreanHanjaMixPages);
      pageNumbers = allPageNumbers.filter((p) => hanjaSet.has(p));
      this.logger.info(
        `[VlmTextCorrector] Filtering to ${pageNumbers.length} Korean-Hanja mix pages out of ${allPageNumbers.length} total`,
      );
    } else {
      pageNumbers = allPageNumbers;
    }

    const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
    this.logger.info(
      `[VlmTextCorrector] Processing ${pageNumbers.length} pages (concurrency: ${concurrency})...`,
    );

    const results = await ConcurrentPool.run(
      pageNumbers,
      concurrency,
      (pageNo) => this.correctPage(outputDir, doc, pageNo, model, options),
      () => {
        if (options?.onTokenUsage && options?.aggregator) {
          options.onTokenUsage(
            options.aggregator.getReport() as TokenUsageReport,
          );
        }
      },
    );

    // Aggregate results
    let totalTextCorrections = 0;
    let totalCellCorrections = 0;
    let pagesFailed = 0;
    for (const result of results) {
      if (result === null) {
        pagesFailed++;
      } else {
        totalTextCorrections += result.tc.length;
        totalCellCorrections += result.cc.length;
      }
    }

    // Apply corrections to document
    pageNumbers.forEach((pageNo, i) => {
      const corrections = results[i];
      if (corrections === null) return;
      applyCorrections(doc, pageNo, corrections, this.logger);
    });

    // Save corrected document
    writeFileSync(resultPath, JSON.stringify(doc, null, 2));

    this.logger.info(
      `[VlmTextCorrector] Correction complete: ${totalTextCorrections} text, ${totalCellCorrections} cell corrections across ${pageNumbers.length} pages (${pagesFailed} failed)`,
    );

    return {
      textCorrections: totalTextCorrections,
      cellCorrections: totalCellCorrections,
      pagesProcessed: pageNumbers.length,
      pagesFailed,
    };
  }

  /**
   * Get sorted page numbers from the document.
   */
  private getPageNumbers(doc: DoclingDocument): number[] {
    return Object.values(doc.pages)
      .map((p) => p.page_no)
      .sort((a, b) => a - b);
  }

  /**
   * Correct text on a single page via VLM.
   * Returns null if VLM call fails (graceful degradation).
   */
  private async correctPage(
    outputDir: string,
    doc: DoclingDocument,
    pageNo: number,
    model: LanguageModel,
    options?: VlmTextCorrectorOptions,
  ): Promise<VlmTextCorrectionOutput | null> {
    try {
      const pageTexts = getPageTexts(doc, pageNo);
      const pageTables = getPageTables(doc, pageNo);

      // Skip pages with no text or table content
      if (pageTexts.length === 0 && pageTables.length === 0) {
        this.logger.debug(
          `[VlmTextCorrector] Page ${pageNo}: no text content, skipping`,
        );
        return { tc: [], cc: [] };
      }

      const imageBase64 = this.readPageImage(outputDir, pageNo);

      const pageText = options?.pageTexts?.get(pageNo);
      let references: Map<number, string> | undefined;
      let tableContext: string | undefined;

      if (pageText) {
        const { references: refs, unusedBlocks } =
          matchTextToReferenceWithUnused(pageTexts, pageText);
        references = refs;

        if (pageTables.length > 0 && unusedBlocks.length > 0) {
          tableContext = unusedBlocks.join('\n');
        }
      }

      const userPrompt = this.buildUserPrompt(
        pageTexts,
        pageTables,
        references,
        tableContext,
      );

      const systemPrompt = this.buildLanguageAwareSystemPrompt(
        options?.documentLanguages,
      );
      const fullPrompt = systemPrompt + '\n\n' + userPrompt;

      const result = await LLMCaller.callVision({
        schema: vlmTextCorrectionSchema as any,
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'text' as const,
                text: fullPrompt,
              },
              {
                type: 'image' as const,
                image: imageBase64,
                mediaType: 'image/png' as const,
              },
            ],
          },
        ],
        primaryModel: model,
        maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
        abortSignal: options?.abortSignal,
        component: 'VlmTextCorrector',
        phase: 'text-correction',
      });

      if (options?.aggregator) {
        options.aggregator.track(result.usage);
      }

      const output = result.output as VlmTextCorrectionOutput;

      if (output.tc.length > 0 || output.cc.length > 0) {
        this.logger.debug(
          `[VlmTextCorrector] Page ${pageNo}: ${output.tc.length} text, ${output.cc.length} cell corrections`,
        );
      }

      return output;
    } catch (error) {
      // Rethrow abort errors
      if (options?.abortSignal?.aborted) {
        throw error;
      }

      this.logger.warn(
        `[VlmTextCorrector] Page ${pageNo}: VLM correction failed, keeping OCR text`,
        error,
      );
      return null;
    }
  }

  /**
   * Build compact user prompt for a page.
   *
   * Format:
   * T:
   * 0|sh|제1장 조사개요
   * 1|tx|본 보고서는 ...
   * C:
   * 0|0,0|유구명
   * 0|1,0|1호 住居址
   */
  buildUserPrompt(
    pageTexts: Array<{ index: number; item: DoclingTextItem }>,
    pageTables: Array<{ index: number; item: DoclingTableItem }>,
    references?: Map<number, string>,
    tableContext?: string,
  ): string {
    const parts: string[] = [];

    if (pageTexts.length > 0) {
      const textLines: string[] = [];
      pageTexts.forEach((entry, promptIndex) => {
        const typeCode = LABEL_TO_TYPE_CODE[entry.item.label] ?? 'tx';
        textLines.push(`${promptIndex}|${typeCode}|${entry.item.text}`);
        const ref = references?.get(promptIndex);
        if (ref) {
          textLines.push(`${promptIndex}|ref|${ref}`);
        }
      });
      parts.push('T:\n' + textLines.join('\n'));
    }

    if (pageTables.length > 0) {
      const cellLines = pageTables.flatMap((entry, tablePromptIndex) =>
        entry.item.data.table_cells
          .filter((cell) => cell.text && cell.text.trim().length > 0)
          .map(
            (cell) =>
              `${tablePromptIndex}|${cell.start_row_offset_idx},${cell.start_col_offset_idx}|${cell.text}`,
          ),
      );
      if (cellLines.length > 0) {
        const cellSection = 'C:\n' + cellLines.join('\n');
        if (tableContext) {
          parts.push(cellSection + '\nC_REF:\n' + tableContext);
        } else {
          parts.push(cellSection);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Build a language-aware system prompt by prepending language context.
   */
  private buildLanguageAwareSystemPrompt(documentLanguages?: string[]): string {
    if (!documentLanguages?.length) {
      return TEXT_CORRECTION_SYSTEM_PROMPT;
    }
    const languageDesc = buildLanguageDescription(documentLanguages);
    const prefix =
      `LANGUAGE CONTEXT: This document is ${languageDesc}. ` +
      'Focus on correcting characters that do not match this language.\n\n';
    return prefix + TEXT_CORRECTION_SYSTEM_PROMPT;
  }

  /**
   * Read page image as base64.
   * Page images are 0-indexed: page_no N → pages/page_{N-1}.png
   */
  private readPageImage(outputDir: string, pageNo: number): Uint8Array {
    const imagePath = join(outputDir, 'pages', `page_${pageNo - 1}.png`);
    return new Uint8Array(readFileSync(imagePath));
  }
}
