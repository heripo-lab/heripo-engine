import type { LoggerMethods } from '@heripo/logger';
import type {
  ExtendedTokenUsage,
  LLMTokenUsageAggregator,
} from '@heripo/shared';
import type { LanguageModel } from 'ai';
import type { z } from 'zod';

import { LLMCaller } from '@heripo/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BaseLLMComponent,
  type BaseLLMComponentOptions,
} from './base-llm-component';

/**
 * Options for VisionLLMComponent
 */
export interface VisionLLMComponentOptions extends BaseLLMComponentOptions {
  // Vision components may have additional options in future
}

/**
 * Image content structure for vision LLM messages
 */
export interface ImageContent {
  type: 'image';
  image: Uint8Array;
  mediaType: string;
}

/**
 * Abstract base class for vision-based LLM components
 *
 * Extends BaseLLMComponent with helper methods for vision-based LLM calls
 * using LLMCaller.callVision().
 *
 * Subclasses: PageRangeParser, VisionTocExtractor
 */
export abstract class VisionLLMComponent extends BaseLLMComponent {
  protected readonly outputPath: string;

  constructor(
    logger: LoggerMethods,
    model: LanguageModel,
    componentName: string,
    outputPath: string,
    options?: VisionLLMComponentOptions,
    fallbackModel?: LanguageModel,
    aggregator?: LLMTokenUsageAggregator,
  ) {
    super(logger, model, componentName, options, fallbackModel, aggregator);
    this.outputPath = outputPath;
  }

  /**
   * Call LLM with vision capabilities using LLMCaller.callVision()
   *
   * @template TSchema - Zod schema type for response validation
   * @param schema - Zod schema for response validation
   * @param messages - Messages array including image content
   * @param phase - Phase name for tracking (e.g., 'extraction', 'sampling')
   * @returns Promise with parsed object and usage information
   */
  protected async callVisionLLM<TSchema extends z.ZodType>(
    schema: TSchema,
    messages: Array<{
      role: 'user' | 'assistant';
      content: unknown[] | string;
    }>,
    phase: string,
  ): Promise<{ output: z.infer<TSchema>; usage: ExtendedTokenUsage }> {
    const result = await LLMCaller.callVision({
      schema,
      messages,
      primaryModel: this.model,
      fallbackModel: this.fallbackModel,
      maxRetries: this.maxRetries,
      temperature: this.temperature,
      abortSignal: this.abortSignal,
      component: this.componentName,
      phase,
    });

    this.trackUsage(result.usage);

    return {
      output: result.output as z.infer<TSchema>,
      usage: result.usage,
    };
  }

  /**
   * Build image content object for vision LLM messages
   *
   * @param imagePath - Path to the image file (relative to outputPath or absolute)
   * @param mimeType - MIME type of the image (default: 'image/png')
   * @returns ImageContent object for LLM message
   */
  protected buildImageContent(
    imagePath: string,
    mimeType: string = 'image/png',
  ): ImageContent {
    const absolutePath = path.isAbsolute(imagePath)
      ? imagePath
      : path.resolve(this.outputPath, imagePath);
    const imageData = new Uint8Array(fs.readFileSync(absolutePath));
    return {
      type: 'image',
      image: imageData,
      mediaType: mimeType,
    };
  }
}
