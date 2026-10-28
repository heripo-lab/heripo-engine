import type {
  ArchaeologyLedgerResult,
  ContentAttachmentPlan,
  LedgerValidationCheck,
  PlaceAliasOutcome,
  RelationParentJudgment,
} from '@heripo/ledger-extractor';
import type { Chapter, ProcessedDocument } from '@heripo/model';

import {
  assembleArchaeologyLedger,
  buildArchaeologyLedger,
  createPlaceAliasProposalRequest,
  createRelationParentRequests,
} from '@heripo/ledger-extractor';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';
import { getCandidateDiscoveryRun } from './candidate-discovery-run';
import { getContentAttachmentRun } from './content-attachment-run';
import {
  getContentAttachmentThinResult,
  getContentAttachmentThinState,
} from './content-attachment-thin-run';
import { readDiscoveryScope } from './discovery-scope';
import { readPlaceAliases } from './place-aliases';

/** Version of the extractor package the demo bundles; recorded on the ledger. */
const EXTRACTOR_VERSION = '0.2.0';

/** Whether a saved place alias table was applied to the ledger. */
export type PlaceAliasesState = PlaceAliasOutcome;

export interface ArchaeologyLedgerView {
  ledger: ArchaeologyLedgerResult;
  /** The thin run the ledger was assembled from. */
  thin: {
    status: string;
    modelId: string;
    completedAt: string | null;
    totalUnits: number;
    attachedUnits: number;
  };
  /** Titles of the chapters the sources point to, for display. */
  chapterTitles: Record<string, string>;
  /** How parents were decided: by code, by place alias rules, by saved judgment runs; questions left. */
  parents: {
    code: number;
    alias: number;
    judged: number;
    questions: number;
    judgmentsLoaded: boolean;
  };
  placeAliases: PlaceAliasesState;
  /** Images the ledger links or asks about: URL, page and caption, for display. */
  images: Record<string, { url: string; pdfPageNo: number; caption?: string }>;
  /** The full validation's checks, with how many items each looked at and how many failed. */
  checks: LedgerValidationCheck[];
  /**
   * For records of one kind sharing a name (`29호 수혈`, `29 수혈`), the chapter title that tells them apart,
   * such as `B. 조선시대`.
   */
  scopes: Record<string, string>;
  /**
   * The discovery scope of an automatic run: each chapter with its title and whether the code added it to the
   * router's proposal; null when the scope was a person's.
   */
  discoveryScope: Array<{ id: string; title: string; added: boolean }> | null;
}
/**
 * Saved parent judgments (`RelationParentJudgment[]`) for this attachment run: written by the automatic ledger
 * run (`saveParentJudgments`) or outside the demo.
 */
const JUDGMENTS_FILE = 'relation-parent-judgments.json';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/** For each group of same-kind records sharing a name, the first chapter title on which their paths differ. */
function sameNameScopes(
  plan: ContentAttachmentPlan,
  records: ArchaeologyLedgerResult['records'],
) {
  const titles = new Map(
    plan.registry.map((e) => [
      `record-${e.groupId}`,
      e.mentions[0].chapterPath.map((c) => c.originTitle),
    ]),
  );
  const nameKey = (r: ArchaeologyLedgerResult['records'][number]) =>
    `${r.recordKind}|${(r.sourceIdentifier && !r.sourceName.includes(r.sourceIdentifier) ? r.sourceIdentifier + r.sourceName : r.sourceName).replace(/\s+/g, '').replace(/(\d)호/g, '$1')}`;
  const groups = new Map<string, string[]>();
  for (const r of records)
    groups.set(nameKey(r), [...(groups.get(nameKey(r)) ?? []), r.id]);
  const scopes: Record<string, string> = {};
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const paths = ids.map((id) => titles.get(id) ?? []);
    const at = paths[0].findIndex((t, i) => paths.some((p) => p[i] !== t));
    if (at >= 0)
      ids.forEach((id, i) => {
        if (paths[i][at]) scopes[id] = paths[i][at];
      });
  }
  return scopes;
}

function collectTitles(chapters: Chapter[], titles: Record<string, string>) {
  for (const chapter of chapters) {
    titles[chapter.id] = chapter.title;
    collectTitles(chapter.children ?? [], titles);
  }
  return titles;
}

/** The latest attachment plan, its thin run and saved result, and the ledger header fields; null until written. */
function getLedgerInputs(taskId: string) {
  const run = getContentAttachmentRun(taskId);
  const state = getContentAttachmentThinState(taskId);
  const attachments = getContentAttachmentThinResult(taskId);
  if (!run || !state || !attachments) return null;
  const planFile = join(
    paths.task(taskId).outputRoot,
    'content-attachment',
    run.runId,
    'plan.json',
  );
  if (!existsSync(planFile)) return null;
  const plan: ContentAttachmentPlan = read(planFile);
  const document: ProcessedDocument = read(paths.task(taskId).inputJson);
  const extractedAt = state.completedAt ?? state.startedAt;
  const meta = {
    ledgerId: `ledger-${run.runId}`,
    processedDocumentId: document.reportId ?? taskId,
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt,
    createdAt: extractedAt,
  };
  return { planFile, plan, document, state, attachments, meta };
}

/**
 * The latest attachment plan, its thin run and the ledger assembled from them, before parents; null until the
 * thin run has written an assembled result. Used to check a place alias table before saving it.
 */
