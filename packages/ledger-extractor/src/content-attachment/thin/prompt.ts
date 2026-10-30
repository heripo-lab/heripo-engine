import type { ContentAttachmentThinCompilation } from './compile-types';

import { contentAttachmentRecipientSystemPrompt } from '../recipients/prompt';
import {
  CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION,
  CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION,
} from './compile-types';

export const CONTENT_ATTACHMENT_THIN_VERSION =
  'content-attachment-thin.v8' as const;
/** The v8 prompt plus the rule for linked page-boundary context (`continuity: 'linked'`). */
export const CONTENT_ATTACHMENT_THIN_LINKED_VERSION =
  'content-attachment-thin.v9' as const;
/**
 * Decisions returned as an array with one item per segment, and a schema that checks reference formats only;
 * membership of segments, candidates, handles and ranges is checked by code. Linked compilations add the
 * page-boundary rule as in v9.
 */
export const CONTENT_ATTACHMENT_THIN_ARRAY_VERSION =
  'content-attachment-thin.v10' as const;
/** v10 plus the rule that headings and discussion statements naming candidates describe them. */
export const CONTENT_ATTACHMENT_THIN_HEADINGS_VERSION =
  'content-attachment-thin.v11' as const;
/** v11 plus the rule that every line of a catalog entry describes its object (`catalog: 'fields'`). */
export const CONTENT_ATTACHMENT_THIN_CATALOG_VERSION =
  'content-attachment-thin.v12' as const;
/** v11 plus the rule for counts and collective summaries. The default. */
export const CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION =
  'content-attachment-thin.v13' as const;
/** v12 plus the rule for counts and collective summaries (`catalog: 'fields'`). */
export const CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION =
  'content-attachment-thin.v14' as const;
/**
 * v13 plus the rule that a layer an object was found in or cut into, and a layer's own account, describe that layer.
 * Opt-in: on three reports it split the runs on findspot and base layers instead of settling them.
 */
export const CONTENT_ATTACHMENT_THIN_LAYER_VERSION =
  'content-attachment-thin.v15' as const;
/** v14 plus the layer-context rule of v15 (`catalog: 'fields'`). */
export const CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION =
  'content-attachment-thin.v16' as const;
export type ContentAttachmentThinRequestVersion =
  | typeof CONTENT_ATTACHMENT_THIN_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_LINKED_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_ARRAY_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_HEADINGS_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_CATALOG_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_LAYER_VERSION
  | typeof CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION;
/** `object`: v8/v9 decisions keyed by segment; `array`: v10 decision items. */
export type ContentAttachmentThinResponseFormat = 'object' | 'array';

/** Whether a request version returns the v10 decision array. */
export const isContentAttachmentThinArrayVersion = (
  version: ContentAttachmentThinRequestVersion,
) =>
  version !== CONTENT_ATTACHMENT_THIN_VERSION &&
  version !== CONTENT_ATTACHMENT_THIN_LINKED_VERSION;

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

const THIN_LINKED_RULE = `PAGE BOUNDARY: Read-only blocks before the first body block may list evidenceOf: R refs whose registration evidence is that block. When the first body block continues such a block (same sentence or same description), its target is that block's subject; otherwise ignore evidenceOf.`;

/** v10 sentences that describe the decision array instead of segment keys of d. */
const ARRAY_FORMAT: Array<[string, string]> = [
  [
    'Return one decision for every segment key in d (k = a or n):',
    'Return d as an array with exactly one item per listed segment, in any order; s is the segment ref and k = a or n:',
  ],
  ['and are not keys in d.', 'and are not items of d.'],
];

/**
 * Thin system prompt: base instructions, the format bridge and the restored rules, plus the page-boundary rule
 * for linked compilations. The array format describes decision items instead of segment keys.
 */
const THIN_HEADINGS_RULE = `HEADINGS AND DISCUSSION STATEMENTS: A heading that names a registered current candidate (a feature, artifact, area, trench or layer, with or without its number) describes that candidate: decide a with it as the recipient, even when figure, plate or photo references follow the name; those references do not make the heading a caption. A topic heading that names no specific candidate, such as a heading for the site's stratigraphy or the survey method, stays n. A sentence stating that the report discusses or examines named current candidates also describes those candidates.`;

const THIN_CATALOG_RULE = `CATALOG ENTRIES: In a catalog that describes registered objects one entry at a time, an entry starts with a line giving one object's catalog or registration numbers and continues with short field lines, such as its name, a translated or foreign-language name, its findspot and find date, and its measurements, followed by its description. Every line of the entry, field lines included, describes that entry's object: decide a with it as the recipient even when the line is only numbers, a name, a list of values or a labeled field, and does not repeat the object's name or number. The entry ends where the next entry's number line begins. Other candidates named in a field line, such as a findspot area, follow the other rules.`;

const THIN_AGGREGATE_RULE = `COUNTS AND COLLECTIVE SUMMARIES: A sentence that describes or counts a collective the report defines for the current investigation, such as the features or finds under a chapter or heading or an enumerated set like "수혈 204기", describes every registered member of that collective, including qualified follow-ups about most or some of its members; use a handle only when it covers exactly that collective. A count of one class within it, such as one material, describes every registered member of that class. A sentence about one type within a collective, such as one ware, form or period, describes only the registered members of that type: list them in r and do not use the collective's handle; decide n when the type cannot be told from the candidates' names. When a stated count clearly exceeds the registered members because it includes finds the report does not register individually, such as discarded, buried or unpublished items, the sentence describes no candidate: decide n.`;

