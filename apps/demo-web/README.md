# Demo Web - heripo engine Web Demo

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

> Next.js web application for visualizing heripo engine's PDF processing capabilities

**English** | [한국어](./README.ko.md)

> **Note**: Please check the [root README](../../README.md) first for project overview, installation instructions, and roadmap.

## Overview

Demo Web is a full-stack Next.js application that allows you to monitor and visualize heripo engine's PDF parsing and document processing capabilities in real-time.

### Key Features

- PDF upload and processing option configuration
- Real-time processing status monitoring (SSE)
- Processing result visualization (TOC, images, tables)
- Job queue management

### Technology Stack

- **Framework**: Next.js 15 (App Router)
- **State Management**: React Query (TanStack Query)
- **Form Management**: TanStack React Form
- **UI**: shadcn/ui + Tailwind CSS
- **Real-time Communication**: Server-Sent Events (SSE)
- **LLM Integration**: Vercel AI SDK

## Online Demo

Try it without local installation:

**🔗 https://engine-demo.heripo.com**

### Online Demo Limitations

The online demo has the following limitations to protect server resources:

| Item                   | Limit         |
| ---------------------- | ------------- |
| Daily processing limit | 3 times       |
| Concurrent processing  | 1             |
| Processing options     | Default fixed |
| LLM model selection    | Default fixed |

### Full Feature Usage

To use all features freely, run locally:

- Unlimited PDF processing
- All processing options customizable
- Various LLM model selection
- OCR language and thread settings

## Prerequisites

### PDF Parser Requirements

This application depends on `@heripo/pdf-parser`, which has specific system requirements.

**Please refer to the [@heripo/pdf-parser documentation](../../packages/pdf-parser/README.md#prerequisites) to verify:**

- macOS system requirements (Apple Silicon or Intel)
- Python version requirements (3.9-3.12)
- Required system dependencies (jq, lsof)
- First-run setup instructions

### Node.js and Package Manager

- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0

### LLM API Keys

An API key from one or more of the following LLM providers is required:

- OpenAI (recommended)
- Anthropic
- Google Generative AI
- Together AI

## Installation and Running

### 1. Environment Variable Setup

```bash
# Copy .env.example to .env
cp .env.example .env

# Edit .env file to enter API keys
```

`.env` file example:

```bash
# At least one API key is required
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional
PDF_PARSER_PORT=5001
PDF_PARSER_TIMEOUT=10000000
```

#### Webhook Setup (Optional)

To receive event notifications in public mode, you can configure webhooks:

```bash
# Webhook settings (only works in public mode)
WEBHOOK_URL=https://your-endpoint.com/webhook
WEBHOOK_SECRET=your-hmac-secret-key
```

**Supported Events:**

| Event                 | Description                 |
| --------------------- | --------------------------- |
| `task.started`        | Processing started          |
| `task.completed`      | Processing completed        |
| `task.failed`         | Processing failed           |
| `task.cancelled`      | Processing cancelled        |
| `otp.failed`          | OTP authentication failed   |
| `otp.locked`          | Locked after 3 OTP failures |
| `rate_limit.exceeded` | Daily limit reached         |

All webhooks include `event`, `timestamp`, `ip`, `userAgent`, and `filename` fields. Payloads are signed with HMAC-SHA256 using `WEBHOOK_SECRET`, included in the `X-Webhook-Signature` header.

### 2. Install Dependencies

From the root directory:

```bash
pnpm install
```

### 3. Run Development Server

```bash
# From root
pnpm --filter demo-web dev

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
- Check table data

### 4. Job Management

- View all jobs on "Job List" page
- Delete jobs
- Re-check previous job results

## Architecture

### Folder Structure

```
src/
├── app/                      # Next.js App Router
│   ├── api/                  # API routes
│   │   └── tasks/            # Task management API
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
    ├── db/                   # JSON file DB
    ├── queue/                # Job queue
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

## About Testing

> **Note**: demo-web is a **demo web application** for visualizing and experiencing heripo engine's features, not a core logic or product. Therefore, we do not write separate test code.

Core business logic and tests are concentrated in the following packages:

- `@heripo/pdf-parser`: PDF parsing core logic
- `@heripo/document-processor`: Document processing pipeline
- `@heripo/shared`: Shared utilities

## Development Guide

### Generate OTP Secret

Generate TOTP secret for bypassing public mode:

```bash
pnpm --filter demo-web generate:otp-secret
```

Set the output value in `OTP_SECRET` in your `.env` file.

### Generate Upload Session Secret

Generate JWT signing secret for large file uploads (50MB+):

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
pnpm start
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
pm2 start pnpm --name "demo-web" -- start

# ❌ Forbidden: cluster mode (multi-process)
pm2 start pnpm --name "demo-web" -i max -- start
```

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
