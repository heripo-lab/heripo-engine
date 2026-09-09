# @heripo/shared

**English** | [한국어](./README.ko.md)

Internal ESM utilities used by the PDF parser and document processor. This package is private and is not published to npm; both public packages bundle it at build time. Workspace consumers reference it with `workspace:*`.

## Exports

| API                       | Purpose                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `BatchProcessor`          | Split/process arrays with `createBatches`, `processBatch`, `processBatchSync`                             |
| `ConcurrentPool`          | `run(items, concurrency, processFn, onItemComplete?)` bounds workers and preserves input order in results |
| `LLMCaller`               | `call` and `callVision` perform model calls with schema validation, retries and fallback                  |
| `LLMTokenUsageAggregator` | `track`, `getReport`, `getTotalUsage`, `getByComponent`, `logSummary`, `reset` aggregate usage            |
| `detectProvider`          | Detect a provider from the model's `provider` value, returning `unknown` when unrecognized                |
| `spawnAsync`              | Run a child process and return `{ stdout, stderr, code }`                                                 |

The [export list](./src/index.ts) also includes call configuration/results, token usage and process option types.

## Array Processing

Use positive integers for batch size and concurrency. `processBatch` starts all batches with `Promise.all`, so it does not bound concurrency. Use `ConcurrentPool` to limit active workers.

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

## LLM Calls and Usage

Recognizes OpenAI, Google, Anthropic, Together AI, Ollama and LM Studio. Together AI/Ollama use tool calls; the other providers use structured output. Zod validates the response schema. Configuration requires a model, schema, prompts (or vision messages), `maxRetries`, `component` and `phase`; `fallbackModel`, `abortSignal`, `temperature` and `metadata` are optional.

Calls return `{ output, usage, usedFallback }`. Pass `usage` to the aggregator's `track()`. `getReport()` includes component/phase/model totals and metadata. Multiple models in one phase produce model-separated phase rows, so phase names need not be unique. Usage covers tracked calls and is not guaranteed to match provider billing.

`spawnAsync` captures stdout/stderr by default, with options to disable capture. Check returned nonzero exit codes; process startup failures reject the promise.

## Development

Run from the repository root with Node.js 24+ and pnpm 11.25.0.

```bash
pnpm install
pnpm build:packages
pnpm --filter @heripo/shared typecheck
pnpm --filter @heripo/shared lint
pnpm --filter @heripo/shared test:coverage
```

[Project README](../../README.md) · [License](../../LICENSE)
