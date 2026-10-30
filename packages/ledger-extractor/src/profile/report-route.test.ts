import type { ProcessedDocument } from '@heripo/model';
import type * as Shared from '@heripo/shared';
import type * as Ai from 'ai';

import type { ReportProfile } from './report-profile';
import type { ReportProfileProposal } from './report-router';

import { createAuditedModel } from '@heripo/shared';
import { generateText } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildDocumentResourceIndex } from '../resources/document-resource-index';
import { REPORT_PROFILE_VERSION, REPORT_TRAIT_IDS } from './report-profile';
import {
  createReportProfileFromProposal,
  prepareReportProfile,
  routeReport,
} from './report-route';
import {
  REPORT_PROFILE_PROPOSAL_VERSION,
  REPORT_ROUTER_VERSION,
} from './report-router';
import { collectReportSignals } from './report-signals';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateText: vi.fn(),
}));
vi.mock('@heripo/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  createAuditedModel: vi.fn((model) => ({ model, attempts: [] })),
}));

const model = { modelId: 'mock' } as unknown as Ai.LanguageModel;
const document = {
  reportId: 'report',
  pageRangeMap: { 1: { startPageNo: 1, endPageNo: 1 } },
  chapters: [
    {
      id: 'ch-1',
      originTitle: 'IV. 조사 내용',
      title: 'IV. 조사 내용',
      pageNo: 1,
      level: 1,
      textBlocks: [{ id: 'b0', text: '1트렌치', pdfPageNo: 1 }],
      imageIds: [],
      tableIds: [],
      footnoteIds: [],
    },
  ],
  images: [],
  tables: [],
  footnotes: [],
} as ProcessedDocument;
const index = buildDocumentResourceIndex(document);
const signals = collectReportSignals(document, index, { inputSha256: 'hash' });
const answer = (scopeChapterIds = ['ch-1']) => ({
  traits: REPORT_TRAIT_IDS.map((id) =>
    id === 'trench_survey'
      ? {
          id,
          value: 'yes',
          confidence: 'high',
          reason: '트렌치',
          evidence: [{ sourceId: 'id:b0', quote: '트렌치' }],
          signals: [],
        }
      : id === 'few_remains'
        ? {
            id,
            value: 'no',
            confidence: 'low',
            reason: '근거 없음',
            evidence: [],
            signals: [],
          }
        : {
            id,
            value: 'unclear',
            confidence: 'low',
            reason: '',
            evidence: [],
            signals: [],
          },
  ),
  scopeChapterIds,
  scopeReasons: [],
  newTraits: [],
  unknowns: [],
});
const reply = (output: unknown) =>
  vi.mocked(generateText).mockResolvedValue({
    output,
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    finishReason: 'stop',
  } as never);

beforeEach(() => {
  vi.mocked(generateText).mockReset();
});

describe('routeReport', () => {
  test('sends one router call with the v2 request and inspects the output', async () => {
    reply(answer());
    const onAttempt = vi.fn();

    const call = await routeReport(index, signals, { model, onAttempt });

    expect(createAuditedModel).toHaveBeenCalledWith(model, onAttempt);
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({
      model,
      system: call.request.systemPrompt,
      prompt: call.request.userPrompt,
      maxRetries: 0,
    });
    expect(call).toMatchObject({
      status: 'completed',
      request: { version: REPORT_ROUTER_VERSION },
      signals,
      finishReason: 'stop',
      callAttempts: [],
    });
    expect(call.inspection?.issues).toEqual([
      'few_remains: no without support',
    ]);
  });

  test('returns a failed call instead of throwing', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('rate limited'));
    vi.mocked(generateText).mockRejectedValueOnce('down');

    const first = await routeReport(index, signals, { model, maxRetries: 2 });
    const second = await routeReport(index, signals, { model });

    expect(first).toMatchObject({ status: 'failed', error: 'rate limited' });
    expect(first).not.toHaveProperty('inspection');
    expect(second.error).toBe('down');
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({
      maxRetries: 2,
    });
  });
});

