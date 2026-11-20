# @heripo/tsdown-config

[English](./README.md) | **한국어**

[tsdown](https://tsdown.dev)으로 라이브러리를 빌드할 때 사용하는 비공개 workspace 패키지입니다. `defineConfig(options)`는 기본값 위에 사용자 옵션을 얕게 덮어씁니다.

기본값은 CJS/ESM, 타입 선언, 출력 정리, sourcemap 활성화입니다. 패키지 `exports`와 맞도록 `.js`/`.cjs`, `.d.ts`/`.d.cts` 파일 이름을 유지하고(`fixedExtension: false`), `src/`를 배포하지 않으므로 선언 sourcemap은 끕니다. `entry`는 소비 패키지에서 지정해야 합니다.

`model`과 `logger`는 두 형식을 사용합니다. `shared`, `pdf-parser`, `document-processor`, `ledger-extractor`는 ESM으로 재정의합니다. 이 중 뒤의 세 패키지는 `deps.alwaysBundle: ['@heripo/shared']`로 비공개 shared 패키지를 JavaScript 번들과 타입 선언 파일 양쪽에 포함합니다.

```typescript
import { defineConfig } from '@heripo/tsdown-config';

export default defineConfig({ entry: ['src/index.ts'] });
```

## 개발

저장소 루트에서 `pnpm install` 후 `pnpm typecheck`와 `pnpm lint`로 소비 패키지를 함께 검사합니다.

```bash
pnpm --filter @heripo/tsdown-config typecheck
pnpm --filter @heripo/tsdown-config lint
```

[heripo engine](../../README.ko.md) · [License](../../LICENSE)
