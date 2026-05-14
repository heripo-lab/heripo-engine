# @heripo/model

> 문서 모델 및 타입 정의

[![npm version](https://img.shields.io/npm/v/@heripo/model.svg)](https://www.npmjs.com/package/@heripo/model)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 전체 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

`@heripo/model`은 heripo engine에서 사용하는 데이터 모델과 TypeScript 타입 정의를 제공합니다.

## 목차

- [개요](#개요)
- [설치](#설치)
- [데이터 모델](#데이터-모델)
- [사용법](#사용법)
- [후원](#후원)
- [라이선스](#라이선스)

## 개요

heripo engine의 데이터 처리 파이프라인:

```
DoclingDocument (Docling SDK 원시 출력)
    ↓
ProcessedDocument (LLM 최적화 중간 모델)
    ↓
(로드맵에 따라 이후 다양한 모델 추가 예정)
```

`@heripo/model`은 현재 PDF 파싱 및 문서 구조 추출 단계에서 사용되는 데이터 모델을 정의합니다. 향후 고고학 데이터 분석, 표준화, 시맨틱 모델링 등 다양한 분야별 모델이 추가될 예정입니다.

## 설치

```bash
# npm으로 설치
npm install @heripo/model

# pnpm으로 설치
pnpm add @heripo/model

# yarn으로 설치
yarn add @heripo/model
```

## 데이터 모델

### DoclingDocument

Docling SDK의 원시 출력 형식입니다.

```typescript
import type { DoclingDocument } from '@heripo/model';
```

**주요 필드:**

- `schema_name`, `version`, `name`: Docling 문서 식별 필드
- `origin`: 원천 파일 metadata
- `body`, `furniture`, `groups`: 문서 트리 및 그룹 구조
- `texts`, `pictures`, `tables`: 추출된 content node
- `pages`: 페이지 metadata와 렌더링된 페이지 이미지 참조

### ProcessedDocument

LLM 분석에 최적화된 중간 데이터 모델입니다.

```typescript
import type { ProcessedDocument } from '@heripo/model';

interface ProcessedDocument {
  reportId: string; // 리포트 ID
  schemaVersion?: string; // 처리된 문서 schema version
  source?: ProcessedDocumentSource; // 원천 Docling artifact metadata
  pageRangeMap: Record<number, PageRange>; // PDF 페이지 → 문서 페이지 매핑
  chapters: Chapter[]; // 계층적 챕터 구조
  images: ProcessedImage[]; // 추출된 이미지 메타데이터
  tables: ProcessedTable[]; // 추출된 테이블 데이터
  footnotes: ProcessedFootnote[]; // 추출된 각주
}
```

### ProcessedDocumentSource

처리된 문서를 만들 때 사용한 Docling JSON의 원천 artifact metadata입니다.

```typescript
import type { ProcessedDocumentSource } from '@heripo/model';

interface ProcessedDocumentSource {
  pipelineRunId?: string; // 처리 pipeline run ID
  doclingObjectKey?: string; // result.json 또는 병합된 Docling JSON object key
  doclingSha256?: string; // Docling JSON artifact의 SHA-256 hash
  handoffManifestObjectKey?: string; // handoff manifest object key
}
```

### Chapter

문서의 계층적 섹션 구조입니다.

```typescript
import type { Chapter } from '@heripo/model';

interface Chapter {
  id: string; // 챕터 ID
  title: string; // 챕터 제목
  originTitle: string; // 원본 제목
  level: number; // 계층 레벨 (1, 2, 3, ...)
  pageNo: number; // 시작 페이지 번호
  sourceRefs?: string[]; // 제목 추출에 사용된 원천 Docling ref
  textBlocks: TextBlock[]; // 텍스트 블록
  imageIds: string[]; // 이미지 ID 참조
  tableIds: string[]; // 테이블 ID 참조
  footnoteIds: string[]; // 각주 ID 참조
  children?: Chapter[]; // 하위 챕터 (선택)
}
```

### TextBlock

원자적 텍스트 단위입니다.

```typescript
import type { TextBlock } from '@heripo/model';

interface TextBlock {
  id?: string; // 안정적인 텍스트 블록 ID
  sourceRef?: string; // 원천 Docling text ref
  text: string; // 텍스트 내용
  pdfPageNo: number; // PDF 페이지 번호
}
```

### ProcessedImage

이미지 메타데이터와 참조 정보입니다.

```typescript
import type { ProcessedImage } from '@heripo/model';

interface ProcessedImage {
  id: string; // 이미지 ID
  sourceRef?: string; // 원천 Docling picture ref
  captionSourceRefs?: string[]; // 캡션 텍스트 item의 원천 Docling ref
  caption?: Caption; // 캡션 (선택)
  pdfPageNo: number; // PDF 페이지 번호
  path: string; // 이미지 파일 경로
}
```

### ProcessedTable

테이블 구조와 데이터입니다.

```typescript
import type { ProcessedTable } from '@heripo/model';

interface ProcessedTable {
  id: string; // 테이블 ID
  sourceRef?: string; // 원천 Docling table ref
  captionSourceRefs?: string[]; // 캡션 텍스트 item의 원천 Docling ref
  caption?: Caption; // 캡션 (선택)
  pdfPageNo: number; // PDF 페이지 번호
  grid: ProcessedTableCell[][]; // 2D 그리드 데이터
  numRows: number; // 행 개수
  numCols: number; // 열 개수
}
```

`grid`는 화면에 보이는 셀만 담은 compact list입니다. 병합 셀은
`rowSpan`, `colSpan`으로 표현하고, span으로 덮인 shadow cell은 포함하지
않습니다. 테이블 셀에는 의도적으로 cell-level `sourceRef`가 없습니다. 셀을
원천 테이블로 추적할 때는 `table.sourceRef`와 `grid[row][col]` 위치를 함께
사용합니다.

### ProcessedTableCell

테이블 셀 메타데이터입니다.

```typescript
import type { ProcessedTableCell } from '@heripo/model';

interface ProcessedTableCell {
  text: string; // 셀 텍스트
  rowSpan: number; // 행 병합
  colSpan: number; // 열 병합
  isHeader: boolean; // 헤더 셀 여부
}
```

### Caption

이미지 및 테이블 캡션입니다.

```typescript
import type { Caption } from '@heripo/model';

interface Caption {
  num?: string; // 캡션 번호 (예: "그림 1"의 "1")
  fullText: string; // 전체 캡션 텍스트
}
```

### PageRange

PDF 페이지와 문서 페이지 매핑입니다.

```typescript
import type { PageRange } from '@heripo/model';

interface PageRange {
  startPageNo: number; // 시작 페이지 번호
  endPageNo: number; // 끝 페이지 번호
}
```

### ProcessedFootnote

문서에서 추출된 각주입니다.

```typescript
import type { ProcessedFootnote } from '@heripo/model';

interface ProcessedFootnote {
  id: string; // 각주 ID
  sourceRef?: string; // 원천 Docling text ref
  text: string; // 각주 텍스트
  pdfPageNo: number; // PDF 페이지 번호
}
```

### DocumentProcessResult

문서 처리 결과로, 처리된 문서와 토큰 사용량 리포트를 포함합니다.

```typescript
import type { DocumentProcessResult } from '@heripo/model';

interface DocumentProcessResult {
  document: ProcessedDocument; // 처리된 문서
  usage: TokenUsageReport; // 토큰 사용량 리포트
}
```

### OcrStrategy

OCR 전략 선택 결과입니다.

```typescript
import type { OcrStrategy } from '@heripo/model';

interface OcrStrategy {
  method: 'ocrmac' | 'vlm'; // OCR 방법
  ocrLanguages?: string[]; // OCR 언어
  detectedLanguages?: Bcp47LanguageTag[]; // 감지된 BCP-47 언어 태그
  reason: string; // 전략 선택 이유
  sampledPages: number; // 샘플링된 페이지 수
  totalPages: number; // 문서 전체 페이지 수
}
```

### 토큰 사용량 타입

처리 단계별 LLM 토큰 사용량을 추적하기 위한 타입입니다.

```typescript
import type {
  ComponentUsageReport,
  ModelUsageDetail,
  PhaseUsageReport,
  TokenUsageReport,
  TokenUsageSummary,
} from '@heripo/model';

interface TokenUsageReport {
  components: ComponentUsageReport[]; // 컴포넌트별 사용량
  total: TokenUsageSummary; // 전체 사용량 요약
}

interface ComponentUsageReport {
  component: string; // 컴포넌트 이름
  phases: PhaseUsageReport[]; // 단계별 사용량
  total: TokenUsageSummary; // 컴포넌트 합계
}

interface PhaseUsageReport {
  phase: string; // 단계 이름
  primary?: ModelUsageDetail; // 기본 모델 사용량
  fallback?: ModelUsageDetail; // 폴백 모델 사용량
  total: TokenUsageSummary; // 단계 합계
}

interface ModelUsageDetail {
  modelName: string; // 모델 이름
  inputTokens: number; // 입력 토큰 수
  outputTokens: number; // 출력 토큰 수
  totalTokens: number; // 전체 토큰 수
}

interface TokenUsageSummary {
  inputTokens: number; // 입력 토큰 수
  outputTokens: number; // 출력 토큰 수
  totalTokens: number; // 전체 토큰 수
}
```

### Review Assistance 타입

`@heripo/pdf-parser`에서 `reviewAssistance`를 활성화했을 때 생성되는 선택적
page-level review assistance 결과 타입입니다.

```typescript
import type {
  ReviewAssistanceDecision,
  ReviewAssistanceIssue,
  ReviewAssistanceProgressEvent,
  ReviewAssistanceReport,
} from '@heripo/model';

interface ReviewAssistanceReport {
  schemaName: 'HeripoReviewAssistanceReport';
  version: '1.0';
  reportId: string;
  source: {
    doclingResult: 'result.json';
    ocrOriginSnapshot?: 'result_ocr_origin.json';
    originSnapshot?: 'result_review_origin.json';
  };
  summary: {
    pageCount: number;
    pagesSucceeded: number;
    pagesFailed: number;
    autoAppliedCount: number;
    proposalCount: number;
    skippedCount: number;
    issueCount: number;
  };
  pages: Array<{
    pageNo: number;
    status: 'succeeded' | 'failed';
    decisions: ReviewAssistanceDecision[];
    issues: ReviewAssistanceIssue[];
  }>;
}

interface ReviewAssistanceProgressEvent {
  substage:
    | 'review-assistance:prepare'
    | 'review-assistance:page'
    | 'review-assistance:patch'
    | 'review-assistance:write-report';
  status: 'started' | 'progress' | 'completed' | 'failed';
  reportId: string;
  pageNo?: number;
  pageCount?: number;
}
```

### BCP-47 언어 태그 유틸리티

BCP-47 언어 태그를 다루기 위한 유틸리티입니다.

```typescript
import {
  type Bcp47LanguageTag,
  BCP47_LANGUAGE_TAGS,
  BCP47_LANGUAGE_TAG_SET,
  isValidBcp47Tag,
  normalizeToBcp47,
} from '@heripo/model';

// Bcp47LanguageTag - 지원되는 전체 BCP-47 언어 태그의 유니온 타입
type Bcp47LanguageTag = (typeof BCP47_LANGUAGE_TAGS)[number];

// BCP47_LANGUAGE_TAGS - ocrmac에서 지원하는 언어 태그 상수 배열
const BCP47_LANGUAGE_TAGS: readonly Bcp47LanguageTag[];

// BCP47_LANGUAGE_TAG_SET - O(1) 조회를 위한 ReadonlySet
const BCP47_LANGUAGE_TAG_SET: ReadonlySet<string>;

// isValidBcp47Tag - 문자열이 유효한 BCP-47 태그인지 확인
function isValidBcp47Tag(tag: string): tag is Bcp47LanguageTag;

// normalizeToBcp47 - 언어 문자열을 BCP-47 형식으로 정규화
function normalizeToBcp47(tag: string): Bcp47LanguageTag | null;
```

## 사용법

### ProcessedDocument 읽기

```typescript
import type { Chapter, ProcessedDocument } from '@heripo/model';

function analyzeDocument(doc: ProcessedDocument) {
  console.log('리포트 ID:', doc.reportId);

  // 챕터 순회
  doc.chapters.forEach((chapter) => {
    console.log(`챕터: ${chapter.title} (레벨 ${chapter.level})`);
    console.log(`  텍스트 블록: ${chapter.textBlocks.length}개`);
    console.log(`  이미지: ${chapter.imageIds.length}개`);
    console.log(`  테이블: ${chapter.tableIds.length}개`);
    console.log(`  하위 챕터: ${chapter.children?.length ?? 0}개`);
  });

  // 이미지 확인
  doc.images.forEach((image) => {
    console.log(`이미지 ${image.id}:`);
    if (image.caption) {
      console.log(`  캡션: ${image.caption.fullText}`);
    }
    console.log(`  경로: ${image.path}`);
  });

  // 테이블 확인
  doc.tables.forEach((table) => {
    console.log(`테이블 ${table.id}:`);
    console.log(`  크기: ${table.numRows} × ${table.numCols}`);
    if (table.caption) {
      console.log(`  캡션: ${table.caption.fullText}`);
    }
  });
}
```

### 챕터 재귀 순회

```typescript
import type { Chapter } from '@heripo/model';

function traverseChapters(chapter: Chapter, depth: number = 0) {
  const indent = '  '.repeat(depth);
  console.log(`${indent}- ${chapter.title}`);

  // 재귀적으로 하위 챕터 순회
  chapter.children?.forEach((child) => {
    traverseChapters(child, depth + 1);
  });
}

// 사용
doc.chapters.forEach((chapter) => traverseChapters(chapter));
```

### 타입 가드

```typescript
import type { ProcessedImage, ProcessedTable } from '@heripo/model';

function hasCaption(
  resource: ProcessedImage | ProcessedTable,
): resource is ProcessedImage | ProcessedTable {
  return resource.caption !== undefined;
}

// 사용
const resourcesWithCaptions = [...doc.images, ...doc.tables].filter(hasCaption);
```

## 관련 패키지

- [@heripo/pdf-parser](../pdf-parser) - PDF 파싱 및 OCR
- [@heripo/document-processor](../document-processor) - 문서 구조 분석

## 후원

heripo lab의 오픈소스 연구를 후원하려면 다음 경로를 이용할 수 있습니다:

- [Open Collective](https://opencollective.com/heripo-project): 전반적인 프로젝트 후원
- [fairy.hada.io/@heripo](https://fairy.hada.io/@heripo): 한국인 개인 후원자를 위한 원화 결제

## 라이선스

이 패키지는 [Apache License 2.0](../../LICENSE) 라이선스 하에 배포됩니다.

## 기여하기

기여는 언제나 환영합니다! [기여 가이드](../../CONTRIBUTING.ko.md)를 참고하세요.

## 프로젝트 전체 정보

이 패키지에서 다루지 않는 프로젝트 전체 정보는 [루트 README](../../README.ko.md)에서 확인하세요:

- **인용 및 출처 표기**: 학술 인용(BibTeX) 및 출처 표기 방법
- **기여 가이드라인**: 개발 가이드라인, 커밋 규칙, PR 절차
- **커뮤니티**: 이슈 트래커, 토론, 보안 정책
- **로드맵**: 프로젝트 개발 계획

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
