# heripo engine Roadmap

**English** | [한국어](./roadmap.ko.md)

## Vision

Extract structured data from archaeological excavation report PDFs, normalize to standard formats, and store in databases to enable systematic analysis and utilization.

## Data Pipeline

```
Raw Data Extraction → Archaeological Data Ledger → Archaeological Data Standard → Domain Ontology → DB Storage
```

Each stage:

1. **Raw Data Extraction**: **Document data** structurally extracted in the original format of PDF reports
   - DoclingDocument: Text, tables, and image information extracted from PDF
   - ProcessedDocument: Document refined into TOC/chapter/page structure
   - Extracts only document structure without archaeological interpretation
2. **Archaeological Data Ledger**: **Immutable ledger** structured using a universal model covering global archaeology
   - Universal archaeological concept model regardless of region/period/domain
   - Transforms document data into archaeological concepts (features, artifacts, strata, etc.)
   - Designed for normalization although pre-standardization
3. **Archaeological Data Standard**: Data normalized into extensible standard models
   - Base standard: Country/region-specific base standards like Korean Archaeology Standard
   - Extended standards: Domain-specific extensions like Silla Tumuli Standard, Baekje Pottery Standard
   - Various sub-standards can be created as needed
4. **Domain Ontology**: Domain-specific semantic models
   - Ontology-based semantic search
   - Knowledge graph construction
5. **DB Storage**: Independent storage and utilization possible for each pipeline stage
   - Data at each stage is managed separately with its own purpose of use

## Current Status (0.2.0)

The raw data extraction stage (v0.1.x) is complete. Release 0.2.0 adds the first implementation of the immutable ledger stage (v0.2.x) in the new published package `@heripo/ledger-extractor`. The ledger format `archaeology-ledger.v1` is experimental.

### ℹ️ Current Notes

| Item                  | Description                                                                                                                | Status          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **OCR Correction**    | OCR is fixed to ocrmac; VLM text/table-cell correction runs on every page after Docling conversion, regardless of language | ✅ Resolved     |
| **TOC Dependency**    | Reports without a TOC will fail (intentional). Rare extraction failures will be addressed via human intervention           | 📋 As designed  |
| **Vertical Text**     | Old documents with vertical text and Chinese numeral page numbers (long-term goal, not currently scheduled)                | 📅 Long-term    |
| **Ledger Validation** | Ledger stages were developed and measured on three reports only (Taean Mado, Buyeo Hwajisan, Geoje Sadeungseong)           | ⚠️ Limited      |
| **Ledger Format**     | `archaeology-ledger.v1` is experimental; fields, review items and prompts may change within 0.2.x without a migration path | 🧪 Experimental |

### ✅ Implemented

#### v0.1.x - Raw Data Extraction

**PDF Parsing and OCR**

- PDF parsing using Docling SDK
- Apple Silicon OCR fixed to ocrmac (Apple Vision Framework)
- High-quality Korean document recognition
- Mandatory VLM correction — ocrmac is excellent for large-scale processing (free, GPU-accelerated, high quality), and every page with text or table content then receives VLM text and table-cell correction (Hanja restoration, script-aware OCR fixes); optional page-gated structural review and table correction
- Automatic image extraction

**Document Structure Extraction**

- Rule-based + LLM fallback TOC extraction
  - TocFinder: Keyword and structure analysis
  - VisionTocExtractor: Vision LLM fallback
  - TocExtractor: Hierarchical structure extraction
- Page range mapping (Vision LLM)
- Chapter hierarchy generation

**Resource Processing**

- Image extraction and caption parsing
- Table extraction and caption parsing
- LLM-based validation (TocContentValidator, CaptionValidator)

**LLM Integration**

- Vercel AI SDK integration
- Multi-LLM provider support (OpenAI, Anthropic, Google, Together AI, Ollama, LM Studio)
- Fallback retry mechanism
- Token usage tracking

#### 0.2.0 - Immutable Ledger (first implementation, `@heripo/ledger-extractor`)

