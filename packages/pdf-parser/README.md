# @heripo/pdf-parser

> PDF parsing library - OCR support with Docling SDK

[![npm version](https://img.shields.io/npm/v/@heripo/pdf-parser.svg)](https://www.npmjs.com/package/@heripo/pdf-parser)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
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
- [Why macOS Only?](#why-macos-only)
- [System Dependencies Details](#system-dependencies-details)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Key Features

- **High-Quality OCR**: Document recognition using Docling SDK (ocrmac / Apple Vision Framework)
- **Mixed Script Auto-Detection & Correction**: Automatically detects Korean-Hanja mixed pages and corrects them via VLM
- **Apple Silicon Optimized**: GPU acceleration on M1/M2/M3/M4/M5 chips
- **Automatic Environment Setup**: Automatic Python virtual environment and docling-serve installation
- **Image Extraction**: Automatic extraction and saving of images from PDFs
- **Flexible Configuration**: OCR, format, threading options, and other detailed settings

## Prerequisites

### System Requirements

- **macOS** with Apple Silicon (M1/M2/M3) - Recommended for optimal performance
- **macOS** with Intel - Supported but slower
- **Linux/Windows** - Currently not supported

### Required Dependencies

#### 1. Node.js >= 22.0.0

```bash
brew install node
```

#### 2. pnpm >= 9.0.0

```bash
npm install -g pnpm
```

#### 3. Python 3.9 - 3.12

⚠️ **Important**: Python 3.13+ is not supported. Some Docling SDK dependencies are not compatible with Python 3.13.

```bash
# Install Python 3.11 (recommended)
brew install python@3.11

# Verify version
python3.11 --version
```

#### 4. poppler (PDF text extraction)

Required for the OCR strategy system's text layer pre-check (`pdftotext`).

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

### First Run Setup

When using `@heripo/pdf-parser` for the first time, it automatically:

1. Creates Python virtual environment at `~/.heripo/pdf-parser/venv`
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

// Create PDFParser instance
const pdfParser = new PDFParser({
  pythonPath: 'python3.11', // Python executable path
  logger,
});

// Initialize (environment setup and start docling-serve)
await pdfParser.init();

// Parse PDF
const outputPath = await pdfParser.parse(
  'path/to/report.pdf', // Input PDF file
  'output-directory', // Output directory
  (resultPath) => {
    // Conversion complete callback
    console.log('PDF conversion complete:', resultPath);
  },
);

// Use results
console.log('Output path:', outputPath);
```

### Advanced Options

```typescript
const pdfParser = new PDFParser({
  pythonPath: 'python3.11',
  logger,

  // docling-serve configuration
  port: 5001, // Port to use (default: 5001)
  timeout: 10000000, // Timeout (milliseconds)

  // Use external docling-serve
  externalDoclingUrl: 'http://localhost:5000', // When using external server
});

// Specify conversion options
await pdfParser.parse('input.pdf', 'output', (result) => console.log(result), {
  // OCR settings
  doOcr: true, // Enable OCR (default: true)

  // Output formats
  formats: ['docling_json', 'md'], // Select output formats

  // Thread count
  pdfBackend: 'dlparse_v2', // PDF backend
});
```

### Image Extraction

Automatically extracts images from PDFs:

```typescript
const outputPath = await pdfParser.parse(
  'report.pdf',
  'output',
  (resultPath) => {
    // Images are saved in output/images/ directory
    console.log('Image extraction complete:', resultPath);
  },
);
```

### Resource Cleanup

Clean up resources after work is complete:

```typescript
// Terminate docling-serve process
await pdfParser.shutdown();
```

## OCR Strategy System

### Why This Strategy?

**ocrmac (Apple Vision Framework) is an excellent OCR engine** — it's free, GPU-accelerated, and delivers high-quality results. For processing thousands to millions of archaeological reports, there's no better solution.

**However, ocrmac cannot handle mixed character systems.** Documents containing Korean-Hanja combinations (and potentially other mixed scripts) produce garbled text for the non-primary script. Rather than switching the entire pipeline to a costly VLM, the system **targets only the affected pages** for VLM correction, minimizing cost and processing time.

### Two-Stage Detection (`OcrStrategySampler`)

1. **Text Layer Pre-Check** (zero cost): Extracts the document's text layer using `pdftotext` and checks for both Hangul and CJK characters. If both are present, the document is immediately flagged as mixed-script.
2. **VLM Sampling** (only when needed): Samples up to 15 pages (trimming 10% from front/back to skip covers and appendices) and analyzes them with a Vision LLM. Uses early exit on first Korean-Hanja mix detection to minimize API costs.

### Per-Page Correction (`VlmTextCorrector`)

When mixed-script pages are detected, only those pages are sent to the VLM for correction:

- Extracts OCR text elements and table cells from each page
- Uses `pdftotext` reference text as a quality anchor
- VLM returns substitution-based corrections (find → replace)
- Failed page corrections are gracefully skipped, preserving original OCR text

### Strategy Options

```typescript
const outputPath = await pdfParser.parse(
  'input.pdf',
  'output',
  (result) => console.log(result),
  {
    // Enable OCR strategy sampling (provide a Vision LLM model)
    strategySamplerModel: openai('gpt-5.1'),

    // VLM model for text correction (required when mixed-script is detected)
    vlmProcessorModel: openai('gpt-5.1'),

    // Concurrency for VLM page processing (default: 1)
    vlmConcurrency: 3,

    // Skip sampling and force a specific OCR method
    forcedMethod: 'ocrmac', // or 'vlm'
  },
);
```

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

| Dependency | Required Version | Installation               | Purpose                                            |
| ---------- | ---------------- | -------------------------- | -------------------------------------------------- |
| Python     | 3.9 - 3.12       | `brew install python@3.11` | Docling SDK runtime                                |
| poppler    | Any              | `brew install poppler`     | Text layer extraction for OCR strategy (pdftotext) |
| jq         | Any              | `brew install jq`          | JSON processing (conversion result parsing)        |
| lsof       | Any              | Included with macOS        | docling-serve port management                      |

> ⚠️ **Python 3.13+ is not supported.** Some Docling SDK dependencies are not compatible with Python 3.13.

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
interface PDFParserOptions {
  pythonPath?: string; // Python executable path (default: 'python3')
  logger?: Logger; // Logger instance
  port?: number; // docling-serve port (default: 5001)
  timeout?: number; // Timeout (milliseconds, default: 10000000)
  externalDoclingUrl?: string; // External docling-serve URL (optional)
}
```

#### Methods

##### `init(): Promise<void>`

Sets up Python environment and starts docling-serve.

```typescript
await pdfParser.init();
```

##### `parse(inputPath, outputDir, callback, options?): Promise<string>`

Parses a PDF file.

**Parameters:**

- `inputPath` (string): Input PDF file path
- `outputDir` (string): Output directory path
- `callback` (function): Callback function called on conversion complete
- `options` (ConversionOptions, optional): Conversion options

**Returns:**

- `Promise<string>`: Output file path

##### `shutdown(): Promise<void>`

Terminates the docling-serve process.

```typescript
await pdfParser.shutdown();
```

### ConversionOptions

```typescript
interface ConversionOptions {
  doOcr?: boolean; // Enable OCR (default: true)
  formats?: string[]; // Output formats (default: ['docling_json'])
  pdfBackend?: string; // PDF backend (default: 'dlparse_v2')
}
```

### PDFConvertOptions (Extended)

```typescript
interface PDFConvertOptions extends ConversionOptions {
  strategySamplerModel?: LanguageModel; // Vision LLM for OCR strategy sampling
  vlmProcessorModel?: LanguageModel; // Vision LLM for text correction
  vlmConcurrency?: number; // Parallel page processing (default: 1)
  skipSampling?: boolean; // Skip strategy sampling
  forcedMethod?: 'ocrmac' | 'vlm'; // Force specific OCR method
}
```

## Troubleshooting

### Python Version Error

**Symptom**: `Python version X.Y is not supported`

**Solution**:

```bash
# Install Python 3.11
brew install python@3.11

# Explicitly specify in PDFParser
const pdfParser = new PDFParser({
  pythonPath: 'python3.11',
  logger,
});
```

### jq Not Found

**Symptom**: `Command not found: jq`

**Solution**:

```bash
brew install jq
```

### Port Conflict

**Symptom**: `Port 5001 is already in use`

**Solution**:

```bash
# Use different port
const pdfParser = new PDFParser({
  pythonPath: 'python3.11',
  port: 5002,  // Specify different port
  logger,
});
```

### docling-serve Start Failure

**Symptom**: `Failed to start docling-serve`

**Solution**:

```bash
# Recreate virtual environment
rm -rf ~/.heripo/pdf-parser/venv
# Run init() again
```

## Linux Support Status

Currently **macOS only**. Linux support is **not entirely ruled out**, but due to OCR performance and cost efficiency issues, **there are no specific plans at this time**.

| Platform              | Status       | Notes                                           |
| --------------------- | ------------ | ----------------------------------------------- |
| macOS + Apple Silicon | ✅ Supported | Optimal performance, GPU acceleration           |
| macOS + Intel         | ✅ Supported | No GPU acceleration                             |
| Linux                 | ❓ TBD       | No current plans due to performance/cost issues |
| Windows               | ❓ TBD       | WSL2 Linux approach possible                    |

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
