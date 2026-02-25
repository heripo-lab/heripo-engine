import { z } from 'zod';

import {
  LLM_MODELS,
  VISION_MODELS,
} from '~/features/upload/constants/llm-models';

import {
  imageIdSchema,
  pageIndexSchema,
  taskIdSchema,
  taskStatusSchema,
} from './common';
import { paginationSchema } from './pagination';

// Valid LLM model IDs
const llmModelIds = LLM_MODELS.map((m) => m.id);
const visionModelIds = VISION_MODELS.map((m) => m.id);

/**
 * LLM model ID validator (any model)
 */
const llmModelSchema = z.string().refine((val) => llmModelIds.includes(val), {
  message: 'Invalid LLM model ID',
});

/**
 * Vision-capable model ID validator
 */
const visionModelSchema = z
  .string()
  .refine((val) => visionModelIds.includes(val), {
    message: 'Model does not support vision',
  });

/**
 * Processing options schema for PDF processing.
 * Used for POST /api/tasks request body validation.
 */
export const processingOptionsSchema = z.object({
  // Processing options
  ocrLanguages: z.array(z.string().min(1)).min(1).default(['ko-KR', 'en-US']),
  threadCount: z.number().int().positive().max(16).default(4),

  // Force image PDF pre-conversion
  forceImagePdf: z.boolean().default(false),

  // OCR Strategy — VLM sampling-based strategy selection
  strategySamplerModel: visionModelSchema.optional(),
  vlmProcessorModel: visionModelSchema.optional(),
  forcedMethod: z.enum(['ocrmac', 'vlm']).optional(),

  // LLM Models
  fallbackModel: llmModelSchema,
  pageRangeParserModel: visionModelSchema,
  tocExtractorModel: llmModelSchema,
  validatorModel: llmModelSchema,
  visionTocExtractorModel: visionModelSchema,
  captionParserModel: llmModelSchema,

  // VLM Processing
  vlmConcurrency: z.number().int().positive().max(10).default(1),

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
