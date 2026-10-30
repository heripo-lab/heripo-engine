import type { LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel, LanguageModelUsage } from 'ai';

import type { ContentAttachmentPlan } from '../content-attachment/types';
import type { ArchaeologyLedgerResult } from '../ledger/archaeology-ledger';
import type { PlaceAliasRule, PlaceAliasTable } from './place-aliases';
import type { RelationParents } from './relation-parents';

import { createAuditedModel } from '@heripo/shared';
import { Output, generateText, jsonSchema } from 'ai';

import { labelOf, placeCandidates, wordsOf } from './parent-judgment-request';
import {
  PLACE_ALIASES_VERSION,
  createPlaceAliasResolver,
  validatePlaceAliases,
} from './place-aliases';
import { createRecordNamer } from './record-names';

export const PLACE_ALIAS_PROPOSAL_VERSION = 'place-alias-proposal.v1' as const;
/** Written places, registered names and statements shown in one request. */
const MAX_PLACES = 60;
const MAX_NAMES = 80;
const MAX_STATEMENTS = 30;
/** The longest text block shown as a statement; a basis quote is the whole block. */
const STATEMENT_CHARS = 400;

export interface PlaceAliasProposalRequest {
  version: typeof PLACE_ALIAS_PROPOSAL_VERSION;
  inputSha256: string;
  /** Written places of open parent questions that no record name matched, with the records that wrote them. */
  places: Array<{ ref: string; place: string; recordIds: string[] }>;
  /** Registered record names a place may stand for. */
  names: Array<{ ref: string; recordId: string; name: string }>;
  /** Report text that may state how a place is written; a rule's basis is one of these, quoted whole. */
  statements: Array<{ ref: string; text: string }>;
  systemPrompt: string;
  userPrompt: string;
  providerOutputSchema: ReturnType<typeof createPlaceAliasProposalSchema>;
}

const SYSTEM_PROMPT = `You find how an archaeological report writes its places in short form, so that written places can be matched to the registered records they stand for, using only the report text given.

Rules:
1. Propose a rule only when one statement (S) states the correspondence: for example "1) 정밀발굴조사(23-1~ 6구역)" states that "발굴 {n}구역" (a unit of the 정밀발굴조사) is "23-{n} 구역", and "2) 시굴조사(23-A구역)" with registered names 23-A-1 to 23-A-10 states that "시굴 {n}구역" is "23-A-{n} 구역".
2. Write each written form as it appears in the places (P), with {n} for the one number that is carried over; list other spellings of the same form (Hanja, spacing) in the same rule. A form without {n} maps one fixed place.
3. Write the registered name exactly as the names (N) write it, with {n} in the same place as the number.
4. Give the range of numbers the statement covers ("23-1~ 6" covers 1 to 6). When the statement gives no range, give the range of the registered names that exist.
5. Do not propose a rule from a number alone, from the usual order of surveys, from nearness in the document or from general knowledge. A written form must keep the word that tells its survey or unit apart ("시굴", "발굴"); never propose a bare "{n}구역".
6. If no statement states a correspondence, answer with no rules.
7. Cite the statement ID of each rule's basis. Do not quote text.`;

/** Output schema: statement IDs are format-checked here and checked against the request by code. */
export function createPlaceAliasProposalSchema() {
  return {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            written: { type: 'array', items: { type: 'string' } },
            registered: { type: 'string' },
            numbers: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    from: { type: 'integer' },
                    to: { type: 'integer' },
                  },
                  required: ['from', 'to'],
                  additionalProperties: false,
                },
                { type: 'null' },
              ],
            },
            basis: { type: 'string', pattern: '^S[0-9]+$' },
            reason: { type: 'string' },
          },
          required: ['written', 'registered', 'numbers', 'basis', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['rules'],
    additionalProperties: false,
  } as const;
}

const norm = (text: string) => text.replace(/\s+/g, '');

