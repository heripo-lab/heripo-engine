/**
 * Python version information
 */
export interface PythonVersionInfo {
  major: number;
  minor: number;
  versionString: string;
}

/**
 * Regex pattern to extract Python version from command output
 */
export const PYTHON_VERSION_REGEX = /Python (\d+)\.(\d+)/;

/**
 * Minimum supported Python version
 */
export const MIN_PYTHON_VERSION = { major: 3, minor: 9 };

/**
 * Maximum supported Python version (exclusive upper bound)
 * Python 3.13+ is NOT compatible with docling-serve
 */
export const MAX_PYTHON_MINOR = 12;

/**
 * Error thrown when Python version is invalid
 */
export class PythonVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonVersionError';
  }
}

/**
 * Parse Python version from command output
 *
 * @param output - Output from `python3 --version` command
 * @returns Parsed version info or null if parsing fails
 *
 * @example
 * ```typescript
 * const version = parsePythonVersion('Python 3.12.0');
 * // { major: 3, minor: 12, versionString: '3.12' }
 * ```
 */
export function parsePythonVersion(output: string): PythonVersionInfo | null {
  const match = output.match(PYTHON_VERSION_REGEX);
  if (!match) return null;

  const major = parseInt(match[1]);
  const minor = parseInt(match[2]);

  return {
    major,
    minor,
    versionString: `${major}.${minor}`,
  };
}

/**
 * Validate that Python version is within supported range
 *
 * @param version - Parsed Python version info
 * @param context - Context for error messages ('system' or 'venv')
 * @throws PythonVersionError if version is outside supported range
 *
 * @example
 * ```typescript
 * const version = parsePythonVersion('Python 3.12.0');
 * validatePythonVersion(version, 'system'); // OK
 *
 * const tooNew = parsePythonVersion('Python 3.13.0');
 * validatePythonVersion(tooNew, 'venv'); // throws PythonVersionError
 * ```
 */
export function validatePythonVersion(
  version: PythonVersionInfo,
  context: 'system' | 'venv' = 'system',
): void {
  const { major, minor } = version;
  const prefix = context === 'venv' ? 'Venv Python' : 'Python';

  // Check if too new (3.13+)
  if (major === 3 && minor >= 13) {
    throw new PythonVersionError(
      `${prefix} ${major}.${minor} is too new. docling-serve requires Python 3.11 or 3.12.`,
    );
  }

  // Check if too old (< 3.9)
  if (major !== 3 || minor < MIN_PYTHON_VERSION.minor) {
    throw new PythonVersionError('Python 3.9 or higher is required');
  }
}
