/* eslint-disable no-undef */
import { execSync } from 'node:child_process';

console.log('🚀 Starting demo-web release process...');

try {
  // 1. Fetch latest data from remote 'origin'
  // This ensures 'origin/main' points to the latest commit
  console.log("🔄 Fetching latest data from remote 'origin'...");
  execSync('git fetch origin');
  console.log('✅ Fetch complete.');

  // 2. Generate datetime string in YYYYMMDDHHMMSS format
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const dateTimeString = `${year}${month}${day}${hours}${minutes}${seconds}`;

  const tagName = `demo-web-release-${dateTimeString}`;
  const tagMessage = `Demo Web Release ${tagName}`;

  console.log(`📌 Tag to be created: ${tagName}`);

  // 3. Create tag on latest commit of 'origin/main'
  // This works regardless of which branch you're currently on
  execSync(`git tag -a ${tagName} -m "${tagMessage}" origin/main`);
  console.log(`✅ Tag "${tagName}" created on latest commit of 'origin/main'.`);

  // 4. Push the created tag to remote repository
  execSync(`git push origin ${tagName}`);
  console.log(`🚀 Tag "${tagName}" pushed to remote 'origin'.`);
  console.log('✨ GitHub Actions CD workflow should now be running.');
} catch (error) {
  console.error(`❌ Error during release process: ${error.message}`);
  if (error.stderr) {
    console.error(`Stderr: ${error.stderr.toString()}`);
  }
  process.exit(1);
}
