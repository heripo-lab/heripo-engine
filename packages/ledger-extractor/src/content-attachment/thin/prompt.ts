import type { ContentAttachmentThinCompilation } from './compile';

import { contentAttachmentRecipientSystemPrompt } from '../recipients/recipients';

export const CONTENT_ATTACHMENT_THIN_VERSION =
  'content-attachment-thin.v8' as const;

/** The recipient prompt version whose rules are restored verbatim. */
const RESTORED_RULES_SOURCE_VERSION = 'segment-recipients.v26' as const;

const THIN_BASE_PROMPT = `You attach source segments of an archaeological excavation report to registered ledger candidates.
Input: candidates (R refs, already deduplicated and prefiltered for this page), collective handles (H refs: all candidates of one kind under one chapter), body blocks and table cells of one page split into segments, and read-only context (X refs). bodySequences list body blocks and read-only blocks in original reading order; a block may continue the sentence of the block before it. tableLocations give each table's page and caption.
Words are addressed through windows: each Q holds up to 16 literal words labelled L1..Ln by position. Evidence is "Qref:Lstart-Lend" inside one Q; use several ranges when evidence spans windows. Never rewrite text.
Each segment is listed as [segment ref, its Q/L ranges]. Return one decision for every segment key in d (k = a or n):
- a: the segment describes or reports on candidates. r = individual candidate refs; h = handles when it speaks about a whole collective; x = handle members the source explicitly excludes; ia = recipient-identity uncertainty: groups of alternative candidates, one of which receives this description; sa = relationship-subject uncertainty: groups of possible individual subjects of a relationship clause; e = evidence ranges that identify each target (current segment first, then context if needed).
- n: the segment has no current-investigation target (dates, weather, methods without an object, comparisons with other sites or earlier investigations, captions only).
Rules: attach only objects of the current investigation; an earlier investigation's object is not a current candidate even with the same name. Same name, type, location reference or containment alone is not identity. Table cells with rowOwner are already attached by code, together with any registeredInCell candidates, and are not keys in d. Prefer ia or sa over guessing; r and h may stay empty when a segment has only uncertainty.`;

const THIN_FORMAT_BRIDGE = `MAPPING TO THIS OUTPUT: The rules below are retained verbatim from a richer response format. A confirmed attachment, including an included area, goes in r, or in h for a whole collective; an area that the segment does not describe is not listed. Recipient-identity uncertainty goes in ia and relationship-subject uncertainty in sa, each as groups of alternative candidates; neither replaces or removes confirmed recipients of the same segment. Reasons, coverage states and per-area dispositions are not returned; apply those judgments when choosing r, h, x and e.

RELATION COUNTERPARTS: When a segment states a relation between the object it describes and another object (overlap, cutting or damage, position inside or outside, connection), attach only the described object. Do not put the counterpart in r, h or ia; relation counterparts are extracted at a later link stage. A table remark describes its row's object. Uncertainty about which candidate is the described subject of a relation still goes in sa.`;

/**
 * Paragraphs of the source prompt that carry recipient, area, operation-link and table-continuity rules.
 * Inventory reviews, dating and qualifier roles, collective type boundaries, field-only contracts and the
 * older Q/L format are left out.
 */
const RESTORED_PARAGRAPHS = [0, 9, 10, 11, 12, 18, 22, 23, 24, 29, 30, 31];
const SOURCE_PARAGRAPH_COUNT = 32;
/** Sentences that only define output fields of the richer format. */
const FIELD_ONLY =
  /areaAssessments|nonAreaAttachments|candidateEvidenceRefs|currentWordRanges|contextWordRanges|supportingWordRanges|consideredWordRanges|targetIdentification|operationCoverage|workScopeAssessment|relationshipSubjectAlternatives|recipientIdentityAlternatives groups|originRowRefs|schema|\bCode\b|\breason\b|fields?\b|evidence-ID|evidence IDs|segment key|inventoryReviews|^[A-Z][A-Z ]+:\s*$/;
/** Remaining sentences that still only describe the richer format's lists and fields. */
const CONTRACT_ONLY = [
  'Do not add another model call or repeat source quotations.',
  'The K grounds are required even for exclusions.',
  'Included or unresolved recipients require nonempty current words in THIS segment;',
  'Explain exclusions and genuine recipient-identity uncertainty instead of silently omitting an area.',
  'That list accepts only candidates whose registered kind is not area.',
  'Keep original row grounds when used;',
  'Earlier references to final attachments describe this derived list;',
  'A semantic inclusion error remains an error;',
  'Explain an established, rejected, or unresolved link without substituting another link for it.',
  'Work descriptions must also satisfy their separate operation-coverage contract.',
];

