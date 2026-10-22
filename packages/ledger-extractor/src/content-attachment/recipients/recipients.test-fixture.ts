import type { ContentAttachmentCollectiveTrace } from './collective-trace';
import type { ContentAttachmentSegmentationAudit } from './segmentation';
import type {
  ContentAttachmentAreaRecipientDecision,
  ContentAttachmentAreaRecipientResponse,
  ContentAttachmentRecipientAudit,
} from './types';
import type { ContentAttachmentWorkScopeAssessment } from './work-scope';

import { expect } from 'vitest';

import { createContentAttachmentRecipientRequest } from './request';
import { createContentAttachmentSegmentationRequest } from './segmentation';

export type Input = Parameters<
  typeof createContentAttachmentRecipientRequest
>[0];

export function fixture(
  version: Parameters<
    typeof createContentAttachmentRecipientRequest
  >[2] = 'segment-recipients.v8',
  workSource = '범위 측량. TR1 제토.',
  groundQuotes = ['시굴범위', '트렌치 1'],
) {
  const excerpts = [
    ['E1', 'text', ['C1'], null, workSource],
    ['E2', 'text', ['C1'], null, '도로 수혈 존재. 도로 연결.'],
    ['E3', 'text', ['C1'], null, '앞 문맥.'],
  ];
  const grounds = groundQuotes.map((quote, i) => ({
    sourceId: 'K' + i,
    resourceKey: '/candidate/' + i,
    resourceId: null,
    sourceRefs: [],
    pdfPageNo: 1,
    logicalPageRange: { startPageNo: 0, endPageNo: 0 },
    quote,
    charStart: 0,
    charEnd: quote.length,
  }));
  const input = {
    payload: {
      contexts: { C1: ['Survey'] },
      PRIVATE_EXPECTED: 'Do not transmit',
      candidates: grounds.map((g, i) => [
        `R${i + 1}`,
        'area',
        'C1',
        g.quote,
        null,
        [[`K${i + 1}.1`, g.quote]],
      ]),
      current: {
        excerpts,
        bodyBlocks: [['P1', ['E1', 'E2', 'E3']]],
        readOnlyContext: [],
        tables: [],
        tableCellColumns: [],
        registrationDecisions: [],
      },
      originTables: [
        { ref: 'U1', contexts: ['C1'], caption: 'Inventory', headers: [] },
      ],
      inventoryMembers: [['U1', ['R1', 'R2']]],
      originRows: [
        ['O1', 'U1', 1, []],
        ['O2', 'U1', 2, []],
      ],
      originAnchors: [
        ['R2', 'O1', 0],
        ['R1', 'O2', 0],
      ],
    },
    codeMap: {
      candidateRows: grounds.map((g, i) => ({
        ref: `R${i + 1}`,
        evidence: [g],
      })),
      excerpts: excerpts.map((e) => ({
        ref: e[0],
        evidence: [
          {
            ...grounds[0],
            sourceId: e[0],
            resourceKey: '/' + e[0],
            quote: e[4],
            charStart: 0,
            charEnd: (e[4] as string).length,
          },
        ],
      })),
      supportingBody: [],
    },
    PRIVATE_PRIOR_ANSWER: ['R1'],
  } as unknown as Input;
  const segmentation: ContentAttachmentSegmentationAudit = {
    ...createContentAttachmentSegmentationRequest(input, ['E1', 'E2']),
    rawResponse: {
      segments: {
        E1: [{ wordRanges: ['E1:W1-W2'] }, { wordRanges: ['E1:W3-W4'] }],
        E2: [{ wordRanges: ['E2:W1-W3'] }, { wordRanges: ['E2:W4-W5'] }],
      },
    },
    usage: {} as never,
    callAttempts: [],
  };
  const request = createContentAttachmentRecipientRequest(
    input,
    segmentation,
    version,
  );
  const support = (candidateRef: string, range: string) => ({
    candidateRef,
    currentWordRanges: [range],
    contextWordRanges: ['E3:W1-W2'],
    candidateEvidenceRefs: [candidateRef === 'R1' ? 'K1.1' : 'K2.1'],
    originRowRefs: [] as string[],
  });
  const trace: ContentAttachmentCollectiveTrace = {
    collectiveAssessment: {
      state: 'not_collective',
      currentWordRanges: [],
      contextWordRanges: [],
      reason: 'Direct source description.',
    },
    qualifierAssessment: {
      periodWordRanges: [],
      typeWordRanges: [],
      scopeWordRanges: [],
      reason: 'No qualifier needed.',
    },
    inventoryMembershipLinks: [],
  };
  const empty = {
    ...trace,
    attachments: [],
    recipientIdentityAlternatives: [],
    relationshipSubjectAlternatives: [],
    reason: 'Source-grounded disposition.',
  };
  const audit: ContentAttachmentRecipientAudit = {
    ...request,
    rawResponse: {
      decisions: {
        'E1:S1': { ...empty, attachments: [support('R1', 'E1:W1-W2')] },
        'E1:S2': {
          ...empty,
          attachments: [
            { ...support('R2', 'E1:W3-W4'), originRowRefs: ['O1'] },
          ],
        },
        'E2:S1': {
          ...empty,
          attachments: [support('R1', 'E2:W1-W3'), support('R2', 'E2:W1-W3')],
        },
        'E2:S2': {
          ...empty,
          relationshipSubjectAlternatives: [
            {
              role: 'subject' as const,
              candidateRefs: ['R1', 'R2'],
              currentWordRanges: ['E2:W4-W5'],
              contextWordRanges: ['E2:W1-W3'],
              candidateEvidenceRefs: ['K1.1', 'K2.1'],
              originRowRefs: ['O1'],
            },
          ],
        },
      },
    },
    usage: {} as never,
    callAttempts: [],
  };
  for (const segment of request.segmentSnapshot) {
    if (
      request.version === 'segment-recipients.v8' ||
      request.version === 'segment-recipients.v9' ||
      request.version === 'segment-recipients.v10' ||
      request.version === 'segment-recipients.v11' ||
      request.version === 'segment-recipients.v12' ||
      request.version === 'segment-recipients.v13' ||
      request.version === 'segment-recipients.v14' ||
      request.version === 'segment-recipients.v15' ||
      request.version === 'segment-recipients.v16' ||
      request.version === 'segment-recipients.v17'
    )
      audit.rawResponse.decisions[segment.ref].workScopeAssessment = {
        ...(request.version === 'segment-recipients.v14' ||
        request.version === 'segment-recipients.v15' ||
        request.version === 'segment-recipients.v16' ||
        request.version === 'segment-recipients.v17'
          ? { groupReviews: {} }
          : {}),
        state: 'not_applicable',
        currentWordRanges: segment.evidence.map((e) => e.range),
        targetGroups: [],
        reason: 'Synthetic baseline; operation coverage is tested separately.',
      };

    if (
      request.version === 'segment-recipients.v9' ||
      request.version === 'segment-recipients.v10' ||
      request.version === 'segment-recipients.v11' ||
      request.version === 'segment-recipients.v12' ||
      request.version === 'segment-recipients.v13' ||
      request.version === 'segment-recipients.v14' ||
      request.version === 'segment-recipients.v15' ||
      request.version === 'segment-recipients.v16' ||
      request.version === 'segment-recipients.v17'
    ) {
      const decision = audit.rawResponse.decisions[segment.ref];
      decision.areaAssessments = Object.fromEntries(
        ['R1', 'R2'].map((ref, i) => {
          const included = decision.attachments.some(
            (a) => a.candidateRef === ref,
          );
          const unresolved = decision.recipientIdentityAlternatives.some((a) =>
            a.candidateRefs.includes(ref),
          );
          return [
            ref,
            {
              disposition: included
                ? 'included'
                : unresolved
                  ? 'unresolved'
                  : 'excluded',
              currentWordRanges:
                included || unresolved
                  ? segment.evidence.map((e) => e.range)
                  : [],
              contextWordRanges: [],
              candidateEvidenceRefs: [`K${i + 1}.1`],
              reason: 'Synthetic independent area disposition.',
            },
          ];
        }),
      );
    }

    audit.rawResponse.decisions[segment.ref] = structuredClone(
      audit.rawResponse.decisions[segment.ref],
    );
    audit.rawResponse.decisions[segment.ref].inventoryReviews = {
      U1: {
        decision: 'rejected',
        currentWordRanges: segment.evidence.map((e) => e.range),
        contextWordRanges: [],
        ...(request.version === 'segment-recipients.v3'
          ? { inventoryContextRefs: ['C1'] }
          : {}),
        candidateEvidenceRefs: [],
        originRowRefs: [],
        reason: 'Direct work or relationship, not an inventory collective.',
      },
    };
  }
  return { input, segmentation, request, audit, support };
}

