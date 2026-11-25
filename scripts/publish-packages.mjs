#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * CI release script for the published @heripo/* packages.
 *
 * Runs inside the "Packages Release" GitHub Actions workflow, which is started
 * by a trigger tag pushed with `pnpm release[:patch|:minor|:major]`. Do not run
 * it locally: it pushes to main and publishes to npm through Trusted Publishing.
 *
 * Order: bump -> build -> atomic git push (commit + version tag) -> stage.
 * Staging last guarantees that every released version exists on main.
 *
 * The trusted publishers are configured stage-only, so this script never puts a
 * version on the registry by itself: it stages all five, and a maintainer
 * approves them with 2FA. Approval cannot be automated, because npm requires
 * proof of presence and refuses OIDC tokens.
 *
 * Level `none` re-stages the current version without bumping, committing or
 * tagging. It is the recovery path when only the staging step failed, so it
 * requires the current version tag to point at HEAD. Packages whose current
 * version is already on the registry are skipped.
 *
 * Before running `none`, every staged version of this release must be approved
 * or rejected. npm refuses to stage a version that already exists as a staged
 * version, and this script cannot tell which ones are pending: `npm view` does
 * not report staged versions, and `npm stage list` requires proof of presence,
 * so it is unavailable to CI. Approved packages are then skipped and rejected
 * ones are staged again.
 *
 * Usage: node scripts/publish-packages.mjs <none|patch|minor|major>
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LEVELS = ['none', 'patch', 'minor', 'major'];

const level = process.argv[2];
if (!LEVELS.includes(level)) {
  console.error(
    `Usage: node scripts/publish-packages.mjs <${LEVELS.join('|')}>`,
  );
  process.exit(1);
}

const rootDir = process.cwd();
const packages = [
  { name: '@heripo/logger', dir: 'packages/logger' },
  { name: '@heripo/model', dir: 'packages/model' },
  { name: '@heripo/pdf-parser', dir: 'packages/pdf-parser' },
  { name: '@heripo/document-processor', dir: 'packages/document-processor' },
  { name: '@heripo/ledger-extractor', dir: 'packages/ledger-extractor' },
];

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: rootDir });
  if (result.status !== 0) {
    console.error(`${cmd} ${args.join(' ')} failed.`);
    process.exit(result.status ?? 1);
  }
};

const runCapture = (cmd, args) => {
  const result = spawnSync(cmd, args, {
    stdio: 'pipe',
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    console.error(`${cmd} ${args.join(' ')} failed.`);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
};

// The run finishes with versions staged rather than published, and a failure
// leaves some of them pending, so both outcomes are reported where the
// maintainer will look for them.
const appendSummary = (lines) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, `${lines.join('\n')}\n`);
};

const readVersion = (dir) =>
  JSON.parse(readFileSync(join(rootDir, dir, 'package.json'), 'utf8')).version;

const tagCommit = (tag) => {
  const result = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`],
    { cwd: rootDir, encoding: 'utf8' },
  );
  return result.status === 0 ? result.stdout.trim() : null;
};

const ensureCleanGit = () => {
  if (runCapture('git', ['status', '--porcelain']).length > 0) {
    console.error('Git working tree is not clean.');
    process.exit(1);
  }
};

const ensureVersionsInSync = (version) => {
  for (const pkg of packages) {
    const pkgVersion = readVersion(pkg.dir);
    if (pkgVersion !== version) {
      console.error(
        `${pkg.name} is at ${pkgVersion}, but the root package is at ${version}. Align the versions before releasing.`,
      );
      process.exit(1);
    }
  }
};

const ensureNoneReleaseMatchesHead = (tag) => {
  const commit = tagCommit(tag);
  if (!commit) {
    console.error(
      `Version tag ${tag} does not exist. Release a new version with patch instead of none.`,
    );
    process.exit(1);
  }
  const head = runCapture('git', ['rev-parse', 'HEAD']);
  if (commit !== head) {
    console.error(
      `Version tag ${tag} points to ${commit.slice(0, 7)}, which differs from the current HEAD ${head.slice(0, 7)}. Release a new version with patch instead of none.`,
    );
    process.exit(1);
  }
};

const bumpVersions = () => {
  for (const pkg of packages) {
    run('npm', ['-C', pkg.dir, 'version', level, '--no-git-tag-version']);
  }
  run('npm', ['version', level, '--no-git-tag-version']);
};

const commitTagAndPush = (tag) => {
  run('git', [
    'add',
    'package.json',
    'pnpm-lock.yaml',
    ...packages.map((pkg) => `${pkg.dir}/package.json`),
  ]);
  run('git', ['commit', '-m', `chore: release ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', tag]);
  // Push the release commit and its version tag together so that neither can
  // land without the other.
  run('git', [
    'push',
    '--atomic',
    'origin',
    'HEAD:refs/heads/main',
    `refs/tags/${tag}`,
  ]);
};

