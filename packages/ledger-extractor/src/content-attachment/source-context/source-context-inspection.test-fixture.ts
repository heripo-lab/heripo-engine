import type { ContentAttachmentSourceContextRecipientAudit } from './source-context-inspection';

import { Output } from 'ai';

import { createContentAttachmentGroundedInput } from '../grounding';
import { createContentAttachmentSegmentationRequest } from '../recipients/segmentation';
import { createContentAttachmentSourceContextRequest } from './source-context';
import {
  createContentAttachmentSourceContextReplaySnapshot,
  inspectContentAttachmentSourceContextRecipients,
} from './source-context-inspection';
import { sourceContextFixture } from './source-context.test-fixture';

export type Audit = ContentAttachmentSourceContextRecipientAudit;

export async function fixture(twoSegments = false, tablePairs = true) {
  const f = sourceContextFixture();
  const document = structuredClone(f.document);
  const input = createContentAttachmentGroundedInput(f.plan, f.unit);
  let segmentation = f.segment();
  if (twoSegments) {
    const refs = [segmentation.excerptRefs[0], 'E1'];
    const request = createContentAttachmentSegmentationRequest(input, refs);
    segmentation = {
      ...request,
      rawResponse: {
        segments: Object.fromEntries(
          refs.map((ref) => [
            ref,
            [
              {
                wordRanges: [
                  `${ref}:W1-W${request.wordEvidence.sources.find((s) => s.ref === ref)!.words.length}`,
                ],
              },
            ],
          ]),
        ),
      },
      usage: {} as never,
      callAttempts: [],
    };
  }
  const options = tablePairs ? { tablePairs: [f.pair] } : {};
  const request = createContentAttachmentSourceContextRequest(
    f.plan,
    f.unit,
    segmentation,
    options,
  );
  const caption = request.contextBindings.sources.find(
    (s) => s.field === 'fullText',
  );
  const context =
    caption?.ref ??
    request.wordEvidence.sources.find((s) => s.ref.startsWith('X'))!.ref;
  const contextWords = request.wordEvidence.sources.find(
    (s) => s.ref === context,
  )!.words.length;
  const contextRange = `${context}:W1-W${contextWords}`;
  const kRefs = request.candidateEvidence
    .filter((k) => k.candidateRef === 'R1')
    .map((k) => k.ref);
  const decisions = Object.fromEntries(
    request.segmentSnapshot.map((segment) => {
      const ranges = segment.evidence.map((e) => e.range);
      const direct = segment.excerptRef === segmentation.excerptRefs[0];
      const support = {
        currentWordRanges: direct ? ranges : [],
        contextWordRanges: [contextRange],
        candidateEvidenceRefs: kRefs,
        originRowRefs: [],
      };
      return [
        segment.ref,
        {
          nonAreaAttachments: [],
          areaAssessments: {
            R1: {
              disposition: direct ? 'included' : 'excluded',
              ...support,
              reason:
                'Synthetic provenance fixture, not an archaeological judgment.',
            },
          },
          recipientIdentityAlternatives: [],
          relationshipSubjectAlternatives: [],
          reason: 'Unchanged response contract fixture.',
          workScopeAssessment: {
            reason: 'Synthetic work-state fixture.',
            state: direct ? 'operation' : 'not_applicable',
            currentWordRanges: ranges,
            targetGroups: direct
              ? [
                  {
                    targetIdentification: { candidateRefs: ['R1'], ...support },
                    operationCoverage: {
                      state: 'established',
                      supportingWordRanges: ranges,
                      consideredWordRanges: [contextRange],
                      reason: 'Synthetic field/coverage consistency fixture.',
                    },
                  },
                ]
              : [],
            groupReviews: {},
          },
          collectiveAssessment: {
            state: 'not_collective',
            currentWordRanges: [],
            contextWordRanges: [contextRange],
            reason: 'No inventory adopted.',
          },
          qualifierAssessment: {
            periodWordRanges: [],
            typeWordRanges: [],
            scopeWordRanges: [],
            reason: 'No qualifiers selected.',
          },
          inventoryReviews: {},
          inventoryMembershipLinks: [],
        },
      ];
    }),
  );
  const format = await Output.object({ schema: request.schema }).responseFormat;
  if (format?.type !== 'json') throw new Error('Expected object output');
  const audit: Audit = JSON.parse(
    JSON.stringify({
      version: request.version,
      contextVersion: request.contextVersion,
      contextOptions: options,
      replaySnapshot: createContentAttachmentSourceContextReplaySnapshot(
        document,
        f.plan,
        f.unit,
        segmentation,
      ),
      providerOutputSchema: format.schema,
      wordEvidence: request.wordEvidence,
      contextBindings: request.contextBindings,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      segmentSnapshot: request.segmentSnapshot,
      candidateEvidence: request.candidateEvidence,
      rawResponse: { decisions },
      usage: { model: 'manual-fixture' },
      callAttempts: [],
    }),
  );
  const run = () =>
    inspectContentAttachmentSourceContextRecipients(
      document,
      f.plan,
      f.unit,
      segmentation,
      audit,
    );
  const refresh = () => {
    audit.replaySnapshot = createContentAttachmentSourceContextReplaySnapshot(
      document,
      f.plan,
      f.unit,
      segmentation,
    );
  };
  return {
    ...f,
    document,
    input,
    segmentation,
    request,
    audit,
    run,
    refresh,
    context,
    contextRange,
    ref: request.segmentSnapshot[0].ref,
  };
}

