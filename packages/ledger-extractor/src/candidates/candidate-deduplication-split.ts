import type { ExtendedTokenUsage } from '@heripo/shared';
import type { LanguageModel } from 'ai';
import type { z } from 'zod';

import type {
  CandidateDiscoveryPlan,
  CandidateDiscoveryResult,
  LedgerObjectCandidate,
} from './discovery-types';

import { LLMCaller } from '@heripo/shared';

import {
  CANDIDATE_DEDUPLICATION_UNMERGED_REASON,
  SYSTEM_PROMPT,
  deduplicationUnits,
  mergeSchemaByKind,
  savedMergesByKindSchema,
} from './candidate-deduplication';
import { isSameCandidateDiscoveryScope } from './discovery-plan';
import { sameObjectNumber } from './object-numbers';

export const CANDIDATE_DEDUPLICATION_SPLIT_VERSION =
  'candidate-deduplication-split.v4';
/**
 * Split versions a saved audit may carry; v1 left number-linked pairs under different names apart, unasked; v2 did not
 * merge one object's number written in different forms (`107`, `M107`, `99XXM107`); v3 put candidates that code had
 * merged into a block as separate refs, so a model could call two of them uncertain.
 */
export type CandidateDeduplicationSplitVersion =
  | 'candidate-deduplication-split.v1'
  | 'candidate-deduplication-split.v2'
  | 'candidate-deduplication-split.v3'
  | typeof CANDIDATE_DEDUPLICATION_SPLIT_VERSION;
export const CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION =
  'candidate-deduplication.v9' as const;
/** Block prompt versions a saved audit may carry: v8 is the block of a split before v4. */
export type CandidateDeduplicationBlockPromptVersion =
  | 'candidate-deduplication.v8'
  | typeof CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION;
/**
 * Provider options of a block call: Anthropic reasoning effort `low`. On the 32 blocks of four saved reviews,
 * Haiku 5.5 at `low` kept 132 of the 134 whole-pool merge pairs (default effort: 131) with 27% fewer output tokens.
 * Other providers ignore it.
 */
export const CANDIDATE_DEDUPLICATION_BLOCK_PROVIDER_OPTIONS = {
  anthropic: { effort: 'low' },
} as const;
/** Kinds whose duplicates are told apart by meaning and context rather than numbers: every pair goes to a model. */
export const CANDIDATE_DEDUPLICATION_CONTEXT_KINDS: ReadonlySet<
  LedgerObjectCandidate['recordKind']
> = new Set(['site', 'area', 'trench', 'layer', 'shipwreck', 'unknown']);

/**
 * `same_number`: same kind, identifier and name. `number_correspondence`: same kind and name, and one
 * candidate's identifier stands in the other's anchor block or table row as a number of another form, one to one.
 * `number_form` (from split v3): same kind, and the identifiers are one number in different forms
 * (`sameObjectNumber`: `107`, `M107`, `99XXM107`), one to one.
 */
export type CandidateDeduplicationRule =
  'same_number' | 'number_correspondence' | 'number_form';
export interface CandidateDeduplicationSplit {
  version: CandidateDeduplicationSplitVersion;
  /** Pairs merged by code, each with the rule that merged it. */
  ruleMerges: Array<{
    candidateIds: [string, string];
    rule: CandidateDeduplicationRule;
  }>;
  /** Candidates a model judges together: each block is one connected set of possible duplicates. */
  blocks: Array<{
    blockId: string;
    candidateIds: string[];
    /**
     * From split v4: the block's candidates that rule merges already join, two or more per group in pool order. A
     * block holds whole groups, and a model sees each group as one ref.
     */
    ruleGroups?: string[][];
  }>;
}

const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/\s+/gu, '').replace(/[()（）]/gu, '');
// an identifier cell may hold two numbers ("마도23-26 마도시굴23-12"); a number token needs a letter and a digit
const numberTokens = (c: LedgerObjectCandidate) =>
  (c.sourceIdentifier ?? '')
    .split(/[\s,;()（）]+/u)
    .map(norm)
    .filter((x) => /\d/u.test(x) && /\p{L}/u.test(x));
const shape = (x: string) => x.replace(/\d+/gu, '#');