/**
 * Build the place alias proposal request (`place-alias-proposal.v1`) for the parent questions code left open,
 * without calling a model, or null when no question has a written place that no record name matched or no
 * statement exists. Names are the records such a place may mean (another kind, a shared name word and number,
 * as offered to parent judgment), leaving out records named like a written place, which are short forms
 * themselves; statements are the plan's text blocks of up to 400 characters, shortest first,
 * that carry a numbered code (23-1, 23-A), a place word no offered name has and a word of the offered names, such as
 * `1) 정밀발굴조사(23-1~ 6구역)` for `발굴 1구역`. They come from the report text, not from records, so they do
 * not depend on which survey headings were registered.
 */
export function createPlaceAliasProposalRequest(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  parents: RelationParents,
): PlaceAliasProposalRequest | null {
  const byId = new Map(ledger.records.map((r) => [r.id, r]));
  const places = new Map<string, { place: string; recordIds: string[] }>();
  const names = new Set<string>();
  for (const question of parents.questions) {
    const child = byId.get(question.recordId)!;
    for (const s of question.signals) {
      if (s.kind !== 'phrase' || !s.place || s.targetRecordIds.length) continue;
      const key = norm(s.place);
      const entry = places.get(key) ?? { place: s.place, recordIds: [] };
      if (!entry.recordIds.includes(child.id)) entry.recordIds.push(child.id);
      places.set(key, entry);
      placeCandidates(s.place, child, ledger.records).forEach((id) =>
        names.add(id),
      );
    }
  }
  if (!places.size) return null;

  const placeList = [...places.values()]
    .sort((a, b) => b.recordIds.length - a.recordIds.length)
    .slice(0, MAX_PLACES)
    .map((p, i) => ({ ref: `P${i + 1}`, ...p }));
  // a record named like a written place (`발굴 2구역` beside `발굴 1구역`) is a short form itself, not a name
  const shapeOf = (text: string) => norm(text).replace(/\d+/g, '#');
  const shapes = new Set([...places.keys()].map(shapeOf));
  const nameList = [...names]
    .map((id) => byId.get(id)!)
    .filter((r) => !shapes.has(shapeOf(labelOf(r))))
    .sort((a, b) => a.ordinal - b.ordinal)
    .slice(0, MAX_NAMES)
    .map((r, i) => ({ ref: `N${i + 1}`, recordId: r.id, name: labelOf(r) }));
  if (!nameList.length) return null;
  const nameWords = new Set(nameList.flatMap((n) => wordsOf(n.name)));
  const placeWords = [
    ...new Set(placeList.flatMap((p) => wordsOf(p.place))),
  ].filter((w) => !nameWords.has(w));
  const statementList = [
    ...new Set(
      plan.units.flatMap((u) => [
        ...u.sources.map((s) => s.resource.data.text.trim()),
        ...u.readOnlyContext.map((c) => c.text.trim()),
      ]),
    ),
  ]
    .filter(
      (t) =>
        t.length <= STATEMENT_CHARS &&
        /\d+-[\dA-Za-z]/.test(t) &&
        placeWords.some((w) => norm(t).includes(w)) &&
        [...nameWords].some((w) => norm(t).includes(w)),
    )
    .sort((a, b) => a.length - b.length)
    .slice(0, MAX_STATEMENTS)
    .map((text, i) => ({ ref: `S${i + 1}`, text }));
  if (!statementList.length) return null;

  const userPrompt = [
    'Written places (P, with the number of records that wrote them):',
    ...placeList.map((p) => `${p.ref} ${p.place} (${p.recordIds.length})`),
    '',
    'Registered names (N):',
    ...nameList.map((n) => `${n.ref} ${n.name}`),
    '',
    'Statements (S):',
    ...statementList.map((s) => `${s.ref} ${s.text}`),
  ].join('\n');
  return {
    version: PLACE_ALIAS_PROPOSAL_VERSION,
    inputSha256: plan.inputSha256,
    places: placeList,
    names: nameList,
    statements: statementList,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    providerOutputSchema: createPlaceAliasProposalSchema(),
  };
}

/** A proposed rule as answered, before code checks. */
interface ProposedRule {
  written: string[];
  registered: string;
  numbers: { from: number; to: number } | null;
  basis: string;
  reason: string;
}
export interface PlaceAliasProposalDrop {
  rule: unknown;
  reason: string;
}
export interface PlaceAliasProposalOutcome {
  /** The kept rules as a table with source `model`, or null when none was kept. */
  table: PlaceAliasTable | null;
  /** Rules left out, with why; a dropped rule is never changed into another. */
  dropped: PlaceAliasProposalDrop[];
}

