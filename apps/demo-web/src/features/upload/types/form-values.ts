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
  documentValidationModel: 'together/MiniMaxAI/MiniMax-M3',
  // PDF language detection for OCR language hints
  languageDetectionModel: 'lmstudio/gemma-4-26b-a4b-it-mlx',
  // Force image PDF pre-conversion
  forceImagePdf: false,
  // Mandatory post-Docling correction.
  // review-assistanceEnabled defaults to false so the heavier automatic
  // correction flow is off by default in the demo UI.
  correction: {
    reviewAssistanceEnabled: false,
    tableCorrectionEnabled: false,
    models: {
      textCorrection: 'lmstudio/gemma-4-26b-a4b-it-mlx',
      textCorrectionFallback: 'google/gemini-3.1-flash-lite',
      pageGate: 'lmstudio/gemma-4-26b-a4b-it-mlx',
      reviewAssistance: 'lmstudio/gemma-4-26b-a4b-it-mlx',
      tableCorrection: 'together/MiniMaxAI/MiniMax-M3',
      reviewAssistanceTasks: {
        textOcrHanja: 'lmstudio/gemma-4-26b-a4b-it-mlx',
        textIntegrity: 'lmstudio/gemma-4-26b-a4b-it-mlx',
        textRoleFootnote: 'lmstudio/gemma-4-26b-a4b-it-mlx',
        tables: 'together/MiniMaxAI/MiniMax-M3',
        picturesCaptions: 'lmstudio/gemma-4-26b-a4b-it-mlx',
        layoutBboxOrder: 'lmstudio/gemma-4-26b-a4b-it-mlx',
      },
    },
    concurrency: {
      pages: 10,
      reviewTasks: 6,
      tables: 1,
    },
    outputLanguage: 'ko-KR',
    maxRetries: undefined,
    modelConcurrency: 3,
    workItemTimeoutMs: 1_800_000,
  },
  // LLM Models
  fallbackModel: 'openai/gpt-5.4-mini',
  validatorModel: 'openai/gpt-5.4-mini',
  pageRangeParserModel: 'together/MiniMaxAI/MiniMax-M3',
  tocExtractorModel: 'together/MiniMaxAI/MiniMax-M3',
  visionTocExtractorModel: 'together/MiniMaxAI/MiniMax-M3',
  captionParserModel: 'lmstudio/gemma-4-26b-a4b-it-mlx',
  // Batch & Retry
  textCleanerBatchSize: 20,
  captionParserBatchSize: 0,
  captionValidatorBatchSize: 10,
  maxRetries: 3,
  enableFallbackRetry: true,
};