function requireCompleteDiscovery(
  plan: CandidateDiscoveryPlan,
  discovery: CandidateDiscoveryResult,
) {
  if (
    plan.inputSha256 !== discovery.inputSha256 ||
    !isSameCandidateDiscoveryScope(plan, discovery) ||
    discovery.completedUnitIds.length !== plan.units.length ||
    plan.units.some((u) => !discovery.completedUnitIds.includes(u.unitId))
  )
    throw new Error(
      'Deduplication requires completed discovery for the same input and scope',
    );
}

/**
 * Split duplicate review into code rules and small model blocks. Code merges a pair of the same kind when both
 * have the same identifier and name, or when their names match and one's identifier stands in the other's anchor
 * block or table row as a number of a different form (a concordance such as "마도23-3 마도발굴23-28"), provided
 * the link is one to one; numbers of one form side by side ("33호 … 5호") are relations such as overlaps, not
 * identity. A pair goes to a model when its kind is told apart by context (area, layer, site, trench, shipwreck,
 * unknown), when it shares an identifier under another name, when both lack an identifier under one name, when
 * an unnumbered mention shares its name with exactly one numbered candidate, when a correspondence link is not
 * one to one, and (from v2) when numbers of different forms link it under names one of which contains the other,
 * such as a catalogue
 * entry `마도23-26 청자양각연판문병(호)` and the table row `마도시굴23-12 청자양각연판문 병(호)저부편` under the
 * heading "마도23-26 마도시굴23-12"; v1 left such pairs apart without asking. `version` replans a saved split. Pairs that neither code nor a model can join stay separate. Blocks are the connected sets of model
 * pairs, in pool order. Deterministic and offline.
 */
