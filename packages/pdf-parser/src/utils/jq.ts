import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

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
 * Run a jq program against a JSON file and pipe output directly to a file.
 * Avoids loading jq output into Node.js memory.
 */
export function runJqFileToFile(
  program: string,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const jqPath = getJqPath();
    const args = [program, inputPath];

    const child = spawn(jqPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stderr = '';
    let exitCode: number | null = null;
    let pipelineDone = false;
    let settled = false;

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const ws = createWriteStream(outputPath);

    function trySettle() {
      if (settled) return;
      if (!pipelineDone || exitCode === null) return;
      settled = true;
      if (exitCode !== 0) {
        reject(
          new Error(
            `jq exited with code ${exitCode}. ${stderr ? 'Stderr: ' + stderr : ''}`,
          ),
        );
      } else {
        resolve();
      }
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      ws.destroy();
      reject(err);
    });

    pipeline(child.stdout, ws)
      .then(() => {
        pipelineDone = true;
        trySettle();
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

    child.on('close', (code) => {
      exitCode = code ?? 1;
      trySettle();
    });
  });
}

/**
 * Run a jq program with -r (raw output) and process stdout line by line.
 * Each line is passed to the onLine callback immediately, avoiding memory accumulation.
 */
export function runJqFileLines(
  program: string,
  filePath: string,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const jqPath = getJqPath();
    const args = ['-r', program, filePath];

    const child = spawn(jqPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stderr = '';
    let buffer = '';
    let callbackError = false;

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    function safeOnLine(line: string): void {
      if (callbackError) return;
      try {
        onLine(line);
      } catch (err) {
        callbackError = true;
        child.kill();
        reject(err);
      }
    }

    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          safeOnLine(line);
        }
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      if (!callbackError) reject(err);
    });

    child.on('close', (code) => {
      if (callbackError) return;
      // Process any remaining data in buffer
      if (buffer.length > 0) {
        safeOnLine(buffer);
      }
      if (callbackError) return;

      if (code !== 0) {
        reject(
          new Error(
            `jq exited with code ${code}. ${stderr ? 'Stderr: ' + stderr : ''}`,
          ),
        );
      } else {
        resolve();
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
 * Streaming extraction of base64 PNG data-URI strings from a JSON file.
 * Each image is passed to the onImage callback immediately instead of accumulating all in memory.
 * Returns the total count of images found.
 */
export async function jqExtractBase64PngStringsStreaming(
  filePath: string,
  onImage: (base64Data: string, index: number) => void,
): Promise<number> {
  let index = 0;
  await runJqFileLines(
    '.. | select(type == "string" and startswith("data:image/png;base64"))',
    filePath,
    (line) => {
      onImage(line, index);
      index++;
    },
  );
  return index;
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

/**
 * Replace base64 PNG data-URIs with file paths and pipe result directly to an output file.
 * Avoids loading the entire transformed JSON into Node.js memory.
 * Uses a temporary file and atomic rename to avoid corrupting the output.
 */
export async function jqReplaceBase64WithPathsToFile(
  inputPath: string,
  outputPath: string,
  dirName: string,
  prefix: string,
): Promise<void> {
  const program = `
      reduce paths(type == "string" and startswith("data:image/png;base64")) as $p (
        {data: ., counter: 0};
        .counter as $idx |
        .data |= setpath($p; "${dirName}/${prefix}_\\($idx).png") |
        .counter += 1
      ) | .data
    `;
  const tmpPath = outputPath + '.tmp';
  await runJqFileToFile(program, inputPath, tmpPath);
  await rename(tmpPath, outputPath);
}