export function collectiveFixture(
  version?: Parameters<typeof createContentAttachmentRecipientRequest>[2],
) {
  const f = fixture(version);
  const members = Object.fromEntries(
    ['R1', 'R2'].map((ref, i) => [
      ref,
      {
        candidateEvidenceRefs: [`K${i + 1}.1`],
        originRowRefs: [i ? 'O1' : 'O2'],
        periodStatus: 'compatible',
        typeStatus: 'compatible',
        tentativeClassification: 'preserved',
        membership: 'linked',
        disposition: 'included',
        reason: 'Original membership with current qualifiers.',
      },
    ]),
  );
  const trace: ContentAttachmentCollectiveTrace = {
    collectiveAssessment: {
      state: 'collective',
      currentWordRanges: ['E2:W1-W3'],
      contextWordRanges: ['E3:W1-W2'],
      reason: 'Source-established set.',
    },
    qualifierAssessment: {
      periodWordRanges: ['E2:W1-W1'],
      typeWordRanges: ['E2:W1-W2'],
      scopeWordRanges: ['E3:W1-W2'],
      reason: 'Current restriction.',
    },
    inventoryMembershipLinks: [
      {
        inventoryRef: 'U1',
        contextWordRanges: ['E3:W1-W2'],
        members,
        reason: 'Original inventory for this account.',
      },
    ] as ContentAttachmentCollectiveTrace['inventoryMembershipLinks'],
  };
  trace.inventoryReviews = {
    U1: {
      ...f.audit.rawResponse.decisions['E2:S1'].inventoryReviews!.U1,
      decision: 'accepted',
      candidateEvidenceRefs: ['K1.1', 'K2.1'],
      originRowRefs: ['O1', 'O2'],
      reason: 'Original inventory connects this collective.',
    },
  };
  Object.assign(f.audit.rawResponse.decisions['E2:S1'], trace);
  return { ...f, trace };
}

