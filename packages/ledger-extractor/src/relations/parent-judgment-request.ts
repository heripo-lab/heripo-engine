import type { ContentAttachmentPlan } from '../content-attachment/types';
import type {
  ArchaeologyLedgerResult,
  LedgerRecord,
} from '../ledger/archaeology-ledger';
import type {
  RelationParentQuestion,
  RelationParents,
} from './relation-parents';

export const RELATION_PARENT_JUDGMENT_VERSION =
  'relation-parent-judgment.v2' as const;
/** Questions sent in one call; neighbouring records share candidates and their descriptions. */
export const RELATION_PARENT_BATCH_SIZE = 12;
/** Candidate parents offered for one question. */
export const RELATION_PARENT_MAX_CANDIDATES = 15;
const EXCERPT_CHARS = 300;
const CANDIDATE_EXCERPT_CHARS = 160;
const CHILD_EXCERPTS = 2;
/** Context records shown for one question, and the excerpts and characters shown for each. */
const CONTEXT_RECORDS = 3;
const CONTEXT_EXCERPTS = 2;
const CONTEXT_EXCERPT_CHARS = 200;

export interface RelationParentEvidence {
  ref: string;
  questionRef: string;
  kind: 'phrase' | 'table_row' | 'heading_scope' | 'chapter_title' | 'excerpt';
  text: string;
  locator?: string;
  chapterId?: string;
}
export interface RelationParentJudgmentRequest {
  version: typeof RELATION_PARENT_JUDGMENT_VERSION;
  batchId: string;
  questions: Array<{
    ref: string;
    recordId: string;
    candidateRefs: string[];
    evidenceRefs: string[];
    /** Context records shown for the question; never answers. */
    contextRefs: string[];
  }>;
  candidates: Array<{ ref: string; recordId: string }>;
  /** Records whose text may tie a written place to a candidate's name, such as a survey covering a numbered series. */
  contexts: Array<{ ref: string; recordId: string }>;
  evidence: RelationParentEvidence[];
  systemPrompt: string;
  userPrompt: string;
  providerOutputSchema: ReturnType<typeof createRelationParentSchema>;
}

const SYSTEM_PROMPT = `You decide the direct parent of records in an archaeological excavation ledger: the one record that directly contains each questioned record (the trench, area, layer or feature it lies in or was found in), using only the report text given.

Rules:
1. Choose a parent only when the evidence states that the record lies in, was found in or belongs to that candidate, for example "X에서 출토된", "출수위치 X", "X 내부", or a section about X whose text describes the record as part of X.
2. A heading or chapter title alone is not enough. Use it only together with text that describes the record within that unit.
3. Different spellings name the same unit only when the given text states the correspondence. Context records (K) are not candidates; use their text only for such statements. A short form names a unit when the text states that the survey or area it refers to covers that numbered series: a survey named in the short form and stated to cover units 23-1 to 23-6 makes its unit 1 the unit 23-1. Otherwise do not assume it.
4. Do not infer a parent from the usual order of record kinds, from nearness in the document or from general knowledge.
5. If no candidate is stated, or several fit equally, answer "none".
6. Cite the evidence IDs that state the containment; a parent needs at least one. Do not quote text.
7. Answer every question exactly once, in a few words of reason.`;

/** Output schema: question and evidence IDs are format-checked here and checked against the request by code. */
export function createRelationParentSchema(questionRefs: string[]) {
  return {
    type: 'object',
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            q: { type: 'string', enum: questionRefs },
            parent: { type: 'string', pattern: '^(R[0-9]+|none)$' },
            evidence: {
              type: 'array',
              items: { type: 'string', pattern: '^E[0-9]+$' },
            },
            reason: { type: 'string' },
          },
          required: ['q', 'parent', 'evidence', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['answers'],
    additionalProperties: false,
  } as const;
}

const norm = (text: string) => text.replace(/\s+/g, '');
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;
export const labelOf = (r: LedgerRecord) =>
  r.sourceIdentifier && !r.sourceName.includes(r.sourceIdentifier)
    ? `${r.sourceIdentifier} ${r.sourceName}`
    : r.sourceName;
const numbersOf = (text: string): string[] => text.match(/\d+/g) ?? [];
/** Name words of at least two letters, numbers removed (`23-1 구역` → `구역`). */
export const wordsOf = (text: string) =>
  text.replace(/[\d-]+/g, ' ').match(/[가-힣A-Za-z]{2,}/g) ?? [];

