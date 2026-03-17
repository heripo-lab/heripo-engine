import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { describe, expect, test, vi } from 'vitest';

import {
  checkCommandExists,
  checkMacOSVersion,
  checkOperatingSystem,
} from './system-checks';

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'darwin'),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => ''),
}));

describe('checkCommandExists', () => {
  test('does not throw when command is found', () => {
    vi.mocked(execSync as any).mockReturnValueOnce('');
    expect(() => checkCommandExists('jq', 'jq is not installed')).not.toThrow();
    expect(execSync).toHaveBeenCalledWith('which jq', { stdio: 'ignore' });
  });

  test('throws with the provided error message when command is not found', () => {
    vi.mocked(execSync as any).mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(() => checkCommandExists('jq', 'jq is not installed')).toThrow(
      'jq is not installed',
    );
  });
});

describe('checkOperatingSystem', () => {
  test('does not throw on macOS', () => {
    vi.mocked(platform).mockReturnValue('darwin');
    expect(() => checkOperatingSystem()).not.toThrow();
  });

  test('throws on non-macOS platforms', () => {
    vi.mocked(platform).mockReturnValue('linux');
    expect(() => checkOperatingSystem()).toThrow(
      'PDFParser is only supported on macOS. Current platform: linux',
    );
  });
});

describe('checkMacOSVersion', () => {
  test('does not throw for macOS 10.15 or later', () => {
    vi.mocked(execSync as any).mockReturnValueOnce('13.5.1');
    expect(() => checkMacOSVersion()).not.toThrow();
  });

  test('does not throw for macOS 10.15 exactly', () => {
    vi.mocked(execSync as any).mockReturnValueOnce('10.15.0');
    expect(() => checkMacOSVersion()).not.toThrow();
  });

  test('throws when macOS version is below 10.15', () => {
    vi.mocked(execSync as any).mockReturnValueOnce('10.14.6');
    expect(() => checkMacOSVersion()).toThrow(
      'macOS 10.15 or later is required. Current version: 10.14.6',
    );
  });

  test('does not throw when version string does not match pattern', () => {
    vi.mocked(execSync as any).mockReturnValueOnce('unknown-version');
    expect(() => checkMacOSVersion()).not.toThrow();
  });

  test('throws when sw_vers command fails', () => {
    vi.mocked(execSync as any).mockImplementationOnce(() => {
      throw new Error('command not found');
    });
    expect(() => checkMacOSVersion()).toThrow('Failed to check macOS version');
  });

  test('re-throws macOS version requirement error from catch block', () => {
    vi.mocked(execSync as any).mockReturnValueOnce('10.14.6');
    expect(() => checkMacOSVersion()).toThrow(
      'macOS 10.15 or later is required',
    );
  });
});
