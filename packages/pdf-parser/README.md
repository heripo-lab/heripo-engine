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
- [Why macOS Only?](#why-macos-only)
- [System Dependencies Details](#system-dependencies-details)
- [API Documentation](#api-documentation)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Key Features

- **High-Quality OCR**: document recognition using Docling SDK
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

#### 4. jq (JSON processing tool)

```bash
brew install jq
```

#### 5. lsof (port management)

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

| Dependency | Required Version | Installation               | Purpose                                     |
| ---------- | ---------------- | -------------------------- | ------------------------------------------- |
| Python     | 3.9 - 3.12       | `brew install python@3.11` | Docling SDK runtime                         |
| jq         | Any              | `brew install jq`          | JSON processing (conversion result parsing) |
| lsof       | Any              | Included with macOS        | docling-serve port management               |

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
