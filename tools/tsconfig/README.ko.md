# @heripo/tsconfig

[English](./README.md) | **한국어**

공유 TypeScript JSON 설정입니다. 비공개 workspace 패키지이며 빌드나 테스트 스크립트가 없습니다.

| 파일           | 설정                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| `base.json`    | ES2022, bundler module resolution, strict 검사, 미사용 변수 검사, Node 타입 |
| `library.json` | base 확장, declaration/declarationMap, `src` → `dist`, 테스트 파일 제외     |
| `app.json`     | base 확장, `src` → `dist`, `noEmit: false`                                  |

소비 패키지는 경로와 `include`/`exclude`를 자기 디렉터리에 맞게 재정의해야 합니다. 데모의 Next.js 설정은 [실제 tsconfig](../../apps/demo-web/tsconfig.json)를 참고하세요.

```json
{
  "extends": "@heripo/tsconfig/library.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

## 개발

저장소 루트에서 `pnpm install` 후 `pnpm typecheck`와 `pnpm lint`로 소비 패키지를 함께 검사합니다.

[heripo engine](../../README.ko.md) · [License](../../LICENSE)