/**
 * Records a stated but unregistered place may mean: another kind, a name word found in the place and, when the
 * place has numbers, a shared number. `발굴 1구역` offers `23-1 구역` (구역, 1) but `98호 수혈` offers no `96호 수혈`.
 */
export function placeCandidates(
  place: string,
  child: LedgerRecord,
  records: LedgerRecord[],
) {
  const text = norm(place);
  const numbers = numbersOf(place);
  return records
    .filter((r) => r.id !== child.id && r.recordKind !== child.recordKind)
    .filter((r) => wordsOf(labelOf(r)).some((w) => text.includes(w)))
    .filter(
      (r) =>
        !numbers.length ||
        numbersOf(labelOf(r)).some((n) => numbers.includes(n)),
    )
    .map((r) => r.id);
}

/**
 * Records that may explain how a stated place is written: of a kind some offered candidate has, not offered,
 * with a name containing a place word no offered candidate has. `발굴 1구역` with candidate `23-1 구역` shows the
 * area `정밀발굴조사`. Without offered candidates there is nothing to tie the place to. Records with more
 * excerpts come first.
 */
export function contextRecords(
  place: string,
  child: LedgerRecord,
  records: LedgerRecord[],
  offered: string[],
) {
  const offeredWords = new Set(
    records
      .filter((r) => offered.includes(r.id))
      .flatMap((r) => wordsOf(labelOf(r))),
  );
  const words = wordsOf(place).filter((w) => !offeredWords.has(w));
  const kinds = new Set(
    records.filter((r) => offered.includes(r.id)).map((r) => r.recordKind),
  );
  return records
    .filter(
      (r) =>
        r.id !== child.id &&
        kinds.has(r.recordKind) &&
        !offered.includes(r.id) &&
        words.some((w) => labelOf(r).includes(w)),
    )
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, CONTEXT_RECORDS)
    .map((r) => r.id);
}
/** A context record's excerpts that carry a numbered code (23-1, 23-A), shortest first; else its first excerpt. */
function contextExcerpts(record: LedgerRecord) {
  const coded = record.content
    .map((c) => c.text)
    .filter((t) => /\d+-[\dA-Za-z]/.test(t))
    .sort((a, b) => a.length - b.length);
  return (coded.length ? coded : record.content.slice(0, 1).map((c) => c.text))
    .slice(0, CONTEXT_EXCERPTS)
    .map((t) => clip(t, CONTEXT_EXCERPT_CHARS));
}

/**
 * Build the parent-judgment requests (`relation-parent-judgment.v2`) for the questions code could not decide,
 * without calling a model. Questions follow ledger order in batches; each offers the candidates its signals
 * named and, for a phrase whose place matched no record, records that may be that place under another
 * spelling, with context records whose text may state how the place is written. Evidence is the signal text
 * and the record's first excerpts with up to 300 characters of their surrounding block from the plan; the
 * model answers with IDs only.
 */