export const corruptions: Array<[string, (a: Audit) => void]> = [
  [
    'body masquerading as caption',
    (a) => {
      const b = a.contextBindings.sources[0];
      b.resourceKey = '/chapters/0/textBlocks/0/caption';
      b.field = 'fullText';
      a.wordEvidence.sources.find((s) => s.ref === b.ref)!.resourceKey =
        b.resourceKey;
    },
  ],
  [
    'field',
    (a) => {
      a.contextBindings.sources.find((s) => s.field === 'fullText')!.field =
        'text';
    },
  ],
  [
    'offset',
    (a) => {
      const b = a.contextBindings.sources.find((s) => s.field === 'fullText')!;
      b.charStart = 1;
      b.charEnd++;
    },
  ],
  [
    'negative offset',
    (a) => {
      a.contextBindings.sources[0].charStart = -1;
    },
  ],
  [
    'fractional offset',
    (a) => {
      a.contextBindings.sources[0].charStart = 0.5;
    },
  ],
  [
    'fractional end',
    (a) => {
      a.contextBindings.sources[0].charEnd = 0.5;
    },
  ],
  [
    'reversed offset',
    (a) => {
      a.contextBindings.sources[0].charEnd = -1;
    },
  ],
  [
    'past-end offset',
    (a) => {
      a.contextBindings.sources[0].charEnd = 999;
    },
  ],
  [
    'text',
    (a) => {
      a.contextBindings.sources[0].text = 'different';
    },
  ],
  [
    'word boundary',
    (a) => {
      a.wordEvidence.sources.find((s) =>
        s.resourceKey.endsWith('/caption'),
      )!.words[1].charStart = 1;
    },
  ],
  [
    'missing binding',
    (a) => {
      a.contextBindings.sources.pop();
    },
  ],
  [
    'duplicate binding',
    (a) => {
      a.contextBindings.sources[0] = a.contextBindings.sources[1];
    },
  ],
  [
    'duplicate source',
    (a) => {
      a.wordEvidence.sources[0] = a.wordEvidence.sources[1];
    },
  ],
  [
    'locator disagreement',
    (a) => {
      a.contextBindings.sources[0].resourceKey = '/missing';
    },
  ],
  [
    'unknown resource',
    (a) => {
      const b = a.contextBindings.sources[0];
      b.resourceKey = '/missing';
      a.wordEvidence.sources.find((s) => s.ref === b.ref)!.resourceKey =
        b.resourceKey;
    },
  ],
  [
    'unsupported native field',
    (a) => {
      const b = a.contextBindings.sources[0];
      b.resourceKey = '/chapters/0';
      a.wordEvidence.sources.find((s) => s.ref === b.ref)!.resourceKey =
        b.resourceKey;
    },
  ],
  [
    'native metadata',
    (a) => {
      a.contextBindings.sources[0].pdfPageNo = 99;
    },
  ],
  [
    'header',
    (a) => {
      a.contextBindings.headers[0].colSpan++;
    },
  ],
  [
    'table',
    (a) => {
      a.contextBindings.tables[0].table.data.caption = { fullText: 'invented' };
    },
  ],
  [
    'prompt mix',
    (a) => {
      a.userPrompt = 'old or unrelated request';
    },
  ],
  [
    'system prompt',
    (a) => {
      a.systemPrompt += 'changed';
    },
  ],
  [
    'segment snapshot',
    (a) => {
      a.segmentSnapshot = [];
    },
  ],
  [
    'candidate snapshot',
    (a) => {
      a.candidateEvidence = [];
    },
  ],
  [
    'provider schema',
    (a) => {
      a.providerOutputSchema = { type: 'string' };
    },
  ],
  [
    'replay snapshot',
    (a) => {
      a.replaySnapshot.documentSha256 = 'different';
    },
  ],
  [
    'wrong recipient version',
    (a) => {
      (a as { version: string }).version = 'segment-recipients.v24';
    },
  ],
  [
    'wrong context version',
    (a) => {
      (a as { contextVersion: string }).contextVersion = 'context.future';
    },
  ],
  [
    'missing context version',
    (a) => {
      delete (a as Partial<Audit>).contextVersion;
    },
  ],
  [
    'missing selection',
    (a) => {
      delete (a as Partial<Audit>).contextOptions;
    },
  ],
  [
    'invalid selection',
    (a) => {
      (a as unknown as { contextOptions: number }).contextOptions = 1;
    },
  ],
  [
    'binding snapshot',
    (a) => {
      a.wordEvidence.sources[0].originalRef = 'different';
    },
  ],
];
