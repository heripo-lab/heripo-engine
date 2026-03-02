import type { LoggerMethods } from '@heripo/logger';
import type {
  DoclingDocument,
  DoclingTableItem,
  DoclingTextItem,
  TokenUsageReport,
} from '@heripo/model';
import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { ConcurrentPool, LLMCaller } from '@heripo/shared';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type VlmTextCorrectionOutput,
  vlmTextCorrectionSchema,
} from '../types/vlm-text-correction-schema';

/** Language display names for prompt context (keyed by ISO 639-1 base language code) */
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

/** Minimum character overlap ratio to consider a pdftotext line as matching an OCR element */
const REFERENCE_MATCH_THRESHOLD = 0.4;

/** Default concurrency for parallel page processing */
const DEFAULT_CONCURRENCY = 1;

/** Default max retries per VLM call */
const DEFAULT_MAX_RETRIES = 3;

/** Default temperature for VLM generation */
const DEFAULT_TEMPERATURE = 0;

/** Type abbreviation codes for text element labels */
const LABEL_TO_TYPE_CODE: Record<string, string> = {
  section_header: 'sh',
  text: 'tx',
  caption: 'ca',
  footnote: 'fn',
  list_item: 'li',
  page_header: 'ph',
  page_footer: 'pf',
};

/** Text labels that should be included in VLM correction */
const TEXT_LABELS = new Set(Object.keys(LABEL_TO_TYPE_CODE));

/**
 * System prompt for VLM text correction.
 * Instructs the VLM to compare OCR text against the page image and fix errors.
 */
