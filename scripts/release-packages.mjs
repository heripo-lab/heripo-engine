#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * Local release trigger for the published @heripo/* packages.
 *
 * It does not build, bump or publish anything locally. It only verifies that
 * the working tree is clean and HEAD matches origin/main, then pushes a trigger
 * tag. The "Packages Release" GitHub Actions workflow performs the release.
 *
 * Usage: node scripts/release-packages.mjs <none|patch|minor|major>
 */
import { spawnSync } from 'node:child_process';

const TAG_PREFIX = 'packages-release';
const LEVELS = ['none', 'patch', 'minor', 'major'];

const level = process.argv[2];
if (!LEVELS.includes(level)) {
  console.error(
    `Usage: node scripts/release-packages.mjs <${LEVELS.join('|')}>`,
  );
  process.exit(1);
}

const git = (args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    console.error(`git ${args.join(' ')} failed.`);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
};

// Untracked files also count as dirty.
if (git(['status', '--porcelain']).length > 0) {
  console.error(
    'Working tree is not clean. Commit, stash or remove changes (including untracked files) first.',
  );
  process.exit(1);
}

git(['fetch', 'origin', 'main']);
const head = git(['rev-parse', 'HEAD']);
const originMain = git(['rev-parse', 'origin/main']);
if (head !== originMain) {
  console.error(
    `HEAD (${head.slice(0, 7)}) does not match origin/main (${originMain.slice(0, 7)}). Check out and pull the latest main first.`,
  );
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const tag = `${TAG_PREFIX}-${level}-${timestamp}`;

git(['tag', tag, head]);
const push = spawnSync('git', ['push', 'origin', `refs/tags/${tag}`], {
  stdio: 'inherit',
});
if (push.status !== 0) {
  git(['tag', '-d', tag]);
  console.error(
    `Failed to push ${tag}. Trigger tags can only be created by organization admins.`,
  );
  process.exit(push.status ?? 1);
}

console.log(`Pushed trigger tag ${tag} (level: ${level}).`);
console.log(
  'The Packages Release workflow is now running: https://github.com/heripo-lab/heripo-engine/actions/workflows/packages-release.yml',
);
