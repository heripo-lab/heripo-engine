import type { ContentAttachmentPlan } from '../content-attachment/types';

import { describe, expect, test } from 'vitest';

import { createNearestRecords } from './record-names';

const entry = (groupId: string, ...paths: string[][]) => ({
  groupId,
  mentions: paths.map((path) => ({
    chapterPath: path.map((id) => ({ id, originTitle: id })),
  })),
});
const plan = {
  registry: [
    entry('pit-29-early', ['iv', 'excavation', 'early', 'pits']),
    entry('pit-29-late', ['iv', 'excavation', 'late', 'pits']),
    entry('pot-late', ['iv', 'excavation', 'late', 'pits', 'finds']),
    entry('summary', ['iv'], ['iv', 'excavation', 'early']),
    entry('other', ['v']),
  ],
} as unknown as ContentAttachmentPlan;

describe('createNearestRecords', () => {
  test('keeps the records whose chapter path shares the longest prefix with the speaking record', () => {
    const nearest = createNearestRecords(plan);

    expect(nearest([], 'record-pot-late')).toEqual([]);
    expect(nearest(['record-pit-29-early'], 'record-pot-late')).toEqual([
      'record-pit-29-early',
    ]);
    expect(
      nearest(['record-pit-29-early', 'record-pit-29-late'], 'record-pot-late'),
    ).toEqual(['record-pit-29-late']);
    expect(
      nearest(['record-pit-29-early', 'record-pit-29-late'], 'record-summary'),
    ).toEqual(['record-pit-29-early']);
    expect(
      nearest(['record-pit-29-early', 'record-pit-29-late'], 'record-other'),
    ).toEqual(['record-pit-29-early', 'record-pit-29-late']);
  });
});
