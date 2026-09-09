# @heripo/tsup-config

[English](./README.md) | **한국어**

라이브러리 빌드에 사용하는 비공개 workspace 패키지입니다. `defineConfig(options)`는 기본값 위에 사용자 옵션을 얕게 덮어씁니다.

기본값은 CJS/ESM, 타입 선언, 출력 정리, sourcemap 활성화입니다. `entry`는 소비 패키지에서 지정해야 합니다. `model`과 `logger`는 두 형식을 사용하고, `pdf-parser`와 `shared`는 ESM으로 재정의합니다. `document-processor`는 자체 tsup 설정으로 ESM과 shared 번들링을 구성합니다.

```typescript
import { defineConfig } from '@heripo/tsup-config';

export default defineConfig({ entry: ['src/index.ts'] });
```

## 개발

저장소 루트에서 `pnpm install` 후 `pnpm typecheck`와 `pnpm lint`로 소비 패키지를 함께 검사합니다.

```bash
pnpm --filter @heripo/tsup-config typecheck
pnpm --filter @heripo/tsup-config lint
```

[heripo engine](../../README.ko.md) · [License](../../LICENSE)
