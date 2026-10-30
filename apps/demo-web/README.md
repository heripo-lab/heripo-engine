# Demo Web - heripo engine Web Demo

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

> Next.js web application for visualizing heripo engine's PDF processing capabilities

**English** | [한국어](./README.ko.md)

> **Note**: Please check the [root README](../../README.md) first for project overview, installation instructions, and roadmap.

## Overview

Demo Web is a full-stack Next.js application that allows you to monitor and visualize heripo engine's PDF parsing and document processing capabilities in real-time.

The home page also introduces [heripo basecamp](https://heripo.app), a separate research service that uses heripo engine to build its own report dataset and is currently in a private alpha. The showcase supports Korean and English based on browser language and notes that basecamp is in private alpha. It also introduces basecamp’s direction: starting with reports from Korea and expanding across national borders. Reports uploaded to the demo and their processing results are not added to basecamp.

### Key Features

- PDF upload and processing option configuration
- Real-time processing status monitoring (SSE)
- Processing result visualization (TOC, images, tables, merged cells, source pages)
- Downloadable result ZIP with processed JSON, raw Docling JSON, source handoff manifest, images, and rendered pages
- Archaeology ledger from a `processed-document.json` upload or straight from a preprocessing result, with a chosen model per step (default Claude Haiku 5.5 for every step)
- Job queue management

### Technology Stack

- **Framework**: Next.js 16 (App Router)
- **State Management**: React Query (TanStack Query)
- **Form Management**: TanStack React Form
- **UI**: shadcn/ui + Tailwind CSS
- **Real-time Communication**: Server-Sent Events (SSE)
- **LLM Integration**: Vercel AI SDK

## Online Demo

Try it without local installation:

**🔗 https://engine-demo.heripo.org**

### Online Demo Limitations

Public-mode limits depend on deployment configuration. Repository behavior is:

| Item                  | Behavior                                                             |
| --------------------- | -------------------------------------------------------------------- |
| Daily processing      | `DAILY_LIMIT`; `.env.example` sets 3, unset fallback is 1 (UTC date) |
| Concurrent task limit | `CONCURRENT_TASK_LIMIT`; unset fallback is 1                         |
| Successful session    | Seven-day lock for that browser session after success                |
| Options and models    | Fixed defaults, except authenticated TOTP bypass                     |
| Upload                | Turnstile validation and large-upload session authentication         |

### Full Feature Usage

To use all features freely, run locally:

- Unlimited PDF processing
- All processing options customizable
- Various LLM model selection
- Language detection model and thread settings

### Demo Correction Defaults

The library enables structural review and table correction by default, while the demo form starts with `reviewAssistanceEnabled: false` and `tableCorrectionEnabled: false`. Initial text/table-cell OCR correction still runs. When structural review is enabled, the worker passes `forceAutoApply: true`, applying valid commands automatically. There is no manual approval queue.

The result viewer distinguishes physical PDF pages (starting at 1) from logical pages relative to body page 1. Negative logical pages and zero are displayed and resolve to their corresponding PDF pages.

## Prerequisites

### PDF Parser Requirements

This application depends on `@heripo/pdf-parser`, which has specific system requirements.

**Please refer to the [@heripo/pdf-parser documentation](../../packages/pdf-parser/README.md#prerequisites) to verify:**

- macOS system requirements (Apple Silicon or Intel)
- Python version requirements (3.9-3.12)
- Required system dependencies (poppler, jq, lsof)
- Page rendering and image-PDF dependencies (ImageMagick, Ghostscript)
- First-run setup instructions

### Node.js and Package Manager

- **Node.js** >= 24.0.0
- **pnpm** 12

### LLM Providers and Models

Supports OpenAI, Anthropic, Google, Together AI, and local Ollama/LM Studio. Model IDs use `provider/model-name`. Configure credentials for every cloud provider selected for a stage or fallback. Stages using only a local server do not require cloud keys.

The current [form defaults](./src/features/upload/types/form-values.ts) combine LM Studio, OpenAI and a Google fallback. Adding a single API key does not configure this entire setup. Load the selected local models or change language detection, document validation, correction, processor and fallback models in the UI to models available in your environment. Models reading pages need image input; structure extraction requires structured output.

OpenAI GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol and GPT-6 Luna are available in the model selector. Stages previously defaulting to GPT-5.6 Luna now use GPT-6 Luna. The displayed cost estimate uses [Standard short-context input and output rates](https://developers.openai.com/api/docs/pricing?latest-pricing=standard); it does not account for cached input or long-context pricing.

## Installation and Running

Run the following commands from the repository root.

### 1. Environment Variable Setup

```bash
# Copy .env.example to .env
cp apps/demo-web/.env.example apps/demo-web/.env

# Edit .env file to enter API keys
```

`.env` file example:

```bash
# Configure credentials for every selected cloud provider
OLLAMA_BASE_URL=http://127.0.0.1:11434
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_API_KEY=
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
TOGETHER_AI_API_KEY=...

# Optional
PDF_PARSER_PORT=5001
PDF_PARSER_TIMEOUT=10000000
NEXT_PUBLIC_PUBLIC_MODE=false
UPLOAD_SESSION_SECRET=...
```

See [`.env.example`](./.env.example) for the complete set of public mode,
webhook, cleanup, Turnstile, and upload-session variables.

#### Webhook Setup (Optional)

To receive event notifications in public mode, you can configure webhooks:

```bash
# Webhook settings (only works in public mode)
WEBHOOK_URL=https://your-endpoint.com/webhook
WEBHOOK_SECRET=your-hmac-secret-key
```

**Supported Events:**

| Event                        | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `task.started`               | Processing started                           |
| `task.completed`             | Processing completed                         |
| `task.failed`                | Processing failed                            |
| `task.cancelled`             | Processing cancelled                         |
| `otp.failed`                 | OTP authentication failed                    |
| `otp.locked`                 | Locked after 3 OTP failures                  |
| `rate_limit.exceeded`        | Daily limit reached                          |
| `session.weekly_locked`      | Weekly session lock reached                  |
| `document.validation_failed` | Uploaded PDF failed document type validation |
| `cleanup.completed`          | Scheduled cleanup completed                  |
| `cleanup.failed`             | Scheduled cleanup failed                     |

Task and user-triggered webhooks include `event`, `timestamp`, `ip`, `userAgent`, and usually `filename` fields. Cleanup webhooks are system events with cleanup-specific counts and errors. Payloads are signed with HMAC-SHA256 using `WEBHOOK_SECRET`, included in the `X-Webhook-Signature` header.

### 2. Install Dependencies

From the root directory:

```bash
pnpm install
pnpm build:packages
```

### 3. Run Development Server

```bash
# From root
pnpm --filter @heripo/demo-web dev

# Or from demo-web directory
cd apps/demo-web
pnpm dev
```

Access http://localhost:3000 in your browser

## Usage Guide

### 1. PDF Upload

1. Click "Select PDF File" button on the home page
2. Select PDF file to process
3. Select LLM provider and model
4. Click "Start Processing" button

### 2. Real-time Monitoring

- Automatically navigates to processing page
- View real-time logs
- Step-by-step processing status display

### 3. View Results

After processing completes:

- TOC structure visualization
- View extracted images
- Check table data with merged cell spans
- Open rendered PDF pages and source images
- Download result artifacts as a ZIP (`result-processed.json`, `result.json`, `source-handoff-manifest.json`, `images/`, `pages/`)
- Export the processed result JSON

### 4. Job Management

- View all jobs on "Job List" page
- Delete jobs
- Re-check previous job results

### 5. Ledger Extraction

The `Ledger Extraction` stage builds the archaeology ledger from a preprocessed document with `@heripo/ledger-extractor`, skipping PDF parsing and document preprocessing. It can be started in two ways: Ledger extraction was developed and measured on three reports only: 『태안 마도 해역 수중발굴조사』 (Taean Mado underwater excavation), 『부여 화지산 백제과원 및 둘레길 조성사업부지내 유적』 (Buyeo Hwajisan) and 『거제 사등성 하수관로 매설구간 내 유적 발굴조사』 (Geoje Sadeungseong), so expect gaps on other report types and layouts; they will be improved step by step as more reports accumulate.

- **On its own:** select **Ledger Extraction** in the pipeline stepper, attach a single `processed-document.json` (max 100MB; ZIP archives are not accepted), choose the model of each step — report profile, candidate discovery, duplicate review and content attachment (default Claude Haiku 5.5 for all four) — and click "Start Ledger Extraction". The file is validated (extension/MIME → size → JSON parse → `ProcessedDocument` runtime validation) before the task is queued.
- **After preprocessing:** a completed Raw Data Extraction result page offers "이 결과로 원장 만들기" with the same per-step model choice. The ledger task takes that result's processed document as is and belongs to the same browser session; the card then links to that ledger instead of making a second one (a failed or cancelled run can be made again).

The task first writes the document preview, then runs every ledger step with its chosen model and no person in between: report profile (one router call; a proposed scope is completed with the investigation chapters the code finds by title, and the ledger header shows which chapters were added), candidate discovery with duplicate review, the content attachment plan, thin attachment of every unit, a place alias proposal when no person's table is saved (two runs with the attachment model; rules both give alike and code accepts are saved as the task's table, marked as an automatic proposal on the ledger page, and the calls are kept in `place-alias-proposal.json`), a three-run judgment of the parent questions code leaves open, and the ledger build with full validation. Discovery proposals that failed their checks do not stop the run: they are already left out of the candidates, the log names them and the ledger lists them as `DROPPED_CANDIDATE_PROPOSAL` warnings. A demo run has no call or token cap. The process page shows each step and its log. Saved judgments and place alias tables are applied when present.

The automatic run sends candidate discovery, the duplicate review and thin attachment as Anthropic Message Batches (half price, answered within 24 hours) whenever that step's model is an Anthropic model; a task created with `batch: false` (JSON body) or `batch=false` (form field) sends direct calls. Units whose two thin runs disagree get a tie-breaking third run, and its majority decisions are attached as `model_majority`. Thin attachment calls, direct or batched, use Anthropic reasoning effort `low` (`CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS`). Batch calls use the official `@anthropic-ai/sdk`, with request bodies captured from the AI SDK so they match a direct call except for the output limit.

#### Batch runs from the command line

`pnpm --filter @heripo/demo-web ledger:batch -- --name <batch> --max-calls <n> --max-tokens <n> <file or directory>...` runs the same automatic ledger run over many processed-document JSON files, one report at a time, without the web server. Every report gets a per-report budget (default 600 calls and 13,000,000 tokens, `LEDGER_BATCH_REPORT_BUDGET`, or `--report-calls` and `--report-tokens`), and a report starts only when what is left of the batch budget covers that whole per-report budget, so `--max-calls` and `--max-tokens` are hard caps for the batch. A completed report is charged what it used; a failed or interrupted report is charged its whole per-report budget, the most the run lets it spend, and is not retried. `--model` sets one model for every step (default Claude Haiku 5.5) and `--no-batch` sends direct calls.

The manifest `data/ledger-batches/<batch>/manifest.json` records each report's task, status, usage and ledger counts (records, review items, layer mentions, same-page image candidates, validation) and is rewritten after every change, so starting the same `--name` again continues with the next pending report; a report left running by a stopped process is marked interrupted. The tasks are written under `data/tasks` and `output` but are not added to the demo database, so the server never resumes or rewrites them. Run one batch process at a time (a lock file refuses a second) and do not open its tasks from another process while they run. The runner refuses to start when a workspace package's source is newer than its build (`pnpm build:packages`). `--dry-run` makes no model call: it checks every input, the builds and how many reports the budget left can start. On the saved runs a report's output takes about 13–55MB, so plan disk space for large batches.

A finished ledger task opens the archaeology ledger (`/ledger/validation/[taskId]`) from the Tasks page, where it is marked as a ledger; `/result/[taskId]` of a ledger task redirects there. The page is written for researchers: a list of records by kind (site, survey area, trench, layer, feature, artifact) with search and a needs-review filter, and for the chosen record its parent and children, attributes, relations (including possible layer relations), drawings and photos, and what to review. Source text opens in popups: every excerpt of a record, and the sentence behind each attribute, relation and review item. A review question about a few records flags them; one over a collective or many records is listed once with the report. **Download ledger JSON** saves the full ledger with every source, review item and check. The page also takes a place abbreviation table (JSON) a person decided. The ledger screens follow the browser language (Korean or English).

Notes:

- The JSON must conform to the `ProcessedDocument` type in `@heripo/model` (`packages/model/src/types/processed-document.ts`).
- `ProcessedImage.path` values must be full public CDN URLs (as generated by the `heripo-web` export script). They are consumed as-is and never fetched or re-signed by the demo.
- Test JSON files are produced by the `heripo-web` export script, or by exporting the processed result JSON from a completed Raw Data Extraction task.

## Uploads and Stored Artifacts

The maximum PDF size is 2 GiB. Files at least 5 MiB use signed upload sessions and 10 MiB chunks, requiring `UPLOAD_SESSION_SECRET`. The browser uploads up to three chunks concurrently and retries failures. Upload cancellation and cancellation of running tasks are supported.

Paths are relative to the server's working directory, normally `apps/demo-web` when launched with `pnpm --filter @heripo/demo-web ...`.

- `data/heripo.json`: JSON storage for tasks, logs, upload sessions and locks. The runtime does not use SQLite despite the presence of `schema.sql`.
- `data/tasks/<taskId>/input.pdf`: Uploaded input.
- `output/<taskId>/`: Parser artifacts and processed output, accessed through the task's stored `artifact_dir`.
- `result.json`: Corrected Docling document; `result_ocr_origin.json` is the initial OCR snapshot.
- `result-processed.json`, `source-handoff-manifest.json`: Final document and source/hash metadata saved by the worker.
- `images/`, `pages/`: Extracted images and rendered pages. Structural review additionally produces reports, checkpoints and snapshots when enabled.

Official demo mode (`NEXT_PUBLIC_HERIPO_OFFICIAL_DEMO=true`) cleans expired task data daily at 16:00 UTC. `NEXT_PUBLIC_DATA_RETENTION_DAYS` defaults to 7. Rebuild after changing `NEXT_PUBLIC_*` values, which are incorporated at build time.

## API Routes

Task APIs scope access by browser session. Deletion cancels queued/running tasks before removing their records and files.

| Method          | Route                                   | Purpose                                             |
| --------------- | --------------------------------------- | --------------------------------------------------- |
| `GET`, `POST`   | `/api/tasks`                            | List tasks / direct upload and creation below 5 MiB |
| `GET`, `DELETE` | `/api/tasks/[taskId]`                   | Task details / cancellation and deletion            |
| `GET`           | `/api/tasks/[taskId]/stream`            | SSE status, logs and usage                          |
| `GET`           | `/api/tasks/[taskId]/result`            | Processed document                                  |
| `GET`           | `/api/tasks/[taskId]/download`          | Result ZIP                                          |
| `GET`           | `/api/tasks/[taskId]/images/[imageId]`  | Image                                               |
| `GET`           | `/api/tasks/[taskId]/pages/[pageIndex]` | Rendered page                                       |
| `POST`          | `/api/upload/session`                   | Create chunked-upload session                       |
| `POST`          | `/api/upload/chunks`                    | Upload chunk                                        |
| `POST`          | `/api/upload/complete`                  | Merge upload and create task                        |
| `DELETE`        | `/api/upload/session/[uploadSessionId]` | Cancel upload                                       |
| `GET`           | `/api/rate-limit/check`                 | Public-mode limits                                  |
| `GET`           | `/api/system/status`                    | System status                                       |

The current ZIP includes only processed JSON, corrected Docling JSON, the handoff manifest, `images/` and `pages/`. OCR snapshots, review reports and checkpoints remain separately in the server artifact directory.

## Architecture

### Folder Structure

```
src/
├── app/                      # Next.js App Router
│   ├── api/                  # API routes
│   │   ├── tasks/            # Task CRUD, SSE stream, result, images/pages, download
│   │   ├── upload/           # Chunked upload session/chunk/complete APIs
│   │   ├── rate-limit/       # Public-mode rate limit check
│   │   └── system/           # System status API
│   ├── legal/                # Terms and privacy pages
│   ├── tasks/                # Task list page
│   ├── process/[taskId]/     # Real-time processing page
│   └── result/[taskId]/      # Result page
├── components/
│   ├── layout/               # Layout components
│   ├── providers/            # React Query Provider
│   └── ui/                   # shadcn/ui components
├── features/                 # Feature modules
│   ├── upload/               # PDF upload & settings
│   ├── process/              # Real-time processing
│   ├── result/               # Result display
│   └── tasks/                # Task management
└── lib/
    ├── api/                  # API client
    ├── auth/                 # TOTP, Turnstile, upload sessions
    ├── cleanup/              # Scheduled task/upload cleanup
    ├── config/               # Public mode, webhook, cleanup config
    ├── cost/                 # Token pricing and cost calculation
    ├── db/                   # JSON file DB
    ├── processing/           # LLM model factory
    ├── queue/                # Job queue
    ├── session/              # Browser session management
    ├── validations/          # Zod validation schemas
    ├── webhook/              # Webhook client and payloads
    └── query-client.ts       # React Query config
```

### React Query Usage

**Important**: This app uses React Query for all API calls. Do not use `fetch()` directly in components.

```typescript
// ✅ Correct: Use React Query hooks
import { useTasks } from '~/features/tasks';

const { data, isLoading } = useTasks();

// ❌ Wrong: Direct fetch call
const response = await fetch('/api/tasks');
```

**Available Hooks:**

- `useTaskResult(taskId)` - Get task result
- `useTasks()` - Get task list
- `useDeleteTask()` - Delete task (mutation)
- `useCreateTask()` - Create task (mutation)
- `useTaskStream(taskId)` - SSE real-time stream
- `useDownloadAll({ taskId, filename })` - Download result artifacts as ZIP
- `useExportJson({ data, filename })` - Export processed result JSON

## About Testing

> **Note**: demo-web is a **demo web application** for visualizing and experiencing heripo engine's features, not a core logic or product. Therefore, we do not write separate test code.

Core business logic and tests are concentrated in the following packages:

- `@heripo/pdf-parser`: PDF parsing core logic
- `@heripo/document-processor`: Document processing pipeline
- `@heripo/ledger-extractor`: Ledger extraction preview
- `@heripo/shared`: Shared utilities

## Development Guide

### Generate OTP Secret

Generate TOTP secret for bypassing public mode:

```bash
pnpm --filter @heripo/demo-web generate:otp-secret
```

Set the output value in `TOTP_SECRET` in your `.env` file.

### Generate Upload Session Secret

Generate JWT signing secret for large file uploads (5 MiB+):

```bash
# Generate random secret with Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Or use openssl
openssl rand -base64 32
```

Set the output value in `UPLOAD_SESSION_SECRET` in your `.env` file.

### Type Check

```bash
pnpm typecheck
```

### Lint

```bash
pnpm lint
pnpm lint:fix
```

### Build

```bash
pnpm build
```

### Production Run

```bash
pnpm build
pnpm demo-web:start
```

## Deployment Notes

### Single Process Only (By Design)

> **Important**: This application works correctly only in a **single process environment**. Multi-process environments like pm2 cluster mode are **not supported, and there are no plans to support them**.

**Why don't we support multi-process?**

Demo Web is a **demo application** for demonstrating heripo engine's features. It is not a high-availability system for production environments.

Multi-process support would require complex infrastructure like Redis, PostgreSQL, message queues, etc. This would be over-engineering for a demo app's purpose, and the code complexity would increase dramatically, actually hindering understanding and utilization of the core libraries (`@heripo/pdf-parser`, `@heripo/document-processor`).

Therefore, we **intentionally maintain a simple architecture**, and multi-process support is not on the roadmap.

**Current Architecture Constraints:**

| Component        | Problem in Multi-Process                           |
| ---------------- | -------------------------------------------------- |
| JSON file DB     | Data loss on concurrent writes                     |
| TaskQueueManager | Separate queues per process → duplicate processing |
| SSE EventEmitter | Process-local → real-time updates missed           |
| PDFParserManager | Port conflicts                                     |

**Correct pm2 Execution:**

```bash
# ✅ Correct: fork mode (single process)
pm2 start ecosystem.config.cjs --only demo-web

# ❌ Forbidden: cluster mode (multi-process)
pm2 start pnpm --name "demo-web" -i max -- start
```

The ecosystem configuration runs the Next.js CLI directly with Node. This keeps
application restarts independent of pnpm's package manager version switching.

## Troubleshooting

### API Key Error

**Symptom**: "API key not configured"

**Solution**:

- Check if `.env` file exists
- Verify correct API keys are configured
- Restart development server

### PDF Processing Failure

**Symptom**: "Failed to parse PDF"

**Solution**:

- Refer to the troubleshooting section in [@heripo/pdf-parser documentation](../../packages/pdf-parser/README.md#troubleshooting)
- Check Python version (3.9-3.12)
- Verify jq is installed

### Port Conflict

**Symptom**: "Port 3000 already in use"

**Solution**:

```bash
# Use different port
PORT=3001 pnpm dev
```

## License

This project is distributed under the [Apache License 2.0](../../LICENSE).

## Project-Wide Information

For project-wide information not covered in this package, see the [root README](../../README.md):

- **Citation and Attribution**: Academic citation (BibTeX) and attribution methods
- **Contributing Guidelines**: Development guidelines, commit rules, PR procedures
- **Community**: Issue tracker, discussions, security policy
- **Roadmap**: Project development plans

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)

After discovery completes, the local runner performs one whole-pool LLM duplicate review. The proposed-group panel shows original/combined counts, merged groups, every member's unchanged evidence and uncertain identity pairs. Raw discovery candidates remain available separately. The runner checkpoints `deduplication-request.json` before execution and `deduplication-audit.json` before validating the partition; the audit download includes both discovery and duplicate-review responses. Invalid partitions fail the run while retaining all discovery results and audits.

Use “이 추출본으로 중복만 다시 검토” to rerun duplicate review without calling discovery again. A new run copies the original discovery audit files byte-for-byte, replays and verifies the snapshot, records `discoverySourceRunId`, and saves a new duplicate-review audit. Prior runs remain unchanged.

Use “문제 난 묶음만 다시 추출 후 통합” to retry only discovery units with validation issues. The runner creates a new run, records `reusedFromRunId` and `rerunUnitIds`, copies retained audit files byte-for-byte, and performs whole-pool duplicate review after the selected calls finish. The local API accepts `retryFailedUnits: true` separately from `deduplicationOnly`. Original runs and rejected responses remain intact.

Selective retry additionally accepts `retryUnitIds` for units explicitly reviewed for semantic omissions or exclusions. Only selected units receive the freshly prepared input (merged table headers and sibling chapter continuations); retained units keep their original input bindings and byte-identical audit files. Send it with `retryFailedUnits: true`. The complete pool is reviewed for duplicates afterward.

### First content-attachment unit

The local ledger page has a separate content-attachment panel. Prepare a fixed candidate registry and all-page sweep plan, inspect the first request, then explicitly run only `plan.units[0]`. An empty physical page stays in the plan without a call; a title-only first unit is processed without automatically advancing to archaeological descriptions. The panel shows exact selectable sources, the complete request, the raw model response and the assembled partial result. Existing candidate identity uncertainties remain in the snapshot.

Session-scoped `GET/POST /api/tasks/[taskId]/content-attachment` accepts only `{ action: 'prepare', maxUnitChars }` and `{ action: 'run-first' }`; execution is unavailable in public mode. There is no full-sweep or next-unit action. `GET ?audit=true` includes the plan, candidate snapshot and saved first-unit audit. Each new run uses its own `output/<taskId>/content-attachment/<runId>/` directory, retaining the original discovery files. Input/plan hashes and the candidate snapshot are checked before execution; a completed run cannot overwrite its first response. The partial result distinguishes automatic validation from human review and preserves literal excerpts and all source locations.

The content-attachment panel now sends compact v2 judgment input and shows actual input/output/cache token counts. Each prepared run saves `first-unit-code-map.json` separately from the transmitted `first-unit-request.json`; the execution guard and audit download include the map. Original IDs and locations stay in saved code-side artifacts. New runs preserve all historical requests/responses and execute only the same first unit.

New content-attachment calls use prompt v3 for sentence-level excerpts and explicit shared findspot/context assignments. Compact user input and source mapping are unchanged; historical v1/v2 audits still replay without modifying their raw responses.

New content-attachment calls use prompt v4 to distinguish source-block provenance from sentence-level excerpts at page boundaries. Compact input, selectors and response assembly stay unchanged; previous v1/v2/v3 audits remain replayable.

New content-attachment calls use prompt v5 to preserve supported numbered object headings separately from body sentences and ignore generic category headings. Compact input, source maps and response assembly are unchanged; historical v1–v4 audits remain replayable.

Content-attachment execution also checkpoints each provider invocation as `first-unit-api-attempt-<sequence>.json` before structured parsing can trigger another attempt. These files survive final failure; a successful `first-unit-audit.json` includes the same records in `callAttempts`. Records preserve complete SDK response bodies and provider termination metadata without changing the selected text or retry policy.

The audit download also includes the checkpointed `callAttempts` when the final structured audit is absent after failure.

### Grouped identity uncertainty display

The duplicate-review panel counts uncertain identity by unordered candidate-group pairs and also shows the original supporting candidate-pair count. Expand an uncertainty to inspect every original candidate pair, reason, exact quotes and source locations. The library derives this view directly from the retained result, so older saved runs use the same display without a new model call, attachment run or file migration. Raw model candidate pairs and group memberships remain unchanged.
