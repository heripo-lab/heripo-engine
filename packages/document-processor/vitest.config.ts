import { defineConfig as defineBaseConfig } from '@heripo/vitest-config';
import { defineConfig } from 'vitest/config';

const baseConfig = defineBaseConfig() as any;

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    coverage: {
      ...baseConfig.test?.coverage,
      exclude: [
        ...(baseConfig.test?.coverage?.exclude || []),
        'src/types.ts', // Type definitions only
        'src/index.ts', // Re-exports only
      ],
    },
  },
});
