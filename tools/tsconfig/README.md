# @heripo/tsconfig

**English** | [한국어](./README.ko.md)

Shared TypeScript JSON configuration. This private workspace package has no build or test scripts.

| File           | Configuration                                                               |
| -------------- | --------------------------------------------------------------------------- |
| `base.json`    | ES2022, bundler module resolution, strict checks, unused checks, Node types |
| `library.json` | Extends base, declaration/declarationMap, `src` → `dist`, excludes tests    |
| `app.json`     | Extends base, `src` → `dist`, `noEmit: false`                               |

Consumers should override paths and `include`/`exclude` for their own directory. See the demo's [actual tsconfig](../../apps/demo-web/tsconfig.json) for Next.js settings.

```json
{
  "extends": "@heripo/tsconfig/library.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

## Development

Run `pnpm install` from the repository root, then `pnpm typecheck` and `pnpm lint` to check consumers together.

[heripo engine](../../README.md) · [License](../../LICENSE)
