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

- `type`: Document type (e.g., "pdf")
- `item_index`: Item index
- `json_content`: Document content (JSON object)

### ProcessedDocument

Intermediate data model optimized for LLM analysis.

```typescript
import type { ProcessedDocument } from '@heripo/model';

interface ProcessedDocument {
  reportId: string; // Report ID
  pageRangeMap: Record<number, PageRange>; // PDF page → document page mapping
  chapters: Chapter[]; // Hierarchical chapter structure
  images: ProcessedImage[]; // Extracted image metadata
  tables: ProcessedTable[]; // Extracted table data
  footnotes: ProcessedFootnote[]; // Extracted footnotes
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
  caption?: Caption; // Caption (optional)
  pdfPageNo: number; // PDF page number
  grid: ProcessedTableCell[][]; // 2D grid data
  numRows: number; // Row count
  numCols: number; // Column count
}
```

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
  num?: string; // Caption number (e.g., "1" in "Figure 1")
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

OCR strategy selection result.

```typescript
import type { OcrStrategy } from '@heripo/model';

interface OcrStrategy {
  method: 'ocrmac' | 'vlm'; // OCR method
  ocrLanguages?: string[]; // OCR languages
  detectedLanguages?: Bcp47LanguageTag[]; // Detected BCP-47 language tags
  reason: string; // Reason for strategy selection
  sampledPages: number; // Number of sampled pages
  totalPages: number; // Total pages in document
  koreanHanjaMixPages?: number[]; // Pages with Korean-Hanja mixed script
}
```

### Token Usage Types

Types for tracking LLM token usage across processing phases.

```typescript
import type {
  ComponentUsageReport,
  ModelUsageDetail,
  PhaseUsageReport,
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
}

interface TokenUsageSummary {
  inputTokens: number; // Input token count
  outputTokens: number; // Output token count
  totalTokens: number; // Total token count
}
```

### BCP-47 Language Tag Utilities

Utilities for working with BCP-47 language tags.

```typescript
import {
  type Bcp47LanguageTag,
  BCP47_LANGUAGE_TAGS,
  BCP47_LANGUAGE_TAG_SET,
  isValidBcp47Tag,
  normalizeToBcp47,
} from '@heripo/model';

// Bcp47LanguageTag - Union type of supported BCP-47 language tags
type Bcp47LanguageTag = 'ko' | 'en' | 'ja' | 'zh' | /* ... */ string;

// BCP47_LANGUAGE_TAGS - Const array of 30 supported tags
const BCP47_LANGUAGE_TAGS: readonly Bcp47LanguageTag[];

// BCP47_LANGUAGE_TAG_SET - ReadonlySet for O(1) lookup
const BCP47_LANGUAGE_TAG_SET: ReadonlySet<string>;

// isValidBcp47Tag - Check if a string is a valid BCP-47 tag
function isValidBcp47Tag(tag: string): tag is Bcp47LanguageTag;

// normalizeToBcp47 - Normalize a language string to BCP-47 format
function normalizeToBcp47(tag: string): Bcp47LanguageTag | undefined;
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
import type { ProcessedImage, ProcessedTable } from '@heripo/model';

function hasCaption(
  resource: ProcessedImage | ProcessedTable,
): resource is ProcessedImage | ProcessedTable {
  return resource.caption !== undefined;
}

// Usage
const resourcesWithCaptions = [...doc.images, ...doc.tables].filter(hasCaption);
```

## Related Packages

- [@heripo/pdf-parser](../pdf-parser) - PDF parsing and OCR
- [@heripo/document-processor](../document-processor) - Document structure analysis

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
