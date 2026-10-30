import type {
  ReportProfile,
  ReportProfileProposal,
  ReportRouterCall,
  SpendGuard,
} from '@heripo/ledger-extractor';

import {
  buildDocumentResourceIndex,
  prepareReportProfile,
  reportProfileSha256,
  validateReportProfile,
} from '@heripo/ledger-extractor';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';
import { createModel } from '../processing/model-factory';
import { parseLedgerInputText } from './ledger-input';

export interface StoredReportProfile {
  profile: ReportProfile;
  profileSha256: string;
}

const fileFor = (taskId: string) =>
  join(paths.task(taskId).outputRoot, 'report-profile.json');

function checkAgainstInput(taskId: string, profile: ReportProfile) {
  const raw = readFileSync(paths.task(taskId).inputJson);
  const index = buildDocumentResourceIndex(
    parseLedgerInputText(raw.toString('utf8')),
  );
  return validateReportProfile(
    index,
    createHash('sha256').update(raw).digest('hex'),
    profile,
  );
}

/** The confirmed profile of a task, if one was saved and still matches the task input. */
export async function getReportProfile(
  taskId: string,
): Promise<StoredReportProfile | null> {
  if (!existsSync(fileFor(taskId))) return null;
  const profile: ReportProfile = JSON.parse(
    readFileSync(fileFor(taskId), 'utf8'),
  );
  if (checkAgainstInput(taskId, profile).length) return null;
  return { profile, profileSha256: await reportProfileSha256(profile) };
}

/** Save a person-confirmed profile after validating it; the saved file is the profile exactly as given. */
export async function saveReportProfile(
  taskId: string,
  profile: ReportProfile,
): Promise<StoredReportProfile> {
  const issues = checkAgainstInput(taskId, profile);
  if (issues.length)
    throw Object.assign(new Error('Invalid report profile'), { issues });
  mkdirSync(paths.task(taskId).outputRoot, { recursive: true });
  writeFileSync(fileFor(taskId), JSON.stringify(profile, null, 2));
  return { profile, profileSha256: await reportProfileSha256(profile) };
}

/** What the demo shows of the latest automatic classification of a task. */
export interface ReportRouterRunSummary {
  runId: string;
  createdAt: string;
  modelId: string;
  status: ReportRouterCall['status'];
  error: string | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  proposal: ReportProfileProposal | null;
  /** Router inspection and profile validation problems, unrepaired. */
  issues: string[];
  /** Whether the router profile replaced the task's profile; a profile with validation problems is not saved. */
  profileSaved: boolean;
}

const routerRoot = (taskId: string) =>
  join(paths.task(taskId).outputRoot, 'report-router');

/** The latest automatic classification of a task, if one ran. */
export function getLatestReportRouterRun(
  taskId: string,
): ReportRouterRunSummary | null {
  const latest = join(routerRoot(taskId), 'latest.json');
  if (!existsSync(latest)) return null;
  const { runId } = JSON.parse(readFileSync(latest, 'utf8')) as {
    runId: string;
  };
  return JSON.parse(
    readFileSync(join(routerRoot(taskId), runId, 'summary.json'), 'utf8'),
  ) as ReportRouterRunSummary;
}

/**
 * Classify a task's report with one router call and save the call audit. The router profile becomes the
 * task's profile only when it passes profile validation; router problems leave the affected traits unclear
 * instead of blocking. Unclear traits stay for an outside decision.
 */
export async function runReportRouter(
  taskId: string,
  modelId: string,
  /** With `guard`, the router call is reserved against the caps of the caller's run. */
  options: { guard?: SpendGuard } = {},
): Promise<ReportRouterRunSummary> {
  const raw = readFileSync(paths.task(taskId).inputJson);
  const document = parseLedgerInputText(raw.toString('utf8'));
  const index = buildDocumentResourceIndex(document);
  const inputSha256 = createHash('sha256').update(raw).digest('hex');
  const runId = randomUUID();
  const result = await prepareReportProfile(document, index, {
    inputSha256,
    model: options.guard
      ? options.guard.wrap(createModel(modelId))
      : createModel(modelId),
    routerRunId: runId,
  });
  const validation = result.profile
    ? validateReportProfile(index, inputSha256, result.profile)
    : ['No profile'];
  if (result.profile && !validation.length)
    await saveReportProfile(taskId, result.profile);
  const call = result.call!;
  const summary: ReportRouterRunSummary = {
    runId,
    createdAt: new Date().toISOString(),
    modelId,
    status: call.status,
    error: call.error ?? null,
    usage: {
      inputTokens: call.usage?.inputTokens ?? 0,
      outputTokens: call.usage?.outputTokens ?? 0,
      totalTokens: call.usage?.totalTokens ?? 0,
    },
    proposal: call.inspection?.proposal ?? null,
    issues: result.issues,
    profileSaved: !!result.profile && !validation.length,
  };
  const dir = join(routerRoot(taskId), runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'call.json'), JSON.stringify(call, null, 2));
  if (result.profile)
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify(result.profile, null, 2),
    );
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(routerRoot(taskId), 'latest.json'),
    JSON.stringify({ runId }),
  );
  return summary;
}
