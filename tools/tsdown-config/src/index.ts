import type { UserConfig } from 'tsdown';

/**
 * Shared tsdown defaults for workspace libraries.
 *
 * Caller options shallowly override these defaults.
 * - All libraries ship ESM only.
 * - `fixedExtension: false` keeps `.js` and `.d.ts` names, matching the
 *   `exports` maps of the published packages.
 * - Declaration maps are disabled because `src/` is not published.
 */
export const defineConfig = (options: UserConfig = {}): UserConfig => {
  return {
    format: ['esm'],
    dts: { sourcemap: false },
    clean: true,
    sourcemap: true,
    fixedExtension: false,
    ...options,
  };
};
