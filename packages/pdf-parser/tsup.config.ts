import { defineConfig } from '@heripo/tsup-config';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  noExternal: ['@heripo/logger', '@heripo/shared'],
});
