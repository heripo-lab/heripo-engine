import type { LanguageModel } from 'ai';

import type { ReviewAssistanceTaskId } from '../prompts/review-assistance-prompt';

import { PDF_CONVERTER } from '../config/constants';

export interface PDFCorrectionModelOptions {
  textCorrection: LanguageModel;
  /** textCorrection 실패(예: lmstudio 400) 시 LLMCaller fallback. */
  textCorrectionFallback?: LanguageModel;
  pageGate: LanguageModel;
  /** pageGate(page-eligibility) 실패 시 fallback. */
  pageGateFallback?: LanguageModel;
  reviewAssistance: LanguageModel;
  /** review-assistance 공통 fallback (task별 미지정 시 사용). */
  reviewAssistanceFallback?: LanguageModel;
  reviewAssistanceTasks?: Partial<
    Record<ReviewAssistanceTaskId, LanguageModel>
  >;
  /** review-assistance task별 fallback. */
  reviewAssistanceTasksFallback?: Partial<
    Record<ReviewAssistanceTaskId, LanguageModel>
  >;
  tableCorrection?: LanguageModel;
  /** tableCorrection 실패 시 fallback. */
  tableCorrectionFallback?: LanguageModel;
}

export interface PDFCorrectionConcurrencyOptions {
  pages?: number;
  reviewTasks?: number;
  tables?: number;
}

export interface PDFCorrectionMaxRetriesOptions {
  textCorrection?: number;
  pageGate?: number;
  reviewAssistance?: number;
  tableCorrection?: number;
}

export interface PDFCorrectionPageGateOptions {
  structuralNoiseThreshold?: number;
}

export interface PDFCorrectionOptions {
  models: PDFCorrectionModelOptions;
  concurrency?: PDFCorrectionConcurrencyOptions;
  maxRetries?: PDFCorrectionMaxRetriesOptions;
  modelConcurrency?: number;
  workItemTimeoutMs?: number;
  outputLanguage?: string;
  pageGate?: PDFCorrectionPageGateOptions;
  autoApplyThreshold?: number;
  proposalThreshold?: number;
  /**
   * When true, every valid review-assistance command auto-applies regardless of
   * confidence threshold or structural block reason (no manual-review routing).
   * Enabled by the engine demo; defaults to false everywhere else.
   */
  forceAutoApply?: boolean;
  temperature?: number;
}

export interface NormalizedPDFCorrectionOptions {
  models: PDFCorrectionModelOptions;
  concurrency: Required<PDFCorrectionConcurrencyOptions>;
  maxRetries: Required<PDFCorrectionMaxRetriesOptions>;
  modelConcurrency: number;
  workItemTimeoutMs: number;
  outputLanguage: string;
  pageGate: Required<PDFCorrectionPageGateOptions>;
  autoApplyThreshold: number;
  proposalThreshold: number;
  forceAutoApply: boolean;
  temperature: number;
}

export const PDF_CORRECTION_DEFAULTS: Omit<
  NormalizedPDFCorrectionOptions,
  'models'
> = {
  concurrency: {
    pages: 1,
    reviewTasks: 6,
    tables: 1,
  },
  maxRetries: {
    textCorrection: 3,
    pageGate: 3,
    reviewAssistance: 3,
    tableCorrection: 3,
  },
  modelConcurrency: 1,
  workItemTimeoutMs: PDF_CONVERTER.DEFAULT_TIMEOUT_MS,
  outputLanguage: 'en-US',
  pageGate: {
    structuralNoiseThreshold: 0.5,
  },
  autoApplyThreshold: 0.85,
  proposalThreshold: 0.5,
  forceAutoApply: false,
  temperature: 0,
};

function normalizeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizePositiveInt(
  value: number | undefined,
  fallback: number,
): number {
  return Math.max(1, Math.floor(normalizeNumber(value, fallback)));
}