export function planCandidateDeduplication(
  plan: CandidateDiscoveryPlan,
  discovery: CandidateDiscoveryResult,
  version: CandidateDeduplicationSplitVersion = CANDIDATE_DEDUPLICATION_SPLIT_VERSION,
): CandidateDeduplicationSplit {
  requireCompleteDiscovery(plan, discovery);
  const resources = new Map(
    plan.units.flatMap((u) => u.resources.map((r) => [r.key, r] as const)),
  );
  const tokenCache = new Map<string, Set<string>>();
  // the words of a candidate's anchor block, or every cell of its table row
  const tokensOf = (c: LedgerObjectCandidate) => {
    const cached = tokenCache.get(c.candidateId);
    if (cached) return cached;
    const r = resources.get(c.evidence[0].resourceKey);
    const texts = !r
      ? []
      : r.kind === 'tableCell'
        ? [...resources.values()].flatMap((x) =>
            x.kind === 'tableCell' &&
            x.tableId === r.tableId &&
            x.rowIndex === r.rowIndex
              ? [x.data.text]
              : [],
          )
        : [r.data.text];
    const tokens = new Set(
      texts
        .flatMap((t) => t.split(/[\s|,;()（）[\]]+/u))
        .map(norm)
        .filter(Boolean),
    );
    tokenCache.set(c.candidateId, tokens);
    return tokens;
  };
  const cands = discovery.candidates;
  const numberedByName = new Map<string, number>();
  for (const c of cands)
    if (norm(c.sourceIdentifier)) {
      const k = `${c.recordKind}|${norm(c.sourceName)}`;
      numberedByName.set(k, (numberedByName.get(k) ?? 0) + 1);
    }
  const sameNumber: Array<[number, number]> = [];
  const correspondence: Array<[number, number]> = [];
  const forms: Array<[number, number]> = [];
  const otherLinks: Array<[number, number]> = [];
  const model: Array<[number, number]> = [];
  for (let i = 0; i < cands.length; i++)
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i];
      const b = cands[j];
      if (a.recordKind !== b.recordKind) continue;
      const ia = norm(a.sourceIdentifier);
      const ib = norm(b.sourceIdentifier);
      const na = norm(a.sourceName);
      const nb = norm(b.sourceName);
      if (ia && ia === ib && na === nb) {
        sameNumber.push([i, j]);
        continue;
      }
      // from v3 one number in another form (`107`, `M107`, `99XXM107`) names the same object whatever the name
      if (
        (version === 'candidate-deduplication-split.v3' ||
          version === CANDIDATE_DEDUPLICATION_SPLIT_VERSION) &&
        ia &&
        ib &&
        ia !== ib &&
        sameObjectNumber(ia, ib)
      ) {
        forms.push([i, j]);
        continue;
      }
      const xa = numberTokens(a);
      const xb = numberTokens(b);
      const linked =
        (xa.some((x) => tokensOf(b).has(x) || xb.includes(x)) ||
          xb.some((x) => tokensOf(a).has(x))) &&
        !xa.some((x) =>
          xb.some((y) => shape(x) === shape(y) && x !== y && !xa.includes(y)),
        );
      if (ia && ib && ia !== ib && linked) {
        (na === nb ? correspondence : otherLinks).push([i, j]);
        if (na === nb) continue;
        // one name inside the other: a fragment entry (`…병(호)저부편`) under its catalogue name (`…병(호)`)
        if (
          version !== 'candidate-deduplication-split.v1' &&
          (na.includes(nb) || nb.includes(na))
        ) {
          model.push([i, j]);
          continue;
        }
      }
      const unique = numberedByName.get(`${a.recordKind}|${na}`) === 1;
      if (
        (ia && ia === ib) ||
        (!ia && !ib && na === nb) ||
        (na === nb && !ia !== !ib && unique) ||
        CANDIDATE_DEDUPLICATION_CONTEXT_KINDS.has(a.recordKind)
      )
        model.push([i, j]);
    }
  // a correspondence counts only one to one: a number linking one candidate to several goes to a model
  const degree = new Map<number, number>();
  for (const pair of [...correspondence, ...otherLinks])
    for (const x of pair) degree.set(x, (degree.get(x) ?? 0) + 1);
  const formDegree = new Map<number, number>();
  for (const pair of forms)
    for (const x of pair) formDegree.set(x, (formDegree.get(x) ?? 0) + 1);
  const ruleMerges: CandidateDeduplicationSplit['ruleMerges'] = [];
  for (const [i, j] of sameNumber)
    ruleMerges.push({
      candidateIds: [cands[i].candidateId, cands[j].candidateId],
      rule: 'same_number',
    });
  for (const pair of forms) {
    if (pair.some((x) => formDegree.get(x)! > 1)) model.push(pair);
    else
      ruleMerges.push({
        candidateIds: [cands[pair[0]].candidateId, cands[pair[1]].candidateId],
        rule: 'number_form',
      });
  }
  for (const pair of correspondence) {
    if (pair.some((x) => degree.get(x)! > 1)) model.push(pair);
    else
      ruleMerges.push({
        candidateIds: [cands[pair[0]].candidateId, cands[pair[1]].candidateId],
        rule: 'number_correspondence',
      });
  }
  // from v4 a block holds whole rule groups: a model pair joins the groups of its candidates, and a pair inside one
  // group is already decided
  const grouped = version === CANDIDATE_DEDUPLICATION_SPLIT_VERSION;
  const rule = cands.map((_, i) => i);
  const findRule = (x: number): number =>
    rule[x] === x ? x : (rule[x] = findRule(rule[x]));
  const indexOf = new Map(cands.map((c, i) => [c.candidateId, i]));
  if (grouped)
    for (const merge of ruleMerges) {
      const [a, b] = merge.candidateIds.map((id) => findRule(indexOf.get(id)!));
      rule[Math.max(a, b)] = Math.min(a, b);
    }
  const pairs = grouped
    ? model.filter(([i, j]) => findRule(i) !== findRule(j))
    : model;
  const parent = cands.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  const root = (x: number) => find(findRule(x));
  for (const [i, j] of pairs)
    parent[Math.max(root(i), root(j))] = Math.min(root(i), root(j));
  const blocks = new Map<number, number[]>();
  const touched = new Set(pairs.flat().map(findRule));
  for (const x of grouped
    ? cands.flatMap((_, i) => (touched.has(findRule(i)) ? [i] : []))
    : pairs.flat())
    blocks.set(root(x), [...(blocks.get(root(x)) ?? []), x]);
  return {
    version,
    ruleMerges,
    blocks: [...blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, members], k) => {
        const sorted = [...new Set(members)].sort((a, b) => a - b);
        const groups = new Map<number, string[]>();
        for (const x of sorted)
          groups.set(findRule(x), [
            ...(groups.get(findRule(x)) ?? []),
            cands[x].candidateId,
          ]);
        return {
          blockId: `block-${k + 1}`,
          candidateIds: sorted.map((x) => cands[x].candidateId),
          ...(grouped
            ? { ruleGroups: [...groups.values()].filter((g) => g.length > 1) }
            : {}),
        };
      }),
  };
}