describe('createReportProfileFromProposal', () => {
  const proposal = (): ReportProfileProposal => ({
    version: REPORT_PROFILE_PROPOSAL_VERSION,
    routerVersion: REPORT_ROUTER_VERSION,
    traits: [
      {
        id: 'trench_survey',
        value: 'yes',
        confidence: 'high',
        reason: '',
        evidence: [],
        signals: ['trenchHeadings'],
        issues: [],
      },
      {
        id: 'catalog_artifacts',
        value: 'yes',
        confidence: 'high',
        reason: '',
        evidence: [],
        signals: [],
        issues: ['yes without support'],
      },
      ...(['grid_survey', 'grid_survey'] as const).map((id) => ({
        id,
        value: 'no' as const,
        confidence: 'high' as const,
        reason: '',
        evidence: [],
        signals: ['gridUnits'],
        issues: [],
      })),
    ],
    scopeChapterIds: ['ch-1'],
    scopeReasons: [],
    newTraits: [],
    unknowns: [],
    issues: [],
  });

  test('keeps clean judgments and turns problem, missing or repeated traits unclear', () => {
    const profile = createReportProfileFromProposal(proposal(), {
      inputSha256: 'hash',
      confirmedAt: '2026-10-26T00:00:00.000Z',
      routerRunId: 'run-1',
    });

    expect(profile).toMatchObject({
      version: REPORT_PROFILE_VERSION,
      inputSha256: 'hash',
      scopeChapterIds: ['ch-1'],
      source: 'router',
      routerRunId: 'run-1',
      confirmedAt: '2026-10-26T00:00:00.000Z',
    });
    expect(profile.traits.trench_survey).toBe('yes');
    expect(profile.traits.catalog_artifacts).toBe('unclear');
    expect(profile.traits.grid_survey).toBe('unclear');
    expect(profile.traits.few_remains).toBe('unclear');
    expect(profile.notes).toMatch(
      /^router traits set unclear for problems: .*grid_survey.*catalog_artifacts/,
    );
  });

  test('keeps only high-confidence judgments and marks the proposed scope until a scope is injected', () => {
    const clean = proposal();
    clean.traits = REPORT_TRAIT_IDS.map((id) => ({
      ...clean.traits[0],
      id,
      ...(id === 'local_stratigraphy' ? { confidence: 'medium' as const } : {}),
      ...(id === 'few_remains'
        ? { value: 'unclear' as const, confidence: 'low' as const }
        : {}),
    }));

    const profile = createReportProfileFromProposal(clean, {
      inputSha256: 'hash',
      confirmedAt: 'now',
    });
    const injected = createReportProfileFromProposal(clean, {
      inputSha256: 'hash',
      confirmedAt: 'now',
      scopeChapterIds: ['ch-9'],
    });

    expect(profile.traits.local_stratigraphy).toBe('unclear');
    expect(profile.traits.few_remains).toBe('unclear');
    expect(profile.traits.trench_survey).toBe('yes');
    expect(profile.scopeStatus).toBe('proposed');
    expect(profile.notes).toBe(
      'router traits set unclear below high confidence: local_stratigraphy; scope proposed by the router',
    );
    expect(profile).not.toHaveProperty('routerRunId');
    expect(injected.scopeChapterIds).toEqual(['ch-9']);
    expect(injected).not.toHaveProperty('scopeStatus');
    expect(injected.notes).toBe(
      'router traits set unclear below high confidence: local_stratigraphy; scope injected by the caller',
    );
  });
});

describe('prepareReportProfile', () => {
  const injected: ReportProfile = {
    version: REPORT_PROFILE_VERSION,
    inputSha256: 'hash',
    traits: { trench_survey: 'yes' },
    scopeChapterIds: ['ch-1'],
    source: 'manual',
    confirmedAt: '2026-10-26T00:00:00.000Z',
  };

  test('uses an injected profile without calling the router, with an injected scope if given', async () => {
    const plain = await prepareReportProfile(document, index, {
      inputSha256: 'hash',
      profile: injected,
    });
    const scoped = await prepareReportProfile(document, index, {
      inputSha256: 'hash',
      profile: { ...injected, scopeStatus: 'proposed' },
      scopeChapterIds: ['ch-9'],
    });

    expect(plain).toEqual({
      profile: injected,
      source: 'injected',
      issues: [],
    });
    expect(scoped.profile?.scopeChapterIds).toEqual(['ch-9']);
    expect(scoped.profile).not.toHaveProperty('scopeStatus');
    expect(scoped.issues).toEqual(['Scope chapter ch-9 not found']);
    expect(generateText).not.toHaveBeenCalled();
  });

  test('builds a router profile, reports router and profile problems, and requires a model', async () => {
    reply(answer());
    const routed = await prepareReportProfile(document, index, {
      inputSha256: 'hash',
      model,
      confirmedAt: '2026-10-26T00:00:00.000Z',
      routerRunId: 'run-1',
    });
    reply(answer(['ch-9']));
    const badScope = await prepareReportProfile(document, index, {
      inputSha256: 'hash',
      model,
    });

    expect(routed.source).toBe('router');
    expect(routed.profile).toMatchObject({
      source: 'router',
      routerRunId: 'run-1',
      traits: { trench_survey: 'yes', few_remains: 'unclear' },
    });
    expect(routed.issues).toEqual(['few_remains: no without support']);
    expect(badScope.profile?.confirmedAt).toMatch(/^\d{4}-/);
    expect(badScope.issues).toContain('unknown scope chapter ch-9');
    expect(badScope.issues).toContain('Scope chapter ch-9 not found');
    await expect(
      prepareReportProfile(document, index, { inputSha256: 'hash' }),
    ).rejects.toThrow('A model is required when no profile is injected');
  });

  test('returns no profile when the router call fails or its output has the wrong shape', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('timeout'));
    const failed = await prepareReportProfile(document, index, {
      inputSha256: 'hash',
      model,
    });
    reply({ traits: 'x' });
    const malformed = await prepareReportProfile(document, index, {
      inputSha256: 'hash',
      model,
    });

    expect(failed).toMatchObject({
      profile: null,
      source: 'router',
      issues: ['Router call failed: timeout'],
    });
    expect(malformed).toMatchObject({
      profile: null,
      issues: ['Response does not match the router schema'],
    });
  });
});
