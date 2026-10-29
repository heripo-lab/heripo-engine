/**
 * Run the automatic ledger pipeline over many processed-document JSON files, one report at a time, unattended.
 *
 *   pnpm --filter @heripo/demo-web ledger:batch -- --name <batch> --max-calls <n> --max-tokens <n> <file or dir>...
 *
 * Every report gets the default per-report budget (`LEDGER_BATCH_REPORT_BUDGET`, or `--report-calls` and
 * `--report-tokens`). A report starts only when what is left of the batch budget covers that whole per-report
 * budget, so the batch never exceeds `--max-calls` and `--max-tokens`. A completed report is charged what it used;
 * a failed or interrupted report is charged its whole per-report budget, the most the pipeline lets it spend.
 * Failed and interrupted reports are not retried.
 *
 * The manifest `data/ledger-batches/<batch>/manifest.json` is written after every change, so a stopped batch
 * continues with its next pending report when started again with the same name. Tasks are written under the
 * usual task and output directories but are not registered in the demo database, so the demo server never
 * resumes or rewrites them; run one batch process at a time and do not read a task while it is running.
 * `--dry-run` makes no model call: it checks the inputs, the package build and the budget arithmetic.
 */
import { createHash, randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, join, resolve } from 'path';
import { parseArgs } from 'util';

import { getArchaeologyLedger } from '~/lib/ledger/archaeology-ledger';
import { parseLedgerInputText } from '~/lib/ledger/ledger-input';
import { runLedgerPipeline } from '~/lib/ledger/ledger-pipeline';
import { ledgerOptionsFile } from '~/lib/ledger/ledger-task-options';
import { paths } from '~/lib/paths';

import type { LedgerStageModels } from '~/features/ledger/constants/ledger-run';
import {
  DEFAULT_LEDGER_MODELS,
  LEDGER_BATCH_REPORT_BUDGET,
} from '~/features/ledger/constants/ledger-run';

interface Usage {
  calls: number;
  totalTokens: number;
}
interface BatchReport {
  file: string;
  sha256: string;
  taskId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: string | null;
  finishedAt: string | null;
  /** What the pipeline reported; absent when it stopped before returning. */
  used: Usage | null;
  /** What the batch budget counts for the report: `used`, or the whole per-report budget when it did not finish. */
  charged: Usage | null;
  error: string | null;
  summary: {
    records: number;
    reviewItems: number;
    layerMentions: number;
    mediaCandidates: number;
    validation: string;
  } | null;
}
interface BatchManifest {
  version: 'ledger-batch.v1';
  name: string;
  createdAt: string;
  models: LedgerStageModels;
  batch: boolean;
  budget: { maxCalls: number; maxTotalTokens: number };
  reportBudget: { maxCalls: number; maxTotalTokens: number };
  reports: BatchReport[];
}

/** Workspace packages the demo imports from their built `dist`. */
const BUILT_PACKAGES = ['ledger-extractor', 'shared', 'model', 'logger'];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'max-calls': { type: 'string' },
    'max-tokens': { type: 'string' },
    'report-calls': { type: 'string' },
    'report-tokens': { type: 'string' },
    model: { type: 'string' },
    'no-batch': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

