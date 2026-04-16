# heripo engine

> TypeScript library for extracting structured data from archaeological excavation report PDFs

[![CI](https://github.com/heripo-lab/heripo-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/heripo-lab/heripo-engine/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.9--3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10-orange)](https://pnpm.io)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

**English** | [한국어](./README.ko.md)

> ⚠️ **macOS Only**: This project currently supports only macOS (Apple Silicon or Intel).
> See [@heripo/pdf-parser README](./packages/pdf-parser/README.md#prerequisites) for detailed system requirements.

> ℹ️ **Notes (v0.1.x)**:
>
> - **Mixed Script Detection**: Korean-Hanja mixed documents are automatically detected and corrected via VLM (Vision Language Model)
> - **TOC Dependency**: Reports without a TOC will fail (intentional). Rare extraction failures will be addressed via human intervention
> - **Vertical Text**: Old vertical-text documents with Chinese numeral page numbers are a long-term goal, not currently scheduled

> 🌐 **Online Demo**: Try it without local installation → [engine-demo.heripo.com](https://engine-demo.heripo.com)

## Table of Contents

- [Introduction](#introduction)
  - [About heripo lab](#about-heripo-lab)
  - [Why heripo engine?](#why-heripo-engine)
  - [Data Pipeline](#data-pipeline)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Packages](#packages)
- [Usage Examples](#usage-examples)
- [Demo Application](#demo-application)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Citation and Attribution](#citation-and-attribution)
- [License](#license)

## Introduction

heripo engine is a collection of tools for analyzing archaeological excavation report PDFs and extracting structured data. It is designed to effectively process documents that span hundreds of pages and contain complex layouts, tables, diagrams, and photographs.

### About heripo lab

heripo lab is an open-source R&D group that combines archaeological domain knowledge with software engineering expertise to drive practical research efficiency.

#### Kim, Hongyeon (Lead Engineer)

- Role: Design of LLM-based unstructured data extraction pipeline and system implementation
- Background: Software Engineer (B.S. in Computer Science and B.A. in Archaeology)
- Research:
  - A Study on Archaeological Informatization Using Large Language Models (LLMs): Proof of Concept for an Automated Metadata Extraction Pipeline from Archaeological Excavation Reports (2025, _Heritage: History and Science_ Vol. 58 No. 3, KCI Listed)
    - DOI: [10.22755/kjchs.2025.58.3.34](https://doi.org/10.22755/KJCHS.2025.58.3.34)
    - [Korean Original](https://koreascience.kr/article/JAKO202570361249829.page)
    - [Official English Version (PDF)](<https://files.heripo.com/archaelogical-informatization-poc/(Eng._Version)_KIM_Hongyeon_2025_A_Study_on_Archaeological_Informatization_Using_Large_Language_Models.pdf>)

#### Cho, Hayoung (Domain Researcher)

- Role: Archaeological data ontology design, data schema definition, and academic validation
- Background: Ph.D. Student in Archaeology, M.A. in Cultural Informatics
- Research:
  - Considerations for Structuring Maritime Cultural Heritage Data (2025, _Journal of the Island Culture_ No. 66, KCI Listed)
    - DOI: [10.22917/island.2025..66.271](https://doi.org/10.22917/island.2025..66.271)
  - [Semantic Data Design for Maritime Cultural Heritage: Focusing on Ancient Shipwrecks and Wooden Tablets Excavated from the Taean Mado waters](https://lib.aks.ac.kr/#/search/detail/1036933) (2025, Master's Thesis)

#### Kim, Gaeun (Software Engineer)

- Role: Development of archaeology research platforms
- Background:
  - Software Engineer
  - M.A. in Archaeology (Coursework Completed)
  - B.A. in Archaeology
  - B.A. in Library and Information Science

### Why heripo engine?

Archaeological excavation reports contain valuable cultural heritage information, but are often available only in PDF format, making systematic analysis and utilization difficult. heripo engine solves the following problems:

- **OCR Quality**: High accuracy recognition of scanned documents using Docling SDK
- **Structure Extraction**: Automatic identification of document structure including table of contents, chapters/sections, images, and tables
- **Cost Efficiency**: Cost savings through local processing instead of cloud OCR (free)

> **Beyond Archaeology**: While heripo engine is optimized for archaeological reports, its PDF structuring capabilities (text, tables, images, TOC extraction) work well with heavily damaged scanned PDFs and documents from other domains (architecture, history, etc.). Feel free to fork and adapt it to your needs.

### Data Pipeline

```
Raw Data Extraction → Archaeological Data Ledger → Archaeological Data Standard → Domain Ontology → DB Storage
```

| Stage                   | Description                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Raw Data Extraction** | Document data structurally extracted in the original format of PDF reports (no archaeological interpretation) |
| **Data Ledger**         | Immutable ledger structured using a universal model covering global archaeology                               |
| **Data Standard**       | Extensible standard model (base standard → country-specific → domain-specific extensions)                     |
| **Ontology**            | Domain-specific semantic models and knowledge graphs                                                          |
| **DB Storage**          | Independent storage and utilization for each pipeline stage                                                   |

**Current Implementation (v0.1.x):**

- ✅ PDF parsing and OCR (Docling SDK)
- ✅ Document structure extraction (TOC, chapters/sections, page mapping)
- ✅ Image/table extraction and caption parsing

**Planned Stages:**

- 🔜 Immutable Ledger (universal archaeological model, concept extraction)
- 🔜 Extensible Standardization (hierarchical standard model, normalization)
- 🔜 Ontology (semantic model, knowledge graph)
- 🔜 Production Ready (performance optimization, API stability)

For a detailed roadmap, see [docs/roadmap.md](./docs/roadmap.md).

## Key Features

### PDF Parsing (`@heripo/pdf-parser`)

- **High-Quality OCR**: Document recognition using Docling SDK (ocrmac / Apple Vision Framework)
- **Mixed Script Auto-Detection & Correction**: Automatically detects Korean-Hanja mixed pages and corrects them via VLM — ocrmac excels at speed and quality for large-scale processing, but cannot handle mixed character systems, so only affected pages are targeted for VLM correction
- **Apple Silicon Optimized**: GPU acceleration on M1/M2/M3/M4/M5 chips
- **Automatic Environment Setup**: Automatic Python virtual environment and docling-serve installation
- **Image Extraction**: Automatic extraction and saving of images from PDFs

### Document Processing (`@heripo/document-processor`)

- **TOC Extraction**: Automatic TOC recognition with rule-based + LLM fallback
- **Hierarchical Structure**: Automatic generation of chapter/section/subsection hierarchy
- **Page Mapping**: Actual page number mapping using Vision LLM
- **Caption Parsing**: Automatic parsing of image and table captions
- **LLM Flexibility**: Support for various LLMs including OpenAI, Anthropic, Google

### Data Models (`@heripo/model`)

- **ProcessedDocument**: Intermediate data model optimized for LLM analysis
- **DoclingDocument**: Raw output format from Docling SDK
- **Type Safety**: Complete TypeScript type definitions

## Architecture

heripo engine is organized as a pnpm workspace-based monorepo.

```
heripo-engine/
├── packages/              # Core libraries
│   ├── pdf-parser/        # PDF → DoclingDocument
│   ├── document-processor/ # DoclingDocument → ProcessedDocument
│   ├── model/             # Data models and type definitions
│   └── shared/            # Internal utilities (not published)
├── apps/                  # Applications
│   └── demo-web/          # Next.js web demo
└── tools/                 # Build tool configurations
    ├── logger/            # Logging utility (not published)
    ├── tsconfig/          # Shared TypeScript config
    ├── tsup-config/       # Build config
    └── vitest-config/     # Test config
```

For detailed architecture explanation, see [docs/architecture.md](./docs/architecture.md).

## Installation

### System Requirements

- **macOS** (Apple Silicon or Intel)
- **Node.js** >= 24.0.0
- **pnpm** >= 10.0.0
- **Python** 3.9 - 3.12 (⚠️ Python 3.13+ is not supported)
- **jq** (JSON processing tool)
- **poppler** (PDF text extraction tools)

```bash
# Install Python 3.11 (recommended)
brew install python@3.11

# Install jq
brew install jq

# Install poppler
brew install poppler

# Install Node.js and pnpm
brew install node
npm install -g pnpm
```

For detailed installation guide, see [@heripo/pdf-parser README](./packages/pdf-parser/README.md#prerequisites).

### Package Installation

```bash
# Install individual packages
pnpm add @heripo/pdf-parser
pnpm add @heripo/document-processor
pnpm add @heripo/model

# Or install all at once
pnpm add @heripo/pdf-parser @heripo/document-processor @heripo/model
```

## Packages

| Package                                                     | Version | Description                                    |
| ----------------------------------------------------------- | ------- | ---------------------------------------------- |
| [@heripo/pdf-parser](./packages/pdf-parser)                 | 0.1.x   | PDF parsing and OCR                            |
| [@heripo/document-processor](./packages/document-processor) | 0.1.x   | Document structure analysis and LLM processing |
| [@heripo/model](./packages/model)                           | 0.1.x   | Data models and type definitions               |

## Usage Examples

### Basic Usage

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { DocumentProcessor } from '@heripo/document-processor';
import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';

const logger = Logger(...);

// 1. PDF Parsing
const pdfParser = new PDFParser({
  port: 5001,
  logger,
});

await pdfParser.init();

const tokenUsageReport = await pdfParser.parse(
  'path/to/report.pdf',
  'report-001',
  async (outputPath) => {
    // 2. Document Processing (inside callback)
    const processor = new DocumentProcessor({
      logger,
      fallbackModel: anthropic('claude-opus-4-5'),
      pageRangeParserModel: openai('gpt-5.2'),
      tocExtractorModel: openai('gpt-5.1'),
      captionParserModel: openai('gpt-5-mini'),
      textCleanerBatchSize: 10,
      captionParserBatchSize: 5,
      captionValidatorBatchSize: 5,
    });

    const { document, usage } = await processor.process(
      doclingDocument,
      'report-001',
      outputPath,
    );

    // 3. Use Results
    console.log('TOC:', document.chapters);
    console.log('Images:', document.images);
    console.log('Tables:', document.tables);
    console.log('Footnotes:', document.footnotes);
    console.log('Token Usage:', usage.total);
  },
  true, // cleanupAfterCallback
  {}, // PDFConvertOptions
);

// Cleanup
await pdfParser.dispose();
```

### Advanced Usage

```typescript
// Specify LLM models per component + fallback retry
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'), // For retry on failure
  pageRangeParserModel: openai('gpt-5.2'),
  tocExtractorModel: openai('gpt-5.1'),
  validatorModel: openai('gpt-5.2'),
  visionTocExtractorModel: openai('gpt-5-mini'),
  captionParserModel: openai('gpt-5-nano'),
  textCleanerBatchSize: 20,
  captionParserBatchSize: 10,
  captionValidatorBatchSize: 10,
  maxRetries: 3,
  enableFallbackRetry: true, // Automatically retry with fallbackModel on failure (default: false)
  onTokenUsage: (report) => console.log('Token usage:', report.total),
});
```

## Demo Application

### Online Demo

Try it without local installation:

**🔗 https://engine-demo.heripo.com**

> The online demo has a daily usage limit (3 times). For full functionality, local execution is recommended.

### Web Demo (Next.js)

A web application providing real-time PDF processing monitoring:

```bash
cd apps/demo-web
cp .env.example .env
# Set LLM API keys in .env file

pnpm install
pnpm dev
```

Access http://localhost:3000 in your browser

**Key Features:**

- PDF upload and processing option configuration
- Real-time processing status monitoring (SSE)
- Processing result visualization (TOC, images, tables)
- Job queue management

For detailed usage, see [apps/demo-web/README.md](./apps/demo-web/README.md).

## Documentation

- [Architecture Document](./docs/architecture.md) - System design and structure
- [Roadmap](./docs/roadmap.md) - Development plans and vision
- [Contributing Guide](./CONTRIBUTING.md) - How to contribute
- [Security Policy](./SECURITY.md) - Vulnerability reporting procedure
- [Code of Conduct](./CODE_OF_CONDUCT.md) - Community code of conduct

### Package Documentation

- [@heripo/pdf-parser](./packages/pdf-parser/README.md)
- [@heripo/document-processor](./packages/document-processor/README.md)
- [@heripo/model](./packages/model/README.md)

## Roadmap

Current version: **v0.1.x** (Initial Release)

### v0.1.x - Raw Data Extraction (Current)

- ✅ PDF parsing with OCR
- ✅ Document structure extraction (TOC, chapters/sections)
- ✅ Image/table extraction
- ✅ Page mapping
- ✅ Caption parsing

### v0.2.x - Immutable Ledger

- Universal data model design covering global archaeology
- Archaeological concept extraction (features, artifacts, strata, excavation units)
- LLM-based information extraction pipeline

### v0.3.x - Extensible Standardization

- Hierarchical standard model design (base → country-specific → domain-specific)
- Normalization pipeline
- Data validation

### v0.4.x - Ontology

- Domain-specific semantic models
- Knowledge graph construction

### v1.0.x - Production Ready

- Performance optimization
- API stability guarantee
- Comprehensive testing

For details, see [docs/roadmap.md](./docs/roadmap.md).

## Development

### Monorepo Commands

```bash
# Install dependencies
pnpm install

# Build all
pnpm build

# Type check
pnpm typecheck

# Lint
pnpm lint
pnpm lint:fix

# Format
pnpm format
pnpm format:check

# Run all tests
pnpm test
pnpm test:coverage
pnpm test:ci

# Test specific package
pnpm --filter @heripo/pdf-parser test
pnpm --filter @heripo/document-processor test
```

### Package-Specific Commands

```bash
# Build specific package
pnpm --filter @heripo/pdf-parser build

# Test specific package (with coverage)
pnpm --filter @heripo/pdf-parser test:coverage

# Watch mode for specific package
pnpm --filter @heripo/pdf-parser dev
```

## Contributing

Thank you for contributing to the heripo engine project! For contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).

### How to Contribute

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

### Development Guidelines

- All tests must pass (`pnpm test`)
- 100% code coverage must be maintained
- ESLint and Prettier rules must be followed
- Commit messages must follow Conventional Commits

## Community

- **Issue Tracker**: [GitHub Issues](https://github.com/heripo-lab/heripo-engine/issues)
- **Discussions**: [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)
- **Security Vulnerabilities**: See [Security Policy](./SECURITY.md)

## Citation and Attribution

If you use this project in research, services, or derivative works, please include the following attribution:

```
Powered by heripo engine
```

Such attribution helps support the open-source project and gives credit to contributors.

### BibTeX Citation

For academic papers or research documents, you may use the following BibTeX entry:

```bibtex
@software{heripo_engine,
  author = {Kim, Hongyeon and Cho, Hayoung and Kim, Gaeun},
  title = {heripo engine: TypeScript Library for Extracting Structured Data from Archaeological Excavation Report PDFs},
  year = {2026},
  url = {https://github.com/heripo-lab/heripo-engine},
  note = {Apache License 2.0}
}
```

## License

This project is distributed under the [Apache License 2.0](./LICENSE).

## Acknowledgments

This project uses the following open-source projects:

- [Docling SDK](https://github.com/DS4SD/docling) - PDF parsing and OCR
- [Vercel AI SDK](https://sdk.vercel.ai) - LLM integration

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