**Input and Source Lookup**

- Runtime validation of a `ProcessedDocument` and a bounded extraction preview
- Whole-document resource index (chapters, text blocks, images, tables, grid cells, footnotes) without LLM calls

**Report Profile**

- Deterministic report signals plus one LLM router call that judges report traits and proposes the investigation scope
- Code completion of the proposed scope; a person can inject a profile and scope as JSON instead

**Investigation Object Registry**

- Per-chapter-unit candidate discovery (site, area, trench, layer, feature, artifact, shipwreck, unknown) with exact source quotes
- Duplicate review: code-decided merges first, then LLM review of the remaining candidates; uncertain identities become review items
- Frozen candidate registry: every ledger record comes from one registry entry

**Content and Relations**

- Thin per-unit content attachment: two runs per unit, targets returned by every run are confirmed automatically, disagreements and area targets go to review, and a tie-break run is added where the runs disagree
- Parent hierarchy: code-decided parents from find-spot phrases and table rows, a three-run LLM judgment for the remaining questions (set only when all runs agree), and place-alias tables a person can inject or a two-run LLM proposal can supply
- Figure and photo references, table and text attributes, rule-based record links, and layer mentions kept as relation candidates

**Ledger Assembly and Validation**

- `archaeology-ledger.v1`: records, sources, attributes, media references, links, review items and issues, assembled deterministically from saved model results
- Ledger validation against the source document (structure, hierarchy, source spans, value fidelity)
- Every record keeps original source text and source references; model output is inspected but never repaired, and unresolved decisions become review items for a person
- Spend guard (`createSpendGuard`, from `@heripo/shared`) holding hard caps on calls and tokens

**Demo**

- The demo web app runs the whole ledger pipeline with a model per step (default Claude Haiku 5.5; local models via LM Studio are possible) and shows the resulting ledger
- CLI batch runner (`pnpm --filter @heripo/demo-web ledger:batch`) for many processed documents with per-report and per-batch caps, using the Anthropic Message Batches API for Anthropic models by default
- Measured on one report (Taean Mado, Claude Haiku 5.5): about US$0.33 per run with about 15 review items

## Planned Features

### v0.2.x - Data Ledger

**Goal**: Generate **immutable ledger** structured using a universal model covering global archaeology

**Status**: 🚧 In progress — first implementation released in 0.2.0 (`@heripo/ledger-extractor`, experimental `archaeology-ledger.v1`)

**Design Philosophy:**

- **Universality**: Model that can accommodate archaeological data worldwide regardless of region/period/domain
- **Immutability**: Once recorded, ledger data is not modified and faithfully reflects source document content
- **Normalization-Ready**: Designed with a structure that enables normalization as foundation data for standardization

**Key Tasks:**

1. **Universal Schema Design** — 🚧 Partial
   - ✅ Experimental `archaeology-ledger.v1`: records of eight kinds (site, area, trench, layer, feature, artifact, shipwreck, unknown) with sources, attributes, media references, links and review items
   - ✅ Report profile with an open trait list (`x-` prefixed traits for new report kinds)
   - 📋 Finalize the universal schema and a stable format across 0.2.x releases

2. **Archaeological Concept Extraction Pipeline** — ✅ First implementation
   - ✅ Feature, artifact, layer (stratum), area and trench extraction as source-backed candidates with duplicate review
   - ✅ Parent hierarchy (code-decided, LLM judgment, injectable place aliases)
   - 📋 Validation on more reports and report types beyond the three development reports

3. **Enhanced Table Parsing** — 🚧 Partial
   - ✅ Table attributes from record-owned rows and key–value tables (logical grid, merged headers)
   - ✅ Relation columns turned into record links
   - 📋 Support for more report formats

4. **LLM-Based Information Extraction** — 🚧 Partial
   - ✅ Archaeological object discovery and content attachment from text and tables
   - ✅ Figure and photo references from captions and text
   - ✅ Rule-based record links (overlap, cutting, adjacency, distance) and layer mentions as relation candidates
   - 📋 Fuller relation extraction (including relations from layer mentions)