export function workFixture() {
  const f = fixture(undefined, '범위·TR1 전체측량. TR1 제토.');
  const decision = f.audit.rawResponse.decisions['E1:S1'];
  const group: ContentAttachmentWorkScopeAssessment['targetGroups'][number] = {
    targetIdentification: {
      candidateRefs: ['R1', 'R2'],
      currentWordRanges: ['E1:W1-W2'],
      contextWordRanges: ['E3:W1-W2'],
      candidateEvidenceRefs: ['K1.1', 'K2.1'],
      originRowRefs: ['O1', 'O2'],
    },
    operationCoverage: {
      state: 'established',
      supportingWordRanges: ['E1:W1-W2'],
      consideredWordRanges: ['E3:W1-W2'],
      reason: 'The current operation explicitly covers both named targets.',
    },
  };
  decision.workScopeAssessment = {
    state: 'operation',
    currentWordRanges: ['E1:W1-W2'],
    targetGroups: [group],
    reason: 'Current measurement operation, independent of inventory findings.',
  };
  decision.attachments = [
    f.support('R1', 'E1:W1-W2'),
    f.support('R2', 'E1:W1-W2'),
  ];
  return { ...f, decision, group, assessment: decision.workScopeAssessment };
}

export function areaFixture() {
  return fixture('segment-recipients.v9', '부분범위 측량. 전체범위 조사.', [
    '부분범위 80㎡',
    '전체범위 200㎡',
  ]);
}

