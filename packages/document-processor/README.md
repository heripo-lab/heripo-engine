# @heripo/document-processor

> LLM-based document structure analysis and processing library

[![npm version](https://img.shields.io/npm/v/@heripo/document-processor.svg)](https://www.npmjs.com/package/@heripo/document-processor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

**English** | [한국어](./README.ko.md)

> **Note**: Please check the [root README](../../README.md) first for project overview, installation instructions, and roadmap.

`@heripo/document-processor` is a library that transforms DoclingDocument into ProcessedDocument, optimized for LLM analysis.

## Table of Contents

- [Key Features](#key-features)
- [Installation](#installation)
- [Usage](#usage)
- [Processing Pipeline](#processing-pipeline)
- [API Documentation](#api-documentation)
- [License](#license)

## Key Features

- **TOC Extraction**: Automatic TOC recognition with rule-based + LLM fallback
- **Hierarchical Structure**: Automatic generation of chapter/section/subsection hierarchy
- **Page Mapping**: Actual page number mapping using Vision LLM
- **Caption Parsing**: Automatic parsing of image and table captions
- **LLM Flexibility**: Support for various LLMs including OpenAI, Anthropic, Google
- **Fallback Retry**: Automatic retry with fallback model on failure

## Installation

```bash
# Install with npm
npm install @heripo/document-processor @heripo/model

# Install with pnpm
pnpm add @heripo/document-processor @heripo/model

# Install with yarn
yarn add @heripo/document-processor @heripo/model
```

Additionally, LLM provider SDKs are required:

```bash
# Vercel AI SDK and provider packages
npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

## Usage

### Basic Usage

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { DocumentProcessor } from '@heripo/document-processor';
import { Logger } from '@heripo/logger';

const logger = Logger(...);

// Basic usage - specify fallback model only
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'),
  textCleanerBatchSize: 10,
  captionParserBatchSize: 5,
  captionValidatorBatchSize: 5,
});

// Process document
const processedDoc = await processor.process(
  doclingDocument, // PDF parser output
  'report-001', // Report ID
  outputPath, // Directory containing images/pages
);

// Use results
console.log('TOC:', processedDoc.chapters);
console.log('Images:', processedDoc.images);
console.log('Tables:', processedDoc.tables);
```

### Advanced Usage - Per-Component Model Specification

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

const processor = new DocumentProcessor({
  logger,
  // Fallback model (for retry on failure)
  fallbackModel: anthropic('claude-opus-4-5'),

  // Per-component model specification
  pageRangeParserModel: openai('gpt-5.1'), // Vision required
  tocExtractorModel: openai('gpt-5.1'), // Structured output
  validatorModel: openai('gpt-5.2'), // Simple validation
  visionTocExtractorModel: openai('gpt-5.1'), // Vision required
  captionParserModel: openai('gpt-5-mini'), // Caption parsing

  // Batch size settings
  textCleanerBatchSize: 20, // Synchronous processing (can be large)
  captionParserBatchSize: 10, // LLM calls (medium)
  captionValidatorBatchSize: 10, // LLM calls (medium)

  // Retry settings
  maxRetries: 3,
  enableFallbackRetry: true, // Automatic retry with fallback model
});

const processedDoc = await processor.process(
  doclingDocument,
  'report-001',
  outputPath,
);
```

## Processing Pipeline

DocumentProcessor processes documents through a 5-stage pipeline:

### 1. Text Cleaning (TextCleaner)

- Unicode normalization (NFC)
- Whitespace cleanup
- Invalid text filtering (numbers-only text, empty text)

### 2. Page Range Mapping (PageRangeParser - Vision LLM)

- Extract actual page numbers from page images
- PDF page to document logical page mapping
- Handle page number mismatches due to scanning errors

### 3. TOC Extraction (5-Stage Pipeline)

#### Stage 1: TocFinder (Rule-Based)

- Keyword search (Table of Contents, Contents, etc.)
- Structure analysis (lists/tables with page number patterns)
- Multi-page TOC detection with continuation markers

#### Stage 2: MarkdownConverter

- Group → Indented list format
- Table → Markdown table format
- Preserve hierarchy for LLM processing

#### Stage 3: TocContentValidator (LLM Validation)

- Verify if extracted content is actual TOC
- Return confidence score and reason

#### Stage 4: VisionTocExtractor (Vision LLM Fallback)

- Used when rule-based extraction or validation fails
- Extract TOC directly from page images

#### Stage 5: TocExtractor (LLM Structuring)

- Extract hierarchical TocEntry[] (title, level, pageNo)
- Recursive children structure for nested sections

### 4. Resource Transformation

- **Images**: Caption extraction and parsing with CaptionParser
- **Tables**: Grid data transformation and caption parsing
- **Caption Validation**: Parsing result validation with CaptionValidator

### 5. Chapter Conversion (ChapterConverter)

- Build chapter tree based on TOC
- Create Chapter hierarchy
- Link text blocks to chapters by page range
- Connect image/table IDs to appropriate chapters
- Fallback: Create single "Document" chapter when TOC is empty

## API Documentation

### DocumentProcessor Class

#### Constructor Options

```typescript
interface DocumentProcessorOptions {
  logger: Logger; // Logger instance (required)

  // LLM model settings
  fallbackModel: LanguageModel; // Fallback model (required)
  pageRangeParserModel?: LanguageModel; // For page range parser
  tocExtractorModel?: LanguageModel; // For TOC extraction
  validatorModel?: LanguageModel; // For validation
  visionTocExtractorModel?: LanguageModel; // For Vision TOC extraction
  captionParserModel?: LanguageModel; // For caption parser

  // Batch processing settings
  textCleanerBatchSize?: number; // Text cleaning (default: 10)
  captionParserBatchSize?: number; // Caption parsing (default: 5)
  captionValidatorBatchSize?: number; // Caption validation (default: 5)

  // Retry settings
  maxRetries?: number; // LLM API retry count (default: 3)
  enableFallbackRetry?: boolean; // Enable fallback retry (default: true)
}
```

#### Methods

##### `process(doclingDoc, reportId, outputPath): Promise<ProcessedDocument>`

Transforms DoclingDocument into ProcessedDocument.

**Parameters:**

- `doclingDoc` (DoclingDocument): PDF parser output
- `reportId` (string): Report ID
- `outputPath` (string): Output directory containing images/pages

**Returns:**

- `Promise<ProcessedDocument>`: Processed document

### Fallback Retry Mechanism

When `enableFallbackRetry: true` is set, LLM components automatically retry with fallbackModel on failure:

```typescript
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'), // For retry
  pageRangeParserModel: openai('gpt-5.2'), // First attempt
  enableFallbackRetry: true, // Use fallback on failure
});

// If pageRangeParserModel fails, automatically retries with fallbackModel
const result = await processor.process(doc, 'id', 'path');
```

### Batch Size Parameters

- **textCleanerBatchSize**: Synchronous text normalization and filtering batch size. Large values possible due to local processing
- **captionParserBatchSize**: LLM-based caption parsing batch size. Small values for API request concurrency and cost management
- **captionValidatorBatchSize**: LLM-based caption validation batch size. Small values to limit validation request concurrency

## Error Handling

### TocExtractError

Errors thrown when TOC extraction fails:

- `TocNotFoundError`: TOC not found in document
- `TocParseError`: LLM response parsing failed
- `TocValidationError`: TOC validation failed

```typescript
try {
  const result = await processor.process(doc, 'id', 'path');
} catch (error) {
  if (error instanceof TocNotFoundError) {
    console.log('TOC not found. Processing as single chapter.');
  } else if (error instanceof TocParseError) {
    console.error('TOC parsing failed:', error.message);
  }
}
```

### PageRangeParseError

Page range parsing failure:

```typescript
import { PageRangeParseError } from '@heripo/document-processor';
```

### CaptionParseError & CaptionValidationError

Caption parsing/validation failure:

```typescript
import {
  CaptionParseError,
  CaptionValidationError,
} from '@heripo/document-processor';
```

## Token Usage Tracking

Major LLM components return token usage:

```typescript
// PageRangeParser
const { pageRangeMap, tokenUsage } = await pageRangeParser.parse(doc);
console.log('Token usage:', tokenUsage);

// TocExtractor
const { entries, tokenUsage } = await tocExtractor.extract(markdown);
console.log('Token usage:', tokenUsage);
```

## Related Packages

- [@heripo/pdf-parser](../pdf-parser) - PDF parsing and OCR
- [@heripo/model](../model) - Data models and type definitions

## License

This package is distributed under the [Apache License 2.0](../../LICENSE).

## Contributing

Contributions are always welcome! Please see the [Contributing Guide](../../CONTRIBUTING.md).

## Issues and Support

- **Bug Reports**: [GitHub Issues](https://github.com/heripo-lab/heripo-engine/issues)
- **Discussions**: [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)

## Project-Wide Information

For project-wide information not covered in this package, see the [root README](../../README.md):

- **Citation and Attribution**: Academic citation (BibTeX) and attribution methods
- **Contributing Guidelines**: Development guidelines, commit rules, PR procedures
- **Community**: Issue tracker, discussions, security policy
- **Roadmap**: Project development plans

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
