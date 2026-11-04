import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { maskFilePaths } from './mask-file-paths';

describe('maskFilePaths', () => {
  test('keeps only the file name of a deployed app path', () => {
    assert.equal(
      maskFilePaths(
        'Saving ZIP file to: /opt/heripo/engine-demo/app/apps/demo-web/output/task_1/_chunks/_chunk_1/result.zip',
      ),
      'Saving ZIP file to: result.zip',
    );
  });

  test('masks quoted paths in error messages', () => {
    assert.equal(
      maskFilePaths(
        "ENOENT: no such file or directory, open '/private/var/folders/x/T/heripo-docling-abc/result.zip'",
      ),
      "ENOENT: no such file or directory, open 'result.zip'",
    );
  });

  test('keeps every field of a JSON log with several paths', () => {
    const input = JSON.stringify({
      source: '/opt/app/a.json',
      result: '/opt/app/b.json',
      pages: [1, 2],
    });
    assert.deepEqual(JSON.parse(maskFilePaths(input)), {
      source: 'a.json',
      result: 'b.json',
      pages: [1, 2],
    });
  });

  test('masks directory paths that end with a slash', () => {
    assert.equal(maskFilePaths('dir /opt/app/ ready'), 'dir app ready');
    assert.equal(maskFilePaths('url file:///opt/app/'), 'url app');
    assert.equal(maskFilePaths('tmp /private/var/app/'), 'tmp app');
  });

  test('masks file URLs', () => {
    assert.equal(
      maskFilePaths('Started local file server: file:///Users/x/input.pdf'),
      'Started local file server: input.pdf',
    );
  });

  test('leaves URLs, API routes and other words alone', () => {
    const input =
      'server http://127.0.0.1:5501/health ready, ocr_options kept, /api/tasks ok, /optimize';
    assert.equal(maskFilePaths(input), input);
  });
});
