# @heripo/shared

[English](./README.md) | **한국어**

PDF 파서와 문서 프로세서가 사용하는 내부 ESM 유틸리티 패키지입니다. `private: true`이므로 npm에 배포하지 않으며 두 공개 패키지를 빌드할 때 번들에 포함합니다. 저장소에서는 `workspace:*`로 참조합니다.

## 내보내는 API

| API                       | 역할                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `BatchProcessor`          | `createBatches`, `processBatch`, `processBatchSync`로 배열 분할·처리                                 |
| `ConcurrentPool`          | `run(items, concurrency, processFn, onItemComplete?)`로 worker 수를 제한하고 입력 순서대로 결과 반환 |
| `LLMCaller`               | `call`과 `callVision`으로 스키마 검증, 재시도, fallback을 포함한 모델 호출                           |
| `LLMTokenUsageAggregator` | `track`, `getReport`, `getTotalUsage`, `getByComponent`, `logSummary`, `reset`으로 사용량 집계       |
| `detectProvider`          | 모델의 `provider` 값으로 provider 구분; 미인식 값은 `unknown`                                        |
| `spawnAsync`              | 자식 프로세스를 실행하고 `{ stdout, stderr, code }` 반환                                             |

[전체 export](./src/index.ts)에는 호출 설정·결과·토큰 사용량·프로세스 실행 옵션 타입도 포함됩니다.

## 배열 처리

양의 정수로 배치 크기와 동시성을 지정하세요. `processBatch`는 모든 배치를 `Promise.all`로 실행하므로 동시성 제한 기능이 아닙니다. 실제 실행 개수를 제한하려면 `ConcurrentPool`을 사용하세요.

```typescript
import { BatchProcessor, ConcurrentPool } from '@heripo/shared';

const batches = BatchProcessor.createBatches([1, 2, 3], 2);
const results = await ConcurrentPool.run(
  [1, 2, 3],
  2,
  async (value) => value * 2,
);
console.log(batches, results);
```

## LLM 호출과 사용량

OpenAI, Google, Anthropic, Together AI, Ollama, LM Studio를 구분합니다. Together AI/Ollama는 tool-call 방식, 나머지는 구조화된 출력 경로를 사용합니다. 응답 스키마는 Zod로 검증합니다. 설정에는 모델, 스키마, 프롬프트(또는 vision 메시지), `maxRetries`, `component`, `phase`가 필요하며 `fallbackModel`, `abortSignal`, `temperature`, `metadata`는 선택 사항입니다. `cacheSystemPrompt: true`는 시스템 프롬프트를 Anthropic 프롬프트 캐시 지점으로 표시해, 같은 시스템 프롬프트를 쓰는 호출이 캐시에서 읽게 합니다. 다른 제공자는 이 표시를 무시합니다. `providerOptions`는 `{ anthropic: { effort: 'low' } }`처럼 AI SDK에 그대로 넘깁니다.

반환값은 `{ output, usage, usedFallback }`이며, 알 수 있으면 `finishReason`과 `structuredAttempts`도 포함합니다. 구조화 출력은 `maxRetries`와 별개로 스키마 불일치 시 최대 10회 더 시도합니다. `structuredAttempts`는 그 시도 수를 세며, `usage`에는 출력을 만든 마지막 시도만 들어갑니다. provider가 사고 토큰을 보고하면 `usage.reasoningTokens`가 채워집니다. `usage`를 aggregator의 `track()`에 전달하세요. `getReport()`는 컴포넌트·단계·모델별 사용량과 메타데이터를 반환합니다. 동일 단계에 여러 모델이 있으면 모델별로 구분된 phase 행을 만들므로 phase 이름의 유일성을 가정하지 마세요. 사용량은 추적된 호출 기준이며 provider 청구서와 같다는 보장은 없습니다.

`spawnAsync`의 stdout/stderr 수집은 기본 활성화되며 옵션으로 끌 수 있습니다. 비정상 종료 코드는 반환값에서 확인하고, 프로세스 시작 오류는 예외로 처리하세요.

## 개발

저장소 루트에서 실행합니다. Node.js 24 이상, pnpm 12를 사용합니다.

```bash
pnpm install
pnpm build:packages
pnpm --filter @heripo/shared typecheck
pnpm --filter @heripo/shared lint
pnpm --filter @heripo/shared test:coverage
```

[프로젝트 README](../../README.ko.md) · [라이선스](../../LICENSE)

## 공급자 호출 시도 감사

`createAuditedModel(model, onAttempt?)`는 `{ model, attempts }`를 반환한다. 이 모델을 `LLMCaller`에 넘기면 구조화 파싱 이전의 비스트리밍 공급자 `doGenerate` 호출마다 기록한다. 스키마 재시도와 SDK 전송 재시도도 각각 별도 시도로 남는다. SDK가 반환한 원래 요청 본문·공급자 응답 전체·콘텐츠·사용량, 통합/원래 종료 사유·API 상태·미완료 상세·응답 ID를 가능한 범위에서 보존한다. 공급자 오류는 원래 응답 본문·오류 정보를 기록한 후 같은 오류를 다시 던진다. 프롬프트·출력·상한·온도·재시도 정책은 변경하지 않는다.

본문은 공급자 SDK가 반환한 형태 그대로 보존하며 HTTP 바이트를 재구성하지 않는다. 없는 메타데이터는 null이다. 인증·응답 헤더는 복사하지 않는다. `onAttempt`로 즉시 저장하면 구조화 시도가 최종 실패해도 기록이 남는다. 저장 콜백 오류는 전파된다. 명시적 모델 인스턴스가 필요한 선택적 도구이며 스트리밍은 관측하지 않는다. 기존 `LLMCaller` 반환값과 최종 시도 사용량 계약은 유지하고, 시도별 사용량은 별도 감사·집계 자료로 제공한다.
