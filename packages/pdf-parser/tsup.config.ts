import { defineConfig } from '@heripo/tsup-config';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'vlm-models': 'src/config/vlm-models.ts',
  },
  noExternal: ['@heripo/logger', '@heripo/shared'],
});
