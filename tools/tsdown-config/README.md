# @heripo/tsdown-config

**English** | [한국어](./README.ko.md)

Private workspace package for library builds with [tsdown](https://tsdown.dev). `defineConfig(options)` shallowly overrides defaults with caller options.

Defaults enable CJS/ESM output, declarations, cleaning and sourcemaps. They also keep `.js`/`.cjs` and `.d.ts`/`.d.cts` file names (`fixedExtension: false`) to match the packages' `exports` maps, and disable declaration maps because `src/` is not published. Consumers must provide `entry`.

`model` and `logger` use both formats. `shared`, `pdf-parser`, `document-processor` and `ledger-extractor` override to ESM. The last three also set `deps.alwaysBundle: ['@heripo/shared']`, which inlines the private shared package into both the JavaScript bundle and the declaration file.

```typescript
import { defineConfig } from '@heripo/tsdown-config';

export default defineConfig({ entry: ['src/index.ts'] });
```

## Development

Run `pnpm install` from the repository root, then `pnpm typecheck` and `pnpm lint` to check consumers together.

```bash
pnpm --filter @heripo/tsdown-config typecheck
pnpm --filter @heripo/tsdown-config lint
```

[heripo engine](../../README.md) · [License](../../LICENSE)
