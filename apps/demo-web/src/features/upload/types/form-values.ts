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
  ocrLanguages: ['ko-KR', 'zh-Hant', 'en-US'],
  threadCount: 4,
  // Force image PDF pre-conversion
  forceImagePdf: false,
  // Pipeline selection
  pipeline: 'standard',
  // LLM Models
  fallbackModel: 'openai/gpt-5.2',
  validatorModel: 'openai/gpt-5.2',
  pageRangeParserModel: 'google/gemini-3-flash-preview',
  tocExtractorModel: 'together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
  visionTocExtractorModel: 'google/gemini-3-flash-preview',
  captionParserModel: 'together/Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
  // Optional models (undefined = use defaults)
  hanjaQualitySamplerModel: 'openai/gpt-5.2',
  vlmModel: undefined,
  // Batch & Retry
  textCleanerBatchSize: 20,
  captionParserBatchSize: 0,
  captionValidatorBatchSize: 10,
  maxRetries: 3,
  enableFallbackRetry: true,
};
