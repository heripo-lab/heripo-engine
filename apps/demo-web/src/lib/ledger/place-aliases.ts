import type { PlaceAliasTable } from '@heripo/ledger-extractor';

import { validatePlaceAliases } from '@heripo/ledger-extractor';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { paths } from '../paths';
import { getLedgerBase } from './archaeology-ledger';

const fileFor = (taskId: string) =>
  join(paths.task(taskId).outputRoot, 'place-aliases.json');

/** The task's saved place alias table exactly as given, if one was saved. */
export function readPlaceAliases(taskId: string): PlaceAliasTable | null {
  return existsSync(fileFor(taskId))
    ? JSON.parse(readFileSync(fileFor(taskId), 'utf8'))
    : null;
}

/**
 * Save a place alias table (a person's, or a proposal kept by code checks) after validating it against the task's latest attachment plan and
 * its assembled ledger; a table with errors is refused. The saved file is the table exactly as given.
 */
export function savePlaceAliases(taskId: string, table: unknown) {
  const base = getLedgerBase(taskId);
  if (!base)
    throw Object.assign(new Error('Place aliases need an assembled ledger'), {
      issues: ['Run the thin content attachment first'],
    });
  const { errors, warnings } = validatePlaceAliases(
    base.plan,
    base.assembled,
    table,
  );
  if (errors.length)
    throw Object.assign(new Error('Invalid place aliases'), { issues: errors });
  mkdirSync(paths.task(taskId).outputRoot, { recursive: true });
  writeFileSync(fileFor(taskId), JSON.stringify(table, null, 2));
  return { table: table as PlaceAliasTable, warnings };
}

/** Remove the task's saved place alias table; the ledger is assembled without it again. */
export function deletePlaceAliases(taskId: string) {
  rmSync(fileFor(taskId), { force: true });
}