/** Select the restored rules verbatim, sentence by sentence, from the recipient prompt. */
export function contentAttachmentThinRestoredRules(): string {
  const paragraphs = contentAttachmentRecipientSystemPrompt(
    RESTORED_RULES_SOURCE_VERSION,
  ).split(/\n\n|\n(?=[A-Z][A-Z /]{3,}:)/);
  if (paragraphs.length !== SOURCE_PARAGRAPH_COUNT)
    throw new Error('Recipient prompt paragraphs changed');
  const dropped = (s: string) =>
    FIELD_ONLY.test(s) || CONTRACT_ONLY.some((c) => s.startsWith(c));
  return RESTORED_PARAGRAPHS.map((i) =>
    paragraphs[i]
      .replace(/^([A-Z][A-Z /]{3,}):\s*/, '')
      .split(/(?<=[.;])\s+(?=[A-Z(])/)
      .filter((s) => !dropped(s))
      .join(' '),
  )
    .filter(Boolean)
    .join('\n\n');
}

/** Thin system prompt: base instructions, the format bridge and the restored rules. */
export function contentAttachmentThinSystemPrompt(): string {
  return `${THIN_BASE_PROMPT}\n\n${THIN_FORMAT_BRIDGE}\n\n${contentAttachmentThinRestoredRules()}`;
}

const upTo = (n: number) => (n <= 9 ? `[1-${n}]` : `[1-9]|1[0-${n - 10}]`);
const obj = (props: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});
const arr = (items: unknown) => ({ type: 'array', items });

/**
 * Output schema: every judged segment is a required key of d; a decision is either an attachment (k = a)
 * or none (k = n). Evidence ranges admit only existing Q windows and L numbers within each window.
 */
export function createContentAttachmentThinSchema(
  compilation: ContentAttachmentThinCompilation,
) {
  const { codeMap } = compilation;
  const byLength = new Map<number, string[]>();
  for (const w of codeMap.windows) {
    const ids = byLength.get(w.originalWords.length) ?? [];
    ids.push(w.ref.slice(1));
    byLength.set(w.originalWords.length, ids);
  }
  const alternatives = [...byLength].map(
    ([n, ids]) => `Q(?:${ids.join('|')}):L(?:${upTo(n)})-L(?:${upTo(n)})`,
  );
  return {
    type: 'object',
    additionalProperties: false,
    required: ['d'],
    $defs: {
      cand: { type: 'string', enum: codeMap.candidateRefs },
      hnd: { type: 'string', enum: codeMap.handles.map((h) => h.ref) },
      range: { type: 'string', pattern: `^(?:${alternatives.join('|')})$` },
      decision: {
        anyOf: [
          obj({
            k: { type: 'string', enum: ['a'] },
            r: arr({ $ref: '#/$defs/cand' }),
            h: arr({ $ref: '#/$defs/hnd' }),
            x: arr({ type: 'string', pattern: '^R[0-9]+$' }),
            ia: arr(arr({ $ref: '#/$defs/cand' })),
            sa: arr(arr({ $ref: '#/$defs/cand' })),
            e: arr({ $ref: '#/$defs/range' }),
          }),
          obj({ k: { type: 'string', enum: ['n'] } }),
        ],
      },
    },
    properties: {
      d: obj(
        Object.fromEntries(
          codeMap.segments.map((s) => [s, { $ref: '#/$defs/decision' }]),
        ),
      ),
    },
  };
}

export interface ContentAttachmentThinRequest {
  version: typeof CONTENT_ATTACHMENT_THIN_VERSION;
  systemPrompt: string;
  userPrompt: string;
  providerOutputSchema: ReturnType<typeof createContentAttachmentThinSchema>;
}

/** Model request for one compiled unit; the user prompt is the compact input JSON. */
export function createContentAttachmentThinRequest(
  compilation: ContentAttachmentThinCompilation,
): ContentAttachmentThinRequest {
  return {
    version: CONTENT_ATTACHMENT_THIN_VERSION,
    systemPrompt: contentAttachmentThinSystemPrompt(),
    userPrompt: JSON.stringify(compilation.input),
    providerOutputSchema: createContentAttachmentThinSchema(compilation),
  };
}
