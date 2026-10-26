import type { Chapter, ProcessedDocument } from '@heripo/model';

import type { ReportProfile } from './report-profile';

import { describe, expect, test } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import {
  REPORT_PROFILE_VERSION,
  REPORT_TRAIT_IDS,
  contentAttachmentThinPolicyFromProfile,
  reportProfileSha256,
  resolveContentAttachmentThinPolicy,
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
    expect(
      validateReportProfile(
        index,
        'hash',
        profile({ scopeStatus: 'proposed' }),
      ),
    ).toEqual([]);
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
        scopeStatus: 'maybe' as ReportProfile['scopeStatus'],
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
      'Unknown scope status',
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

  test('records how each branch was decided and marks branches a profile left unclear', () => {
    expect(resolveContentAttachmentThinPolicy().decisions).toEqual([
      {
        branch: 'layers',
        value: 'all',
        source: 'default',
        needsDecision: false,
      },
      {
        branch: 'continuity',
        value: 'none',
        source: 'default',
        needsDecision: false,
      },
      {
        branch: 'areas',
        value: 'review',
        source: 'default',
        needsDecision: false,
      },
      {
        branch: 'catalog',
        value: 'none',
        source: 'default',
        needsDecision: false,
      },
    ]);

    const resolved = resolveContentAttachmentThinPolicy(
      profile({ traits: { local_stratigraphy: 'no' } }),
    );

    expect(resolved.decisions).toEqual([
      {
        branch: 'layers',
        value: 'all',
        source: 'trait',
        trait: 'local_stratigraphy',
        traitValue: 'no',
        needsDecision: false,
      },
      {
        branch: 'continuity',
        value: 'linked',
        source: 'profile',
        needsDecision: false,
      },
      {
        branch: 'areas',
        value: 'unanimous',
        source: 'profile',
        needsDecision: false,
      },
      {
        branch: 'catalog',
        value: 'none',
        source: 'default',
        trait: 'catalog_artifacts',
        traitValue: 'unclear',
        needsDecision: true,
      },
    ]);
  });

  test('lets caller trait and branch decisions override the profile, in that priority', () => {
    const resolved = resolveContentAttachmentThinPolicy(
      profile({
        traits: { local_stratigraphy: 'unclear', catalog_artifacts: 'no' },
      }),
      {
        traitOverrides: { local_stratigraphy: 'no', catalog_artifacts: 'yes' },
        policyOverrides: {
          catalog: 'none',
          continuity: 'none',
          areas: 'review',
        },
      },
    );
    const withoutProfile = resolveContentAttachmentThinPolicy(undefined, {
      traitOverrides: { catalog_artifacts: 'yes' },
    });

    expect(resolved.policy).toEqual({ layers: 'all' });
    expect(
      resolved.decisions.map((d) => [
        d.branch,
        d.value,
        d.source,
        d.needsDecision,
      ]),
    ).toEqual([
      ['layers', 'all', 'trait_override', false],
      ['continuity', 'none', 'policy_override', false],
      ['areas', 'review', 'policy_override', false],
      ['catalog', 'none', 'policy_override', false],
    ]);
    expect(withoutProfile.policy).toEqual({ layers: 'all', catalog: 'fields' });
    expect(withoutProfile.decisions[3]).toMatchObject({
      source: 'trait_override',
      traitValue: 'yes',
    });
    expect(() =>
      resolveContentAttachmentThinPolicy(undefined, {
        traitOverrides: { 'x-unknown': 'yes' } as never,
      }),
    ).toThrow('Invalid trait override x-unknown');
    expect(() =>
      resolveContentAttachmentThinPolicy(undefined, {
        traitOverrides: { catalog_artifacts: 'maybe' as never },
      }),
    ).toThrow('Invalid trait override catalog_artifacts');
    expect(() =>
      resolveContentAttachmentThinPolicy(undefined, {
        policyOverrides: { layers: 'some' as never },
      }),
    ).toThrow('Invalid policy override layers');
    expect(() =>
      resolveContentAttachmentThinPolicy(undefined, {
        policyOverrides: { other: 'x' } as never,
      }),
    ).toThrow('Invalid policy override other');
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
