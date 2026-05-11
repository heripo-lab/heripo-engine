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
- [OCR Strategy System](#ocr-strategy-system)
- [Document Type Validation](#document-type-validation)
- [Large PDF Chunked Conversion](#large-pdf-chunked-conversion)
- [Image PDF Fallback](#image-pdf-fallback)
- [AbortSignal Support](#abortsignal-support)
- [Server Crash Recovery](#server-crash-recovery)
- [Why macOS Only?](#why-macos-only)
- [System Dependencies Details](#system-dependencies-details)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Key Features

- **High-Quality OCR**: Document recognition using Docling SDK (ocrmac / Apple Vision Framework)
- **Korean Report VLM Correction**: Automatically detects Korean reports and applies VLM text correction to all pages
- **Apple Silicon Optimized**: GPU acceleration on M1/M2/M3/M4/M5 chips
- **Automatic Environment Setup**: Automatic Python virtual environment and docling-serve installation
- **Image Extraction**: Automatic extraction and saving of images from PDFs
- **Document Type Validation**: Optional LLM-based validation that a PDF is an archaeological report
- **Chunked Conversion**: Split large PDFs into chunks for reliable processing
- **Image PDF Fallback**: Automatic fallback to image-based PDF when conversion fails
- **AbortSignal Support**: Cancel ongoing parsing operations
- **Server Crash Recovery**: Automatic restart of docling-serve on ECONNREFUSED

## Prerequisites

### System Requirements

- **macOS** with Apple Silicon (M1/M2/M3) - Recommended for optimal performance
- **macOS** with Intel - Supported but slower
- **Linux/Windows** - Currently not supported

### Required Dependencies

#### 1. Node.js >= 24.0.0

```bash
brew install node
```

#### 2. pnpm >= 9.0.0

```bash
npm install -g pnpm
```

#### 3. Python 3.9 - 3.12

> **Important**: Python 3.13+ is not supported. Some Docling SDK dependencies are not compatible with Python 3.13.

```bash
# Install Python 3.11 (recommended)
brew install python@3.11

# Verify version
python3.11 --version
```

#### 4. poppler (PDF text extraction)

Required for PDF page counting (`pdfinfo`) and text layer extraction (`pdftotext`), used by the OCR strategy system's text layer pre-check.

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

#### 7. ImageMagick + Ghostscript (optional)

Required only when using the image PDF fallback feature (`enableImagePdfFallback` or `forceImagePdf`).

```bash
brew install imagemagick ghostscript
```

### First Run Setup

When using `@heripo/pdf-parser` for the first time, it automatically:

1. Creates Python virtual environment at `.venv` in the current working directory (configurable via `venvPath`)
2. Installs `docling-serve` and dependencies
3. Starts docling-serve process on local port

This setup runs only once and may take 5-10 minutes depending on internet connection.

## Installation

```bash
# Install with npm
npm install @heripo/pdf-parser

# Install with pnpm
pnpm add @heripo/pdf-parser

# Install with yarn
yarn add @heripo/pdf-parser
```

## Usage

### Basic Usage

```typescript
import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';

const logger = Logger(...);

// Create PDFParser instance (logger is required)
const pdfParser = new PDFParser({
  port: 5001,
  logger,
});

// Initialize (environment setup and start docling-serve)
await pdfParser.init();

// Parse PDF
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/report.pdf', // PDF URL (file:// or http://)
  'report-001',                 // Report ID
  async (outputPath) => {
    // Conversion complete callback
    console.log('PDF conversion complete:', outputPath);
  },
  false,                        // cleanupAfterCallback
  {},                           // PDFConvertOptions
);

// Token usage report (null when no LLM usage)
console.log('Token usage:', tokenUsageReport);
```

### Advanced Options

```typescript
// Option A: Use local server with port
const pdfParser = new PDFParser({
  logger,
  port: 5001,                      // Port to use (default: 5001)
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
    // OCR strategy options
    strategySamplerModel: openai('gpt-5.1'),
    vlmProcessorModel: openai('gpt-5.1'),
    vlmConcurrency: 3,

    // Document validation
    documentValidationModel: openai('gpt-5.1'),

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

### Resource Cleanup

Clean up resources after work is complete:

```typescript
// Terminate docling-serve process and release resources
await pdfParser.dispose();
```

## OCR Strategy System

### Why This Strategy?

**ocrmac (Apple Vision Framework) is an excellent OCR engine** -- it's free, GPU-accelerated, and delivers high-quality results. For processing thousands to millions of archaeological reports, there's no better solution.

**However, Korean archaeological reports often need script-aware correction.** Hanja restoration, CJK mojibake, phonetic substitutions, and institution names can be unreliable with standard OCR alone. Rather than using VLM as the primary OCR engine, the system runs the fast ocrmac pipeline first and then applies VLM text correction to Korean reports.

### Two-Stage Korean Detection (`OcrStrategySampler`)

1. **Text Layer Pre-Check** (zero cost): Extracts the document's text layer using `pdftotext` and checks for Hangul. If Hangul is present, the document is immediately treated as Korean.
2. **VLM Sampling** (only when needed): Samples up to 15 pages (trimming 10% from front/back to skip covers and appendices) and analyzes them with a Vision LLM. Uses early exit when `ko-KR` is detected.

### Full-Document Correction (`VlmTextCorrector`)

When a Korean report is detected, every page is sent to the VLM for correction:

- Extracts OCR text elements and table cells from each page
- Uses `pdftotext` reference text as a quality anchor
- VLM returns substitution-based corrections (find -> replace)
- Failed page corrections are gracefully skipped, preserving original OCR text

### Strategy Options

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    // Enable OCR strategy sampling (provide a Vision LLM model)
    strategySamplerModel: openai('gpt-5.1'),

    // VLM model for text correction (required when Korean reports are detected)
    vlmProcessorModel: openai('gpt-5.1'),

    // Concurrency for VLM page processing (default: 1)
    vlmConcurrency: 3,

    // Skip sampling and force a specific OCR method
    forcedMethod: 'ocrmac', // or 'vlm'
  },
);
```

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
      documentValidationModel: openai('gpt-5.1'),
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
    chunkedConversion: true,
    chunkSize: 50, // Pages per chunk (default: configured in constants)
    chunkMaxRetries: 3, // Max retry attempts per failed chunk (default: configured in constants)
  },
);
```

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
    {},
    controller.signal, // AbortSignal
  );
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Parsing was cancelled');
  }
}
```

## Server Crash Recovery

When using a local docling-serve instance (port mode), the parser automatically detects server crashes (ECONNREFUSED errors) and restarts the server. This happens transparently during `parse()` calls -- the failed operation is retried after the server is restarted.

> **Note**: Server crash recovery is only available in local server mode (using `port` option). When using an external server (`baseUrl` option), recovery is not attempted.

## Why macOS Only?

`@heripo/pdf-parser` **intentionally relies heavily on macOS**. The key reason for this decision is **Docling SDK's local OCR performance**.

### OCR Selection Background

Archaeological excavation report PDFs have the following characteristics:

- Scanned documents spanning hundreds of pages
- Layouts containing complex tables, diagrams, photographs
- Precise text extraction is essential

### OCR Option Comparison

| Method                  | Performance | Cost | Description                                                |
| ----------------------- | ----------- | ---- | ---------------------------------------------------------- |
| **Docling (Local)**     | ★★★★★       | Free | Overwhelming performance on Apple Silicon, GPU utilization |
| Cloud OCR (Google, AWS) | ★★★★        | $$$  | Tens of dollars per hundreds of pages                      |
| Tesseract (Local)       | ★★          | Free | Low Korean recognition rate, lacking layout analysis       |

### Key Advantages

- **Cost**: 100x+ cheaper than cloud OCR (free)
- **Performance**: Fast processing with GPU acceleration on Apple Silicon M1/M2/M3
- **Quality**: Accurate recognition even for complex documents
- **Privacy**: Documents are not sent to external servers

### Trade-off

- Optimal performance only in macOS + Apple Silicon environment
- No current plans for Linux/Windows support (see "Linux Support Status" below)

## System Dependencies Details

`@heripo/pdf-parser` requires the following system-level dependencies:

| Dependency  | Required Version | Installation               | Purpose                                                           |
| ----------- | ---------------- | -------------------------- | ----------------------------------------------------------------- |
| Python      | 3.9 - 3.12       | `brew install python@3.11` | Docling SDK runtime                                               |
| poppler     | Any              | `brew install poppler`     | PDF page counting (pdfinfo) and text layer extraction (pdftotext) |
| jq          | Any              | `brew install jq`          | JSON processing (conversion result parsing)                       |
| lsof        | Any              | Included with macOS        | docling-serve port management                                     |
| ImageMagick | Any (optional)   | `brew install imagemagick` | Image PDF fallback and page rendering                             |
| Ghostscript | Any (optional)   | `brew install ghostscript` | Image PDF fallback (PDF to image conversion)                      |

> **Python 3.13+ is not supported.** Some Docling SDK dependencies are not compatible with Python 3.13.

### Checking Python Version

```bash
# Check installed Python version
python3 --version
python3.11 --version

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
  timeout?: number; // Timeout in milliseconds (default: 10000000)
  venvPath?: string; // Python venv path (default: CWD/.venv)
  killExistingProcess?: boolean; // Kill existing process on port (default: false)
  enableImagePdfFallback?: boolean; // Enable image PDF fallback (default: false, requires ImageMagick + Ghostscript)
} & (
  | { port?: number } // Local server mode (default port: 5001)
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

### PDFConvertOptions

```typescript
type PDFConvertOptions = {
  // OCR strategy options
  strategySamplerModel?: LanguageModel; // Vision LLM for OCR strategy sampling
  vlmProcessorModel?: LanguageModel; // Vision LLM for text correction
  vlmConcurrency?: number; // Parallel page processing (default: 1)
  skipSampling?: boolean; // Skip strategy sampling
  forcedMethod?: 'ocrmac' | 'vlm'; // Force specific OCR method

  // Image PDF options
  forceImagePdf?: boolean; // Force pre-conversion to image-based PDF

  // Token usage tracking
  aggregator?: LLMTokenUsageAggregator; // Token usage aggregator
  onTokenUsage?: (report: TokenUsageReport) => void; // Callback for token usage updates

  // Document processing
  document_timeout?: number; // Document processing timeout in seconds
  documentValidationModel?: LanguageModel; // LLM for document type validation

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

### ConvertWithStrategyResult

```typescript
interface ConvertWithStrategyResult {
  /** The OCR strategy that was determined */
  strategy: OcrStrategy;
  /** Token usage report from sampling and/or VLM processing (null when no LLM usage occurs) */
  tokenUsageReport: TokenUsageReport | null;
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

Currently **macOS only**. Linux support is **not entirely ruled out**, but due to OCR performance and cost efficiency issues, **there are no specific plans at this time**.

| Platform              | Status    | Notes                                           |
| --------------------- | --------- | ----------------------------------------------- |
| macOS + Apple Silicon | Supported | Optimal performance, GPU acceleration           |
| macOS + Intel         | Supported | No GPU acceleration                             |
| Linux                 | TBD       | No current plans due to performance/cost issues |
| Windows               | TBD       | WSL2 Linux approach possible                    |

### Reason for No Linux Support

Docling SDK's local OCR achieves both performance and cost efficiency by utilizing Apple Metal GPU acceleration on macOS. We have not yet found an OCR solution on Linux that provides equivalent performance and cost efficiency.

### Ideas Welcome

If you have ideas for supporting Linux while maintaining both performance and cost efficiency, please suggest them via [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions) or Issues. The following information is particularly helpful:

- Experience with Korean document OCR on Linux
- OCR solutions capable of handling complex layouts (tables, diagrams)
- Cost estimates for processing hundreds of pages

## Related Packages

- [@heripo/document-processor](../document-processor) - Document structure analysis and LLM processing
- [@heripo/model](../model) - Data models and type definitions

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