export function getLedgerBase(taskId: string) {
  const inputs = getLedgerInputs(taskId);
  if (!inputs) return null;
  const { plan, attachments, meta } = inputs;
  return {
    plan,
    assembled: assembleArchaeologyLedger(plan, attachments, meta),
  };
}

/**
 * The parent questions code leaves open in the task's ledger, as judgment requests (`createRelationParentRequests`),
 * built from the same inputs as the ledger itself (place aliases included) without saved judgments. Empty when
 * the ledger cannot be built yet or code decided every parent.
 */
export async function getParentJudgmentRequests(taskId: string) {
  const inputs = getLedgerInputs(taskId);
  if (!inputs) return [];
  const { plan, document, attachments, meta } = inputs;
  const table = readPlaceAliases(taskId);
  const scope = readDiscoveryScope(taskId);
  const built = await buildArchaeologyLedger({
    document,
    plan,
    attachments,
    meta,
    ...(table ? { placeAliases: table } : {}),
    parentJudgments: [],
    ...(scope ? { discoveryScope: scope } : {}),
  });
  return createRelationParentRequests(plan, built.result, built.stages.parents);
}

/**
 * The place alias proposal request for the parent questions code leaves open in the task's ledger without a
 * place alias table (`createPlaceAliasProposalRequest`), with the plan and ledger it was built from; null when
 * the ledger cannot be built yet or no open question has a written place that no record name matched.
 */
export async function getPlaceAliasProposalRequest(taskId: string) {
  const inputs = getLedgerInputs(taskId);
  if (!inputs) return null;
  const { plan, document, attachments, meta } = inputs;
  const scope = readDiscoveryScope(taskId);
  const built = await buildArchaeologyLedger({
    document,
    plan,
    attachments,
    meta,
    parentJudgments: [],
    ...(scope ? { discoveryScope: scope } : {}),
  });
  const request = createPlaceAliasProposalRequest(
    plan,
    built.result,
    built.stages.parents,
  );
  return request ? { plan, ledger: built.result, request } : null;
}

/** Save parent judgments beside the attachment plan, where the ledger build reads them. */
export function saveParentJudgments(
  taskId: string,
  judgments: RelationParentJudgment[],
) {
  const inputs = getLedgerInputs(taskId);
  if (!inputs) throw new Error('No ledger inputs to judge parents for');
  writeFileSync(
    join(inputs.planFile, '..', JUDGMENTS_FILE),
    JSON.stringify(judgments, null, 2),
  );
}

/**
 * Build the archaeology ledger from the task's latest attachment plan and its saved thin result in one engine
 * call, with the task's saved place alias table (applied only when it still validates) and, when saved beside
 * the plan, the parent judgment runs; other parent questions stay as review items. Deterministic and offline;
 * nothing is saved.
 */
export async function getArchaeologyLedger(
  taskId: string,
): Promise<ArchaeologyLedgerView | null> {
  const inputs = getLedgerInputs(taskId);
  if (!inputs) return null;
  const { planFile, plan, document, state, attachments, meta } = inputs;
  // judgments only when saved beside the plan; other parent questions stay as review items
  const judgmentsFile = join(planFile, '..', JUDGMENTS_FILE);
  const judgments: RelationParentJudgment[] = existsSync(judgmentsFile)
    ? read(judgmentsFile)
    : [];
  const table = readPlaceAliases(taskId);
  const scope = readDiscoveryScope(taskId);
  const dropped = getCandidateDiscoveryRun(taskId)?.result?.issues ?? [];
  const built = await buildArchaeologyLedger({
    document,
    plan,
    attachments,
    meta,
    ...(table ? { placeAliases: table } : {}),
    parentJudgments: judgments,
    ...(scope ? { discoveryScope: scope } : {}),
    ...(dropped.length ? { droppedProposals: dropped } : {}),
  });
  const ledger = built.result;
  const shown = new Set([
    ...ledger.mediaReferences.map((m) => m.imageId),
    ...ledger.mediaCandidates.flatMap((m) => m.imageIds),
    ...ledger.reviewItems.flatMap((i) => i.imageIds ?? []),
  ]);
  const images = Object.fromEntries(
    document.images
      .filter((im) => shown.has(im.id))
      .map((im) => [
        im.id,
        {
          url: im.path,
          pdfPageNo: im.pdfPageNo,
          ...(im.caption ? { caption: im.caption.fullText } : {}),
        },
      ]),
  );
  const titles = collectTitles(document.chapters ?? [], {});
  const used = new Set(ledger.sources.flatMap((s) => s.chapterId ?? []));
  const basisCount = (basis: string) =>
    ledger.records.filter((r) => r.parentBasis === basis).length;
  return {
    ledger,
    thin: {
      status: state.status,
      modelId: state.modelId,
      completedAt: state.completedAt,
      totalUnits: state.totalUnits,
      attachedUnits: Object.values(state.units).filter((s) => s === 'completed')
        .length,
    },
    chapterTitles: Object.fromEntries(
      [...used].map((id) => [id, titles[id] ?? id]),
    ),
    parents: {
      code: basisCount('code'),
      alias: basisCount('alias'),
      judged: basisCount('judgment'),
      questions: built.stages.parents.questions.length,
      judgmentsLoaded: judgments.length > 0,
    },
    placeAliases: built.placeAliases,
    images,
    checks: built.validation.checks,
    scopes: sameNameScopes(plan, ledger.records),
    discoveryScope: scope
      ? scope.scopeChapterIds.map((id) => ({
          id,
          title: titles[id] ?? id,
          added: scope.addedChapterIds.includes(id),
        }))
      : null,
  };
}
