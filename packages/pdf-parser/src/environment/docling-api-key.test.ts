import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  DOCLING_API_KEY_FILE,
  loadOrCreateDoclingApiKey,
} from './docling-api-key';

describe('loadOrCreateDoclingApiKey', () => {
  let venvPath: string;

  beforeEach(() => {
    venvPath = mkdtempSync(join(tmpdir(), 'docling-api-key-test-'));
  });

  afterEach(() => {
    rmSync(venvPath, { recursive: true, force: true });
  });

  test('creates a random key readable only by the owner', () => {
    const key = loadOrCreateDoclingApiKey(venvPath);
    const path = join(venvPath, DOCLING_API_KEY_FILE);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path, 'utf8')).toBe(key);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('returns the same key on later calls', () => {
    const first = loadOrCreateDoclingApiKey(venvPath);
    expect(loadOrCreateDoclingApiKey(venvPath)).toBe(first);
  });

  test('uses an existing key file', () => {
    writeFileSync(join(venvPath, DOCLING_API_KEY_FILE), 'existing-key\n');
    expect(loadOrCreateDoclingApiKey(venvPath)).toBe('existing-key');
  });

  test('restricts an existing key file to the owner', () => {
    const path = join(venvPath, DOCLING_API_KEY_FILE);
    writeFileSync(path, 'existing-key', { mode: 0o644 });

    expect(loadOrCreateDoclingApiKey(venvPath)).toBe('existing-key');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('replaces an empty key file', () => {
    writeFileSync(join(venvPath, DOCLING_API_KEY_FILE), '');
    const key = loadOrCreateDoclingApiKey(venvPath);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(loadOrCreateDoclingApiKey(venvPath)).toBe(key);
  });

  test('throws when the venv directory does not exist', () => {
    expect(() => loadOrCreateDoclingApiKey(join(venvPath, 'missing'))).toThrow(
      /ENOENT/,
    );
  });
});
