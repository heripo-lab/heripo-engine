import { execSync } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Check that a command-line tool is installed (via `which`).
 * @throws Error with the provided error message if not found
 */
export function checkCommandExists(
  command: string,
  errorMessage: string,
): void {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
  } catch {
    throw new Error(errorMessage);
  }
}

/**
 * Check that the operating system is macOS.
 */
export function checkOperatingSystem(): void {
  if (platform() !== 'darwin') {
    throw new Error(
      'PDFParser is only supported on macOS. Current platform: ' + platform(),
    );
  }
}

/**
 * Check that macOS version is 10.15 (Catalina) or later.
 */
export function checkMacOSVersion(): void {
  try {
    const versionOutput = execSync('sw_vers -productVersion', {
      encoding: 'utf-8',
    }).trim();
    const versionMatch = versionOutput.match(/^(\d+)\.(\d+)/);
    if (versionMatch) {
      const major = parseInt(versionMatch[1]);
      const minor = parseInt(versionMatch[2]);
      if (major < 10 || (major === 10 && minor < 15)) {
        throw new Error(
          `macOS 10.15 or later is required. Current version: ${versionOutput}`,
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('macOS 10.15')) {
      throw error;
    }
    throw new Error('Failed to check macOS version');
  }
}