const BLOCK_RULE = `
BLOCK REVIEW: The pool is one block of candidates that code selected as possible duplicates of each other. Candidates outside the block were decided without you, and code has already merged candidates of one kind with the same identifier and name, so do not reason about candidates you were not given. The supplied units hold every source block and table row with these candidates' evidence; use them as the relevant source context.
`;

const MERGED_BY_CODE_RULE = `MERGED BY CODE: A candidate with mergedByCode stands for itself and the candidates listed there, which code has already merged into one record by their identifiers. Judge it as that one record, using the evidence of all of them; its ref covers them all. Do not ask in uncertainMatches whether the candidates it holds are the same object.`;

/**
 * The candidates of a block with refs C1… in pool order. From split v4 a rule group is one ref: its first candidate,
 * with the others under `mergedByCode`.
 */
function blockCandidates(
  discovery: CandidateDiscoveryResult,
  block: CandidateDeduplicationSplit['blocks'][number],
) {
  const ids = new Set(block.candidateIds);
  const groupOf = new Map(
    (block.ruleGroups ?? []).flatMap((g) => g.map((id) => [id, g] as const)),
  );
  const byId = new Map(discovery.candidates.map((c) => [c.candidateId, c]));
  return discovery.candidates
    .filter(
      (c) =>
        ids.has(c.candidateId) &&
        (groupOf.get(c.candidateId)?.[0] ?? c.candidateId) === c.candidateId,
    )
    .map((candidate, i) => {
      const merged = (groupOf.get(candidate.candidateId) ?? [])
        .slice(1)
        .map((id) => byId.get(id)!);
      return {
        ref: `C${i + 1}`,
        ...candidate,
        ...(merged.length ? { mergedByCode: merged } : {}),
      };
    });
}

/** The candidate IDs a block ref stands for. */
function refMembers(candidate: ReturnType<typeof blockCandidates>[number]) {
  return [
    candidate.candidateId,
    ...(candidate.mergedByCode ?? []).map((c) => c.candidateId),
  ];
}

/** Refs of each record kind among a block's candidates, kinds in order of first appearance. */
function blockRefsByKind(
  candidates: Array<{ ref: string; recordKind: string }>,
) {
  const kinds = new Map<string, string[]>();
  for (const c of candidates)
    kinds.set(c.recordKind, [...(kinds.get(c.recordKind) ?? []), c.ref]);
  return [...kinds] as Array<[string, [string, ...string[]]]>;
}

/**
 * One model request for one block: the v7 merge prompt plus the block rule, the block's candidates and only the
 * units that hold their evidence. Replayable like the whole-pool request.
 */
export function createCandidateDeduplicationBlockRequest(
  plan: CandidateDiscoveryPlan,
  discovery: CandidateDiscoveryResult,
  block: CandidateDeduplicationSplit['blocks'][number],
) {
  requireCompleteDiscovery(plan, discovery);
  const candidates = blockCandidates(discovery, block);
  const merged = candidates.some((c) => c.mergedByCode);
  return {
    blockId: block.blockId,
    promptVersion: (block.ruleGroups
      ? CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION
      : 'candidate-deduplication.v8') as CandidateDeduplicationBlockPromptVersion,
    systemPrompt: SYSTEM_PROMPT + BLOCK_RULE,
    userPrompt: JSON.stringify({
      inputSha256: discovery.inputSha256,
      scopeChapterId: discovery.scopeChapterId,
      ...(discovery.scopeChapterIds
        ? { scopeChapterIds: discovery.scopeChapterIds }
        : {}),
      blockId: block.blockId,
      candidates,
      units: deduplicationUnits(
        plan,
        candidates.flatMap((c) => [c, ...(c.mergedByCode ?? [])]),
        true,
      ),
      ...(merged ? { rules: [MERGED_BY_CODE_RULE] } : {}),
    }),
  };
}

/**
 * The response schema of a block: merges of two or more refs per record kind, each kind limited to its own refs,
 * and uncertain matches between the block's refs. Exposed for callers that send block requests themselves.
 */
export function createCandidateDeduplicationBlockSchema(
  discovery: CandidateDiscoveryResult,
  block: CandidateDeduplicationSplit['blocks'][number],
) {
  const candidates = blockCandidates(discovery, block);
  return mergeSchemaByKind(
    blockRefsByKind(candidates),
    candidates.map((c) => c.ref) as [string, ...string[]],
  );
}

