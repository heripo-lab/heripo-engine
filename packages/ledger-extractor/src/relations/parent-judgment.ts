import type { LLMCallAttempt } from '@heripo/shared';
import type { LanguageModel, LanguageModelUsage } from 'ai';

import type {
  RelationParentEvidence,
  RelationParentJudgmentRequest,
} from './parent-judgment-request';

import { createAuditedModel } from '@heripo/shared';
import { Output, generateText, jsonSchema } from 'ai';

/** One question's answer after code checks; `parentRecordId` null means `none`. */
export interface RelationParentAnswer {
  questionRef: string;
  recordId: string;
  parentRecordId: string | null;
  evidence: RelationParentEvidence[];
  reason: string;
}
export interface RelationParentInspection {
  /** Answers that passed every check, by question ref. */
  answers: Record<string, RelationParentAnswer>;
  /** Problems; an answer with a problem is left out of `answers`. */
  issues: string[];
}
export type RelationParentRunName = 'r1' | 'r2' | 'r3';
export interface RelationParentCall {
  run: RelationParentRunName;
  status: 'completed' | 'failed';
  request: RelationParentJudgmentRequest;
  /** Parsed structured output exactly as returned; never repaired. */
  rawResponse?: unknown;
  usage?: LanguageModelUsage;
  finishReason?: string;
  error?: string;
  callAttempts: LLMCallAttempt[];
  inspection?: RelationParentInspection;
}
/** The decision for one question after three runs. */
export interface RelationParentJudgment {
  recordId: string;
  /** parent: all runs chose the same record; none: all runs answered none; review: anything else. */
  status: 'parent' | 'none' | 'review';
  parentRecordId?: string;
  /** Evidence cited by the runs for the decided parent. */
  evidence: RelationParentEvidence[];
  /** Each run's valid answer as a record ID, `none`, or `invalid` when the run gave no valid answer. */
  votes: string[];
}
export interface RelationParentBatchResult {
  batchId: string;
  status: 'judged' | 'failed';
  calls: RelationParentCall[];
  judgments: RelationParentJudgment[];
}
export interface RelationParentRunOptions {
  model: LanguageModel;
  /** Transient-error retries per call; the default 0 sends each call once. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
  onAttempt?: (attempt: LLMCallAttempt) => void | Promise<void>;
  /** Called after every call, completed or failed, so the caller can persist it. */
  onCall?: (call: RelationParentCall) => void | Promise<void>;
}

/**
 * Check a parent-judgment response against its request without repairing it: every question answered once,
 * the parent among that question's candidates, evidence among that question's evidence, and a parent backed
 * by at least one evidence ID.
 */
export function inspectRelationParentResponse(
  request: RelationParentJudgmentRequest,
  rawResponse: unknown,
): RelationParentInspection {
  const answers: RelationParentInspection['answers'] = {};
  const issues: string[] = [];
  const list = (rawResponse as { answers?: unknown })?.answers;
  if (!Array.isArray(list))
    return { answers, issues: ['Response has no answers array'] };
  const seen = new Set<string>();
  for (const item of list as Array<Record<string, unknown>>) {
    const question = request.questions.find((q) => q.ref === item?.q);
    if (!question) {
      issues.push(`Unknown question ${String(item?.q)}`);
      continue;
    }
    if (seen.has(question.ref)) {
      issues.push(`${question.ref}: answered more than once`);
      delete answers[question.ref];
      continue;
    }
    seen.add(question.ref);
    const parent = String(item.parent);
    const cited = Array.isArray(item.evidence) ? item.evidence.map(String) : [];
    const problems = [
      ...(parent !== 'none' && !question.candidateRefs.includes(parent)
        ? [`parent ${parent} is not a candidate`]
        : []),
      ...cited
        .filter((ref) => !question.evidenceRefs.includes(ref))
        .map((ref) => `evidence ${ref} is not this question's`),
      ...(parent !== 'none' && !cited.length
        ? ['parent without evidence']
        : []),
    ];
    if (problems.length) {
      issues.push(...problems.map((p) => `${question.ref}: ${p}`));
      continue;
    }
    answers[question.ref] = {
      questionRef: question.ref,
      recordId: question.recordId,
      parentRecordId:
        parent === 'none'
          ? null
          : request.candidates.find((c) => c.ref === parent)!.recordId,
      evidence: request.evidence.filter((e) => cited.includes(e.ref)),
      reason: String(item.reason ?? ''),
    };
  }
  for (const q of request.questions)
    if (!seen.has(q.ref)) issues.push(`${q.ref}: not answered`);
  return { answers, issues };
}

/**
 * Decide each question from the runs: a parent only when every run validly chose the same record, `none`
 * only when every run validly answered none; disagreement or an invalid answer leaves it for review.
 */
export function decideRelationParents(
  request: RelationParentJudgmentRequest,
  inspections: RelationParentInspection[],
): RelationParentJudgment[] {
  return request.questions.map((question) => {
    const answers = inspections.map((i) => i.answers[question.ref]);
    const votes = answers.map((a) =>
      a ? (a.parentRecordId ?? 'none') : 'invalid',
    );
    const agreed =
      votes.every((v) => v === votes[0]) && votes[0] !== 'invalid'
        ? votes[0]
        : null;
    const evidence = request.evidence.filter((e) =>
      answers.some((a) => a?.evidence.some((x) => x.ref === e.ref)),
    );
    if (agreed && agreed !== 'none')
      return {
        recordId: question.recordId,
        status: 'parent' as const,
        parentRecordId: agreed,
        evidence,
        votes,
      };
    return {
      recordId: question.recordId,
      status: agreed ? ('none' as const) : ('review' as const),
      evidence: [],
      votes,
    };
  });
}

/**
 * Judge one batch of parent questions with three runs: r1, then r2 and r3 together so they can reuse the
 * provider's prompt cache. Calls are never retried beyond maxRetries and a failed call is never re-sent; a
 * failed call sends every question of the batch to review. Persistence, budgets and stopping stay with the caller.
 */
export async function judgeRelationParentBatch(
  request: RelationParentJudgmentRequest,
  options: RelationParentRunOptions,
): Promise<RelationParentBatchResult> {
  const calls: RelationParentCall[] = [];
  const call = async (run: RelationParentRunName) => {
    const audited = createAuditedModel(options.model, options.onAttempt);
    let result: RelationParentCall;
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
      result = {
        run,
        status: 'completed',
        request,
        rawResponse: response.output,
        usage: response.usage,
        finishReason: response.finishReason,
        callAttempts: audited.attempts,
        inspection: inspectRelationParentResponse(request, response.output),
      };
    } catch (error) {
      result = {
        run,
        status: 'failed',
        request,
        error: error instanceof Error ? error.message : String(error),
        callAttempts: audited.attempts,
      };
    }
    calls.push(result);
    await options.onCall?.(result);
    return result;
  };
  const failed = (): RelationParentBatchResult => ({
    batchId: request.batchId,
    status: 'failed',
    calls,
    judgments: request.questions.map((q) => ({
      recordId: q.recordId,
      status: 'review',
      evidence: [],
      votes: [],
    })),
  });

  if ((await call('r1')).status === 'failed') return failed();
  await Promise.all([call('r2'), call('r3')]);
  if (calls.some((c) => c.status === 'failed')) return failed();
  const ordered = (['r1', 'r2', 'r3'] as const).map(
    (r) => calls.find((c) => c.run === r)!.inspection!,
  );
  return {
    batchId: request.batchId,
    status: 'judged',
    calls,
    judgments: decideRelationParents(request, ordered),
  };
}