const THIN_LAYER_RULE = `LAYER CONTEXTS: For a registered current layer, this rule replaces RELATION COUNTERPARTS. A segment stating that an identified artifact or feature was found in, recovered from, cut into, founded on or built on that layer describes both: put the object and the layer in r. A segment about a layer's own formation, composition, sequence, depth or extent describes that layer, even when it also names other objects. A layer named only as overburden removed to expose an object, as in "표토층과 현대 퇴적층을 제거하자 유구가 드러났다", is not described: do not attach it. A common layer name such as topsoil (표토) alone does not identify one registered layer; when the source may mean one of several layers, use ia instead of guessing. Relations between other objects still follow RELATION COUNTERPARTS.`;

export function contentAttachmentThinSystemPrompt(
  options: {
    linked?: boolean;
    format?: ContentAttachmentThinResponseFormat;
    /** v11: add the heading and discussion-statement rule. */
    headings?: boolean;
    /** v12: add the catalog-entry rule. */
    catalog?: boolean;
    /** v13/v14: add the counts and collective summaries rule. */
    aggregate?: boolean;
    /** v15/v16: add the layer-context rule. */
    layers?: boolean;
  } = {},
): string {
  const head =
    options.format === 'array'
      ? ARRAY_FORMAT.reduce(
          (prompt, [from, to]) => prompt.replace(from, to),
          THIN_BASE_PROMPT,
        )
      : THIN_BASE_PROMPT;
  const base = `${head}\n\n${THIN_FORMAT_BRIDGE}\n\n${contentAttachmentThinRestoredRules()}`;
  const withHeadings = [
    base,
    ...(options.headings ? [THIN_HEADINGS_RULE] : []),
    ...(options.catalog ? [THIN_CATALOG_RULE] : []),
    ...(options.aggregate ? [THIN_AGGREGATE_RULE] : []),
    ...(options.layers ? [THIN_LAYER_RULE] : []),
  ].join('\n\n');
  return options.linked
    ? `${withHeadings}\n\n${THIN_LINKED_RULE}`
    : withHeadings;
}

const upTo = (n: number) => (n <= 9 ? `[1-${n}]` : `[1-9]|1[0-${n - 10}]`);
const obj = (props: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});
const arr = (items: unknown) => ({ type: 'array', items });

const pattern = (p: string) => ({ type: 'string', pattern: p });
/**
 * v10 output schema, the same for every unit: d is an array of decision items whose segment, candidate, handle
 * and range references are checked by format only.
 */
export function createContentAttachmentThinArraySchema() {
  const ref = pattern('^R[0-9]+$');
  const segment = pattern('^[ET][0-9]+:S[0-9]+$');
  return {
    type: 'object',
    additionalProperties: false,
    required: ['d'],
    properties: {
      d: arr({
        anyOf: [
          obj({
            s: segment,
            k: { type: 'string', enum: ['a'] },
            r: arr(ref),
            h: arr(pattern('^H[0-9]+$')),
            x: arr(ref),
            ia: arr(arr(ref)),
            sa: arr(arr(ref)),
            e: arr(pattern('^Q[0-9]+:L[0-9]+-L[0-9]+$')),
          }),
          obj({ s: segment, k: { type: 'string', enum: ['n'] } }),
        ],
      }),
    },
  };
}

/**
 * v8/v9 output schema: every judged segment is a required key of d; a decision is either an attachment (k = a)
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
  version: ContentAttachmentThinRequestVersion;
  systemPrompt: string;
  userPrompt: string;
  providerOutputSchema:
    | ReturnType<typeof createContentAttachmentThinSchema>
    | ReturnType<typeof createContentAttachmentThinArraySchema>;
}

/**
 * Model request for one compiled unit; the user prompt is the compact input JSON. New requests use v13 (array
 * format with the heading and collective-summary rules), or v14 with the catalog-entry rule, v15 or v16 with the
 * layer-context rule, when the caller passes that version. `version` rebuilds a saved request's version; `format: 'object'` builds the v8/v9
 * request, v9 for linked compilations.
 */
export function createContentAttachmentThinRequest(
  compilation: ContentAttachmentThinCompilation,
  options: {
    format?: ContentAttachmentThinResponseFormat;
    version?: ContentAttachmentThinRequestVersion;
  } = {},
): ContentAttachmentThinRequest {
  const version =
    options.version ??
    (options.format === 'object'
      ? CONTENT_ATTACHMENT_THIN_VERSION
      : CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION);
  const format: ContentAttachmentThinResponseFormat =
    isContentAttachmentThinArrayVersion(version) ? 'array' : 'object';
  const layers =
    version === CONTENT_ATTACHMENT_THIN_LAYER_VERSION ||
    version === CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION;
  const catalog =
    version === CONTENT_ATTACHMENT_THIN_CATALOG_VERSION ||
    version === CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION ||
    version === CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION;
  const aggregate =
    layers ||
    version === CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION ||
    version === CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION;
  const headings =
    format === 'array' && version !== CONTENT_ATTACHMENT_THIN_ARRAY_VERSION;
  const linked =
    compilation.version === CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION ||
    compilation.version ===
      CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION;
  return {
    version:
      format === 'array'
        ? version
        : linked
          ? CONTENT_ATTACHMENT_THIN_LINKED_VERSION
          : CONTENT_ATTACHMENT_THIN_VERSION,
    systemPrompt: contentAttachmentThinSystemPrompt({
      linked,
      format,
      headings,
      catalog,
      aggregate,
      layers,
    }),
    userPrompt: JSON.stringify(compilation.input),
    providerOutputSchema:
      format === 'array'
        ? createContentAttachmentThinArraySchema()
        : createContentAttachmentThinSchema(compilation),
  };
}
