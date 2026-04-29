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
    expect(normalizeReviewAssistanceOptions(false, 7)).toEqual({
      ...REVIEW_ASSISTANCE_DEFAULTS,
      concurrency: 7,
      enabled: false,
    });
  });

  test('uses object options with enabled defaulting to false', () => {
    expect(
      normalizeReviewAssistanceOptions({
        concurrency: 4,
        autoApplyThreshold: 0.9,
        proposalThreshold: 0.6,
        maxRetries: 2,
        temperature: 0.2,
      }),
    ).toEqual({
      enabled: false,
      concurrency: 4,
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

  test('uses top-level concurrency alias when nested concurrency is absent', () => {
    expect(normalizeReviewAssistanceOptions(true, 6).concurrency).toBe(6);
  });

  test('prefers nested concurrency over top-level alias', () => {
    expect(
      normalizeReviewAssistanceOptions({ enabled: true, concurrency: 3 }, 6)
        .concurrency,
    ).toBe(3);
  });

  test('clamps concurrency to 1..10 and floors decimal values', () => {
    expect(normalizeReviewAssistanceOptions(true, 0).concurrency).toBe(1);
    expect(normalizeReviewAssistanceOptions(true, 20).concurrency).toBe(10);
    expect(normalizeReviewAssistanceOptions(true, 4.9).concurrency).toBe(4);
  });

  test('falls back for non-finite concurrency values', () => {
    expect(normalizeReviewAssistanceOptions(true, Number.NaN).concurrency).toBe(
      1,
    );
    expect(
      normalizeReviewAssistanceOptions(true, Number.POSITIVE_INFINITY)
        .concurrency,
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
    expect(isReviewAssistanceEnabled({ concurrency: 3 })).toBe(false);
  });
});
