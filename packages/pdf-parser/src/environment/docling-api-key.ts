import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DOCLING_API_KEY_FILE = '.docling-serve-api-key';

/**
 * Returns the API key that protects the local docling-serve, creating it on
 * first use.
 *
 * docling-serve listens on loopback, which every local account can reach, and
 * accepts conversion requests (including remote URLs) without authentication
 * unless a key is set. The key is stored in the venv with mode 0600, so every
 * PDFParser of the same account and venv, including one that reuses a running
 * server or restarts it, shares the key, and other accounts cannot read it.
 */
export function loadOrCreateDoclingApiKey(venvPath: string): string {
  const path = join(venvPath, DOCLING_API_KEY_FILE);

  try {
    writeFileSync(path, randomBytes(32).toString('hex'), {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  // A file left with wider permissions (or created by an older version) must
  // not stay readable by other accounts. Fails if this account does not own it.
  chmodSync(path, 0o600);

  const key = readFileSync(path, 'utf8').trim();
  if (key) {
    return key;
  }

  // An empty file can only come from an interrupted write; replace it.
  const replacement = randomBytes(32).toString('hex');
  writeFileSync(path, replacement, { mode: 0o600 });
  return replacement;
}
