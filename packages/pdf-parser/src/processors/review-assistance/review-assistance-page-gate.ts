import type { LLMTokenUsageAggregator } from '@heripo/shared';
import type { LanguageModel } from 'ai';

import { LLMCaller } from '@heripo/shared';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';

export type ReviewAssistancePageKind =
  | 'toc'
  | 'archaeological_data'
  | 'non_meaningful';

export interface ReviewAssistancePageEligibility {
  pageNo: number;
  eligible: boolean;
  kind: ReviewAssistancePageKind;
  score: number;
  reasons: string[];
  exclusionReasons: string[];
}

export interface ReviewAssistancePageGateContext {
  pageNo: number;
  textBlocks: Array<{
    label: string;
    text: string;
    repeatedAcrossPages?: boolean;
    suspectReasons: string[];
  }>;
  missingTextCandidates: unknown[];
  tables: Array<{ suspectReasons: string[] }>;
  pictures: Array<{ caption?: string; suspectReasons: string[] }>;
  orphanCaptions: unknown[];
  layout: {
    bboxWarnings: unknown[];
  };
  domainPatterns: Array<{ pattern: string; value: string }>;
}

export interface ReviewAssistancePageGateOptions {
  maxRetries?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  aggregator?: LLMTokenUsageAggregator;
  outputLanguage?: string;
}

interface ReviewAssistancePageGateReport {
  schemaName: 'HeripoReviewAssistancePageGateReport';
  version: '1.0';
  pages: ReviewAssistancePageEligibility[];
}

const REVIEW_ASSISTANCE_PAGE_GATE_FILE = 'review_assistance_page_gate.json';
const REVIEW_ASSISTANCE_PAGE_GATE_MAX_RETRIES = 2;
const REVIEW_ASSISTANCE_PAGE_GATE_TEMPERATURE = 0;
const MAX_REASON_COUNT = 12;
const MAX_CONTEXT_TEXT_LENGTH = 1_800;

const reviewAssistancePageGateSchema = z.object({
  eligible: z.boolean(),
  kind: z.enum(['toc', 'archaeological_data', 'non_meaningful']),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).max(MAX_REASON_COUNT),
  exclusionReasons: z.array(z.string()).max(MAX_REASON_COUNT),
});

type ReviewAssistancePageGateOutput = z.infer<
  typeof reviewAssistancePageGateSchema
>;

const REVIEW_ASSISTANCE_PAGE_GATE_PROMPT = `You are deciding whether a single PDF page should run structural Review Assistance after OCR text correction.

Review Assistance is expensive in human attention: it may create proposals for layout, tables, captions, pictures, reading order, and bounding boxes. It should run only when structural review can improve table-of-contents extraction, archaeological/cultural-heritage data extraction, or visible document structure.

This is NOT a language classifier. Reports may be in any language. Do not use locale, script, or missing language-specific keywords as a reason to skip.

Look at the page image and the compact Docling context.

Return eligible=true for pages that include any meaningful structural review target, such as:
- table of contents or document index entries
- body pages with data-bearing text, tables, figures, captions, notes, or layout relationships
- archaeological, cultural heritage, excavation, survey, collection, catalog, or field-report content in any language
- pages where visible text/table/picture structure may affect downstream extraction

Return eligible=false only for pages that are unlikely to benefit from structural review, such as:
- cover/title pages with no body data or structure to correct
- chapter divider pages with only a heading
- barcode/ISBN/QR/colophon-only pages
- blank, decorative, picture-only design, or repeated header/footer-only pages

Fail toward eligible=true when uncertain. Text OCR correction is handled separately; this decision only controls structural Review Assistance.`;

