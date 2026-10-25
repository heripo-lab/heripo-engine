import type { ReportProfile } from '@heripo/ledger-extractor';

import {
  buildDocumentResourceIndex,
  reportProfileSha256,
  validateReportProfile,
} from '@heripo/ledger-extractor';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';
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
