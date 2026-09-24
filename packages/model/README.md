# @heripo/model

> Document models and type definitions

[![npm version](https://img.shields.io/npm/v/@heripo/model.svg)](https://www.npmjs.com/package/@heripo/model)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

**English** | [한국어](./README.ko.md)

> **Note**: Please check the [root README](../../README.md) first for project overview, installation instructions, and roadmap.

`@heripo/model` provides data models and TypeScript type definitions used in heripo engine.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Data Models](#data-models)
- [Usage](#usage)
- [Sponsor](#sponsor)
- [License](#license)

## Overview

heripo engine's data processing pipeline:

```
DoclingDocument (Docling SDK raw output)
    ↓
ProcessedDocument (LLM-optimized intermediate model)
    ↓
(Various models to be added per roadmap)
```

`@heripo/model` defines data models currently used in the PDF parsing and document structure extraction stages. Various domain-specific models for archaeological data analysis, standardization, semantic modeling, etc. will be added in the future.

Targets Node.js 24+ with ESM and CommonJS entry points. Use `import type` for document interfaces and ordinary imports for language utilities. A TypeScript assertion on parsed JSON does not perform runtime validation.

## Installation

```bash
# Install with npm
npm install @heripo/model

# Install with pnpm
pnpm add @heripo/model

# Install with yarn
yarn add @heripo/model
```

## Data Models

### DoclingDocument

Raw output format from Docling SDK.

```typescript
import type { DoclingDocument } from '@heripo/model';
```

**Key Fields:**

- `schema_name`, `version`, `name`: Docling document identity fields
- `origin`: Source file metadata
- `body`, `furniture`, `groups`: Document tree and grouping structures
- `texts`, `pictures`, `tables`: Extracted content nodes
- `pages`: Page metadata and rendered page image references

`DoclingReference.$ref` and node `self_ref` values link source nodes. `DoclingProv.page_no` and processed `pdfPageNo` are one-based, while rendered files start at `pages/page_0.png`. `Chapter.pageNo` and `PageRange` refer to logical printed page numbers, which can differ from PDF page numbers. Interpret bounding boxes using their `DoclingBBox.coord_origin`.

### ProcessedDocument

Intermediate data model optimized for LLM analysis.

```typescript
import type { ProcessedDocument } from '@heripo/model';

interface ProcessedDocument {
  reportId: string; // Report ID
  schemaVersion?: string; // Processed document schema version
  source?: ProcessedDocumentSource; // Source Docling artifact metadata
  pageRangeMap: Record<number, PageRange>; // PDF page → document page mapping
  chapters: Chapter[]; // Hierarchical chapter structure
  images: ProcessedImage[]; // Extracted image metadata
  tables: ProcessedTable[]; // Extracted table data
  footnotes: ProcessedFootnote[]; // Extracted footnotes
}
```

### ProcessedDocumentSource

Source artifact metadata for the Docling JSON used to create a processed document.

```typescript
import type { ProcessedDocumentSource } from '@heripo/model';

interface ProcessedDocumentSource {
  pipelineRunId?: string; // Processing pipeline run ID
  doclingObjectKey?: string; // Object key for result.json or merged Docling JSON
  doclingSha256?: string; // SHA-256 hash of the Docling JSON artifact
  handoffManifestObjectKey?: string; // Object key for a handoff manifest
}
```

### Chapter

Hierarchical section structure of the document.

```typescript
import type { Chapter } from '@heripo/model';

interface Chapter {
  id: string; // Chapter ID
  title: string; // Chapter title
  originTitle: string; // Original title from source
  level: number; // Hierarchy level (1, 2, 3, ...)
  pageNo: number; // Start page number
  sourceRefs?: string[]; // Source Docling refs used for the title
  textBlocks: TextBlock[]; // Text blocks
  imageIds: string[]; // Image ID references
  tableIds: string[]; // Table ID references
  footnoteIds: string[]; // Footnote ID references
  children?: Chapter[]; // Sub-chapters (optional)
}
```

### TextBlock

Atomic text unit.

```typescript
import type { TextBlock } from '@heripo/model';

interface TextBlock {
  id?: string; // Stable text block ID
  sourceRef?: string; // Source Docling text ref
  text: string; // Text content
  pdfPageNo: number; // PDF page number
}
```

### ProcessedImage

Image metadata and reference information.

```typescript
import type { ProcessedImage } from '@heripo/model';

interface ProcessedImage {
  id: string; // Image ID
  sourceRef?: string; // Source Docling picture ref
  captionSourceRefs?: string[]; // Source Docling refs for caption text items
  caption?: Caption; // Caption (optional)
  pdfPageNo: number; // PDF page number
  path: string; // Image file path
}
```

### ProcessedTable

Table structure and data.

```typescript
import type { ProcessedTable } from '@heripo/model';

interface ProcessedTable {
  id: string; // Table ID
  sourceRef?: string; // Source Docling table ref
  captionSourceRefs?: string[]; // Source Docling refs for caption text items
  caption?: Caption; // Caption (optional)
  pdfPageNo: number; // PDF page number
  grid: ProcessedTableCell[][]; // 2D grid data
  numRows: number; // Row count
  numCols: number; // Column count
}
```

`grid` is a compact list of visible cells. Merged cells are represented with
`rowSpan` and `colSpan`; shadow cells covered by a span are not included.
Cells have no individual `sourceRef`. Locate the source table using
`table.sourceRef`, then compare cell spans and original coordinates. Compact
array indexes need not equal logical source column indexes.

### ProcessedTableCell

Table cell metadata.

```typescript
import type { ProcessedTableCell } from '@heripo/model';

interface ProcessedTableCell {
  text: string; // Cell text
  rowSpan: number; // Row span
  colSpan: number; // Column span
  isHeader: boolean; // Is header cell
}
```

### Caption

Image and table captions.

```typescript
import type { Caption } from '@heripo/model';

interface Caption {
  num?: string; // Caption prefix and number (e.g., "Figure 1")
  fullText: string; // Full caption text
}
```

### PageRange

PDF page to document page mapping.

```typescript
import type { PageRange } from '@heripo/model';

interface PageRange {
  startPageNo: number; // Start page number
  endPageNo: number; // End page number
}
```

### ProcessedFootnote

Footnote extracted from the document.

```typescript
import type { ProcessedFootnote } from '@heripo/model';

interface ProcessedFootnote {
  id: string; // Footnote ID
  sourceRef?: string; // Source Docling text ref
  text: string; // Footnote text
  pdfPageNo: number; // PDF page number
}
```

### DocumentProcessResult

Result of document processing, including the processed document and token usage report.

```typescript
import type { DocumentProcessResult } from '@heripo/model';

interface DocumentProcessResult {
  document: ProcessedDocument; // Processed document
  usage: TokenUsageReport; // Token usage report
}
```

### OcrStrategy

Retained type for OCR strategy data. The current PDF parser uses fixed ocrmac
plus post-Docling correction; it no longer returns or selects this strategy.

```typescript
import type { OcrStrategy } from '@heripo/model';

interface OcrStrategy {
  method: 'ocrmac' | 'vlm'; // OCR method
  ocrLanguages?: string[]; // OCR languages
  detectedLanguages?: Bcp47LanguageTag[]; // Detected BCP-47 language tags
  reason: string; // Reason for strategy selection
  sampledPages: number; // Number of sampled pages
  totalPages: number; // Total pages in document
}
```

### Token Usage Types

Types for tracking LLM token usage across processing phases.

```typescript
import type {
  ComponentUsageReport,
  ModelUsageDetail,
  PhaseUsageReport,
  TokenUsageMetadata,
  TokenUsageReport,
  TokenUsageSummary,
} from '@heripo/model';

interface TokenUsageReport {
  components: ComponentUsageReport[]; // Usage per component
  total: TokenUsageSummary; // Total usage summary
}

interface ComponentUsageReport {
  component: string; // Component name
  phases: PhaseUsageReport[]; // Usage per phase
  total: TokenUsageSummary; // Component total
}

interface PhaseUsageReport {
  metadata?: TokenUsageMetadata[]; // Per-call context
  phase: string; // Phase name
  primary?: ModelUsageDetail; // Primary model usage
  fallback?: ModelUsageDetail; // Fallback model usage
  total: TokenUsageSummary; // Phase total
}

interface ModelUsageDetail {
  modelName: string; // Model name
  inputTokens: number; // Input token count
  outputTokens: number; // Output token count
  totalTokens: number; // Total token count
  cachedInputTokens?: number | null; // Cache reads
  cacheWriteTokens?: number | null; // Default-duration cache writes
  cacheWrite1hTokens?: number | null; // One-hour cache writes
}

interface TokenUsageSummary {
  inputTokens: number; // Input token count
  outputTokens: number; // Output token count
  totalTokens: number; // Total token count
  cachedInputTokens?: number | null; // Cache reads across contributing calls
  cacheWriteTokens?: number | null; // Default-duration cache writes
  cacheWrite1hTokens?: number | null; // One-hour cache writes
}
```

Cache counts are subsets of `inputTokens`, not additional tokens. Missing fields or `null` mean the provider did not report a complete count; `0` means it reported zero.

### Review Assistance Types

A separate audit report is produced when `correction.reviewAssistanceEnabled` is true (the parser default). It is not embedded in `ProcessedDocument`. The [complete type definitions](./src/types/review-assistance.ts) cover commands, evidence, issues, call traces and progress events.

Required report fields are `schemaName`, `version`, `reportId`, `source`, `options`, `summary`, `pages` and `callTraces`. A rejected decision may have `invalidOp` and no `command`; check before accessing it.

```typescript
import type { ReviewAssistanceReport } from '@heripo/model';

function summarizeReview(report: ReviewAssistanceReport) {
  for (const page of report.pages) {
    for (const decision of page.decisions) {
      console.log(
        page.pageNo,
        decision.command?.op ?? decision.invalidOp,
        decision.disposition,
      );
    }
  }
  console.log(report.summary, report.callTraces);
}
```

### BCP-47 Language Tag Utilities

Language validation and normalization use the supported tag list; these are not general BCP-47 syntax validators. Display-name helpers are also runtime exports.

```typescript
import {
  BCP47_LANGUAGE_TAGS,
  BCP47_LANGUAGE_TAG_SET,
  LANGUAGE_DISPLAY_NAMES,
  buildLanguageDescription,
  getLanguageDisplayName,
  isValidBcp47Tag,
  normalizeToBcp47,
} from '@heripo/model';

console.log(normalizeToBcp47('ko')); // 'ko-KR'
console.log(isValidBcp47Tag('ko-KR')); // true
console.log(BCP47_LANGUAGE_TAGS.length, BCP47_LANGUAGE_TAG_SET.has('ko-KR'));
console.log(LANGUAGE_DISPLAY_NAMES.ko, getLanguageDisplayName('ko-KR'));
console.log(buildLanguageDescription(['ko-KR', 'en-US']));
```

## Usage

### Reading ProcessedDocument

```typescript
import type { Chapter, ProcessedDocument } from '@heripo/model';

function analyzeDocument(doc: ProcessedDocument) {
  console.log('Report ID:', doc.reportId);

  // Iterate chapters
  doc.chapters.forEach((chapter) => {
    console.log(`Chapter: ${chapter.title} (level ${chapter.level})`);
    console.log(`  Text blocks: ${chapter.textBlocks.length}`);
    console.log(`  Images: ${chapter.imageIds.length}`);
    console.log(`  Tables: ${chapter.tableIds.length}`);
    console.log(`  Sub-chapters: ${chapter.children?.length ?? 0}`);
  });

  // Check images
  doc.images.forEach((image) => {
    console.log(`Image ${image.id}:`);
    if (image.caption) {
      console.log(`  Caption: ${image.caption.fullText}`);
    }
    console.log(`  Path: ${image.path}`);
  });

  // Check tables
  doc.tables.forEach((table) => {
    console.log(`Table ${table.id}:`);
    console.log(`  Size: ${table.numRows} x ${table.numCols}`);
    if (table.caption) {
      console.log(`  Caption: ${table.caption.fullText}`);
    }
  });
}
```

### Recursive Chapter Traversal

```typescript
import type { Chapter } from '@heripo/model';

function traverseChapters(chapter: Chapter, depth: number = 0) {
  const indent = '  '.repeat(depth);
  console.log(`${indent}- ${chapter.title}`);

  // Recursively traverse sub-chapters
  chapter.children?.forEach((child) => {
    traverseChapters(child, depth + 1);
  });
}

// Usage
doc.chapters.forEach((chapter) => traverseChapters(chapter));
```

### Type Guards

```typescript
import type { Caption, ProcessedImage, ProcessedTable } from '@heripo/model';

function hasCaption(
  resource: ProcessedImage | ProcessedTable,
): resource is (ProcessedImage | ProcessedTable) & { caption: Caption } {
  return resource.caption !== undefined;
}

// Usage
const resourcesWithCaptions = [...doc.images, ...doc.tables].filter(hasCaption);
```

## Related Packages

- [@heripo/pdf-parser](../pdf-parser/README.md) - PDF parsing and OCR
- [@heripo/document-processor](../document-processor/README.md) - Document structure analysis

## Sponsor

If you'd like to support heripo lab's open-source research, you can sponsor us through:

- [Open Collective](https://opencollective.com/heripo-project) for general project sponsorship.
- [fairy.hada.io/@heripo](https://fairy.hada.io/@heripo) for Korean individual supporters who prefer KRW payments.

## License

This package is distributed under the [Apache License 2.0](../../LICENSE).

## Contributing

Contributions are always welcome! Please see the [Contributing Guide](../../CONTRIBUTING.md).

## Project-Wide Information

For project-wide information not covered in this package, see the [root README](../../README.md):

- **Citation and Attribution**: Academic citation (BibTeX) and attribution methods
- **Contributing Guidelines**: Development guidelines, commit rules, PR procedures
- **Community**: Issue tracker, discussions, security policy
- **Roadmap**: Project development plans

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