export interface CandidateDeduplicationBlockAudit {
  blockId: string;
  promptVersion: CandidateDeduplicationBlockPromptVersion;
  systemPrompt: string;
  userPrompt: string;
  response: z.infer<typeof savedMergesByKindSchema>;
  usage: ExtendedTokenUsage;
}
/** A split review: the code split it was made from and one audit per model block. */
export interface CandidateDeduplicationSplitAudit {
  promptVersion: CandidateDeduplicationBlockPromptVersion;
  split: CandidateDeduplicationSplit;
  blocks: CandidateDeduplicationBlockAudit[];
}

/**
 * Review duplicates split by code: plan the rule merges and blocks, then ask a model one block at a time.
 * `completed` holds block audits saved by an earlier attempt of the same split; they are reused, not re-sent.
 * `onBlock` receives each new block audit so the caller can save it.
 */
export async function deduplicateCandidateBlocks(
  plan: CandidateDiscoveryPlan,
  discovery: CandidateDiscoveryResult,
  options: {
    model: LanguageModel;
    maxRetries: number;
    abortSignal?: AbortSignal;
    completed?: CandidateDeduplicationBlockAudit[];
    onBlock?: (audit: CandidateDeduplicationBlockAudit) => void | Promise<void>;
  },
): Promise<CandidateDeduplicationSplitAudit> {
  const split = planCandidateDeduplication(plan, discovery);
  const blocks: CandidateDeduplicationBlockAudit[] = [];
  for (const block of split.blocks) {
    const request = createCandidateDeduplicationBlockRequest(
      plan,
      discovery,
      block,
    );
    const saved = options.completed?.find(
      (a) =>
        a.blockId === block.blockId &&
        a.systemPrompt === request.systemPrompt &&
        a.userPrompt === request.userPrompt,
    );
    if (saved) {
      blocks.push(saved);
      continue;
    }
    const candidates = blockCandidates(discovery, block);
    const { output, usage } = await LLMCaller.call({
      schema: createCandidateDeduplicationBlockSchema(discovery, block),
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      // every block shares the system prompt, so later blocks read it from the provider's prompt cache
      providerOptions: CANDIDATE_DEDUPLICATION_BLOCK_PROVIDER_OPTIONS,
      primaryModel: options.model,
      maxRetries: options.maxRetries,
      abortSignal: options.abortSignal,
      component: 'LedgerCandidateDeduplication',
      phase: 'candidate-deduplication-block',
      metadata: {
        promptVersion: request.promptVersion,
        blockId: block.blockId,
        candidateCount: candidates.length,
      },
    });
    const audit: CandidateDeduplicationBlockAudit = {
      ...request,
      response: output,
      usage,
    };
    blocks.push(audit);
    await options.onBlock?.(audit);
  }
  return {
    promptVersion: CANDIDATE_DEDUPLICATION_BLOCK_PROMPT_VERSION,
    split,
    blocks,
  };
}

const RULE_REASONS: Record<CandidateDeduplicationRule, string> = {
  same_number: '코드 규칙: 같은 종류·번호·이름',
  number_correspondence: '코드 규칙: 같은 이름, 근거 블록·표 행의 번호 대응',
  number_form: '코드 규칙: 같은 종류, 같은 번호의 다른 표기',
};

/**
 * Assemble a split review into the same groups as a whole-pool review. The split is recomputed and each block
 * request rebuilt, so a saved audit replays only against the same pool and context. Rule merges and model merges
 * both assert identity and are joined transitively; a candidate in no merge stays its own record. Invalid or
 * missing block responses are issues; nothing is repaired.
 */
