# @heripo/tsup-config

**English** | [한국어](./README.ko.md)

Private workspace package for library builds. `defineConfig(options)` shallowly overrides defaults with caller options.

Defaults enable CJS/ESM output, declarations, cleaning and sourcemaps. Consumers must provide `entry`. `model` and `logger` use both formats; `pdf-parser` and `shared` override to ESM. `document-processor` uses its own tsup config for ESM and shared bundling.

```typescript
import { defineConfig } from '@heripo/tsup-config';

export default defineConfig({ entry: ['src/index.ts'] });
```

## Development

Run `pnpm install` from the repository root, then `pnpm typecheck` and `pnpm lint` to check consumers together.

```bash
pnpm --filter @heripo/tsup-config typecheck
pnpm --filter @heripo/tsup-config lint
```

[heripo engine](../../README.md) · [License](../../LICENSE)
