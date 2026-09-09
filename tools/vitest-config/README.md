# @heripo/vitest-config

**English** | [한국어](./README.ko.md)

Private workspace package exporting common library-test `defineConfig()`.

Defaults use Node, globals, mock reset/clear, the threads pool, `./vitest.setup.ts`, and `src/**/*.{test,spec}.{ts,js,mjs}`. V8 coverage excludes index files and sets 100% thresholds for lines/functions/branches/statements. `TEST_MODE=ci` selects `json-summary`; otherwise the reporter is text.

Options are shallowly applied at the top level. In the current implementation, passing `options.test` replaces the entire default `test` object, so merge required defaults explicitly. The example below uses unmodified defaults and requires a consumer `vitest.setup.ts`.

```typescript
import { defineConfig } from '@heripo/vitest-config';

export default defineConfig();
```

## Development

Run `pnpm install` from the repository root, then `pnpm typecheck` and `pnpm lint` to check consumers together.

```bash
pnpm --filter @heripo/vitest-config typecheck
pnpm --filter @heripo/vitest-config lint
```

[heripo engine](../../README.md) · [License](../../LICENSE)