const log = (message: string) =>
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
const toInt = (value: string | undefined, label: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${label} must be a positive integer`);
  return n;
};

/** Every JSON file named, or found directly inside a named directory, in name order. */
function inputFiles(args: string[]) {
  const files = args.flatMap((arg) => {
    const path = resolve(arg);
    return statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => join(path, f))
      : [path];
  });
  return [...new Set(files)];
}

/** Newest modification time of the files under a directory, in milliseconds. */
function newest(dir: string): number {
  if (!existsSync(dir)) return 0;
  return Math.max(
    0,
    ...readdirSync(dir, { withFileTypes: true }).map((e) =>
      e.isDirectory()
        ? newest(join(dir, e.name))
        : statSync(join(dir, e.name)).mtimeMs,
    ),
  );
}

/** Packages whose source changed after their last build; a paid run against an old build spends on old code. */
function staleBuilds() {
  const root = resolve(process.cwd(), '../../packages');
  return BUILT_PACKAGES.filter(
    (name) =>
      newest(join(root, name, 'src')) > newest(join(root, name, 'dist')),
  );
}

const used = (reports: BatchReport[]): Usage =>
  reports.reduce(
    (sum, r) => ({
      calls: sum.calls + (r.charged?.calls ?? 0),
      totalTokens: sum.totalTokens + (r.charged?.totalTokens ?? 0),
    }),
    { calls: 0, totalTokens: 0 },
  );

function main() {
  if (!values.name || !/^[\w.-]+$/.test(values.name))
    throw new Error(
      '--name is required (letters, digits, dot, dash, underscore)',
    );
  const dir = join(paths.dataDir, 'ledger-batches', values.name);
  const manifestFile = join(dir, 'manifest.json');
  const save = (manifest: BatchManifest) => {
    // write a whole new file and swap it in, so a crash never leaves half a manifest
    writeFileSync(`${manifestFile}.tmp`, JSON.stringify(manifest, null, 2));
    renameSync(`${manifestFile}.tmp`, manifestFile);
  };

  let manifest: BatchManifest;
  if (existsSync(manifestFile)) {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    if (positionals.length)
      log('Continuing the saved batch; input arguments are ignored');
  } else {
    const files = inputFiles(positionals);
    if (!files.length)
      throw new Error('Name at least one input file or directory');
    const model = values.model;
    manifest = {
      version: 'ledger-batch.v1',
      name: values.name,
      createdAt: new Date().toISOString(),
      models: model
        ? {
            router: model,
            discovery: model,
            deduplication: model,
            attachment: model,
          }
        : DEFAULT_LEDGER_MODELS,
      batch: !values['no-batch'],
      budget: {
        maxCalls: toInt(values['max-calls'], '--max-calls'),
        maxTotalTokens: toInt(values['max-tokens'], '--max-tokens'),
      },
      reportBudget: {
        maxCalls: values['report-calls']
          ? toInt(values['report-calls'], '--report-calls')
          : LEDGER_BATCH_REPORT_BUDGET.maxCalls,
        maxTotalTokens: values['report-tokens']
          ? toInt(values['report-tokens'], '--report-tokens')
          : LEDGER_BATCH_REPORT_BUDGET.maxTotalTokens,
      },
      reports: files.map((file) => ({
        file,
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        taskId: null,
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        used: null,
        charged: null,
        error: null,
        summary: null,
      })),
    };
  }
  return { dir, manifest, save };
}

async function run() {
  const { dir, manifest, save } = main();
  const stale = staleBuilds();
  if (stale.length)
    throw new Error(
      `Source is newer than the build for ${stale.join(', ')}; run pnpm build:packages first`,
    );
  const { reportBudget, budget } = manifest;
  const fits = () => {
    const spent = used(manifest.reports);
    return (
      budget.maxCalls - spent.calls >= reportBudget.maxCalls &&
      budget.maxTotalTokens - spent.totalTokens >= reportBudget.maxTotalTokens
    );
  };

  if (values['dry-run']) {
    for (const r of manifest.reports.filter((x) => x.status === 'pending')) {
      try {
        parseLedgerInputText(readFileSync(r.file, 'utf8'));
        log(`ok      ${basename(r.file)}`);
      } catch (error) {
        log(`invalid ${basename(r.file)}: ${(error as Error).message}`);
      }
    }
    const pending = manifest.reports.filter(
      (r) => r.status === 'pending',
    ).length;
    const spent = used(manifest.reports);
    const room = Math.min(
      Math.floor((budget.maxCalls - spent.calls) / reportBudget.maxCalls),
      Math.floor(
        (budget.maxTotalTokens - spent.totalTokens) /
          reportBudget.maxTotalTokens,
      ),
    );
    log(
      `${pending} pending reports; the budget left starts ${Math.max(0, room)} more at ${reportBudget.maxCalls} calls and ${reportBudget.maxTotalTokens} tokens each. Builds are current. No calls were made.`,
    );
    return;
  }

  mkdirSync(dir, { recursive: true });
  const lock = join(dir, 'run.lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive)
      throw new Error(`Batch ${manifest.name} is already running (pid ${pid})`);
  }
  writeFileSync(lock, String(process.pid));
  const controller = new AbortController();
  process.once('SIGINT', () => {
    log('Stopping after the current step...');
    controller.abort();
  });

  try {
    // a report left running by a stopped process may have spent up to its whole budget
    for (const r of manifest.reports.filter((x) => x.status === 'running')) {
      r.status = 'interrupted';
      r.charged = {
        calls: reportBudget.maxCalls,
        totalTokens: reportBudget.maxTotalTokens,
      };
      r.finishedAt = new Date().toISOString();
      r.error = 'the batch process stopped while this report was running';
    }
    save(manifest);

    for (const r of manifest.reports) {
      if (r.status !== 'pending') continue;
      if (controller.signal.aborted) break;
      if (!fits()) {
        log('The batch budget left does not cover another report; stopping.');
        break;
      }
      const rawText = readFileSync(r.file, 'utf8');
      if (createHash('sha256').update(rawText).digest('hex') !== r.sha256) {
        r.status = 'failed';
        r.error = 'the input file changed after the batch was created';
        save(manifest);
        continue;
      }
      const taskId = `task_${randomUUID()}`;
      const options = {
        models: manifest.models,
        budget: reportBudget,
        batch: manifest.batch,
      };
      mkdirSync(paths.task(taskId).root, { recursive: true });
      writeFileSync(paths.task(taskId).inputJson, rawText, 'utf8');
      writeFileSync(
        ledgerOptionsFile(taskId),
        JSON.stringify(options, null, 2),
      );
      Object.assign(r, {
        taskId,
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      save(manifest);
      log(`Start ${basename(r.file)} as ${taskId}`);
      try {
        const result = await runLedgerPipeline(taskId, options, {
          onStep: (step) => log(`  step ${step}`),
          log: (message) => log(`  ${message}`),
          abortSignal: controller.signal,
        });
        const view = await getArchaeologyLedger(taskId);
        Object.assign(r, {
          status: 'completed',
          used: result.used,
          charged: result.used,
          summary: view && {
            records: view.ledger.records.length,
            reviewItems: view.ledger.reviewItems.length,
            layerMentions: view.ledger.layerMentions.length,
            mediaCandidates: view.ledger.mediaCandidates.length,
            validation: view.ledger.ledger.validationStatus,
          },
        });
      } catch (error) {
        Object.assign(r, {
          status: controller.signal.aborted ? 'interrupted' : 'failed',
          charged: {
            calls: reportBudget.maxCalls,
            totalTokens: reportBudget.maxTotalTokens,
          },
          error: (error as Error).message,
        });
      }
      r.finishedAt = new Date().toISOString();
      save(manifest);
      const spent = used(manifest.reports);
      log(
        `${r.status} ${basename(r.file)}${r.used ? ` (${r.used.calls} calls, ${r.used.totalTokens} tokens)` : ''}; batch charged ${spent.calls} calls and ${spent.totalTokens} tokens of ${budget.maxCalls} and ${budget.maxTotalTokens}`,
      );
    }
  } finally {
    rmSync(lock, { force: true });
  }
  const counts = manifest.reports.reduce<Record<string, number>>(
    (n, r) => ({ ...n, [r.status]: (n[r.status] ?? 0) + 1 }),
    {},
  );
  log(`Batch ${manifest.name}: ${JSON.stringify(counts)}`);
  // pending provider batches keep the process alive; the run is over
  process.exit(0);
}

run().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
