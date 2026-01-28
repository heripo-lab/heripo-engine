import type { Options } from 'tsup';

export const defineConfig = (options: Options = {}): Options => {
  return {
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    ...options,
  };
};