export function providerSchemaIssues(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const schema = value as Record<string, unknown>;
  const issues = [
    'oneOf',
    'allOf',
    'not',
    'dependentRequired',
    'dependentSchemas',
    'if',
    'then',
    'else',
  ]
    .filter((key) => key in schema)
    .map((key) => `${path}.${key}`);
  if (path === '$' && 'anyOf' in schema) issues.push('$.anyOf');
  if ('$ref' in schema && Object.keys(schema).length !== 1)
    issues.push(`${path}.$ref siblings`);
  for (const key of [
    'properties',
    'definitions',
    '$defs',
    'patternProperties',
    'dependentSchemas',
  ]) {
    const entries = schema[key];
    if (entries && typeof entries === 'object')
      for (const [name, child] of Object.entries(entries))
        issues.push(...providerSchemaIssues(child, `${path}.${key}.${name}`));
  }
  for (const key of [
    'items',
    'additionalProperties',
    'not',
    'if',
    'then',
    'else',
  ])
    issues.push(...providerSchemaIssues(schema[key], `${path}.${key}`));
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const branches = schema[key];
    if (Array.isArray(branches))
      branches.forEach((child, i) =>
        issues.push(...providerSchemaIssues(child, `${path}.${key}[${i}]`)),
      );
  }
  return issues;
}

export function inclusiveSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inclusiveSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key === 'oneOf' ? 'anyOf' : key,
      inclusiveSchema(child),
    ]),
  );
}

export function singleAreaFixture(
  kinds = ['area', 'feature'],
  version: Parameters<
    typeof createContentAttachmentRecipientRequest
  >[2] = 'segment-recipients.v18',
) {
  const f = fixture('segment-recipients.v17');
  f.input.payload.candidates.forEach((row, i) => {
    row[1] = kinds[i];
  });
  const request = createContentAttachmentRecipientRequest(
    f.input,
    f.segmentation,
    version,
  );
  const areas = new Set(
    f.input.payload.candidates
      .filter((r) => r[1] === 'area')
      .map((r) => r[0] as string),
  );
  const decisions: Record<string, ContentAttachmentAreaRecipientDecision> = {};
  for (const [ref, d] of Object.entries(f.audit.rawResponse.decisions)) {
    const { attachments, areaAssessments, ...rest } = structuredClone(d);
    decisions[ref] = {
      ...rest,
      nonAreaAttachments: attachments.filter((a) => !areas.has(a.candidateRef)),
      areaAssessments: Object.fromEntries(
        [...areas].map((area) => [
          area,
          {
            ...areaAssessments![area],
            originRowRefs:
              attachments.find((a) => a.candidateRef === area)?.originRowRefs ??
              [],
          },
        ]),
      ),
    };
  }
  const audit: ContentAttachmentRecipientAudit<ContentAttachmentAreaRecipientResponse> =
    {
      ...request,
      rawResponse: { decisions },
      usage: {} as never,
      callAttempts: [],
    };
  return { input: f.input, segmentation: f.segmentation, request, audit };
}

export function expandProviderSchema(
  value: unknown,
  definitions?: Record<string, unknown>,
): unknown {
  if (Array.isArray(value))
    return value.map((child) => expandProviderSchema(child, definitions));
  if (!value || typeof value !== 'object') return value;
  const node = value as Record<string, unknown>;
  const defs = definitions ?? (node.definitions as Record<string, unknown>);
  if (typeof node.$ref === 'string') {
    const key = node.$ref.slice('#/definitions/'.length);
    expect(defs).toHaveProperty(key);
    return expandProviderSchema(defs[key], defs);
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'definitions')
      .map(([key, child]) => [key, expandProviderSchema(child, defs)]),
  );
}
