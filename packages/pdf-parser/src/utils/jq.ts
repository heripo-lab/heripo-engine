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

    const state = { stdout: '', stderr: '' };

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    child.stdout.on('data', (chunk: string) => {
      state.stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      state.stderr += chunk;
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(
          `jq exited with code ${code}. ${state.stderr ? 'Stderr: ' + state.stderr : ''}`,
        );
        return reject(error);
      }
      try {
        // jq may output trailing newlines; trim is safe for JSON
        const text = state.stdout.trim();
        const parsed = JSON.parse(text) as T;
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(
            `Failed to parse jq output as JSON. Output length=${state.stdout.length}. Error: ${(e as Error).message}`,
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

    const state = {
      stderr: '',
      exitCode: null as number | null,
      pipelineDone: false,
      settled: false,
    };

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      state.stderr += chunk;
    });

    const ws = createWriteStream(outputPath);

    function trySettle() {
      if (state.settled) return;
      if (!state.pipelineDone || state.exitCode === null) return;
      state.settled = true;
      if (state.exitCode !== 0) {
        reject(
          new Error(
            `jq exited with code ${state.exitCode}. ${state.stderr ? 'Stderr: ' + state.stderr : ''}`,
          ),
        );
      } else {
        resolve();
      }
    }

    child.on('error', (err) => {
      if (state.settled) return;
      state.settled = true;
      ws.destroy();
      reject(err);
    });

    pipeline(child.stdout, ws)
      .then(() => {
        state.pipelineDone = true;
        trySettle();
      })
      .catch((err) => {
        if (state.settled) return;
        state.settled = true;
        reject(err);
      });

    child.on('close', (code) => {
      state.exitCode = code ?? 1;
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

    const state = { stderr: '', buffer: '', callbackError: false };

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    function safeOnLine(line: string): void {
      if (state.callbackError) return;
      try {
        onLine(line);
      } catch (err) {
        state.callbackError = true;
        child.kill();
        reject(err);
      }
    }

    function processBuffer(): void {
      let newlineIdx: number;
      while ((newlineIdx = state.buffer.indexOf('\n')) !== -1) {
        const line = state.buffer.slice(0, newlineIdx);
        state.buffer = state.buffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          safeOnLine(line);
        }
      }
    }

    child.stdout.on('data', (chunk: string) => {
      state.buffer += chunk;
      processBuffer();
    });

    child.stderr.on('data', (chunk: string) => {
      state.stderr += chunk;
    });

    child.on('error', (err) => {
      if (!state.callbackError) reject(err);
    });

    child.on('close', (code) => {
      if (state.callbackError) return;
      // Process any remaining data in buffer
      if (state.buffer.length > 0) {
        safeOnLine(state.buffer);
      }
      if (state.callbackError) return;

      if (code !== 0) {
        reject(
          new Error(
            `jq exited with code ${code}. ${state.stderr ? 'Stderr: ' + state.stderr : ''}`,
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
  const counter = { value: 0 };
  await runJqFileLines(
    '.. | select(type == "string" and startswith("data:image/png;base64"))',
    filePath,
    (line) => {
      onImage(line, counter.value);
      counter.value++;
    },
  );
  return counter.value;
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
