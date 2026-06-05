import { z } from 'zod';

import { LLM_MODELS } from '~/features/upload/constants/llm-models';

import {
  imageIdSchema,
  pageIndexSchema,
  taskIdSchema,
  taskStatusSchema,
} from './common';
import { paginationSchema } from './pagination';

// Valid LLM model IDs
const llmModelIds = LLM_MODELS.map((m) => m.id);

/**
 * LLM model ID validator
 */
const llmModelSchema = z.string().refine((val) => llmModelIds.includes(val), {
  message: 'Invalid LLM model ID',
});

const correctionTaskModelSchema = z
  .object({
    textOcrHanja: llmModelSchema.optional(),
    textIntegrity: llmModelSchema.optional(),
    textRoleFootnote: llmModelSchema.optional(),
    tables: llmModelSchema.optional(),
    picturesCaptions: llmModelSchema.optional(),
    layoutBboxOrder: llmModelSchema.optional(),
  })
  .optional();

const correctionMaxRetriesSchema = z
  .object({
    textCorrection: z.number().int().nonnegative().max(10).optional(),
    pageGate: z.number().int().nonnegative().max(10).optional(),
    reviewAssistance: z.number().int().nonnegative().max(10).optional(),
    tableCorrection: z.number().int().nonnegative().max(10).optional(),
  })
  .optional();

const correctionOptionsSchema = z.object({
  // Each correction slot can take a local primary model with a cloud fallback
  // (mirrors heripo-web's backoffice config). The `*Fallback` ids are carried
  // as defaults in DEFAULT_FORM_VALUES; the UI does not expose them, so they
  // round-trip through `JSON.stringify(options)` without a dedicated selector.
  models: z.object({
    textCorrection: llmModelSchema,
    textCorrectionFallback: llmModelSchema.optional(),
    pageGate: llmModelSchema,
    pageGateFallback: llmModelSchema.optional(),
    reviewAssistance: llmModelSchema,
    reviewAssistanceFallback: llmModelSchema.optional(),
    tableCorrection: llmModelSchema.optional(),
    tableCorrectionFallback: llmModelSchema.optional(),
    reviewAssistanceTasks: correctionTaskModelSchema,
    reviewAssistanceTasksFallback: correctionTaskModelSchema,
  }),
  concurrency: z
    .object({
      pages: z.number().int().positive().max(50).default(1),
      reviewTasks: z.number().int().positive().max(6).default(6),
      tables: z.number().int().positive().max(10).default(1),
    })
    .optional(),
  // BCP 47 language tag for AI prompt output (descriptions, reasons).
  // Defaults to ko-KR; the library accepts any string.
  outputLanguage: z.string().default('ko-KR'),
  // Optional per-stage retry overrides. When unset, each stage uses the
  // top-level `maxRetries` value.
  maxRetries: correctionMaxRetriesSchema,
  modelConcurrency: z.number().int().positive().max(16).optional(),
  workItemTimeoutMs: z.number().int().positive().max(7_200_000).optional(),
});

/**
 * Processing options schema for PDF processing.
 * Used for POST /api/tasks request body validation.
 */
export const processingOptionsSchema = z.object({
  // Processing options
  threadCount: z.number().int().positive().max(16).default(4),

  // Document type validation
  documentValidationModel: llmModelSchema.optional(),

  // PDF language detection for OCR language hints (local primary + cloud fallback)
  languageDetectionModel: llmModelSchema.optional(),
  languageDetectionFallbackModel: llmModelSchema.optional(),

  // Force image PDF pre-conversion
  forceImagePdf: z.boolean().default(false),

  // Mandatory post-Docling correction
  correction: correctionOptionsSchema,

  // LLM Models
  fallbackModel: llmModelSchema,
  pageRangeParserModel: llmModelSchema,
  tocExtractorModel: llmModelSchema,
  validatorModel: llmModelSchema,
  visionTocExtractorModel: llmModelSchema,
  captionParserModel: llmModelSchema,

  // Batch & Retry
  textCleanerBatchSize: z.number().int().nonnegative().default(20),
  captionParserBatchSize: z.number().int().nonnegative().default(0),
  captionValidatorBatchSize: z.number().int().nonnegative().default(10),
  maxRetries: z.number().int().nonnegative().max(10).default(3),
  enableFallbackRetry: z.boolean().default(true),
});

export type ProcessingOptions = z.infer<typeof processingOptionsSchema>;

// Max file size: 2GB
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * PDF file metadata validation schema.
 * Validates file type and size without the actual file content.
 */
export const pdfFileMetadataSchema = z.object({
  name: z.string(),
  type: z.literal('application/pdf', {
    error: 'Only PDF files are supported',
  }),
  size: z.number().max(MAX_FILE_SIZE, {
    message: 'File size exceeds 2GB limit',
  }),
});

/**
 * Create task FormData schema.
 * Used for POST /api/tasks request validation.
 */
export const createTaskFormDataSchema = z.object({
  file: pdfFileMetadataSchema,
  options: processingOptionsSchema,
  bypassCode: z.string().optional(),
});

export type CreateTaskFormData = z.infer<typeof createTaskFormDataSchema>;

/**
 * GET /api/tasks query params schema.
 */
export const taskListQuerySchema = paginationSchema.extend({
  status: taskStatusSchema.optional(),
});

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

/**
 * Route params for /api/tasks/[taskId]
 */
export const taskRouteParamsSchema = z.object({
  taskId: taskIdSchema,
});

export type TaskRouteParams = z.infer<typeof taskRouteParamsSchema>;

/**
 * Route params for /api/tasks/[taskId]/images/[imageId]
 */
export const imageRouteParamsSchema = z.object({
  taskId: taskIdSchema,
  imageId: imageIdSchema,
});

export type ImageRouteParams = z.infer<typeof imageRouteParamsSchema>;

/**
 * Route params for /api/tasks/[taskId]/pages/[pageIndex]
 */
export const pageRouteParamsSchema = z.object({
  taskId: taskIdSchema,
  pageIndex: pageIndexSchema,
});

export type PageRouteParams = z.infer<typeof pageRouteParamsSchema>;