export function createRelationParentRequests(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  parents: RelationParents,
  options: { batchSize?: number; maxCandidates?: number } = {},
): RelationParentJudgmentRequest[] {
  const batchSize = options.batchSize ?? RELATION_PARENT_BATCH_SIZE;
  const maxCandidates = options.maxCandidates ?? RELATION_PARENT_MAX_CANDIDATES;
  const byId = new Map(ledger.records.map((r) => [r.id, r]));
  const blockText = new Map(
    plan.units.flatMap((u) =>
      u.sources.map((s) => [s.resource.key, s.resource.data.text] as const),
    ),
  );
  // the record's first excerpts with the text around them, so a short quote shows the section it stands in
  const contextOf = (recordId: string) => [
    ...new Set(
      ledger.sources
        .filter((s) => s.recordId === recordId)
        .map((s) => {
          const block = blockText.get(s.locator.split('#')[0]);
          if (!block) return s.excerpt;
          const start = Math.max(
            0,
            Math.floor((s.charStart + s.charEnd - EXCERPT_CHARS) / 2),
          );
          return block.slice(start, start + EXCERPT_CHARS);
        }),
    ),
  ];
  const questions = [...parents.questions].sort(
    (a, b) => byId.get(a.recordId)!.ordinal - byId.get(b.recordId)!.ordinal,
  );
  const batches: RelationParentQuestion[][] = [];
  for (let i = 0; i < questions.length; i += batchSize)
    batches.push(questions.slice(i, i + batchSize));

  return batches.map((batch, batchIndex) => {
    const candidates: RelationParentJudgmentRequest['candidates'] = [];
    const candidateRef = (recordId: string) => {
      let entry = candidates.find((c) => c.recordId === recordId);
      if (!entry) {
        entry = { ref: `R${candidates.length + 1}`, recordId };
        candidates.push(entry);
      }
      return entry.ref;
    };
    const contexts: RelationParentJudgmentRequest['contexts'] = [];
    const contextRef = (recordId: string) => {
      let entry = contexts.find((c) => c.recordId === recordId);
      if (!entry) {
        entry = { ref: `K${contexts.length + 1}`, recordId };
        contexts.push(entry);
      }
      return entry.ref;
    };
    const evidence: RelationParentEvidence[] = [];
    const lines: string[] = [];
    const items = batch.map((question, index) => {
      const ref = `Q${index + 1}`;
      const child = byId.get(question.recordId)!;
      const offered = [
        ...new Set([
          ...question.candidateRecordIds,
          ...question.signals.flatMap((s) =>
            s.kind === 'phrase' && s.place && !s.targetRecordIds.length
              ? placeCandidates(s.place, child, ledger.records)
              : [],
          ),
        ]),
      ].slice(0, maxCandidates);
      const context = [
        ...new Set(
          question.signals.flatMap((s) =>
            s.kind === 'phrase' && s.place && !s.targetRecordIds.length
              ? contextRecords(s.place, child, ledger.records, offered)
              : [],
          ),
        ),
      ].slice(0, CONTEXT_RECORDS);
      const own: RelationParentEvidence[] = [
        ...question.signals.map((s) => ({
          ref: '',
          questionRef: ref,
          kind: s.kind,
          text: s.text,
          ...(s.locator ? { locator: s.locator } : {}),
          ...(s.chapterId ? { chapterId: s.chapterId } : {}),
        })),
        ...contextOf(child.id)
          .slice(0, CHILD_EXCERPTS)
          .map((text) => ({
            ref: '',
            questionRef: ref,
            kind: 'excerpt' as const,
            text,
          })),
      ];
      for (const e of own) {
        e.ref = `E${evidence.length + 1}`;
        evidence.push(e);
      }
      return {
        ref,
        child,
        offered: offered.map(candidateRef),
        context: context.map(contextRef),
        own,
      };
    });

    lines.push('Candidates:');
    for (const c of candidates) {
      const r = byId.get(c.recordId)!;
      const first = r.content[0]?.text;
      lines.push(
        `${c.ref} [${r.recordKind}] ${labelOf(r)}${first ? ` — ${clip(first, CANDIDATE_EXCERPT_CHARS)}` : ''}`,
      );
    }
    if (contexts.length) {
      lines.push('', 'Context (not candidates):');
      for (const c of contexts) {
        const r = byId.get(c.recordId)!;
        lines.push(
          `${c.ref} [${r.recordKind}] ${labelOf(r)}`,
          ...contextExcerpts(r).map((t) => `  ${t}`),
        );
      }
    }
    lines.push('', 'Questions:');
    for (const item of items) {
      lines.push(
        `${item.ref} [${item.child.recordKind}] ${labelOf(item.child)}`,
        `  candidates: ${item.offered.join(', ') || 'none'}`,
        ...(item.context.length
          ? [`  context: ${item.context.join(', ')}`]
          : []),
        ...item.own.map(
          (e) =>
            `  ${e.ref} ${e.kind.replace('_', ' ')}: ${clip(e.text, EXCERPT_CHARS)}`,
        ),
      );
    }
    const questionRefs = items.map((i) => i.ref);
    return {
      version: RELATION_PARENT_JUDGMENT_VERSION,
      batchId: `parents-${batchIndex + 1}`,
      questions: items.map((i) => ({
        ref: i.ref,
        recordId: i.child.id,
        candidateRefs: i.offered,
        evidenceRefs: i.own.map((e) => e.ref),
        contextRefs: i.context,
      })),
      candidates,
      contexts,
      evidence,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: lines.join('\n'),
      providerOutputSchema: createRelationParentSchema(questionRefs),
    };
  });
}
