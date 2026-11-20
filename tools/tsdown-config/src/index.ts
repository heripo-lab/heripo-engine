import type { UserConfig } from 'tsdown';

/**
 * Shared tsdown defaults for workspace libraries.
 *
 * Caller options shallowly override these defaults.
 * - `fixedExtension: false` keeps `.js`/`.cjs` and `.d.ts`/`.d.cts` names,
 *   matching the `exports` maps of the published packages.
 * - Declaration maps are disabled because `src/` is not published.
 */
export const defineConfig = (options: UserConfig = {}): UserConfig => {
  return {
    format: ['cjs', 'esm'],
    dts: { sourcemap: false },
    clean: true,
    sourcemap: true,
    fixedExtension: false,
    ...options,
  };
};