const TEXT_CORRECTION_SYSTEM_PROMPT = `You are a text correction engine for OCR output from Korean archaeological (考古學) report PDFs. Compare OCR text against the page image and reference text to fix errors.

The OCR engine cannot read Chinese characters (漢字/Hanja) correctly. These errors appear as:
- Random ASCII letters/symbols: 熊津 → "M", 小京制 → "5☆", 故址 → "Bbt"
- Meaningless Korean syllables: 東明 → "햇배", 金憲昌 → "숲", 總管 → "3씁"
- Number/symbol noise: 熊川州 → "IEJIM", 湯井郡 → "3#"
- Hanja dropped entirely: (株)韓國纖維 → (주), (財)忠淸文化財硏究院 → (재)충남문화재연구원
- Phonetic reading substitution (音讀): 漢字 replaced by Korean pronunciation, e.g. 忠淸文化財硏究院 → 충남문화재연구원, 實玉洞遺蹟 → 실옥동유적

FIX: garbled/wrong Chinese characters, mojibake, encoding artifacts, random ASCII/Korean replacing Hanja, dropped Hanja, phonetic reading substitutions
KEEP: correct text, structure, punctuation, whitespace

Input format:
T: (text elements) index|type|text
   Optional: index|ref|reference_text (PDF text layer for the above element)
C: (table cells) tableIndex|row,col|text
   Optional: C_REF: (unused pdftotext blocks as table reference)

FOOTNOTE (fn) SPECIAL INSTRUCTIONS:
- Footnotes in archaeological reports contain institution names with Hanja that are severely garbled
- Common pattern: (財)機關名硏究院 → (W)#X1CR003T or (W): 103 or similar ASCII noise
- When OCR shows patterns like (W), (M), or random ASCII where an institution name should be, READ THE IMAGE directly
- Institution names follow patterns like: (財)OO文化財硏究院, (株)OO, (社)OO學會

TABLE CELL (C:) SPECIAL INSTRUCTIONS:
- Table headers often contain Hanja that OCR cannot read: 發刊日, 時代, 調査緣由, 調査機關, 遺蹟名, 類型 및 基數
- When OCR shows garbled characters like "₩ A", "#쩯및표뽰" in table cells, READ THE IMAGE directly
- If C_REF is present, use it as additional context for correcting table cells

When a |ref| line is present:
- It shows text extracted directly from the PDF text layer for that element
- If OCR text contains garbled characters but ref text looks correct, USE the ref text
- For long paragraphs, align OCR and ref text segment by segment to identify and fix each garbled portion
- IMPORTANT: If BOTH OCR and ref text are garbled (e.g. CJK font encoding issues), IGNORE the ref text and READ THE IMAGE directly

When NO |ref| line is present:
- The PDF text layer could not be matched to this element
- READ THE IMAGE directly to determine the correct text

Output JSON with corrections:
tc=[{i:index, s:[{f:"garbled_substring",r:"corrected_text"}, ...]}] for text
cc=[{ti:tableIndex, r:row, c:col, t:corrected}] for table cells

Substitution rules for tc:
- 'f': exact garbled/wrong substring from the input text (must match exactly)
- 'r': the corrected replacement
- Include ALL garbled portions for each element as separate s entries
- Order substitutions left-to-right as they appear in the text
- Do NOT include unchanged text — only the specific substrings that need fixing

If all correct: {"tc":[],"cc":[]}`;

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

    let pageNumbers = this.getPageNumbers(doc);
    if (pageNumbers.length === 0) {
      this.logger.info('[VlmTextCorrector] No pages to process');
      return {
        textCorrections: 0,
        cellCorrections: 0,
        pagesProcessed: 0,
        pagesFailed: 0,
      };
    }

    if (
      options?.koreanHanjaMixPages &&
      options.koreanHanjaMixPages.length > 0
    ) {
      const totalPageCount = pageNumbers.length;
      const hanjaSet = new Set(options.koreanHanjaMixPages);
      pageNumbers = pageNumbers.filter((p) => hanjaSet.has(p));
      this.logger.info(
        `[VlmTextCorrector] Filtering to ${pageNumbers.length} Korean-Hanja mix pages out of ${totalPageCount} total`,
      );
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
    for (let i = 0; i < pageNumbers.length; i++) {
      const corrections = results[i];
      if (corrections === null) continue;
      this.applyCorrections(doc, pageNumbers[i], corrections);
    }

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
      const pageTexts = this.getPageTexts(doc, pageNo);
      const pageTables = this.getPageTables(doc, pageNo);

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
          this.matchTextToReferenceWithUnused(pageTexts, pageText);
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
                image: `data:image/png;base64,${imageBase64}`,
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
   * Get text items on a specific page, with their indices for prompt building.
   */
  private getPageTexts(
    doc: DoclingDocument,
    pageNo: number,
  ): Array<{ index: number; item: DoclingTextItem }> {
    const results: Array<{ index: number; item: DoclingTextItem }> = [];

    for (let i = 0; i < doc.texts.length; i++) {
      const item = doc.texts[i];
      if (!TEXT_LABELS.has(item.label)) continue;
      if (item.prov.some((p) => p.page_no === pageNo)) {
        results.push({ index: i, item });
      }
    }

    return results;
  }

  /**
   * Get table items on a specific page, with their indices.
   */
  private getPageTables(
    doc: DoclingDocument,
    pageNo: number,
  ): Array<{ index: number; item: DoclingTableItem }> {
    const results: Array<{ index: number; item: DoclingTableItem }> = [];

    for (let i = 0; i < doc.tables.length; i++) {
      const item = doc.tables[i];
      if (item.prov.some((p) => p.page_no === pageNo)) {
        results.push({ index: i, item });
      }
    }

    return results;
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
      const cellLines: string[] = [];
      for (
        let tablePromptIndex = 0;
        tablePromptIndex < pageTables.length;
        tablePromptIndex++
      ) {
        const table = pageTables[tablePromptIndex].item;
        for (const cell of table.data.table_cells) {
          if (!cell.text || cell.text.trim().length === 0) continue;
          cellLines.push(
            `${tablePromptIndex}|${cell.start_row_offset_idx},${cell.start_col_offset_idx}|${cell.text}`,
          );
        }
      }
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
    const primaryBase = documentLanguages[0].split('-')[0];
    const primaryName =
      LANGUAGE_DISPLAY_NAMES[primaryBase] ?? documentLanguages[0];
    const otherNames = documentLanguages
      .slice(1)
      .map((code) => LANGUAGE_DISPLAY_NAMES[code.split('-')[0]] ?? code);
    const languageDesc =
      otherNames.length > 0
        ? `primarily written in ${primaryName}, with ${otherNames.join(', ')} also present`
        : `written in ${primaryName}`;
    const prefix =
      `LANGUAGE CONTEXT: This document is ${languageDesc}. ` +
      'Focus on correcting characters that do not match this language.\n\n';
    return prefix + TEXT_CORRECTION_SYSTEM_PROMPT;
  }

  /**
   * Match pdftotext paragraph blocks to OCR elements using character multiset overlap.
   * Returns a map from prompt index to the best-matching reference block.
   */
  matchTextToReference(
    pageTexts: Array<{ index: number; item: DoclingTextItem }>,
    pageText: string,
  ): Map<number, string> {
    return this.matchTextToReferenceWithUnused(pageTexts, pageText).references;
  }

  /**
   * Match pdftotext paragraph blocks to OCR elements and also return unused blocks.
   * Unused blocks are those that were not consumed by any text element match.
   */
  private matchTextToReferenceWithUnused(
    pageTexts: Array<{ index: number; item: DoclingTextItem }>,
    pageText: string,
  ): { references: Map<number, string>; unusedBlocks: string[] } {
    const references = new Map<number, string>();

    const refBlocks = this.mergeIntoBlocks(pageText);

    if (refBlocks.length === 0) {
      return { references, unusedBlocks: [] };
    }

    const available = new Set(refBlocks.map((_, i) => i));

    for (let promptIndex = 0; promptIndex < pageTexts.length; promptIndex++) {
      const ocrText = pageTexts[promptIndex].item.text;

      let bestScore = 0;
      let bestBlockIndex = -1;

      for (const blockIndex of available) {
        const score = this.computeCharOverlap(ocrText, refBlocks[blockIndex]);
        if (score > bestScore) {
          bestScore = score;
          bestBlockIndex = blockIndex;
        }
      }

      if (bestBlockIndex >= 0 && bestScore >= REFERENCE_MATCH_THRESHOLD) {
        if (refBlocks[bestBlockIndex] !== ocrText) {
          references.set(promptIndex, refBlocks[bestBlockIndex]);
        }
        available.delete(bestBlockIndex);
      }
    }

    const unusedBlocks = [...available]
      .sort((a, b) => a - b)
      .map((i) => refBlocks[i]);

    return { references, unusedBlocks };
  }

  /**
   * Merge pdftotext output into paragraph blocks separated by blank lines.
   * Consecutive non-empty lines are joined with a space.
   */
  private mergeIntoBlocks(pageText: string): string[] {
    const blocks: string[] = [];
    let currentLines: string[] = [];

    for (const rawLine of pageText.split('\n')) {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0) {
        if (currentLines.length > 0) {
          blocks.push(currentLines.join(' '));
          currentLines = [];
        }
      } else {
        currentLines.push(trimmed);
      }
    }
    if (currentLines.length > 0) {
      blocks.push(currentLines.join(' '));
    }

    return blocks;
  }

  /**
   * Compute character multiset overlap ratio between two strings.
   * Returns a value between 0.0 and 1.0.
   */
  private computeCharOverlap(a: string, b: string): number {
    if (a.length === 0 || b.length === 0) return 0;

    const freqA = new Map<string, number>();
    for (const ch of a) {
      freqA.set(ch, (freqA.get(ch) ?? 0) + 1);
    }

    const freqB = new Map<string, number>();
    for (const ch of b) {
      freqB.set(ch, (freqB.get(ch) ?? 0) + 1);
    }

    let overlap = 0;
    for (const [ch, countA] of freqA) {
      const countB = freqB.get(ch) ?? 0;
      overlap += Math.min(countA, countB);
    }

    return overlap / Math.max(a.length, b.length);
  }

  /**
   * Read page image as base64.
   * Page images are 0-indexed: page_no N → pages/page_{N-1}.png
   */
  private readPageImage(outputDir: string, pageNo: number): string {
    const imagePath = join(outputDir, 'pages', `page_${pageNo - 1}.png`);
    return readFileSync(imagePath).toString('base64');
  }

  /**
   * Apply VLM corrections to the DoclingDocument.
   */
  private applyCorrections(
    doc: DoclingDocument,
    pageNo: number,
    corrections: VlmTextCorrectionOutput,
  ): void {
    // Apply text corrections (substitution-based)
    if (corrections.tc.length > 0) {
      const pageTexts = this.getPageTexts(doc, pageNo);
      for (const correction of corrections.tc) {
        if (correction.i >= 0 && correction.i < pageTexts.length) {
          const docIndex = pageTexts[correction.i].index;
          let text = doc.texts[docIndex].text;
          for (const sub of correction.s) {
            const idx = text.indexOf(sub.f);
            if (idx >= 0) {
              text =
                text.substring(0, idx) +
                sub.r +
                text.substring(idx + sub.f.length);
            } else {
              this.logger.warn(
                `[VlmTextCorrector] Page ${pageNo}, text ${correction.i}: ` +
                  `find string not found, skipping substitution`,
              );
            }
          }
          if (text !== doc.texts[docIndex].text) {
            doc.texts[docIndex].text = text;
            doc.texts[docIndex].orig = text;
          }
        }
      }
    }

    // Apply cell corrections
    if (corrections.cc.length > 0) {
      const pageTables = this.getPageTables(doc, pageNo);
      for (const correction of corrections.cc) {
        if (correction.ti >= 0 && correction.ti < pageTables.length) {
          const table = pageTables[correction.ti].item;

          // Update table_cells
          for (const cell of table.data.table_cells) {
            if (
              cell.start_row_offset_idx === correction.r &&
              cell.start_col_offset_idx === correction.c
            ) {
              cell.text = correction.t;
              break;
            }
          }

          // Sync grid cell (grid stores separate objects from table_cells)
          const gridRow = table.data.grid[correction.r];
          if (gridRow) {
            const gridCell = gridRow[correction.c];
            if (gridCell) {
              gridCell.text = correction.t;
            }
          }
        }
      }
    }
  }
}
