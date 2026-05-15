import { describe, expect, test } from 'vitest';

import {
  PDF_CORRECTION_DEFAULTS,
  normalizePDFCorrectionOptions,
} from './correction-options';

const model = { modelId: 'model' } as any;

function correction(overrides: Record<string, unknown> = {}) {
  const { models, ...rest } = overrides;
  return {
    models: {
      textCorrection: model,
      pageGate: model,
      reviewAssistance: model,
      ...((models as object | undefined) ?? {}),
    },
    ...rest,
  } as any;
}

describe('normalizePDFCorrectionOptions', () => {
  test('requires correction models', () => {
    expect(() => normalizePDFCorrectionOptions(undefined)).toThrow(
      'PDF correction.models is required',
    );
    expect(() =>
      normalizePDFCorrectionOptions({
        models: { pageGate: model, reviewAssistance: model },
      } as any),
    ).toThrow('PDF correction.models.textCorrection is required');
  });

  test('fills defaults for correction execution settings', () => {
    expect(normalizePDFCorrectionOptions(correction())).toEqual({
      ...PDF_CORRECTION_DEFAULTS,
      models: {
        textCorrection: model,
        pageGate: model,
        reviewAssistance: model,
      },
    });
  });

  test('normalizes concurrency, retry, language, thresholds, and temperature', () => {
    const normalized = normalizePDFCorrectionOptions(
      correction({
        concurrency: { pages: 0, reviewTasks: 2.8, tables: 3 },
        maxRetries: {
          textCorrection: -1,
          pageGate: 2.7,
          reviewAssistance: 4,
          tableCorrection: 5,
        },
        outputLanguage: ' ko-KR ',
        pageGate: { structuralNoiseThreshold: 2 },
        proposalThreshold: 0.7,
        autoApplyThreshold: 0.2,
        temperature: 2,
      }),
    );

    expect(normalized).toMatchObject({
      concurrency: { pages: 1, reviewTasks: 2, tables: 3 },
      maxRetries: {
        textCorrection: 0,
        pageGate: 2,
        reviewAssistance: 4,
        tableCorrection: 5,
      },
      outputLanguage: 'ko-KR',
      pageGate: { structuralNoiseThreshold: 1 },
      proposalThreshold: 0.7,
      autoApplyThreshold: 0.7,
      temperature: 1,
    });
  });
});
