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
  });

  test.each([
    {
      field: 'textCorrection',
      models: { pageGate: model, reviewAssistance: model },
    },
    {
      field: 'pageGate',
      models: { textCorrection: model, reviewAssistance: model },
    },
    {
      field: 'reviewAssistance',
      models: { textCorrection: model, pageGate: model },
    },
  ])('requires correction.models.$field to be present', ({ field, models }) => {
    expect(() => normalizePDFCorrectionOptions({ models } as any)).toThrow(
      `PDF correction.models.${field} is required`,
    );
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
        localModelConcurrency: 2.9,
        workItemTimeoutMs: 599_999.9,
        pageGate: { structuralNoiseThreshold: 2 },
        proposalThreshold: 0.7,
        autoApplyThreshold: 0.2,
        temperature: 1.5,
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
      localModelConcurrency: 2,
      workItemTimeoutMs: 599_999,
      pageGate: { structuralNoiseThreshold: 1 },
      proposalThreshold: 0.7,
      autoApplyThreshold: 0.7,
      temperature: 1.5,
    });
  });

  test('clamps temperature to the API-supported [0, 2] range', () => {
    const above = normalizePDFCorrectionOptions(correction({ temperature: 3 }));
    const below = normalizePDFCorrectionOptions(
      correction({ temperature: -1 }),
    );

    expect(above.temperature).toBe(2);
    expect(below.temperature).toBe(0);
  });
});