export function assembleCandidateDeduplicationSplit(
  plan: CandidateDiscoveryPlan,
  discovery: CandidateDiscoveryResult,
  audit: CandidateDeduplicationSplitAudit,
): CandidateDeduplicationResultShape {
  const result: CandidateDeduplicationResultShape = {
    version: 'ledger-candidate-groups.v1',
    groups: [],
    issues: [],
    uncertainMatches: [],
  };
  const split = planCandidateDeduplication(
    plan,
    discovery,
    audit.split.version,
  );
  if (JSON.stringify(split) !== JSON.stringify(audit.split)) {
    result.issues.push('Saved split does not match the candidate pool');
    return result;
  }
  const index = new Map(discovery.candidates.map((c, i) => [c.candidateId, i]));
  const parent = discovery.candidates.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  const reasons = new Map<string, string[]>();
  const join = (ids: string[], reason: string) => {
    const xs = ids.map((id) => index.get(id)!);
    for (const x of xs.slice(1)) {
      const [a, b] = [find(xs[0]), find(x)];
      parent[Math.max(a, b)] = Math.min(a, b);
    }
    reasons.set(ids[0], [...(reasons.get(ids[0]) ?? []), reason]);
  };
  for (const merge of split.ruleMerges)
    join(merge.candidateIds, RULE_REASONS[merge.rule]);
  const uncertain: Array<[string, string, string]> = [];
  for (const block of split.blocks) {
    const saved = audit.blocks.find((a) => a.blockId === block.blockId);
    if (!saved) {
      result.issues.push(`Missing block response: ${block.blockId}`);
      continue;
    }
    const request = createCandidateDeduplicationBlockRequest(
      plan,
      discovery,
      block,
    );
    if (
      saved.promptVersion !== request.promptVersion ||
      saved.systemPrompt !== request.systemPrompt ||
      saved.userPrompt !== request.userPrompt
    ) {
      result.issues.push(
        `Block response does not match its request: ${block.blockId}`,
      );
      continue;
    }
    const parsed = savedMergesByKindSchema.safeParse(saved.response);
    if (!parsed.success) {
      result.issues.push(`Invalid block response schema: ${block.blockId}`);
      continue;
    }
    const candidates = blockCandidates(discovery, block);
    const byRef = new Map(candidates.map((c) => [c.ref, c]));
    const kinds = new Set(candidates.map((c) => c.recordKind));
    const used = new Set<string>();
    for (const [kind, merges] of Object.entries(parsed.data.mergesByKind)) {
      if (!kinds.has(kind as LedgerObjectCandidate['recordKind']))
        result.issues.push(
          `Merges listed under a kind absent from ${block.blockId}: ${kind}`,
        );
      for (const merge of merges) {
        const members = merge.members.map((ref) => byRef.get(ref));
        if (members.some((m) => !m)) {
          result.issues.push(`Unknown candidate ref in ${block.blockId}`);
          continue;
        }
        if (merge.members.some((ref) => used.has(ref)))
          result.issues.push(`Repeated candidate ref in ${block.blockId}`);
        // a block holds one record kind, since every pair that forms it does
        merge.members.forEach((ref) => used.add(ref));
        join(
          members.flatMap((m) => refMembers(m!)),
          merge.reason,
        );
      }
    }
    for (const match of parsed.data.uncertainMatches) {
      const left = byRef.get(match.left);
      const right = byRef.get(match.right);
      if (!left || !right) {
        result.issues.push(
          `Invalid uncertain match in ${block.blockId}: ${match.left}, ${match.right}`,
        );
        continue;
      }
      uncertain.push([left.candidateId, right.candidateId, match.reason]);
    }
  }
  if (result.issues.length) return result;
  for (const [left, right] of uncertain)
    if (find(index.get(left)!) === find(index.get(right)!))
      result.issues.push(`Uncertain match inside one group: ${left}, ${right}`);
  if (result.issues.length) return result;
  const groups = new Map<number, string[]>();
  discovery.candidates.forEach((c, i) =>
    groups.set(find(i), [...(groups.get(find(i)) ?? []), c.candidateId]),
  );
  result.groups = [...groups.values()].map((members) => ({
    groupId: `group-${members[0]}`,
    status: 'proposed',
    memberCandidateIds: members,
    reason:
      members.length > 1
        ? members.flatMap((id) => reasons.get(id) ?? []).join(' / ')
        : CANDIDATE_DEDUPLICATION_UNMERGED_REASON,
  }));
  result.uncertainMatches = uncertain.map(([l, r, reason]) => ({
    leftCandidateId: l,
    rightCandidateId: r,
    reason,
  }));
  return result;
}

/** The result shape of `assembleCandidateDeduplication`, repeated here to keep the import one-way. */
interface CandidateDeduplicationResultShape {
  version: 'ledger-candidate-groups.v1';
  groups: Array<{
    groupId: string;
    status: 'proposed';
    memberCandidateIds: string[];
    reason: string;
  }>;
  issues: string[];
  uncertainMatches: Array<{
    leftCandidateId: string;
    rightCandidateId: string;
    reason: string;
  }>;
}
