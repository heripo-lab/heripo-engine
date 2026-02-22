/**
 * @heripo/document-processor
 *
 * Document preprocessing package that converts DoclingDocument to ProcessedDocument.
 *
 * ## Key Features
 *
 * - TOC extraction and structuring (LLM-based)
 * - Page range mapping (Vision LLM)
 * - Text cleaning and sentence merging (lightweight LLM)
 * - Caption parsing (lightweight LLM)
 * - Chapter tree construction
 * - Image/table conversion
 * - Hanja (KCJ) quality assessment (Vision LLM)
 *
 * @packageDocumentation
 */

export { DocumentProcessor } from './document-processor';
export { BaseLLMComponent, TextLLMComponent, VisionLLMComponent } from './core';
export type {
  BaseLLMComponentOptions,
  VisionLLMComponentOptions,
  ImageContent,
} from './core';
export type { DocumentProcessorOptions } from './document-processor';
export type { TocEntry, TocAreaResult, PageSizeGroup } from './types';
export {
  CaptionParser,
  CaptionParseError,
  PageRangeParser,
  PagePattern,
  PageRangeParseError,
} from './parsers';
export type { CaptionParserOptions } from './parsers';
export {
  TocFinder,
  TocExtractor,
  TocExtractError,
  TocNotFoundError,
  TocParseError,
  TOC_KEYWORDS,
  CONTINUATION_MARKERS,
  PAGE_NUMBER_PATTERN,
  TocEntrySchema,
  TocResponseSchema,
  VisionTocExtractor,
  VisionTocExtractionSchema,
} from './extractors';
export type {
  TocFinderOptions,
  TocExtractorOptions,
  TocResponse,
  VisionTocExtractorOptions,
  VisionTocExtractionResult,
} from './extractors';
export {
  BaseValidator,
  TocContentValidator,
  TocContentValidationSchema,
  CaptionValidator,
  CaptionValidationError,
} from './validators';
export type {
  BaseValidatorOptions,
  TocContentValidatorOptions,
  TocContentValidationResult,
  CaptionValidatorOptions,
} from './validators';
export { ChapterConverter } from './converters';
export { HanjaQualitySampler } from './samplers';
