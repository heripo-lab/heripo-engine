import { describe, expect, test } from 'vitest';

import {
  REVIEW_ASSISTANCE_DEFAULTS,
  isReviewAssistanceEnabled,
  normalizeReviewAssistanceOptions,
} from './review-assistance-options';

describe('normalizeReviewAssistanceOptions', () => {
  test('returns disabled defaults when value is undefined', () => {
    expect(normalizeReviewAssistanceOptions(undefined)).toEqual(
      REVIEW_ASSISTANCE_DEFAULTS,
    );
  });

  test('enables defaults when value is true', () => {
    expect(normalizeReviewAssistanceOptions(true)).toEqual({
      ...REVIEW_ASSISTANCE_DEFAULTS,
      enabled: true,
    });
  });

  test('keeps disabled defaults when value is false', () => {
    expect(normalizeReviewAssistanceOptions(false)).toEqual({
      ...REVIEW_ASSISTANCE_DEFAULTS,
      enabled: false,
    });
  });

  test('uses object options with enabled defaulting to false', () => {
    expect(
      normalizeReviewAssistanceOptions({
        autoApplyThreshold: 0.9,
        proposalThreshold: 0.6,
        maxRetries: 2,
        temperature: 0.2,
      }),
    ).toEqual({
      enabled: false,
      concurrency: 1,
      autoApplyThreshold: 0.9,
      proposalThreshold: 0.6,
      maxRetries: 2,
      temperature: 0.2,
    });
  });

  test('uses explicit enabled object option', () => {
    expect(normalizeReviewAssistanceOptions({ enabled: true })).toMatchObject({
      enabled: true,
      concurrency: 1,
    });
  });

  test('ignores legacy concurrency input and always runs one page at a time', () => {
    expect(
      normalizeReviewAssistanceOptions({
        enabled: true,
        concurrency: 8,
      } as any).concurrency,
    ).toBe(1);
  });

  test('clamps confidence thresholds and keeps auto threshold at least proposal threshold', () => {
    expect(
      normalizeReviewAssistanceOptions({
        enabled: true,
        autoApplyThreshold: -1,
        proposalThreshold: 2,
      }),
    ).toMatchObject({
      autoApplyThreshold: 1,
      proposalThreshold: 1,
    });

    expect(
      normalizeReviewAssistanceOptions({
        enabled: true,
        autoApplyThreshold: 0.4,
        proposalThreshold: 0.7,
      }),
    ).toMatchObject({
      autoApplyThreshold: 0.7,
      proposalThreshold: 0.7,
    });
  });

  test('normalizes retry and temperature values', () => {
    expect(
      normalizeReviewAssistanceOptions({
        enabled: true,
        maxRetries: 2.9,
        temperature: 2,
      }),
    ).toMatchObject({
      maxRetries: 2,
      temperature: 1,
    });

    expect(
      normalizeReviewAssistanceOptions({
        enabled: true,
        maxRetries: -1,
        temperature: -0.5,
      }),
    ).toMatchObject({
      maxRetries: 0,
      temperature: 0,
    });
  });
});

describe('isReviewAssistanceEnabled', () => {
  test('detects enabled values', () => {
    expect(isReviewAssistanceEnabled(true)).toBe(true);
    expect(isReviewAssistanceEnabled({ enabled: true })).toBe(true);
  });

  test('detects disabled values', () => {
    expect(isReviewAssistanceEnabled(undefined)).toBe(false);
    expect(isReviewAssistanceEnabled(false)).toBe(false);
    expect(isReviewAssistanceEnabled({})).toBe(false);
  });
});
