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
        'src/types/**', // Pure type definitions only
      ],
    },
  },
});