function normalizeNonNegativeInt(
  value: number | undefined,
  fallback: number,
): number {
  return Math.max(0, Math.floor(normalizeNumber(value, fallback)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeThreshold(
  value: number | undefined,
  fallback: number,
): number {
  return clamp(normalizeNumber(value, fallback), 0, 1);
}

/**
 * Normalize a generation temperature value to the API-supported range [0, 2].
 *
 * Kept separate from threshold normalization because temperatures and 0-1
 * thresholds (auto-apply, proposal, structural-noise) intentionally use
 * different ranges.
 */
function normalizeTemperature(
  value: number | undefined,
  fallback: number,
): number {
  return clamp(normalizeNumber(value, fallback), 0, 2);
}

function normalizeOutputLanguage(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || PDF_CORRECTION_DEFAULTS.outputLanguage;
}

function assertModel(
  model: LanguageModel | undefined,
  fieldName: string,
): asserts model is LanguageModel {
  if (!model) {
    throw new Error(`PDF correction.models.${fieldName} is required`);
  }
}

export function normalizePDFCorrectionOptions(
  value: PDFCorrectionOptions | undefined,
): NormalizedPDFCorrectionOptions {
  if (!value?.models) {
    throw new Error('PDF correction.models is required');
  }

  assertModel(value.models.textCorrection, 'textCorrection');
  assertModel(value.models.pageGate, 'pageGate');
  assertModel(value.models.reviewAssistance, 'reviewAssistance');

  const proposalThreshold = normalizeThreshold(
    value.proposalThreshold,
    PDF_CORRECTION_DEFAULTS.proposalThreshold,
  );
  const autoApplyThreshold = Math.max(
    normalizeThreshold(
      value.autoApplyThreshold,
      PDF_CORRECTION_DEFAULTS.autoApplyThreshold,
    ),
    proposalThreshold,
  );

  return {
    models: value.models,
    concurrency: {
      pages: normalizePositiveInt(
        value.concurrency?.pages,
        PDF_CORRECTION_DEFAULTS.concurrency.pages,
      ),
      reviewTasks: normalizePositiveInt(
        value.concurrency?.reviewTasks,
        PDF_CORRECTION_DEFAULTS.concurrency.reviewTasks,
      ),
      tables: normalizePositiveInt(
        value.concurrency?.tables,
        PDF_CORRECTION_DEFAULTS.concurrency.tables,
      ),
    },
    maxRetries: {
      textCorrection: normalizeNonNegativeInt(
        value.maxRetries?.textCorrection,
        PDF_CORRECTION_DEFAULTS.maxRetries.textCorrection,
      ),
      pageGate: normalizeNonNegativeInt(
        value.maxRetries?.pageGate,
        PDF_CORRECTION_DEFAULTS.maxRetries.pageGate,
      ),
      reviewAssistance: normalizeNonNegativeInt(
        value.maxRetries?.reviewAssistance,
        PDF_CORRECTION_DEFAULTS.maxRetries.reviewAssistance,
      ),
      tableCorrection: normalizeNonNegativeInt(
        value.maxRetries?.tableCorrection,
        PDF_CORRECTION_DEFAULTS.maxRetries.tableCorrection,
      ),
    },
    modelConcurrency: normalizePositiveInt(
      value.modelConcurrency,
      PDF_CORRECTION_DEFAULTS.modelConcurrency,
    ),
    workItemTimeoutMs: normalizePositiveInt(
      value.workItemTimeoutMs,
      PDF_CORRECTION_DEFAULTS.workItemTimeoutMs,
    ),
    outputLanguage: normalizeOutputLanguage(value.outputLanguage),
    pageGate: {
      structuralNoiseThreshold: normalizeThreshold(
        value.pageGate?.structuralNoiseThreshold,
        PDF_CORRECTION_DEFAULTS.pageGate.structuralNoiseThreshold,
      ),
    },
    autoApplyThreshold,
    proposalThreshold,
    forceAutoApply:
      value.forceAutoApply ?? PDF_CORRECTION_DEFAULTS.forceAutoApply,
    temperature: normalizeTemperature(
      value.temperature,
      PDF_CORRECTION_DEFAULTS.temperature,
    ),
  };
}
