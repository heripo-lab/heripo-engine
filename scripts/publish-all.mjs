#!/usr/bin/env node
/* eslint-disable no-undef */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);

if (args.length === 0 || args[0].startsWith('-')) {
  console.error(
    'Usage: pnpm release[:patch|:minor|:major] [--tag <dist-tag>] [--no-git] [--allow-dirty] [--dry-run]',
  );
  process.exit(1);
}

const bumpType = args[0];
if (!['none', 'patch', 'minor', 'major'].includes(bumpType)) {
  console.error(
    `Invalid bump type: ${bumpType}. Use none, patch, minor, or major.`,
  );
  process.exit(1);
}

const distTagIndex = args.indexOf('--tag');
const distTag = distTagIndex >= 0 ? args[distTagIndex + 1] : null;
const noGit = args.includes('--no-git');
const allowDirty = args.includes('--allow-dirty');
const dryRun = args.includes('--dry-run');

if (distTagIndex >= 0 && !distTag) {
  console.error('--tag requires a value, e.g. --tag next');
  process.exit(1);
}

const rootDir = process.cwd();
const packages = [
  { name: '@heripo/model', dir: 'packages/model' },
  { name: '@heripo/pdf-parser', dir: 'packages/pdf-parser' },
  { name: '@heripo/document-processor', dir: 'packages/document-processor' },
];

const run = (cmd, cmdArgs, options = {}) => {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const runCapture = (cmd, cmdArgs, options = {}) => {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'pipe',
    cwd: rootDir,
    env: process.env,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

const runPublish = (cmd, cmdArgs) => {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'pipe',
    cwd: rootDir,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    if (bumpType === 'none') {
      console.error(
        "Publish failed while bumpType is 'none'. Ensure the package versions were manually updated to a new version before running release.",
      );
    }
    process.exit(result.status ?? 1);
  }
};

const ensureCleanGit = () => {
  if (allowDirty) {
    return;
  }
  const status = runCapture('git', ['status', '--porcelain']);
  if (status.trim().length > 0) {
    console.error(
      'Git working tree is not clean. Commit or stash changes, or re-run with --allow-dirty.',
    );
    process.exit(1);
  }
};

const bumpVersions = () => {
  if (bumpType === 'none') {
    return;
  }
  for (const pkg of packages) {
    run('pnpm', ['-C', pkg.dir, 'version', bumpType, '--no-git-tag-version']);
  }
  run('pnpm', ['version', bumpType, '--no-git-tag-version']);
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

const packAndPublish = () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'heripo-pack-'));

  try {
    for (const pkg of packages) {
      const packOutput = runCapture('pnpm', [
        '-C',
        pkg.dir,
        'pack',
        '--pack-destination',
        tempDir,
      ]);
      const tarball = findPackedTarball(packOutput, tempDir);

      const publishArgs = ['publish', tarball];
      if (distTag) {
        publishArgs.push('--tag', distTag);
      }
      if (dryRun) {
        publishArgs.push('--dry-run');
      }

      runPublish('npm', publishArgs);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const readVersion = () => {
  const packageJson = runCapture('node', [
    '-e',
    "const pkg=require('./package.json');console.log(pkg.version);",
  ]).trim();
  if (!packageJson) {
    console.error('Failed to read root package version.');
    process.exit(1);
  }
  return packageJson;
};

const commitAndTag = (version) => {
  const tag = `v${version}`;
  const existingTag = runCapture('git', ['tag', '-l', tag]).trim();
  if (existingTag) {
    console.error(`Git tag ${tag} already exists.`);
    process.exit(1);
  }

  run('git', [
    'add',
    'package.json',
    'pnpm-lock.yaml',
    'packages/model/package.json',
    'packages/pdf-parser/package.json',
    'packages/document-processor/package.json',
  ]);
  run('git', ['commit', '-m', `chore: release ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', tag]);
  if (!dryRun) {
    run('git', ['push', 'origin', 'HEAD']);
    run('git', ['push', 'origin', tag]);
  }
};

ensureCleanGit();
bumpVersions();
run('pnpm', ['build']);
packAndPublish();

if (!noGit) {
  const version = readVersion();
  commitAndTag(version);
}

console.log('Release publish complete.');
