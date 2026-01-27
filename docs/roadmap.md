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

## Current Status (v0.1.x)

### ✅ Implemented

**PDF Parsing and OCR**

- PDF parsing using Docling SDK
- Apple Silicon GPU-accelerated OCR
- High-quality Korean document recognition
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
- Multi-LLM provider support (OpenAI, Anthropic, Google, Together)
- Fallback retry mechanism
- Token usage tracking

## Planned Features

### v0.2.x - Data Ledger

**Goal**: Generate **immutable ledger** structured using a universal model covering global archaeology

**Design Philosophy:**

- **Universality**: Model that can accommodate archaeological data worldwide regardless of region/period/domain
- **Immutability**: Once recorded, ledger data is not modified and faithfully reflects source document content
- **Normalization-Ready**: Designed with a structure that enables normalization as foundation data for standardization

**Key Tasks:**

1. **Universal Schema Design**
   - Define universal data model covering global archaeology
   - Abstract core archaeological concepts (features, artifacts, strata, excavation units, etc.)
   - Design extensible metadata structure
   - _Detailed schema to be finalized_

2. **Archaeological Concept Extraction Pipeline**
   - Feature extraction
   - Artifact extraction
   - Stratum extraction
   - Excavation unit (Trench/Unit) extraction
   - _Detailed extraction items to be finalized_

3. **Enhanced Table Parsing**
   - Automatic summary table parsing
   - Relationship table parsing
   - Support for various report formats

4. **LLM-Based Information Extraction**
   - Archaeological concept extraction from text
   - Information extraction from diagrams and photo descriptions
   - Relationship identification between concepts

5. **Data Model Implementation**
   - `ArchaeologyLedger` universal model
   - Extensible entity type definitions
   - Validation logic

**Expected Output (Reference Example, Detailed Structure TBD):**

```typescript
// The following is a conceptual example and may change in actual implementation
interface ArchaeologyLedger {
  reportId: string;
  features: Feature[]; // Features
  artifacts: Artifact[]; // Artifacts
  strata: Stratum[]; // Strata
  units: Unit[]; // Excavation units
  metadata: ReportMetadata;
  // Detailed fields to be finalized
}
```

### v0.3.x - Standardization

**Goal**: Normalize ledger data into extensible standard models

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

| Version | Goal                       | Key Features                                       | Status      |
| ------- | -------------------------- | -------------------------------------------------- | ----------- |
| v0.1.x  | Raw Data Extraction        | PDF parsing, document structure extraction         | ✅ Complete |
| v0.2.x  | Immutable Ledger           | Universal archaeological model, concept extraction | 🔜 Planned  |
| v0.3.x  | Extensible Standardization | Hierarchical standard model, normalization         | 🔜 Planned  |
| v0.4.x  | Ontology                   | Semantic model, knowledge graph                    | 🔜 Planned  |
| v1.0.x  | Production                 | Performance, stability, documentation              | 🔜 Planned  |

## Feedback and Suggestions

Feedback on the roadmap or new feature suggestions are welcome at [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)!

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
