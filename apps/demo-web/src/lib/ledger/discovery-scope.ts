import type { ReportScopeCompletion } from '@heripo/ledger-extractor';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';

const fileFor = (taskId: string) =>
  join(paths.task(taskId).outputRoot, 'discovery-scope.json');

/** Save how an automatic run completed the router's proposed discovery scope. */
export function saveDiscoveryScope(
  taskId: string,
  completion: ReportScopeCompletion,
) {
  mkdirSync(paths.task(taskId).outputRoot, { recursive: true });
  writeFileSync(fileFor(taskId), JSON.stringify(completion, null, 2));
}

/** The saved scope completion of the task's automatic run, if one ran. */
export function readDiscoveryScope(
  taskId: string,
): ReportScopeCompletion | null {
  return existsSync(fileFor(taskId))
    ? JSON.parse(readFileSync(fileFor(taskId), 'utf8'))
    : null;
}
