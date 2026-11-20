import { defineConfig } from '@heripo/tsdown-config';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // Inline the private shared package into both JS and declarations.
  deps: { alwaysBundle: ['@heripo/shared'] },
});
