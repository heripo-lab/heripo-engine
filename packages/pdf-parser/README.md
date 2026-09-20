# @heripo/pdf-parser

> PDF parsing library - OCR support with Docling SDK

[![npm version](https://img.shields.io/npm/v/@heripo/pdf-parser.svg)](https://www.npmjs.com/package/@heripo/pdf-parser)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.9--3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

**English** | [한국어](./README.ko.md)

> **Note**: Please check the [root README](../../README.md) first for project overview, installation instructions, and roadmap.

`@heripo/pdf-parser` is a library for parsing PDF documents and OCR processing based on Docling SDK. It is designed to effectively process documents with complex layouts such as archaeological excavation reports.

## Table of Contents

- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Mandatory Correction Pipeline](#mandatory-correction-pipeline)
- [Review Assistance](#review-assistance)
- [Document Type Validation](#document-type-validation)
- [Large PDF Chunked Conversion](#large-pdf-chunked-conversion)
- [Image PDF Fallback](#image-pdf-fallback)
- [AbortSignal Support](#abortsignal-support)
- [Server Crash Recovery](#server-crash-recovery)
- [Why macOS Only?](#why-macos-only)
- [System Dependencies Details](#system-dependencies-details)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [Sponsor](#sponsor)
- [License](#license)

## Key Features

- **Fixed ocrmac OCR**: Docling conversion always uses ocrmac / Apple Vision Framework
- **Mandatory VLM Correction**: Post-Docling text correction always runs; page gating and structural review can be disabled
- **Apple Silicon Backend**: Docling conversion requests the `mps` accelerator
- **Automatic Environment Setup**: Automatic Python virtual environment and docling-serve installation
- **Image Extraction**: Automatic extraction and saving of images from PDFs
- **Document Type Validation**: Optional LLM-based validation that a PDF is an archaeological report
- **Chunked Conversion**: Split large PDFs into chunks for reliable processing
- **Image PDF Fallback**: Automatic fallback to image-based PDF when conversion fails
- **Review Assistance**: Page-level VLM review writes audit proposals, skips low-value pages with observable reasons, and can auto-apply high-confidence fixes
- **Table Correction**: Table-specific work items validate cells, spans, headers, units, footnotes, and adjacent-page continuations
- **AbortSignal Support**: Cancel ongoing parsing operations
- **Server Crash Recovery**: Automatic restart of docling-serve on ECONNREFUSED

## Prerequisites

### System Requirements

- **macOS** with Apple Silicon (M1/M2/M3/M4/M5) - Recommended for optimal performance
- **macOS** with Intel - Supported but slower
- **Linux/Windows** - Currently not supported

### Required Dependencies

#### 1. Node.js >= 24.0.0

```bash
brew install node
```

#### 2. pnpm >= 12

```bash
npm install -g pnpm@12
```

#### 3. Python 3.9 - 3.12

> **Important**: The current installer accepts Python 3.9–3.12 and rejects 3.13+. This is the repository's version check, not a compatibility statement for every upstream Docling release.

```bash
# Install Python 3.11 (recommended)
brew install python@3.11

# Verify version
export PATH="$(brew --prefix python@3.11)/libexec/bin:$PATH"
python3 --version
```

#### 4. poppler (PDF text extraction)

Required for PDF page counting (`pdfinfo`) and text layer extraction (`pdftotext`), used as a post-Docling correction reference.

```bash
brew install poppler
```

#### 5. jq (JSON processing tool)

```bash
brew install jq
```

#### 6. lsof (port management)

Installed by default on macOS. Verify:

```bash
which lsof
```

#### 7. ImageMagick + Ghostscript

Required for rendering local PDF pages used by mandatory VLM correction, as well as image-PDF fallback. Install these even when `enableImagePdfFallback` and `forceImagePdf` are disabled.

```bash
brew install imagemagick ghostscript
```

### First Run Setup

When using `@heripo/pdf-parser` for the first time, it automatically:

1. Creates Python virtual environment at `.venv` in the current working directory (configurable via `venvPath`)
2. Installs `docling-serve` and dependencies
3. Starts docling-serve process on local port

The virtual environment is reused, but local initialization runs dependency setup again. The installer pins docling-serve 1.16.1 and an explicit Docling runtime set; see [python-environment.ts](./src/environment/python-environment.ts). Ensure the `python3` command on PATH is a supported version, not just a separately installed `python3.11`.

## Installation

```bash
# Install with npm
npm install @heripo/pdf-parser @heripo/logger @ai-sdk/openai

# Install with pnpm
pnpm add @heripo/pdf-parser @heripo/logger @ai-sdk/openai

# Install with yarn
yarn add @heripo/pdf-parser @heripo/logger @ai-sdk/openai
```

## Usage

### Basic Usage

Use an ESM project. `HERIPO_MODEL` is an example-specific environment variable for a model ID supporting image input and structured output; also set `OPENAI_API_KEY`. Other providers can be supplied through their AI SDK adapters.

```typescript
import { openai } from '@ai-sdk/openai';
import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';

const logger = new Logger({
  debug: (...args) => console.debug('[heripo]', ...args),
  info: (...args) => console.info('[heripo]', ...args),
  warn: (...args) => console.warn('[heripo]', ...args),
  error: (...args) => console.error('[heripo]', ...args),
});

// Create PDFParser instance (logger is required)
const pdfParser = new PDFParser({
  port: 5001,
  logger,
});

const correctionModel = openai(process.env.HERIPO_MODEL!);

// Initialize (environment setup and start docling-serve)
try {
  await pdfParser.init();

  // Parse PDF
  const tokenUsageReport = await pdfParser.parse(
    'file:///path/to/report.pdf', // PDF URL (file:// or http://)
    'report-001', // Report ID
    async (outputPath) => {
      // Conversion complete callback
      console.log('PDF conversion complete:', outputPath);
    },
    false, // cleanupAfterCallback
    {
      correction: {
        models: {
          textCorrection: correctionModel,
          pageGate: correctionModel,
          reviewAssistance: correctionModel,
        },
      },
    }, // PDFConvertOptions
  );

  // Token usage report (null when no LLM usage)
  console.log('Token usage:', tokenUsageReport);
} finally {
  await pdfParser.dispose();
}
```

### Advanced Options

```typescript
// Option A: Use local server with port
const pdfParser = new PDFParser({
  logger,
  port: 5001,                      // Set the local port explicitly
  timeout: 10000000,                // Timeout (milliseconds)
  venvPath: '/custom/path/.venv',   // Custom venv path (default: CWD/.venv)
  killExistingProcess: true,        // Kill existing process on port (default: false)
  enableImagePdfFallback: true,     // Enable image PDF fallback (default: false)
});

// Option B: Use external docling-serve
const pdfParser = new PDFParser({
  logger,
  baseUrl: 'http://localhost:5000', // External server URL
});

// Parse with conversion options
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    // Mandatory post-Docling correction
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
        tableCorrection: openai(process.env.HERIPO_MODEL!),
        reviewAssistanceTasks: {
          text_ocr_hanja: openai(process.env.HERIPO_MODEL!),
          tables: openai(process.env.HERIPO_MODEL!),
        },
      },
      concurrency: {
        pages: 1,
        reviewTasks: 4,
        tables: 1,
      },
      modelConcurrency: 1,
      workItemTimeoutMs: 900000,
      maxRetries: {
        textCorrection: 3,
        pageGate: 3,
        reviewAssistance: 3,
        tableCorrection: 3,
      },
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      temperature: 0,
      outputLanguage: 'en-US',
    },
    onReviewAssistanceProgress: (event) => console.log(event),

    // Document validation
    documentValidationModel: openai(process.env.HERIPO_MODEL!),

    // Chunked conversion for large PDFs
    chunkedConversion: true,
    chunkSize: 50,
    chunkMaxRetries: 3,

    // Force image PDF pre-conversion
    forceImagePdf: false,

    // Document processing timeout (seconds)
    document_timeout: 600,

    // Token usage tracking
    onTokenUsage: (report) => console.log('Token usage:', report),
  },
);
```

### Artifacts

The callback receives the absolute `output/<reportId>/` path. `result.json` is the corrected document and `result_ocr_origin.json` is the initial OCR snapshot. `images/` and `pages/` hold extracted and page images. Structural review also produces `result_review_origin.json`, `review_assistance_page_gate.json`, `review_assistance_checkpoint.json` and `review_assistance.json`. Check page status, issues and call traces for failed review work.

With `cleanupAfterCallback: true`, the artifact directory is removed after the callback. Copy required files elsewhere inside it or use `false` to preserve them. The parser does not create `result-processed.json` or a handoff manifest; the demo worker saves those separately.

### Resource Cleanup

Clean up resources after work is complete:

```typescript
// Terminate docling-serve process and release resources
await pdfParser.dispose();
```

## Mandatory Correction Pipeline

### Why ocrmac Is Fixed

ocrmac is the fixed OCR backend, using Apple Vision on macOS.

`@heripo/pdf-parser` no longer samples OCR strategies or switches to a VLM OCR path. Docling conversion always uses ocrmac. VLM correction runs after Docling conversion. Optional language detection and document validation can also call a model before conversion.

### Required Correction Contract

Every `parse()` call must provide `correction.models.textCorrection`, `correction.models.pageGate`, and `correction.models.reviewAssistance`. If any required correction model is missing, parsing fails before conversion callback wrapping.

With the default review controls enabled, the correction stage runs as follows:

1. Save `result_ocr_origin.json` before mutations.
2. Run page-level text and table-cell OCR correction with `textCorrection`.
3. Run the Review Assistance page gate with `pageGate` and write `review_assistance_page_gate.json`.
4. Run structural Review Assistance work items with task-specific models.
5. Run table-specific correction work items for each detected table.
6. Write `review_assistance_checkpoint.json` during execution and `review_assistance.json` at the end.

Text correction applies to every page with text or table content. The page gate only controls structural Review Assistance noise; it does not disable OCR text correction.

### Local Model Execution

The correction pipeline is optimized for local VLMs: small contexts, many calls, deterministic validation, retry loops, bounded concurrency, and resumable checkpoints. For local models, start with `concurrency.pages: 1`, `concurrency.reviewTasks: 1`, `modelConcurrency: 1`, `temperature: 0`, and a generous `workItemTimeoutMs`. Increase concurrency only after the model is stable.

### Validation

Run the defined package check with `pnpm --filter @heripo/pdf-parser test:coverage`. Tests mock external model calls; correction quality on real documents requires separate evaluation.

### Correction Controls and Defaults

All three required models must still be supplied when structural review is disabled. `reviewAssistanceEnabled: false` runs only text/table-cell OCR correction, skipping the page gate and structural review. `tableCorrectionEnabled: false` skips structural table work items, but does not disable initial table-cell OCR correction.

`forceAutoApply` defaults to `false`. When true, validated commands are applied without routing to manual review based on confidence thresholds or structural block reasons. Command validation still runs.

| Option                                               | Default                |
| ---------------------------------------------------- | ---------------------- |
| `concurrency.pages`                                  | `1`                    |
| `concurrency.reviewTasks`                            | `6`                    |
| `modelConcurrency`                                   | `1`                    |
| `maxRetries.*`                                       | `3`                    |
| `workItemTimeoutMs`                                  | `1800000` (30 minutes) |
| `outputLanguage`                                     | `en-US`                |
| `autoApplyThreshold` / `proposalThreshold`           | `0.85` / `0.5`         |
| `reviewAssistanceEnabled` / `tableCorrectionEnabled` | `true` / `true`        |
| `forceAutoApply` / `temperature`                     | `false` / `0`          |

Defaults are also exported as `PDF_CORRECTION_DEFAULTS`. `concurrency.tables` and `pageGate.structuralNoiseThreshold` exist in the type but are not forwarded as runner controls by the current top-level pipeline. Use `reviewTasks` and `modelConcurrency` to bound table work.

### Language Detection

Explicit `ocr_lang` values take precedence. Otherwise local PDF text is inspected, with optional vision-based detection through `languageDetectionModel` and `languageDetectionFallbackModel` when needed. Remote inputs and undetected inputs use `ko-KR`, `en-US` as defaults. This does not select an OCR engine: OCR remains ocrmac.

## Review Assistance

Review Assistance runs after text correction when `correction.reviewAssistanceEnabled` is true (library default), but it does not process every page with the same intensity. The page gate marks covers, chapter covers, barcode/ISBN pages, and decorative pages as low-value for structural review. Skipped pages remain observable in `review_assistance.json` with an info issue and skip reason.

Eligible pages are split into small work items for text OCR/Hanja review, text integrity, text role/footnote review, tables, pictures/captions, layout/bbox/order, and table-specific correction. Each call records timing, model id, attempts, target refs, and deterministic validation status in `review_assistance.json`.

### Table Correction Strategy

Tables are treated as first-class correction targets. The scheduler creates one table-specific work item per table so pages with multiple tables keep independent bbox, crop, context, and validation state. The table validator checks target identity, same-page table mixing, cells, spans, headers, units, footnotes, empty-cell expansion, and adjacent-page continuation refs before any command can become an auto-apply or proposal decision.

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
        tableCorrection: openai(process.env.HERIPO_MODEL!),
      },
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: {
        textCorrection: 3,
        pageGate: 3,
        reviewAssistance: 3,
        tableCorrection: 3,
      },
      temperature: 0,
      outputLanguage: 'en-US',
    },
    onReviewAssistanceProgress: (event) => {
      console.log(event.substage, event.status, event.pageNo);
    },
  },
);
```

Use a local `file://` PDF for the complete pipeline. HTTP inputs are accepted by Docling, but local page rendering, language detection and document validation are skipped. Missing `pages/page_<index>.png` files cause text correction to be skipped; a successful callback does not prove every page was corrected. Failed correction calls retain the original OCR text and emit warnings. It updates `result.json` with auto-applied fixes, keeps snapshots in `result_review_origin.json` and `result_ocr_origin.json`, writes `review_assistance_page_gate.json`, and writes `review_assistance.json` containing per-page decisions, issues, proposals, call traces, validation status, and summary counts.

## Document Type Validation

Optional LLM-based validation that a PDF is an archaeological investigation report. When `documentValidationModel` is provided, the parser extracts text from the PDF and uses the LLM to verify the document type before processing. If validation fails, an `InvalidDocumentTypeError` is thrown.

```typescript
import { InvalidDocumentTypeError } from '@heripo/pdf-parser';

try {
  await pdfParser.parse(
    'file:///path/to/input.pdf',
    'report-001',
    async (outputPath) => console.log(outputPath),
    false,
    {
      correction: {
        models: {
          textCorrection: openai(process.env.HERIPO_MODEL!),
          pageGate: openai(process.env.HERIPO_MODEL!),
          reviewAssistance: openai(process.env.HERIPO_MODEL!),
        },
      },
      documentValidationModel: openai(process.env.HERIPO_MODEL!),
    },
  );
} catch (error) {
  if (error instanceof InvalidDocumentTypeError) {
    console.error('Not an archaeological report:', error.message);
  }
}
```

## Large PDF Chunked Conversion

For large PDFs that may cause timeouts or memory issues, enable chunked conversion to split the PDF into smaller chunks and process them individually. Only works with local files (`file://` URLs).

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/large-report.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
      },
    },
    chunkedConversion: true,
    chunkSize: 50, // Pages per chunk (default: 10)
    chunkMaxRetries: 3, // Retries per failed chunk (default: 2)
  },
);
```

Correction runs after chunk results are merged. The current chunked failure path attempts image-PDF conversion independently of `enableImagePdfFallback`, so ImageMagick/Ghostscript are needed for that recovery path too. For local inputs, the chunked branch takes precedence when `chunkedConversion` and `forceImagePdf` are both set.

## Image PDF Fallback

When conversion fails, the parser can automatically fall back to converting the PDF to an image-based PDF first, then retrying conversion. This is useful for PDFs with complex or corrupt structures. Requires ImageMagick and Ghostscript.

### Automatic Fallback (on failure)

Enable via constructor option. When a conversion fails, the parser automatically retries using an image-based PDF:

```typescript
const pdfParser = new PDFParser({
  logger,
  port: 5001,
  enableImagePdfFallback: true, // Enable automatic fallback
});
```

### Forced Image PDF (always)

Force pre-conversion to image-based PDF via parse option:

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
      },
    },
    forceImagePdf: true, // Always convert to image PDF first
  },
);
```

If both the original and fallback conversions fail, an `ImagePdfFallbackError` is thrown containing both errors.

## AbortSignal Support

Pass an `AbortSignal` to cancel ongoing parsing operations:

```typescript
const controller = new AbortController();

// Cancel after 5 minutes
setTimeout(() => controller.abort(), 5 * 60 * 1000);

try {
  await pdfParser.parse(
    'file:///path/to/input.pdf',
    'report-001',
    async (outputPath) => console.log(outputPath),
    false,
    {
      correction: {
        models: {
          textCorrection: openai(process.env.HERIPO_MODEL!),
          pageGate: openai(process.env.HERIPO_MODEL!),
          reviewAssistance: openai(process.env.HERIPO_MODEL!),
        },
      },
    },
    controller.signal, // AbortSignal
  );
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    console.log('Parsing was cancelled');
  }
}
```

## Server Crash Recovery

When using a local docling-serve instance (port mode), the parser automatically detects server crashes (ECONNREFUSED errors) and restarts the server. This happens transparently during `parse()` calls -- the failed operation is retried after the server is restarted.

> **Note**: Server crash recovery is only available in local server mode (using `port` option). When using an external server (`baseUrl` option), recovery is not attempted.

## Why macOS Only?

The package declares `os: ["darwin"]` and checks macOS and local tools in `init()`. Connecting to an external Docling server through `baseUrl` does not remove this client-side restriction. ocrmac uses Apple Vision on macOS.

Docling OCR can run locally, but VLM correction calls the configured models. Cloud models can receive document text and page images and incur API charges. To keep the full pipeline local, configure local models for language detection, document validation, correction, fallbacks and downstream document processing.

## System Dependencies Details

`@heripo/pdf-parser` requires the following system-level dependencies:

| Dependency  | Required Version | Installation               | Purpose                                                           |
| ----------- | ---------------- | -------------------------- | ----------------------------------------------------------------- |
| Python      | 3.9 - 3.12       | `brew install python@3.11` | Docling SDK runtime                                               |
| poppler     | Any              | `brew install poppler`     | PDF page counting (pdfinfo) and text layer extraction (pdftotext) |
| jq          | Any              | `brew install jq`          | JSON processing (conversion result parsing)                       |
| lsof        | Any              | Included with macOS        | docling-serve port management                                     |
| ImageMagick | Any              | `brew install imagemagick` | Image PDF fallback and page rendering                             |
| Ghostscript | Any              | `brew install ghostscript` | Image PDF fallback (PDF to image conversion)                      |

> **Python 3.13+ is rejected by the current installer.** See the version check in [python-version.ts](./src/utils/python-version.ts).

### Checking Python Version

```bash
# Check installed Python version
python3 --version
export PATH="$(brew --prefix python@3.11)/libexec/bin:$PATH"
python3 --version

# When multiple versions are installed
ls -la /usr/local/bin/python*
```

### Checking jq Installation

```bash
# Check jq version
jq --version

# Check jq path
which jq
```

## API Documentation

### PDFParser Class

#### Constructor Options

```typescript
type Options = {
  logger: LoggerMethods; // Logger instance (REQUIRED)
  timeout?: number; // Timeout in milliseconds (default: 100000)
  venvPath?: string; // Python venv path (default: CWD/.venv)
  killExistingProcess?: boolean; // Kill existing process on port (default: false)
  enableImagePdfFallback?: boolean; // Enable image PDF fallback (default: false, requires ImageMagick + Ghostscript)
} & (
  | { port?: number } // Local mode; explicitly provide port (no runtime default)
  | { baseUrl: string } // External server mode
);
```

#### Methods

##### `init(): Promise<void>`

Sets up Python environment and starts docling-serve.

```typescript
await pdfParser.init();
```

##### `parse(url, reportId, onComplete, cleanupAfterCallback, options, abortSignal?): Promise<TokenUsageReport | null>`

Parses a PDF file.

**Parameters:**

- `url` (string): PDF URL (`file://` for local files or `http://` for remote)
- `reportId` (string): Unique report identifier (used for output directory naming)
- `onComplete` (ConversionCompleteCallback): Callback function called with the output directory path on conversion complete
- `cleanupAfterCallback` (boolean): Whether to delete the output directory after the callback completes
- `options` (PDFConvertOptions): Conversion options
- `abortSignal` (AbortSignal, optional): Signal to cancel the operation

**Returns:**

- `Promise<TokenUsageReport | null>`: Token usage report from LLM operations, or `null` when no LLM usage occurs

##### `dispose(): Promise<void>`

Disposes the parser instance, kills the local docling-serve process (if started), and releases resources.

```typescript
await pdfParser.dispose();
```

##### `isReady(): Promise<boolean>` / `ensureReady(): Promise<void>`

`isReady()` checks health without recovery. `ensureReady()` requires initialization and attempts recovery for a local server. External server failures are propagated. `dispose()` also terminates a process on the configured local port, including a reused server; use `baseUrl` for an externally managed lifecycle.

### PDFConvertOptions

```typescript
type PDFConvertOptions = {
  // Mandatory post-Docling correction
  correction: PDFCorrectionOptions;

  // Image PDF options
  forceImagePdf?: boolean; // Force pre-conversion to image-based PDF

  // Token usage tracking
  aggregator?: LLMTokenUsageAggregator; // Token usage aggregator
  onTokenUsage?: (report: TokenUsageReport) => void; // Callback for token usage updates

  // Document processing
  document_timeout?: number; // Document processing timeout in seconds
  languageDetectionModel?: LanguageModel;
  languageDetectionFallbackModel?: LanguageModel;
  documentValidationModel?: LanguageModel; // LLM for document type validation

  // Correction progress
  onReviewAssistanceProgress?: (event: ReviewAssistanceProgressEvent) => void; // Progress callback

  // Chunked conversion (large PDFs)
  chunkedConversion?: boolean; // Enable chunked conversion
  chunkSize?: number; // Pages per chunk
  chunkMaxRetries?: number; // Max retry attempts per failed chunk

  // Docling conversion options (inherited)
  num_threads?: number; // Number of processing threads
  ocr_lang?: string[]; // OCR languages
  // ... other Docling ConversionOptions fields
};
```

### PDFCorrectionOptions

```typescript
interface PDFCorrectionOptions {
  models: {
    textCorrection: LanguageModel; // Required: page text and table-cell OCR correction
    textCorrectionFallback?: LanguageModel; // Optional: fallback for text correction
    pageGate: LanguageModel; // Required: structural Review Assistance page gate
    pageGateFallback?: LanguageModel; // Optional: fallback for page gate
    reviewAssistance: LanguageModel; // Required: default structural review model
    reviewAssistanceFallback?: LanguageModel; // Optional: common fallback for review assistance
    tableCorrection?: LanguageModel; // Optional: table-specific correction override
    tableCorrectionFallback?: LanguageModel; // Optional: fallback for table correction
    reviewAssistanceTasks?: Partial<
      Record<
        | 'text_ocr_hanja'
        | 'text_integrity'
        | 'text_role_footnote'
        | 'tables'
        | 'pictures_captions'
        | 'layout_bbox_order',
        LanguageModel
      >
    >;
    reviewAssistanceTasksFallback?: Partial<
      Record<
        | 'text_ocr_hanja'
        | 'text_integrity'
        | 'text_role_footnote'
        | 'tables'
        | 'pictures_captions'
        | 'layout_bbox_order',
        LanguageModel
      >
    >;
  };
  concurrency?: {
    pages?: number; // Page-level text correction and page gate concurrency
    reviewTasks?: number; // Structural Review Assistance work-item concurrency
    tables?: number; // Accepted but not forwarded by the top-level pipeline
  };
  maxRetries?: {
    textCorrection?: number;
    pageGate?: number;
    reviewAssistance?: number;
    tableCorrection?: number;
  };
  modelConcurrency?: number; // Bounded local model request concurrency
  workItemTimeoutMs?: number; // Per-work-item timeout
  outputLanguage?: string; // Human-readable review reason language (default: en-US)
  pageGate?: {
    structuralNoiseThreshold?: number;
  };
  autoApplyThreshold?: number; // Minimum confidence for direct mutation (default: 0.85)
  proposalThreshold?: number; // Minimum confidence for sidecar proposal (default: 0.5)
  forceAutoApply?: boolean; // When true, review-assistance commands auto-apply regardless of threshold (default: false)
  reviewAssistanceEnabled?: boolean; // When false, review-assistance is skipped completely (default: true)
  tableCorrectionEnabled?: boolean; // When false, table-correction is skipped (default: true)
  temperature?: number; // VLM generation temperature (default: 0)
}
```

### ConversionCompleteCallback

```typescript
type ConversionCompleteCallback = (outputPath: string) => Promise<void> | void;
```

### Error Types

#### `InvalidDocumentTypeError`

Thrown when the PDF fails document type validation (i.e., it is not an archaeological investigation report).

```typescript
import { InvalidDocumentTypeError } from '@heripo/pdf-parser';
```

#### `ImagePdfFallbackError`

Thrown when both the original conversion and the image PDF fallback conversion fail. Contains references to both errors.

```typescript
import { ImagePdfFallbackError } from '@heripo/pdf-parser';
```

## Troubleshooting

### jq Not Found

**Symptom**: `Command not found: jq`

**Solution**:

```bash
brew install jq
```

### poppler Not Found

**Symptom**: `poppler is not installed. Please install poppler using: brew install poppler`

**Solution**:

```bash
brew install poppler
```

### Port Conflict

**Symptom**: `Port 5001 is already in use`

**Solution**:

```typescript
// Use a different port
const pdfParser = new PDFParser({
  port: 5002,  // Specify different port
  logger,
});

// Or kill the existing process
const pdfParser = new PDFParser({
  port: 5001,
  killExistingProcess: true,
  logger,
});
```

### docling-serve Start Failure

**Symptom**: `Failed to start docling-serve`

**Solution**:

```bash
# Recreate virtual environment (default location)
rm -rf .venv
# Run init() again
```

### ImageMagick / Ghostscript Not Found

**Symptom**: `ImageMagick is not installed but enableImagePdfFallback is enabled`

**Solution**:

```bash
brew install imagemagick ghostscript
```

## Linux Support Status

The current `@heripo/pdf-parser` package supports macOS and does not provide a Linux/Windows runtime path. Platform proposals are welcome in [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions).

## Related Packages

- [@heripo/document-processor](../document-processor/README.md) - Document structure analysis and LLM processing
- [@heripo/model](../model/README.md) - Data models and type definitions

## Sponsor

If you'd like to support heripo lab's open-source research, you can sponsor us through:

- [Open Collective](https://opencollective.com/heripo-project) for general project sponsorship.
- [fairy.hada.io/@heripo](https://fairy.hada.io/@heripo) for Korean individual supporters who prefer KRW payments.

## License

This package is distributed under the [Apache License 2.0](../../LICENSE).

## Contributing

Contributions are always welcome! Please see the [Contributing Guide](../../CONTRIBUTING.md).

## Issues and Support

- **Bug Reports**: [GitHub Issues](https://github.com/heripo-lab/heripo-engine/issues)
- **Discussions**: [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)
- **Security Vulnerabilities**: See [Security Policy](../../SECURITY.md)

## Project-Wide Information

For project-wide information not covered in this package, see the [root README](../../README.md):

- **Citation and Attribution**: Academic citation (BibTeX) and attribution methods
- **Contributing Guidelines**: Development guidelines, commit rules, PR procedures
- **Community**: Issue tracker, discussions, security policy
- **Roadmap**: Project development plans

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
