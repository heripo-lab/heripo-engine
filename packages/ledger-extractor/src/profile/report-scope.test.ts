import type { DocumentResourceIndex } from '../resources/document-resource-index';
import type { ReportSignals } from './report-signals';

import { describe, expect, test } from 'vitest';

import {
  REPORT_SCOPE_COMPLETION_VERSION,
  completeReportScope,
} from './report-scope';

const chapter = (id: string, key: string) => ({
  kind: 'chapter',
  key,
  resourceId: id,
});
const index = {
  resources: [
    chapter('ch-1', '/chapters/0'),
    chapter('ch-2', '/chapters/1'),
    chapter('ch-3', '/chapters/1/children/0'),
    chapter('ch-4', '/chapters/1/children/1'),
    chapter('ch-5', '/chapters/2'),
    chapter('ch-6', '/chapters/2/children/0'),
    chapter('ch-7', '/chapters/3'),
    { kind: 'text', key: '/chapters/3/textBlocks/0', resourceId: 'txt-1' },
  ],
} as unknown as DocumentResourceIndex;
const signals = (ids: string[]) =>
  ({
    signals: {
      investigationLikeChapters: ids.map((chapterId) => ({ chapterId })),
    },
  }) as unknown as ReportSignals;

describe('completeReportScope', () => {
  test('adds investigation chapters, keeps the outermost in document order and records what changed', () => {
    const result = completeReportScope(index, signals(['ch-4', 'ch-5']), [
      'ch-7',
      'ch-6',
      'ch-3',
      'ch-missing',
    ]);

    expect(result).toEqual({
      version: REPORT_SCOPE_COMPLETION_VERSION,
      scopeChapterIds: ['ch-3', 'ch-4', 'ch-5', 'ch-7'],
      proposedChapterIds: ['ch-7', 'ch-6', 'ch-3', 'ch-missing'],
      addedChapterIds: ['ch-4', 'ch-5'],
      absorbedChapterIds: ['ch-6'],
    });
  });

  test('keeps a proposal the signals already cover', () => {
    expect(
      completeReportScope(index, signals(['ch-2']), ['ch-2']),
    ).toMatchObject({
      scopeChapterIds: ['ch-2'],
      addedChapterIds: [],
      absorbedChapterIds: [],
    });
  });
});