const ruleKey = (r: ProposedRule) =>
  JSON.stringify([
    r.written.map(norm).sort(),
    norm(r.registered),
    r.numbers ? [r.numbers.from, r.numbers.to] : null,
  ]);
const isRule = (value: unknown): value is ProposedRule => {
  const r = value as Partial<ProposedRule>;
  return (
    !!r &&
    Array.isArray(r.written) &&
    r.written.every((w) => typeof w === 'string') &&
    typeof r.registered === 'string' &&
    typeof r.basis === 'string' &&
    (r.numbers === null ||
      (typeof r.numbers === 'object' &&
        Number.isInteger(r.numbers?.from) &&
        Number.isInteger(r.numbers?.to)))
  );
};

/**
 * Keep the proposed rules both runs gave alike (same written forms, registered name and numbers) that pass code
 * checks, without changing any: a basis among the request's statements and in both runs; a numbered rule with
 * a number range; a written form with a word the registered name lacks (so a bare `{n}구역` never maps); a
 * basis that names a written word and the registered code (`23-A` of `23-A-{n} 구역`) or, for a fixed rule,
 * every registered word; the table checks of `validatePlaceAliases`; and at least one written place it maps to
 * exactly one record. Rules are added in r1's order and one that would make the table invalid is dropped.
 */
export function assemblePlaceAliasProposal(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  request: PlaceAliasProposalRequest,
  responses: [unknown, unknown],
  confirmedAt: string,
): PlaceAliasProposalOutcome {
  const dropped: PlaceAliasProposalDrop[] = [];
  const rulesOf = (response: unknown) => {
    const list = (response as { rules?: unknown })?.rules;
    return Array.isArray(list) ? list : [];
  };
  const [first, second] = responses.map(rulesOf);
  const secondByKey = new Map(
    second.filter(isRule).map((r) => [ruleKey(r), r]),
  );
  const statement = new Map(request.statements.map((s) => [s.ref, s.text]));
  const { named } = createRecordNamer(plan);
  const kindOf = new Map(ledger.records.map((r) => [r.id, r.recordKind]));
  const kept: PlaceAliasRule[] = [];
  const tableOf = (rules: PlaceAliasRule[]): PlaceAliasTable => ({
    version: PLACE_ALIASES_VERSION,
    inputSha256: request.inputSha256,
    source: 'model',
    confirmedAt,
    rules,
  });

  for (const raw of first) {
    const drop = (reason: string) => dropped.push({ rule: raw, reason });
    if (!isRule(raw)) {
      drop('malformed rule');
      continue;
    }
    const other = secondByKey.get(ruleKey(raw));
    if (!other) {
      drop('not proposed alike by both runs');
      continue;
    }
    const basis = statement.get(raw.basis);
    if (!basis || !statement.has(other.basis)) {
      drop('basis is not a statement of the request');
      continue;
    }
    const numbered = raw.registered.includes('{n}');
    if (numbered && !raw.numbers) {
      drop('numbered rule without a number range');
      continue;
    }
    const registeredWords = new Set(wordsOf(raw.registered));
    // words that tell the written form apart from the registered name (`시굴` of `시굴 {n}구역`)
    const writtenWords = raw.written
      .flatMap((w) => wordsOf(w.replaceAll('{n}', ' ')))
      .filter((w) => !registeredWords.has(w));
    if (!writtenWords.length) {
      drop('no written form has a word the registered name lacks');
      continue;
    }
    const code = norm(raw.registered.split('{n}')[0]).replace(/[-_.]+$/, '');
    const basisText = norm(basis);
    const names =
      numbered && code
        ? basisText.includes(code)
        : [...registeredWords].every((w) => basisText.includes(w));
    if (!writtenWords.some((w) => basisText.includes(w)) || !names) {
      drop('basis does not name the written form and the registered name');
      continue;
    }
    const expanded = numbered
      ? Array.from(
          { length: Math.max(0, raw.numbers!.to - raw.numbers!.from + 1) },
          (_, i) =>
            raw.registered.replace('{n}', String(raw.numbers!.from + i)),
        )
      : [raw.registered];
    const kinds = new Set(
      expanded.flatMap((name) => named(name)).map((id) => kindOf.get(id)!),
    );
    const rule: PlaceAliasRule = {
      id: `model-${kept.length + 1}`,
      written: raw.written,
      registered: raw.registered,
      ...(raw.numbers ? { numbers: raw.numbers } : {}),
      ...(kinds.size === 1 ? { recordKind: [...kinds][0] } : {}),
      basis: { quote: basis },
      note: raw.reason,
    };
    const { errors } = validatePlaceAliases(
      plan,
      ledger,
      tableOf([...kept, rule]),
    );
    if (errors.length) {
      drop(`invalid with the kept rules: ${errors.join('; ')}`);
      continue;
    }
    const resolver = createPlaceAliasResolver(plan, ledger, tableOf([rule]));
    const useful = request.places.some((p) =>
      p.recordIds.some(
        (id) => resolver.resolve(p.place, id)?.recordIds.length === 1,
      ),
    );
    if (!useful) {
      drop('maps no written place to exactly one record');
      continue;
    }
    kept.push(rule);
  }
  return { table: kept.length ? tableOf(kept) : null, dropped };
}

