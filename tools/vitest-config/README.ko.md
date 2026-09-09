# @heripo/vitest-config

[English](./README.md) | **한국어**

라이브러리 테스트의 공통 `defineConfig()`를 제공하는 비공개 workspace 패키지입니다.

기본값은 Node 환경, globals, mock reset/clear, threads pool, `./vitest.setup.ts`, `src/**/*.{test,spec}.{ts,js,mjs}`입니다. V8 coverage는 index 파일을 제외하며 lines/functions/branches/statements 모두 100% 임계값을 사용합니다. `TEST_MODE=ci`이면 `json-summary`, 그 외에는 text 리포터를 사용합니다.

옵션은 최상위에서 얕게 덮어씁니다. 특히 현재 구현에서 `options.test`를 주면 기본 `test` 객체 전체가 교체되므로 필요한 값을 명시적으로 병합하세요. 기본 설정을 그대로 쓰는 예제는 아래와 같습니다. 소비 패키지에 `vitest.setup.ts`가 필요합니다.

```typescript
import { defineConfig } from '@heripo/vitest-config';

export default defineConfig();
```

## 개발

저장소 루트에서 `pnpm install` 후 `pnpm typecheck`와 `pnpm lint`로 소비 패키지를 함께 검사합니다.

```bash
pnpm --filter @heripo/vitest-config typecheck
pnpm --filter @heripo/vitest-config lint
```

[heripo engine](../../README.ko.md) · [License](../../LICENSE)
