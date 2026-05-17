import type { ReviewAssistancePageResult } from '@heripo/model';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  type ReviewAssistanceCallTrace,
  ReviewAssistanceCheckpointStore,
} from './review-assistance-checkpoint-store';

const page: ReviewAssistancePageResult = {
  pageNo: 1,
  status: 'succeeded',
  decisions: [],
  issues: [],
};

const trace: ReviewAssistanceCallTrace = {
  workItemId: 'item-1',
  kind: 'text_ocr_hanja',
  pageNo: 1,
  targetRefs: ['#/texts/0'],
  attempts: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 10,
  validation: 'passed',
};

describe('ReviewAssistanceCheckpointStore', () => {
  let outputDir: string;

  afterEach(() => {
    if (outputDir) {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test('records and reloads completed work item checkpoints', () => {
    outputDir = mkdtempSync(join(tmpdir(), 'review-checkpoint-'));
    const now = () => new Date('2026-01-01T00:00:00.000Z');
    const store = ReviewAssistanceCheckpointStore.open(outputDir, 'run-1', now);

    store.recordWorkItem({ workItemId: 'item-1', page, trace });

    const reloaded = ReviewAssistanceCheckpointStore.open(
      outputDir,
      'run-1',
      now,
    );
    expect(reloaded.hasCompletedWorkItem('item-1')).toBe(true);
    expect(reloaded.hasFailedWorkItem('item-1')).toBe(false);
    expect(reloaded.getPartialPage(1)).toEqual(page);
    expect(reloaded.getCallTraces()).toEqual([trace]);

    const raw = JSON.parse(
      readFileSync(
        join(outputDir, 'review_assistance_checkpoint.json'),
        'utf-8',
      ),
    );
    expect(raw.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('records failed work items and resets mismatched or malformed runs', () => {
    outputDir = mkdtempSync(join(tmpdir(), 'review-checkpoint-'));
    const store = ReviewAssistanceCheckpointStore.open(outputDir, 'run-1');
    store.recordWorkItem({
      workItemId: 'item-2',
      page,
      trace: { ...trace, workItemId: 'item-2', validation: 'failed' },
      failed: { reason: 'validation failed', attempts: 3 },
    });
    store.recordWorkItem({
      workItemId: 'item-2',
      page,
      trace: { ...trace, workItemId: 'item-2', validation: 'passed' },
    });

    const recovered = ReviewAssistanceCheckpointStore.open(outputDir, 'run-1');
    expect(recovered.hasCompletedWorkItem('item-2')).toBe(true);
    expect(recovered.hasFailedWorkItem('item-2')).toBe(false);

    const mismatched = ReviewAssistanceCheckpointStore.open(outputDir, 'run-2');
    expect(mismatched.hasFailedWorkItem('item-2')).toBe(false);

    writeFileSync(
      join(outputDir, 'review_assistance_checkpoint.json'),
      JSON.stringify({
        schemaVersion: 1,
        runId: 'run-1',
        completedWorkItemIds: [123, 'item-3'],
        failedWorkItems: [
          { id: 'item-4', reason: 'failed', attempts: 2 },
          { id: 'item-5', reason: 10, attempts: 'bad' },
        ],
        partialPages: [],
        callTraces: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const sanitized = ReviewAssistanceCheckpointStore.open(outputDir, 'run-1');
    expect(sanitized.hasCompletedWorkItem('item-3')).toBe(true);
    expect(sanitized.hasFailedWorkItem('item-4')).toBe(true);
    expect(sanitized.hasFailedWorkItem('item-5')).toBe(false);

    writeFileSync(
      join(outputDir, 'review_assistance_checkpoint.json'),
      JSON.stringify({
        schemaVersion: 1,
        runId: 'run-1',
      }),
    );
    const defaulted = ReviewAssistanceCheckpointStore.open(outputDir, 'run-1');
    expect(defaulted.getPartialPage(1)).toBeUndefined();
    expect(defaulted.getCallTraces()).toEqual([]);

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(outputDir, 'review_assistance_checkpoint.json'),
      '{not-json',
    );
    const malformed = ReviewAssistanceCheckpointStore.open(outputDir, 'run-1');
    expect(malformed.getCallTraces()).toEqual([]);
  });

  test('records whole page checkpoints without work item traces', () => {
    outputDir = mkdtempSync(join(tmpdir(), 'review-checkpoint-'));
    const store = ReviewAssistanceCheckpointStore.open(outputDir, 'run-1');

    store.recordPage(page);

    expect(store.getPartialPage(1)).toEqual(page);
    expect(store.getCallTraces()).toEqual([]);
  });
});