export type PlaceAliasProposalRunName = 'r1' | 'r2';
export interface PlaceAliasProposalCall {
  run: PlaceAliasProposalRunName;
  status: 'completed' | 'failed';
  /** Parsed structured output exactly as returned; never repaired. */
  rawResponse?: unknown;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: string;
  callAttempts: LLMCallAttempt[];
}
export interface PlaceAliasProposalResult extends PlaceAliasProposalOutcome {
  version: typeof PLACE_ALIAS_PROPOSAL_VERSION;
  status: 'proposed' | 'failed';
  request: PlaceAliasProposalRequest;
  calls: PlaceAliasProposalCall[];
}

/**
 * Propose a place alias table with two independent runs sent together and keep what both give alike and code
 * accepts (`assemblePlaceAliasProposal`). Calls are never retried beyond maxRetries and a failed call is never
 * re-sent; when one fails no table is proposed. Persistence and budgets stay with the caller.
 */
export async function proposePlaceAliases(
  plan: ContentAttachmentPlan,
  ledger: ArchaeologyLedgerResult,
  request: PlaceAliasProposalRequest,
  options: {
    model: LanguageModel;
    maxRetries?: number;
    abortSignal?: AbortSignal;
    onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
    /** Proposal time written into the table; defaults to now. */
    now?: () => Date;
  },
): Promise<PlaceAliasProposalResult> {
  const call = async (
    run: PlaceAliasProposalRunName,
  ): Promise<PlaceAliasProposalCall> => {
    const audited = createAuditedModel(options.model, options.onAttempt);
    try {
      const response = await generateText({
        model: audited.model,
        output: Output.object({
          schema: jsonSchema(
            request.providerOutputSchema as unknown as Parameters<
              typeof jsonSchema
            >[0],
          ),
        }),
        system: request.systemPrompt,
        prompt: request.userPrompt,
        maxRetries: options.maxRetries ?? 0,
        abortSignal: options.abortSignal,
      });
      return {
        run,
        status: 'completed',
        rawResponse: response.output,
        usage: response.usage,
        finishReason: response.finishReason,
        callAttempts: audited.attempts,
      };
    } catch (error) {
      return {
        run,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        callAttempts: audited.attempts,
      };
    }
  };
  const calls = await Promise.all([call('r1'), call('r2')]);
  if (calls.some((c) => c.status === 'failed'))
    return {
      version: PLACE_ALIAS_PROPOSAL_VERSION,
      status: 'failed',
      request,
      calls,
      table: null,
      dropped: [],
    };
  const confirmedAt = (options.now?.() ?? new Date()).toISOString();
  return {
    version: PLACE_ALIAS_PROPOSAL_VERSION,
    status: 'proposed',
    request,
    calls,
    ...assemblePlaceAliasProposal(
      plan,
      ledger,
      request,
      [calls[0].rawResponse, calls[1].rawResponse],
      confirmedAt,
    ),
  };
}
