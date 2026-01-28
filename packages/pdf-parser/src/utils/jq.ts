import { spawn } from 'node:child_process';

/**
 * Resolve jq executable path from environment or default to 'jq' in PATH.
 */
function getJqPath(): string {
  const p = process.env.JQ_PATH?.trim();
  return p && p.length > 0 ? p : 'jq';
}

/**
 * Run a jq program against a JSON file and parse the JSON result.
 * - program: jq filter/program string
 * - filePath: path to the input JSON file
 * Returns parsed JSON as type T.
 */
export function runJqFileJson<T = unknown>(
  program: string,
  filePath: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const jqPath = getJqPath();
    const args = [
      '-c', // compact output (single line when possible)
      program,
      filePath,
    ];

    const child = spawn(jqPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(
          `jq exited with code ${code}. ${stderr ? 'Stderr: ' + stderr : ''}`,
        );
        return reject(error);
      }
      try {
        // jq may output trailing newlines; trim is safe for JSON
        const text = stdout.trim();
        const parsed = JSON.parse(text) as T;
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(
            `Failed to parse jq output as JSON. Output length=${stdout.length}. Error: ${(e as Error).message}`,
          ),
        );
      }
    });
  });
}

/**
 * Convenience: extract all base64 PNG data-URI strings from a JSON file.
 */
export function jqExtractBase64PngStrings(filePath: string): Promise<string[]> {
  const program = `
      [
        .. |
        select(type == "string" and startswith("data:image/png;base64"))
      ]
    `;
  return runJqFileJson<string[]>(program, filePath);
}

/**
 * Convenience: replace base64 PNG data-URIs with file paths like `${dirName}/${prefix}_<idx>.png`.
 * Returns an object: { data, count }
 */
export function jqReplaceBase64WithPaths(
  filePath: string,
  dirName: string,
  prefix: string,
): Promise<{ data: unknown; count: number }> {
  const program = `
      reduce paths(type == "string" and startswith("data:image/png;base64")) as $p (
        {data: ., counter: 0};
        .counter as $idx |
        .data |= setpath($p; "${dirName}/${prefix}_\\($idx).png") |
        .counter += 1
      ) | {data: .data, count: .counter}
    `;
  return runJqFileJson<{ data: unknown; count: number }>(program, filePath);
}
