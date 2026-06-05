import type { ProcessingOptions } from '~/lib/validations';

// Re-export ProcessingOptions from validations for convenience
export type { ProcessingOptions } from '~/lib/validations';

/**
 * Form values type for PDF processing form.
 * Used with @tanstack/react-form for form state management.
 * Extends ProcessingOptions with file field.
 */
export interface ProcessingFormValues extends ProcessingOptions {
  file: File | null;
}

/**
 * Default values for the processing form.
 * LLM models are tested for optimal performance and cost balance.
 */
export const DEFAULT_FORM_VALUES: ProcessingFormValues = {
  file: null,
  threadCount: 4,
  // Document type validation
  documentValidationModel: 'openai/gpt-5.4',
  // PDF language detection for OCR language hints
  languageDetectionModel: 'openai/gpt-5.4',
  // Force image PDF pre-conversion
  forceImagePdf: false,
  // Mandatory post-Docling correction.
  // NOTE: review assistance (the structural correction logic) is disabled for
  // the demo — only the text-correction stage runs (see `reviewAssistanceEnabled:
  // false` in task-worker.ts). Accordingly, only `textCorrection` uses a local
  // model (LM Studio gemma 26b) with a cloud fallback so it still completes if
  // the local model fails; every other slot stays on the original cloud models
  // and is inert while review assistance is off.
  correction: {
    models: {
      textCorrection: 'lmstudio/gemma-4-26b-a4b-it-mlx',
      textCorrectionFallback: 'openai/gpt-5.4',
      pageGate: 'google/gemini-3.1-flash-lite',
      reviewAssistance: 'google/gemini-3.1-flash-lite',
      tableCorrection: 'openai/gpt-5-mini',
      reviewAssistanceTasks: {
        textOcrHanja: 'google/gemini-3.1-flash-lite',
        textIntegrity: 'google/gemini-3.1-flash-lite',
        textRoleFootnote: 'google/gemini-3.1-flash-lite',
        tables: 'openai/gpt-5-mini',
        picturesCaptions: 'google/gemini-3.1-flash-lite',
        layoutBboxOrder: 'google/gemini-3.1-flash-lite',
      },
    },
    concurrency: {
      pages: 2,
      reviewTasks: 6,
      tables: 1,
    },
    outputLanguage: 'ko-KR',
    maxRetries: undefined,
    modelConcurrency: 3,
    workItemTimeoutMs: 1_800_000,
  },
  // LLM Models
  fallbackModel: 'openai/gpt-5.4',
  validatorModel: 'openai/gpt-5.4',
  pageRangeParserModel: 'google/gemini-3-flash-preview',
  tocExtractorModel: 'together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
  visionTocExtractorModel: 'google/gemini-3-flash-preview',
  captionParserModel: 'together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
  // Batch & Retry
  textCleanerBatchSize: 20,
  captionParserBatchSize: 0,
  captionValidatorBatchSize: 10,
  maxRetries: 3,
  enableFallbackRetry: true,
};