5. **Data Model Implementation** — 🚧 Partial
   - ✅ `ArchaeologyLedgerResult` (`archaeology-ledger.v1`) and extensible record kinds
   - ✅ Ledger validation and review items
   - 📋 Human review UI for review items (the demo currently only shows review flags)

**Current Output (experimental `archaeology-ledger.v1`, may change within 0.2.x):**

```typescript
// Simplified; see @heripo/ledger-extractor for the full types
interface ArchaeologyLedgerResult {
  ledger: ArchaeologyLedger; // Header: versions, profile, validation/review status
  records: LedgerRecord[]; // Investigation objects with original content excerpts
  sources: LedgerRecordSource[]; // Where each excerpt occurs (page, chapter, span, sourceRef)
  attributes: LedgerRecordAttribute[]; // Values from tables and text, kept as written
  mediaReferences: LedgerMediaReference[]; // Figures and photos linked to records
  mediaCandidates: LedgerMediaCandidate[];
  layerMentions: LedgerLayerMention[]; // Relation candidates
  links: LedgerRecordLink[]; // Relations between records
  pending: ArchaeologyLedgerPendingPart[];
  reviewItems: LedgerReviewItem[]; // Decisions left to a person
  issues: LedgerExtractionIssue[];
}
```

### v0.3.x - Standardization

**Goal**: Normalize ledger data into extensible standard models

**First step**: Standard-model extraction from ledger data (starting with 0.3.0)

**Design Philosophy:**

Standard data is designed as a **hierarchical extension model**:

```
Base Standard
└── Regional Standard (Country/Region)
    └── Domain Extension Standard
```

**Standard Hierarchy Examples:**

| Level             | Examples                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Base Standard     | Universal Archaeology Standard                                                                  |
| Regional Standard | Korean Archaeology Standard, Japanese Archaeology Standard, UK Archaeology Standard, etc.       |
| Domain Extension  | Silla Tumuli Standard, Baekje Pottery Standard, Mahan Burial Standard, Gaya Iron Standard, etc. |

**Key Tasks:**

1. **Extensible Standard Format Design**
   - Base standard: Global common archaeological terminology and classification systems
   - Regional standards: Extensions based on regional archaeological glossaries
   - Domain extension standards: Standards specialized for specific periods/sites/artifact types
   - _Detailed standard schemas to be finalized_

2. **Normalization Pipeline**
   - Ledger data → Base standard conversion
   - Base standard → Regional standard extension
   - Apply domain extension standards as needed
   - Unit standardization, period classification standardization

3. **Data Validation**
   - Required field validation per standard level
   - Data format validation
   - Referential integrity validation

4. **Mapping Rules**
   - Ledger terminology → Standard terminology mapping
   - LLM-based ambiguous case handling
   - Community-contributed mapping rule expansion

**Expected Output (Reference Example, Detailed Structure TBD):**

```typescript
// The following is a conceptual example and may change in actual implementation
interface StandardArchaeologyData {
  reportId: string;
  baseStandard: string; // Applied base standard
  regionalStandard?: string; // Applied regional standard
  domainExtensions?: string[]; // Applied domain extension standards
  standardFeatures: StandardFeature[];
  standardArtifacts: StandardArtifact[];
  standardStrata: StandardStratum[];
  validationResults: ValidationResult[];
  // Detailed fields to be finalized
}
```

### v0.4.x - Domain Ontology

**Goal**: Build domain-specific semantic models and knowledge graphs

**Key Tasks:**

1. **Ontology Design**
   - Archaeological domain ontologies (prehistoric, historical, industrial, etc.)
   - Period-specific models
   - Region-specific models
   - _Detailed ontology structure to be finalized_

2. **Relationship Inference**
   - Feature-artifact relationships
   - Stratum-period relationships
   - Spatial relationships (excavation unit-feature)
   - Knowledge graph construction

