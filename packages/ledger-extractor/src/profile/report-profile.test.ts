import type { Chapter, ProcessedDocument } from '@heripo/model';

import type { ReportProfile } from './report-profile';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import {
  REPORT_PROFILE_VERSION,
  REPORT_TRAIT_IDS,
  contentAttachmentThinPolicyFromProfile,
  reportProfileSha256,
  validateReportProfile,
} from './report-profile';

const chapter = (id: string, children: Chapter[] = []): Chapter => ({
  id,
  originTitle: id,
  title: id,
  pageNo: 1,
  level: 1,
  textBlocks: [],
  imageIds: [],
  tableIds: [],
  footnoteIds: [],
  children,
});
const index = buildDocumentResourceIndex({
  reportId: 'report',
  pageRangeMap: { 1: { startPageNo: 1, endPageNo: 1 } },
  chapters: [
    chapter('methods'),
    chapter('results', [chapter('trenches')]),
    chapter('conclusion'),
  ],
  images: [],
  tables: [],
  footnotes: [],
} as ProcessedDocument);
const profile = (overrides: Partial<ReportProfile> = {}): ReportProfile => ({
  version: REPORT_PROFILE_VERSION,
  inputSha256: 'hash',
  traits: { trench_survey: 'yes', 'x-utility_disturbance': 'yes' },
  scopeChapterIds: ['methods', 'results'],
  source: 'manual',
  confirmedAt: '2026-10-23T00:00:00.000Z',
  ...overrides,
});

describe('report profile', () => {
  test('accepts listed and x- prefixed traits with distinct, non-nested scope chapters', () => {
    const input = profile();
    const before = structuredClone(input);

    expect(validateReportProfile(index, 'hash', input)).toEqual([]);
    expect(input).toEqual(before);
    expect(REPORT_TRAIT_IDS).toContain('grid_survey');
  });

  test('reports every problem without changing the profile', () => {
    const issues = validateReportProfile(
      index,
      'other',
      profile({
        version: 'report-profile.v0' as ReportProfile['version'],
        traits: {
          made_up: 'yes',
          trench_survey: 'maybe' as ReportProfile['traits'][string],
        },
        scopeChapterIds: ['results', 'trenches', 'results', 'missing'],
        source: 'guess' as ReportProfile['source'],
        confirmedAt: 'later',
      }),
    );

    expect(issues).toEqual([
      'Unsupported profile version',
      'Profile belongs to a different input',
      'Unknown trait made_up',
      'Invalid value for trait trench_survey',
      'Scope chapter missing not found',
      'Scope chapters are repeated',
      'Scope chapters are nested',
      'Unknown profile source',
      'Profile confirmation time is invalid',
    ]);
    const empty = profile();
    delete (empty as Partial<ReportProfile>).traits;
    delete (empty as Partial<ReportProfile>).scopeChapterIds;
    expect(validateReportProfile(index, 'hash', empty)).toEqual([
      'Profile scope has no chapter',
    ]);
  });

  test('keeps every layer offered only when stratigraphy is confirmed not local or there is no profile, and links context with a profile', () => {
    expect(contentAttachmentThinPolicyFromProfile()).toEqual({ layers: 'all' });
    expect(
      contentAttachmentThinPolicyFromProfile(
        profile({ traits: { local_stratigraphy: 'no' } }),
      ),
    ).toEqual({ layers: 'all', continuity: 'linked', areas: 'unanimous' });
    const localTraits: Array<ReportProfile['traits']> = [
      { local_stratigraphy: 'yes' },
      { local_stratigraphy: 'unclear' },
      {},
    ];
    for (const traits of localTraits)
      expect(
        contentAttachmentThinPolicyFromProfile(profile({ traits })),
      ).toEqual({ layers: 'local', continuity: 'linked', areas: 'unanimous' });
    expect(
      contentAttachmentThinPolicyFromProfile(
        profile({ traits: { catalog_artifacts: 'yes' } }),
      ),
    ).toEqual({
      layers: 'local',
      continuity: 'linked',
      areas: 'unanimous',
      catalog: 'fields',
    });
  });

  test('hashes the same judgments the same regardless of key order', async () => {
    const input = profile({ notes: '' });
    const reordered = Object.fromEntries(
      Object.entries(input).reverse(),
    ) as ReportProfile;
    reordered.traits = Object.fromEntries(
      Object.entries(input.traits).reverse(),
    );

    const hash = await reportProfileSha256(input);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await reportProfileSha256(reordered)).toBe(hash);
    expect(
      await reportProfileSha256(
        profile({ notes: '', scopeChapterIds: ['results', 'methods'] }),
      ),
    ).not.toBe(hash);
  });
});
