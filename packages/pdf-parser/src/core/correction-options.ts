import type { LanguageModel } from 'ai';

import type { ReviewAssistanceTaskId } from '../prompts/review-assistance-prompt';

import { PDF_CONVERTER } from '../config/constants';

export interface PDFCorrectionModelOptions {
  textCorrection: LanguageModel;
  pageGate: LanguageModel;
  reviewAssistance: LanguageModel;
  reviewAssistanceTasks?: Partial<
    Record<ReviewAssistanceTaskId, LanguageModel>
  >;
  tableCorrection?: LanguageModel;
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
  localModelConcurrency?: number;
  workItemTimeoutMs?: number;
  outputLanguage?: string;
  pageGate?: PDFCorrectionPageGateOptions;
  autoApplyThreshold?: number;
  proposalThreshold?: number;
  temperature?: number;
}

export interface NormalizedPDFCorrectionOptions {
  models: PDFCorrectionModelOptions;
  concurrency: Required<PDFCorrectionConcurrencyOptions>;
  maxRetries: Required<PDFCorrectionMaxRetriesOptions>;
  localModelConcurrency: number;
  workItemTimeoutMs: number;
  outputLanguage: string;
  pageGate: Required<PDFCorrectionPageGateOptions>;
  autoApplyThreshold: number;
  proposalThreshold: number;
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
  localModelConcurrency: 1,
  workItemTimeoutMs: PDF_CONVERTER.DEFAULT_TIMEOUT_MS,
  outputLanguage: 'en-US',
  pageGate: {
    structuralNoiseThreshold: 0.5,
  },
  autoApplyThreshold: 0.85,
  proposalThreshold: 0.5,
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
    localModelConcurrency: normalizePositiveInt(
      value.localModelConcurrency,
      PDF_CORRECTION_DEFAULTS.localModelConcurrency,
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
    temperature: normalizeTemperature(
      value.temperature,
      PDF_CORRECTION_DEFAULTS.temperature,
    ),
  };
}
