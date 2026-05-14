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
  fallbackModel: anthropic('claude-opus-4-5'),
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

Table cells do not receive cell-level `sourceRef` values. To locate a specific
cell in the source artifact, combine `table.sourceRef` with the
`grid[row][col]` row/column indexes.

### Table Grid Handling

Processed tables expose a compact `grid` of visible cells. The processor:

- Preserves Docling row/column spans as `rowSpan` and `colSpan`
- Marks row and column headers through `isHeader`
- Removes merged-cell shadow entries when Docling repeats covered cells
- Falls back to `table_cells` when Docling's `data.grid` is empty

`numRows` and `numCols` keep the logical table size. Individual cells do not
store `sourceRef`; use `table.sourceRef` together with the `grid[row][col]`
position when tracing a cell back to the source table.

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
  fallbackModel: anthropic('claude-opus-4-5'), // For retry
  pageRangeParserModel: openai('gpt-5.2'), // First attempt
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
  const { document, usage } = await processor.process(doc, 'id', 'path');
} catch (error) {
  if (error instanceof TocNotFoundError) {
    console.error('TOC not found. Manual TOC review is required.');
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
