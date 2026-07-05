import { defineConfig } from '@heripo/tsup-config';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  noExternal: ['@heripo/shared'],
});
