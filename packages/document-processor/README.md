# @heripo/document-processor

> LLM-based document structure analysis and processing library

[![npm version](https://img.shields.io/npm/v/@heripo/document-processor.svg)](https://www.npmjs.com/package/@heripo/document-processor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
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
- [Sponsor](#sponsor)
- [License](#license)

## Key Features

- **TOC Extraction**: Automatic TOC recognition with rule-based + LLM fallback
- **Hierarchical Structure**: Automatic generation of chapter/section/subsection hierarchy
- **Page Mapping**: Actual page number mapping using Vision LLM
- **Caption Parsing**: Automatic parsing of image and table captions
- **Source Provenance**: Preserves Docling source metadata and node-level references
- **Table Grid Normalization**: Preserves row/column spans and removes merged-cell shadow entries
- **LLM Flexibility**: Support for various LLMs including OpenAI, Anthropic, Google
- **Fallback Retry**: Automatic retry with fallback model on failure

## Installation

```bash
# Install with npm
npm install @heripo/document-processor @heripo/model @heripo/logger

# Install with pnpm
pnpm add @heripo/document-processor @heripo/model @heripo/logger

# Install with yarn
yarn add @heripo/document-processor @heripo/model @heripo/logger
```

Additionally, LLM provider SDKs are required:

```bash
# Vercel AI SDK and provider packages
npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

## Usage

### Runtime and Result Persistence

This package is an ESM library for Node.js 24+. It does not itself require Python or macOS; those requirements belong to `@heripo/pdf-parser`. Align AI SDK/provider versions with the repository [catalog](../../pnpm-workspace.yaml).

In the examples, `doclingDocument` is the parser's corrected `result.json`, and `artifactDir` contains its image/page artifacts. The fallback model also serves every component without an explicit model, so it must support image input and structured output. Set the example-specific `HERIPO_ANTHROPIC_MODEL` and `HERIPO_OPENAI_MODEL` environment variables to available model IDs, and configure credentials for the selected providers.

`process()` does not save files. Save the returned `document` as JSON and preserve referenced images yourself. Its `schemaVersion` is the exported `PROCESSED_DOCUMENT_SCHEMA_VERSION`, currently `processed-document.v2`.

### Basic Usage

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { DocumentProcessor } from '@heripo/document-processor';
import { Logger } from '@heripo/logger';

const logger = new Logger({
  debug: (...args) => console.debug('[heripo]', ...args),
  info: (...args) => console.info('[heripo]', ...args),
  warn: (...args) => console.warn('[heripo]', ...args),
  error: (...args) => console.error('[heripo]', ...args),
});

// Basic usage - specify fallback model only
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic(process.env.HERIPO_ANTHROPIC_MODEL!),
  textCleanerBatchSize: 10,
  captionParserBatchSize: 5,
  captionValidatorBatchSize: 5,
});

// Process document
const { document, usage } = await processor.process(
  doclingDocument, // PDF parser output
  'report-001', // Report ID
  artifactDir, // Directory containing parser artifacts such as images/pages
);

// Use results
console.log('TOC:', document.chapters);
console.log('Images:', document.images);
console.log('Tables:', document.tables);
console.log('Footnotes:', document.footnotes);
console.log('Token Usage:', usage.total);
```

### Advanced Usage - Per-Component Model Specification

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

const processor = new DocumentProcessor({
  logger,
  // Fallback model (for retry on failure)
  fallbackModel: anthropic(process.env.HERIPO_ANTHROPIC_MODEL!),

  // Per-component model specification
  pageRangeParserModel: openai(process.env.HERIPO_OPENAI_MODEL!), // Vision required
  tocExtractorModel: openai(process.env.HERIPO_OPENAI_MODEL!), // Structured output
  validatorModel: openai(process.env.HERIPO_OPENAI_MODEL!), // Simple validation
  visionTocExtractorModel: openai(process.env.HERIPO_OPENAI_MODEL!), // Vision required
  captionParserModel: openai(process.env.HERIPO_OPENAI_MODEL!), // Caption parsing

  // Batch size settings
  textCleanerBatchSize: 20, // Synchronous processing (can be large)
  captionParserBatchSize: 10, // LLM calls (medium)
  captionValidatorBatchSize: 10, // LLM calls (medium)

  // Retry settings
  maxRetries: 3,
  maxValidationRetries: 3,
  enableFallbackRetry: true, // Automatic retry with fallback model (default: false)
});

const { document, usage } = await processor.process(
  doclingDocument,
  'report-001',
  artifactDir,
);
```

### Manual Page Range Map

If page range mapping has already been reviewed, pass it as the fourth
`process()` argument to skip automatic PageRangeParser execution. The provided
map is used as-is without additional post-processing.

```typescript
import type { PageRange } from '@heripo/model';

const pageRangeMap: Record<number, PageRange> = {
  1: { startPageNo: 0, endPageNo: 0 },
  2: { startPageNo: 1, endPageNo: 1 },
  3: { startPageNo: 2, endPageNo: 3 },
};

const { document, usage } = await processor.process(
  doclingDocument,
  'report-001',
  artifactDir,
  { pageRangeMap },
);
```

### Manual TOC Entries

If the table of contents has already been reviewed, pass `tocEntries` as the
fourth `process()` argument to skip automatic TOC extraction. The provided
entries are used as-is without additional extraction or validation.

```typescript
import type { TocEntry } from '@heripo/document-processor';

const tocEntries: TocEntry[] = [
  {
    title: 'Chapter 1. Overview',
    level: 1,
    pageNo: 1,
    children: [
      {
        title: '1. Background',
        level: 2,
        pageNo: 3,
      },
    ],
  },
];

const { document, usage } = await processor.process(
  doclingDocument,
  'report-001',
  artifactDir,
  { tocEntries },
);
```

Manual page range maps and TOC entries can be provided together to skip both
automatic stages.

```typescript
const { document, usage } = await processor.process(
  doclingDocument,
  'report-001',
  artifactDir,
  { pageRangeMap, tocEntries },
);
```

### Preserving Source Docling References

If the caller knows where the source Docling JSON is stored or has its hash,
pass that metadata through `source`. The value is preserved as
`ProcessedDocument.source`. Use `validateSourceRefs` or
`sourceRefValidationMode` to verify that generated `sourceRef` and
`captionSourceRefs` values exist in the input `DoclingDocument`.

```typescript
const { document } = await processor.process(
  doclingDocument,
  'report-001',
  artifactDir,
  {
    pageRangeMap,
    tocEntries,
    source: {
      pipelineRunId: 'run-001',
      doclingObjectKey: 'docling/report-001.json',
      doclingSha256: '...',
      handoffManifestObjectKey: 'manifests/run-001.json',
    },
    sourceRefValidationMode: 'warn', // 'off' | 'warn' | 'error'
  },
);

console.log(document.source);
console.log(document.chapters[0].textBlocks[0].sourceRef);
console.log(document.images[0].captionSourceRefs);
```

`ProcessedDocument.source` is document-level metadata that identifies the
Docling artifact used for processing. `TextBlock.sourceRef`,
`Chapter.sourceRefs`, `ProcessedImage.sourceRef`, `ProcessedTable.sourceRef`,
and `ProcessedFootnote.sourceRef` are node-level references that point back to
the Docling nodes each processed node came from. For images and tables,
`captionSourceRefs` contains only caption text node references, not the resource
node reference.

`sourceRefValidationMode: 'error'` fails processing when references are missing.
`validateSourceRefs: true` is a compatibility shortcut and behaves like
`'error'` unless a mode is explicitly provided.

Table cells do not receive cell-level `sourceRef` values. Use `table.sourceRef`
to find the source table, then compare spans and source cell coordinates.
Compact `grid` array indexes may differ from logical source column indexes.

### Table Grid Handling

Processed tables expose a compact `grid` of visible cells. The processor:

- Preserves Docling row/column spans as `rowSpan` and `colSpan`
- Marks row and column headers through `isHeader`
- Removes merged-cell shadow entries when Docling repeats covered cells
- Falls back to `table_cells` when Docling's `data.grid` is empty

`numRows` and `numCols` keep the logical table size; do not assume they match
array lengths. When rendering, skip positions covered by `rowSpan`/`colSpan`.

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
- **Tables**: Grid data transformation, merged-cell shadow filtering, span preservation, and caption parsing
- **Caption Validation**: Parsing result validation with CaptionValidator

### 5. Chapter Conversion (ChapterConverter)

A `Front Matter` (`ch-000`) chapter is always prepended to retain content before the first TOC entry. The remaining hierarchy is built from the supplied or extracted TOC.

- Build chapter tree based on TOC
- Create Chapter hierarchy
- Link text blocks to chapters by page range
- Connect image/table IDs to appropriate chapters
- Link footnote IDs to appropriate chapters
- Throws `TocNotFoundError` when TOC entries are empty because TOC-based chapter conversion is required

## API Documentation

### DocumentProcessor Class

#### Constructor Options

```typescript
interface DocumentProcessorOptions {
  logger: LoggerMethods; // Logger instance (required)

  // LLM model settings
  fallbackModel: LanguageModel; // Fallback model (required)
  pageRangeParserModel?: LanguageModel; // For page range parser
  tocExtractorModel?: LanguageModel; // For TOC extraction
  validatorModel?: LanguageModel; // For validation
  visionTocExtractorModel?: LanguageModel; // For Vision TOC extraction
  captionParserModel?: LanguageModel; // For caption parser

  // Batch processing settings
  textCleanerBatchSize: number; // Text cleaning batch size (required)
  captionParserBatchSize: number; // Caption parsing batch size (required)
  captionValidatorBatchSize: number; // Caption validation batch size (required)

  // Retry settings
  maxRetries?: number; // LLM API retry count (default: 3)
  maxValidationRetries?: number; // TOC validation correction retry count (default: 3)
  enableFallbackRetry?: boolean; // Enable fallback retry (default: false)

  // Advanced options
  abortSignal?: AbortSignal; // Cancellation support
  onTokenUsage?: (report: TokenUsageReport) => void; // Real-time token usage monitoring
}
```

#### Methods

##### `process(doclingDoc, reportId, artifactDir, processOptions?): Promise<DocumentProcessResult>`

Transforms DoclingDocument into ProcessedDocument.

```typescript
interface DocumentProcessorProcessOptions {
  pageRangeMap?: Record<number, PageRange>;
  tocEntries?: TocEntry[];
  source?: ProcessedDocumentSource;
  validateSourceRefs?: boolean;
  sourceRefValidationMode?: 'off' | 'warn' | 'error';
}
```

**Parameters:**

- `doclingDoc` (DoclingDocument): PDF parser output
- `reportId` (string): Report ID
- `artifactDir` (string): Artifact directory containing parser outputs such as `images/`, `pages/`, and `result.json`
- `processOptions` (DocumentProcessorProcessOptions, optional): Per-document processing inputs. When `pageRangeMap` is provided, automatic page range parsing is skipped. When `tocEntries` is provided, automatic TOC extraction is skipped. `source` preserves source Docling artifact metadata, and `sourceRefValidationMode` controls generated source reference validation.

**Returns:**

- `Promise<DocumentProcessResult>`: Result containing:
  - `document` (ProcessedDocument): Processed document (includes `chapters`, `images`, `tables`, `footnotes`)
  - `usage` (TokenUsageReport): Token usage report

### Fallback Retry Mechanism

When `enableFallbackRetry: true` is set (default is `false`), LLM components automatically retry with fallbackModel on failure:

```typescript
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic(process.env.HERIPO_ANTHROPIC_MODEL!), // For retry
  pageRangeParserModel: openai(process.env.HERIPO_OPENAI_MODEL!), // First attempt
  enableFallbackRetry: true, // Use fallback on failure (default: false)
  textCleanerBatchSize: 10,
  captionParserBatchSize: 5,
  captionValidatorBatchSize: 5,
});

// If pageRangeParserModel fails, automatically retries with fallbackModel
const { document, usage } = await processor.process(doc, 'id', 'path');
```

### Batch Size Parameters

- **textCleanerBatchSize**: Synchronous text normalization and filtering batch size. Large values possible due to local processing
- **captionParserBatchSize**: LLM-based caption parsing batch size. Controls captions included per parsing request
- **captionValidatorBatchSize**: LLM-based caption validation batch size. Controls captions grouped for validation

`textCleanerBatchSize`, `captionParserBatchSize` and `captionValidatorBatchSize` accept `0` for sequential processing without batching. Use positive integers to enable batching. Positive batch sizes group items; they do not impose a global API concurrency limit.

## Error Handling

### TocExtractError

Errors thrown when TOC extraction fails:

- `TocNotFoundError`: TOC not found in document
- `TocParseError`: LLM response parsing failed
- `TocValidationError`: May be raised internally, but is not exported from the package root. Catch the exported `TocExtractError` base class.

```typescript
import {
  TocExtractError,
  TocNotFoundError,
  TocParseError,
} from '@heripo/document-processor';

try {
  const { document, usage } = await processor.process(doc, 'id', 'path');
} catch (error) {
  if (error instanceof TocNotFoundError) {
    console.error('TOC not found. Manual TOC review is required.');
  } else if (error instanceof TocParseError) {
    console.error('TOC parsing failed:', error.message);
  } else if (error instanceof TocExtractError) {
    console.error(error.message);
  } else {
    throw error;
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
const { pageRangeMap, usage } = await pageRangeParser.parse(doc);
console.log('Token usage:', usage);

// TocExtractor
const { entries, usages } = await tocExtractor.extract(markdown);
console.log('Token usage:', usages);
```

## Related Packages

- [@heripo/pdf-parser](../pdf-parser/README.md) - PDF parsing and OCR
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

## Project-Wide Information

For project-wide information not covered in this package, see the [root README](../../README.md):

- **Citation and Attribution**: Academic citation (BibTeX) and attribution methods
- **Contributing Guidelines**: Development guidelines, commit rules, PR procedures
- **Community**: Issue tracker, discussions, security policy
- **Roadmap**: Project development plans

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
