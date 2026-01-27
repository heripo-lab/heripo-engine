import type { SpawnOptions } from 'node:child_process';

import { spawn } from 'node:child_process';

/**
 * Result of a spawn operation
 */
export interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Extended spawn options with output capture control
 */
export interface SpawnAsyncOptions extends SpawnOptions {
  /**
   * Whether to capture stdout (default: true)
   */
  captureStdout?: boolean;

  /**
   * Whether to capture stderr (default: true)
   */
  captureStderr?: boolean;
}

/**
 * Execute a command asynchronously and return the result
 *
 * Eliminates the repetitive Promise wrapper pattern used throughout
 * DoclingEnvironment for spawn operations.
 *
 * @param command - The command to execute
 * @param args - Arguments to pass to the command
 * @param options - Spawn options with optional output capture control
 * @returns Promise resolving to stdout, stderr, and exit code
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = await spawnAsync('python3', ['--version']);
 * console.log(result.stdout); // "Python 3.12.0"
 *
 * // With options
 * const result = await spawnAsync('pip', ['install', 'package'], {
 *   cwd: '/path/to/venv',
 *   captureStderr: true,
 * });
 * ```
 */
export function spawnAsync(
  command: string,
  args: string[],
  options: SpawnAsyncOptions = {},
): Promise<SpawnResult> {
  const {
    captureStdout = true,
    captureStderr = true,
    ...spawnOptions
  } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, spawnOptions);

    let stdout = '';
    let stderr = '';

    if (captureStdout && proc.stdout) {
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (captureStderr && proc.stderr) {
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    proc.on('error', reject);
  });
}