export class ReviewAssistancePageGate {
  async evaluate(
    context: ReviewAssistancePageGateContext,
    image: Uint8Array,
    model: LanguageModel,
    options: ReviewAssistancePageGateOptions = {},
  ): Promise<ReviewAssistancePageEligibility> {
    const result = await LLMCaller.callVision({
      schema: reviewAssistancePageGateSchema as any,
      messages: [
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: this.buildPrompt(context, options.outputLanguage),
            },
            {
              type: 'image' as const,
              image,
              mediaType: 'image/png' as const,
            },
          ],
        },
      ],
      primaryModel: model,
      maxRetries: options.maxRetries ?? REVIEW_ASSISTANCE_PAGE_GATE_MAX_RETRIES,
      temperature:
        options.temperature ?? REVIEW_ASSISTANCE_PAGE_GATE_TEMPERATURE,
      abortSignal: options.abortSignal,
      component: 'ReviewAssistancePageGate',
      phase: 'page-eligibility',
      metadata: { pageNo: context.pageNo },
    });

    options.aggregator?.track(result.usage);

    return this.normalizeOutput(
      context.pageNo,
      result.output as ReviewAssistancePageGateOutput,
    );
  }

  buildPrompt(
    context: ReviewAssistancePageGateContext,
    outputLanguage?: string,
  ): string {
    const outputLanguagePrompt = outputLanguage?.trim()
      ? `Write reasons and exclusionReasons in ${outputLanguage.trim()}.`
      : undefined;
    return [
      REVIEW_ASSISTANCE_PAGE_GATE_PROMPT,
      outputLanguagePrompt,
      'Return JSON only with keys: eligible, kind, score, reasons, exclusionReasons.',
      'Use kind "toc" for table-of-contents/index pages, "archaeological_data" for data-bearing body/structure pages, and "non_meaningful" for skipped pages.',
      'PAGE CONTEXT JSON:',
      JSON.stringify(this.toPromptContext(context)),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private normalizeOutput(
    pageNo: number,
    output: ReviewAssistancePageGateOutput,
  ): ReviewAssistancePageEligibility {
    const eligible = output.eligible;
    const kind = eligible
      ? output.kind === 'non_meaningful'
        ? 'archaeological_data'
        : output.kind
      : 'non_meaningful';
    return {
      pageNo,
      eligible,
      kind,
      score: Math.round(output.score),
      reasons: this.unique(output.reasons.map((reason) => reason.trim())),
      exclusionReasons: eligible
        ? []
        : this.unique(
            output.exclusionReasons
              .map((reason) => reason.trim())
              .filter(Boolean),
          ),
    };
  }

  private toPromptContext(context: ReviewAssistancePageGateContext): unknown {
    const textBlocks = context.textBlocks.map((block) => ({
      label: block.label,
      text: this.truncate(block.text),
      repeatedAcrossPages: block.repeatedAcrossPages,
      suspectReasons: block.suspectReasons,
    }));
    return {
      pageNo: context.pageNo,
      textBlocks,
      textBlockCount: context.textBlocks.length,
      tableCount: context.tables.length,
      pictureCount: context.pictures.length,
      missingTextCandidateCount: context.missingTextCandidates.length,
      orphanCaptionCount: context.orphanCaptions.length,
      bboxWarningCount: context.layout.bboxWarnings.length,
      tables: context.tables,
      pictures: context.pictures,
      domainPatterns: context.domainPatterns,
    };
  }

  private truncate(value: string): string {
    return value.length <= MAX_CONTEXT_TEXT_LENGTH
      ? value
      : value.slice(0, MAX_CONTEXT_TEXT_LENGTH);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))].slice(0, MAX_REASON_COUNT);
  }
}

export function createReviewAssistancePageGatePendingEligibility(
  pageNo: number,
): ReviewAssistancePageEligibility {
  return {
    pageNo,
    eligible: true,
    kind: 'archaeological_data',
    score: 100,
    reasons: ['page_gate_not_evaluated'],
    exclusionReasons: [],
  };
}

export function createReviewAssistancePageGateFailOpenEligibility(
  pageNo: number,
  reason: string,
): ReviewAssistancePageEligibility {
  return {
    pageNo,
    eligible: true,
    kind: 'archaeological_data',
    score: 100,
    reasons: ['page_gate_failed_open', reason],
    exclusionReasons: [],
  };
}

export function isReviewAssistancePageGatePending(
  eligibility: ReviewAssistancePageEligibility,
): boolean {
  return eligibility.reasons?.includes('page_gate_not_evaluated') ?? false;
}

export function readReviewAssistancePageGateReport(
  outputDir: string,
): Map<number, ReviewAssistancePageEligibility> | undefined {
  const path = join(outputDir, REVIEW_ASSISTANCE_PAGE_GATE_FILE);
  if (!existsSync(path)) return undefined;
  const report = JSON.parse(
    readFileSync(path, 'utf-8'),
  ) as ReviewAssistancePageGateReport;
  return new Map(report.pages.map((page) => [page.pageNo, page]));
}

export function writeReviewAssistancePageGateReport(
  outputDir: string,
  pages: ReviewAssistancePageEligibility[],
): void {
  const report: ReviewAssistancePageGateReport = {
    schemaName: 'HeripoReviewAssistancePageGateReport',
    version: '1.0',
    pages: [...pages].sort((a, b) => a.pageNo - b.pageNo),
  };
  writeFileSync(
    join(outputDir, REVIEW_ASSISTANCE_PAGE_GATE_FILE),
    JSON.stringify(report, null, 2),
  );
}