const approvalLines = () => [
  'Approve them with 2FA to publish:',
  '',
  '```',
  'npm stage list',
  'npm stage approve <stage-id>   # once per package',
  '```',
  '',
  'Or approve all of them together under **Staged Packages** in your npm',
  'account settings (`npmjs.com/settings/<your-username>/staged-packages`):',
  'a batch covers one version per package under a single 2FA prompt, which is',
  'exactly this release.',
  '',
  'Batch actions succeed or fail independently, and these packages pin each',
  "other's exact versions, so confirm all of them landed with `npm view`",
  'afterwards — otherwise a published package may depend on an unpublished one.',
];

const reportStaged = (tag, staged) => {
  if (staged.length === 0) {
    console.log(`Release ${tag}: every version was already published.`);
    appendSummary([`Release ${tag}: every version was already published.`]);
    return;
  }
  console.log(`Staged ${tag}. Approve to publish: ${staged.join(', ')}`);
  appendSummary([
    `### Release ${tag} is staged, not published`,
    '',
    ...staged.map((entry) => `- \`${entry}\``),
    '',
    ...approvalLines(),
  ]);
};

const reportStagingFailure = (failedName, version, staged) => {
  const lines = [
    `### :warning: Staging failed at \`${failedName}@${version}\``,
    '',
  ];
  if (staged.length === 0) {
    lines.push(
      'Nothing was staged before it, so nothing is pending approval and this',
      'release can be retried with level `none` once the cause is fixed.',
    );
  } else {
    lines.push(
      'These versions were staged before the failure and are now pending',
      'approval:',
      '',
      ...staged.map((entry) => `- \`${entry}\``),
      '',
      '**Approve or reject every one of them before retrying with level',
      '`none`.** npm refuses to stage a version that already exists as a staged',
      'version, and this script cannot detect pending ones. Approved packages',
      'are skipped on the retry; rejected ones are staged again.',
      '',
      ...approvalLines(),
    );
  }
  appendSummary(lines);
};

const findPackedTarball = (packOutput, tempDir) => {
  const match = packOutput.match(/\S+\.tgz/);
  if (match) {
    return resolve(tempDir, match[0].trim());
  }
  const files = readdirSync(tempDir)
    .map((name) => ({ name, mtime: statSync(join(tempDir, name)).mtimeMs }))
    .filter((entry) => entry.name.endsWith('.tgz'))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) {
    console.error('Failed to locate packed tarball.');
    process.exit(1);
  }
  return resolve(tempDir, files[0].name);
};

const isPublished = (name, version) => {
  // Exits non-zero for a package that has never been published, and prints
  // nothing for a version that does not exist. It does not report staged
  // versions, which is why a pending one has to be cleared by hand before a
  // `none` run; see the header.
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim() === version;
};

const packAndStage = (version) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'heripo-pack-'));

  try {
    // Pack everything first so that a packing failure publishes nothing.
    // pnpm pack rewrites workspace: dependency ranges to real versions.
    const tarballs = packages.map((pkg, i) => {
      console.log(`Packing ${pkg.name} (${i + 1}/${packages.length})...`);
      const packOutput = runCapture('pnpm', [
        '-C',
        pkg.dir,
        'pack',
        '--pack-destination',
        tempDir,
      ]);
      return findPackedTarball(packOutput, tempDir);
    });

    const staged = [];
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      if (isPublished(pkg.name, version)) {
        console.log(`Skipping ${pkg.name}@${version}: already published.`);
        continue;
      }
      console.log(
        `Staging ${pkg.name}@${version} (${i + 1}/${packages.length})...`,
      );
      // Authentication and provenance come from npm Trusted Publishing (OIDC).
      // publishConfig.access is public in every package, so no flag is needed.
      const result = spawnSync('npm', ['stage', 'publish', tarballs[i]], {
        stdio: 'inherit',
        cwd: rootDir,
      });
      if (result.status !== 0) {
        // Whatever was staged before this point is now pending approval and
        // blocks a `none` retry until it is approved or rejected, so name it.
        reportStagingFailure(pkg.name, version, staged);
        process.exit(result.status ?? 1);
      }
      staged.push(`${pkg.name}@${version}`);
    }
    return staged;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const main = () => {
  ensureCleanGit();

  const currentVersion = readVersion('.');
  ensureVersionsInSync(currentVersion);

  if (level === 'none') {
    ensureNoneReleaseMatchesHead(`v${currentVersion}`);
  } else {
    bumpVersions();
  }

  const version = readVersion('.');
  ensureVersionsInSync(version);
  const tag = `v${version}`;

  if (level !== 'none' && tagCommit(tag)) {
    console.error(`Git tag ${tag} already exists.`);
    process.exit(1);
  }

  run('pnpm', ['build:packages:force']);

  if (level !== 'none') {
    commitTagAndPush(tag);
  }

  const staged = packAndStage(version);

  reportStaged(tag, staged);
};

main();
