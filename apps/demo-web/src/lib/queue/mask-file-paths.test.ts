import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createPathMasker } from './mask-file-paths';

// Known prefixes with a space and an apostrophe, like a deployed app directory
// on a volume named by a person.
const APP = "/Volumes/O'Brien Drive/heripo/app/apps/demo-web";
const HOME = '/Users/heripo-demo';
const TMP = '/private/var/folders/x/T';

const mask = createPathMasker([
  { path: APP, replacement: '.' },
  { path: HOME, replacement: '~' },
  { path: TMP, replacement: '<tmp>' },
]);
const fallbackOnly = createPathMasker([]);

describe('createPathMasker: known prefixes', () => {
  test('replaces the app directory and keeps the relative path', () => {
    assert.equal(
      mask(
        `Saving ZIP file to: ${APP}/output/task_1/_chunks/_chunk_1/result.zip`,
      ),
      'Saving ZIP file to: ./output/task_1/_chunks/_chunk_1/result.zip',
    );
  });

  test('keeps the sentence around paths inside a quoted JSON value', () => {
    const input = JSON.stringify({
      message: `${APP}/input.pdf was missing; retried ${APP}/archive.pdf`,
      code: 'ENOENT',
    });
    const output = mask(input);
    assert.deepEqual(JSON.parse(output), {
      message: './input.pdf was missing; retried ./archive.pdf',
      code: 'ENOENT',
    });
    assert.ok(!output.includes('Brien'));
  });

  test('masks a quoted path with spaces and an apostrophe completely', () => {
    const output = mask(`Cannot open "${APP}/reports/My File.pdf"`);
    assert.equal(output, 'Cannot open "./reports/My File.pdf"');
    assert.ok(!output.includes('Volumes'));
  });

  test('masks home, temp and file URLs', () => {
    assert.equal(
      mask(`Using venv ${HOME}/.heripo/pdf-parser-venv`),
      'Using venv ~/.heripo/pdf-parser-venv',
    );
    assert.equal(
      mask(`ENOENT: open '${TMP}/heripo-docling-abc/result.zip'`),
      "ENOENT: open '<tmp>/heripo-docling-abc/result.zip'",
    );
    assert.equal(
      mask(`Started local file server: file://${APP}/input/a.pdf`),
      'Started local file server: ./input/a.pdf',
    );
  });

  test('only matches a prefix at a path boundary', () => {
    assert.equal(mask(`${HOME}2/a.json`), 'a.json');
    assert.equal(mask(`${HOME}`), '~');
  });
});

describe('createPathMasker: fallback for other paths', () => {
  test('keeps only the file name of an unknown absolute path', () => {
    assert.equal(
      fallbackOnly('Saving ZIP file to: /opt/other/output/result.zip'),
      'Saving ZIP file to: result.zip',
    );
    assert.equal(
      fallbackOnly("ENOENT: open '/private/var/tmp/x/result.zip'"),
      "ENOENT: open 'result.zip'",
    );
  });

  test('keeps every field of a JSON log with several paths', () => {
    const input = JSON.stringify({
      source: '/opt/app/a.json',
      result: '/opt/app/b.json',
      pages: [1, 2],
    });
    assert.deepEqual(JSON.parse(fallbackOnly(input)), {
      source: 'a.json',
      result: 'b.json',
      pages: [1, 2],
    });
  });

  test('masks directory paths that end with a slash', () => {
    assert.equal(fallbackOnly('dir /opt/app/ ready'), 'dir app ready');
    assert.equal(fallbackOnly('url file:///opt/app/'), 'url app');
  });

  test('keeps the text after a path inside a quoted value', () => {
    assert.equal(
      fallbackOnly('"/opt/app/input.pdf was missing; retried /opt/app/b.pdf"'),
      '"input.pdf was missing; retried b.pdf"',
    );
  });

  test('leaves URLs, API routes and other words alone', () => {
    for (const input of [
      'server http://127.0.0.1:5501/health ready, ocr_options kept, /api/tasks ok, /optimize',
      'see https://example.com/opt/docs/setup',
      'see http://example.com/home/user/guide.html',
      "fetch 'https://example.com/Users/list'",
      'host example.com/opt/docs',
    ]) {
      assert.equal(fallbackOnly(input), input);
    }
  });

  test('does not treat an apostrophe in text as a quote', () => {
    assert.equal(
      fallbackOnly("can't read /opt/app/a.json"),
      "can't read a.json",
    );
  });
});
