import type { UserConfig } from 'vitest/config';

export const defineConfig = (options: UserConfig = {}): UserConfig => {
  return {
    test: {
      environment: 'node',
      globals: true,
      mockReset: true,
      clearMocks: true,
      setupFiles: ['./vitest.setup.ts'],
      pool: 'threads',
      include: ['src/**/*.{test,spec}.{ts,js,mjs}'],
      coverage: {
        provider: 'v8',
        reporter: process.env.TEST_MODE === 'ci' ? ['json-summary'] : ['text'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,js,mjs}'],
        exclude: ['src/index.ts', '**/index.ts'],
        thresholds: {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
      ...options.test,
    },
    ...options,
  };
};