3. **Semantic Search**
   - Ontology-based semantic queries
   - Similar feature/artifact search
   - Distribution pattern analysis
   - _Detailed search features to be finalized_

### v1.0.x - Production Ready

**Goal**: Stable and scalable production system

**Key Tasks:**

1. **Performance Optimization**
   - Large PDF processing optimization
   - LLM call optimization (batching, caching)
   - Parallel processing improvements

2. **API Stability**
   - Strict version management
   - Minimal breaking changes
   - Comprehensive error handling

3. **Test Coverage**
   - End-to-end testing
   - Enhanced integration testing
   - Performance testing

4. **Operations Tools**
   - Monitoring and logging
   - Error reporting
   - Performance profiling

5. **Documentation**
   - Complete API reference
   - Tutorials and guides
   - Best practices

6. **Community**
   - Plugin system
   - Extension point documentation
   - Enhanced contributor guide

## Future Vision

### v2.0+ - Advanced Features

- **Multi-language Support**: English, Chinese, Japanese report processing
- **3D Data Processing**: Diagram and 3D scan data integration
- **Time-series Analysis**: Comparative analysis across multiple reports
- **GIS Integration**: Spatial data visualization and analysis
- **Automatic Report Generation**: Automatic summarization based on extracted data

### Community Contributions Welcome

heripo engine welcomes diverse contributions from the global archaeology community. Anyone can participate regardless of country, region, or cultural background.

#### 🌍 Regional Standard Contributions

Build regional archaeological standards together from around the world:

- **East Asia**: Korea, Japan, China, Taiwan, Mongolia
- **Southeast Asia**: Vietnam, Thailand, Cambodia, Indonesia, Philippines
- **South Asia**: India, Pakistan, Sri Lanka, Nepal
- **Central Asia**: Uzbekistan, Kazakhstan, Kyrgyzstan
- **Middle East & Western Asia**: Iran, Iraq, Turkey, Israel, Jordan, Egypt
- **Europe**: UK, France, Germany, Italy, Spain, Greece, Northern Europe
- **Africa**: Egypt, Ethiopia, South Africa, Kenya
- **Americas**: USA, Mexico, Peru, Brazil, Argentina
- **Oceania**: Australia, New Zealand, Polynesia

#### 🏛️ Domain Ontology Contributions

Build ontologies for various periods and domains together:

- **By Period**: Prehistoric, Bronze Age, Iron Age, Ancient, Medieval, Modern
- **By Site Type**: Habitation, Burial, Production, Fortification, Religious
- **By Artifact Type**: Pottery, Stone tools, Metal, Wood, Glass, Textiles
- **Special Domains**: Maritime archaeology, Industrial archaeology, Urban archaeology, Environmental archaeology

#### 🌐 Multi-language Support Contributions

Extend the system in various languages:

- Korean, English, Chinese (Simplified/Traditional), Japanese
- Arabic, Persian, Hebrew
- Spanish, Portuguese, French, German, Italian
- Hindi, Tamil, Bengali
- Russian, Polish, Czech

#### 🔧 Technical Contributions

- New LLM provider integration
- Additional document format support beyond PDF (DOCX, HTML, XML, etc.)
- Linux/Windows platform support
- Domain-specific processor development
- Performance optimization and bug fixes
- Documentation and translation

## Milestones

| Version | Goal                       | Key Features                                       | Status                                             |
| ------- | -------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| v0.1.x  | Raw Data Extraction        | PDF parsing, document structure extraction         | ✅ Complete                                        |
| v0.2.x  | Immutable Ledger           | Universal archaeological model, concept extraction | 🚧 In progress (first release 0.2.0, experimental) |
| v0.3.x  | Extensible Standardization | Hierarchical standard model, normalization         | 🔜 Planned                                         |
| v0.4.x  | Ontology                   | Semantic model, knowledge graph                    | 🔜 Planned                                         |
| v1.0.x  | Production                 | Performance, stability, documentation              | 🔜 Planned                                         |

## Feedback and Suggestions

Feedback on the roadmap or new feature suggestions are welcome at [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)!

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
