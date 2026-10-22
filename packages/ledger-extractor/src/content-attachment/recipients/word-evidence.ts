import type { CandidateEvidence } from '../../candidates/candidate-discovery';
import type { createContentAttachmentGroundedInput } from '../grounding';

type Grounded = ReturnType<typeof createContentAttachmentGroundedInput>;
type Input = {
  payload: {
    current: Pick<
      Grounded['payload']['current'],
      'excerpts' | 'readOnlyContext'
    >;
  };
  codeMap: Pick<Grounded['codeMap'], 'excerpts' | 'supportingBody'>;
};

export interface ContentAttachmentWordSource {
  ref: string;
  originalRef: string;
  kind: 'excerpt' | 'read_only';
  text: string;
  words: Array<{ ref: string; charStart: number; charEnd: number }>;
  evidence: CandidateEvidence[];
  resourceKey: string;
}
export interface ContentAttachmentWordEvidenceSnapshot {
  version: 'word-ranges.v1';
  sources: ContentAttachmentWordSource[];
}
export interface ContentAttachmentWordRangeEvidence {
  range: string;
  basis: 'direct' | 'context';
  sourceRef: string;
  originalRef: string;
  resourceKey: string;
  charStart: number;
  charEnd: number;
  text: string;
  evidence: CandidateEvidence[];
}

export const CONTENT_ATTACHMENT_WORD_RANGE_PATTERN =
  /^((?:E|X)[1-9]\d*):W([1-9]\d*)-W([1-9]\d*)$/;

export const CONTENT_ATTACHMENT_WORD_EVIDENCE_POLICY =
  'WORD-ID EVIDENCE SELECTION: Excerpt and read-only text is represented by [W ref, literal non-whitespace unit] rows. These are deterministic surface units, not semantic clauses. Punctuation, split numbers, decimals and incomplete fragments remain literal. W numbering restarts in each source; E refs identify current excerpts and X refs identify read-only passages. Keep original body-block and table boundaries. For EACH candidate independently inspect ALL substantive clauses/actions in the whole current E. A cell may directly describe an area own boundary/grid/layout AND a particular unit own excavation; one local action does not classify or erase every other action in that cell. Include a candidate when an independently supported part directly describes it, even if other parts concern another object. Exclude only after checking the full E against that candidate own definition; a shared action word, location or containing area alone does not establish the subject. Preserve original qualifier, inventory, title, navigation, local-work and two-uncertainty criteria.\nReturn wordRanges for EVERY member, using only compact strings such as E7:W2-W5 or X1:W1-W3 with both endpoints inclusive. Select narrow, sufficient original ranges for each directly supported action or clause; multiple disjoint ranges and shared predicate ranges are allowed. Do not select an entire E merely to avoid identifying the relevant words. Decode explicit numbers through original candidate numbers and K evidence; W and opaque R suffixes are not object numbers. Keep candidateEvidenceRefs as that candidate own K citations. An included or unresolved attachment, or a relationshipSubject alternative, requires at least one range from the CURRENT E. Other E/X ranges may identify an omitted subject, bounded set, continuation or whole/partial scope; they are context only and cannot alone justify attachment, import their recipients, or turn their content into current-E evidence. Link an elliptical task through the original action account AND actual original registration membership, not count alone. Excluded members may use an empty wordRanges array; their reason and K grounds must still address the whole E and relevant qualifiers. Preserve collective attachment separately from individual relationship-subject alternatives. Never reproduce or rewrite a quote or return invented words/IDs. Code resolves ranges against unchanged original text and locations, keeps the entire E on the selected record, and never adopts review judgments into first selection. Valid ranges establish provenance, not semantic correctness.';

/** Preserve UTF-16 positions and every original character without interpreting clause boundaries. */
export function createContentAttachmentWordEvidence(
  input: Input,
  visibleExcerpts: ReadonlySet<string>,
): ContentAttachmentWordEvidenceSnapshot {
  const tokenize = (text: string) =>
    [...text.matchAll(/\S+/gu)].map((match, i) => ({
      ref: `W${i + 1}`,
      charStart: match.index,
      charEnd: match.index + match[0].length,
    }));
  const sources: ContentAttachmentWordSource[] = input.payload.current.excerpts
    .filter((e) => visibleExcerpts.has(e[0]))
    .map((e) => {
      const binding = input.codeMap.excerpts.find((b) => b.ref === e[0]);
      const evidence = binding?.evidence;
      if (
        !evidence ||
        evidence.length !== 1 ||
        evidence[0].quote !== e[4] ||
        evidence[0].charEnd - evidence[0].charStart !== e[4].length
      )
        throw new Error('Word evidence differs from original excerpt');
      return {
        ref: e[0],
        originalRef: e[0],
        kind: 'excerpt',
        text: e[4],
        words: tokenize(e[4]),
        evidence,
        resourceKey: evidence[0].resourceKey,
      };
    });
  for (const [i, row] of input.payload.current.readOnlyContext.entries()) {
    const binding = input.codeMap.supportingBody.find((b) => b.ref === row[0]);
    if (!binding || binding.text !== row[2])
      throw new Error('Word evidence differs from original read-only context');
    sources.push({
      ref: `X${i + 1}`,
      originalRef: row[0],
      kind: 'read_only',
      text: row[2],
      words: tokenize(row[2]),
      evidence: [],
      resourceKey: binding.resourceKey,
    });
  }
  return { version: 'word-ranges.v1', sources };
}

/** Derive a model view without repeating long locators or modifying any original source string. */
export function contentAttachmentWordRows(source: ContentAttachmentWordSource) {
  return source.words.map((word) => [
    word.ref,
    source.text.slice(word.charStart, word.charEnd),
  ]);
}

/** Reject fabricated, reversed or out-of-bounds ranges; never repair a returned ID or quotation. */
export function resolveContentAttachmentWordRange(
  snapshot: ContentAttachmentWordEvidenceSnapshot,
  range: string,
  currentExcerptRef: string,
): ContentAttachmentWordRangeEvidence {
  const match = CONTENT_ATTACHMENT_WORD_RANGE_PATTERN.exec(range);
  if (!match) throw new Error('Malformed word range');
  const source = snapshot.sources.find((s) => s.ref === match[1]);
  const first = source?.words[Number(match[2]) - 1];
  const last = source?.words[Number(match[3]) - 1];
  if (!source || !first || !last || first.charStart > last.charStart)
    throw new Error('Unknown or reversed word range');
  const text = source.text.slice(first.charStart, last.charEnd);
  return {
    range,
    basis: source.ref === currentExcerptRef ? 'direct' : 'context',
    sourceRef: source.ref,
    originalRef: source.originalRef,
    resourceKey: source.resourceKey,
    charStart: first.charStart,
    charEnd: last.charEnd,
    text,
    evidence: source.evidence.map((e) => ({
      ...e,
      charStart: e.charStart + first.charStart,
      charEnd: e.charStart + last.charEnd,
      quote: text,
    })),
  };
}
