import type { LoggerMethods } from '@heripo/logger';
import type { OcrStrategy } from '@heripo/model';

import type { PDFConvertOptions } from './pdf-converter';

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PageRenderer } from '../processors/page-renderer';
import { PdfTextExtractor } from '../processors/pdf-text-extractor';
import { OcrStrategySampler } from '../samplers/ocr-strategy-sampler';

/**
 * Resolves the OCR strategy based on options and page sampling.
 *
 * When sampling is possible (strategySamplerModel + local file), it always
 * runs — even with forcedMethod — so that detectedLanguages are available
 * for OCR engine configuration. The forced method simply overrides the
 * sampled method choice.
 */
export class StrategyResolver {
  constructor(private readonly logger: LoggerMethods) {}

  async resolve(
    pdfPath: string | null,
    reportId: string,
    options: PDFConvertOptions,
    abortSignal?: AbortSignal,
  ): Promise<OcrStrategy> {
    // Cannot sample: skip, no sampler model, or non-local URL
    if (options.skipSampling || !options.strategySamplerModel || !pdfPath) {
      const method = options.forcedMethod ?? 'ocrmac';
      const reason = options.forcedMethod
        ? `Forced: ${options.forcedMethod}`
        : !pdfPath
          ? 'Non-local URL, sampling skipped'
          : 'Sampling skipped';
      return { method, reason, sampledPages: 0, totalPages: 0 };
    }

    // Sample pages to determine strategy (also detects languages)
    const samplingDir = join(process.cwd(), 'output', reportId, '_sampling');
    const sampler = new OcrStrategySampler(
      this.logger,
      new PageRenderer(this.logger),
      new PdfTextExtractor(this.logger),
    );

    try {
      const strategy = await sampler.sample(
        pdfPath,
        samplingDir,
        options.strategySamplerModel,
        {
          aggregator: options.aggregator,
          abortSignal,
        },
      );

      // Override method when forced, preserving detected languages from sampling
      if (options.forcedMethod) {
        return {
          ...strategy,
          method: options.forcedMethod,
          reason: `Forced: ${options.forcedMethod} (${strategy.reason})`,
        };
      }

      return strategy;
    } finally {
      // Always clean up sampling temp directory
      if (existsSync(samplingDir)) {
        rmSync(samplingDir, { recursive: true, force: true });
      }
    }
  }
}
