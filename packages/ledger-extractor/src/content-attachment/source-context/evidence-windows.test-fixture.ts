import type { ContentAttachmentAreaRecipientResponse } from '../recipients/types';

import { createContentAttachmentEvidenceWindowRequest } from './evidence-windows';
import { sourceContextFixture } from './source-context.test-fixture';

export async function evidenceWindowFixture(
  longContext = false,
  twoSegments = false,
) {
  const f = sourceContextFixture();
  if (longContext)
    f.document.chapters[0].textBlocks[4].text = Array.from(
      { length: 34 },
      (_, i) => (i === 16 ? '1.25㎝\t(미완😀' : '어절' + (i + 1)),
    ).join('  ');
  const segmentation = f.segment();
  const excerpt = segmentation.excerptRefs[0];
  if (twoSegments)
    segmentation.rawResponse.segments[excerpt] = [
      { wordRanges: [excerpt + ':W1-W1'] },
      { wordRanges: [excerpt + ':W2-W2'] },
    ];
  const options = { tablePairs: [f.pair] };
  const request = await createContentAttachmentEvidenceWindowRequest(
    f.document,
    f.plan,
    f.unit,
    segmentation,
    options,
  );
  const encode = (range: string) => {
    const [, ref, from, to] = /^((?:E|X)\d+):W(\d+)-W(\d+)$/.exec(range)!;
    return request.windows
      .filter((w) => w.sourceRef === ref)
      .flatMap((w) => {
        const selected = w.originalWords
          .map((word, i) => ({ n: Number(word.slice(1)), i }))
          .filter((x) => x.n >= Number(from) && x.n <= Number(to));
        return selected.length
          ? [
              w.ref +
                ':L' +
                (selected[0].i + 1) +
                '-L' +
                (selected.at(-1)!.i + 1),
            ]
          : [];
      });
  };
  const k = request.sourceRequest.candidateEvidence.map((e) => e.ref);
  const response: ContentAttachmentAreaRecipientResponse = {
    decisions: Object.fromEntries(
      request.sourceRequest.segmentSnapshot.map((s) => {
        const ranges = s.evidence.flatMap((e) => encode(e.range));
        const support = {
          currentWordRanges: ranges,
          contextWordRanges: [],
          candidateEvidenceRefs: k,
          originRowRefs: [],
        };
        return [
          s.ref,
          {
            nonAreaAttachments: [],
            areaAssessments: {
              R1: {
                disposition: 'included',
                ...support,
                reason: 'Synthetic provenance judgment.',
              },
            },
            recipientIdentityAlternatives: [],
            relationshipSubjectAlternatives: [],
            reason: 'Synthetic contract response.',
            workScopeAssessment: {
              state: 'operation',
              currentWordRanges: ranges,
              targetGroups: [
                {
                  targetIdentification: { candidateRefs: ['R1'], ...support },
                  operationCoverage: {
                    state: 'established',
                    supportingWordRanges: ranges,
                    consideredWordRanges: [],
                    reason: 'Synthetic supported operation.',
                  },
                },
              ],
              groupReviews: {},
              reason: 'Synthetic operation.',
            },
            collectiveAssessment: {
              state: 'not_collective',
              currentWordRanges: [],
              contextWordRanges: [],
              reason: 'No inventory.',
            },
            qualifierAssessment: {
              periodWordRanges: [],
              typeWordRanges: [],
              scopeWordRanges: [],
              reason: 'No qualifiers.',
            },
            inventoryReviews: {},
            inventoryMembershipLinks: [],
          },
        ];
      }),
    ),
  };
  return {
    ...f,
    segmentation,
    options,
    request,
    encode,
    response,
    segmentRef: request.sourceRequest.segmentSnapshot[0].ref,
  };
}
