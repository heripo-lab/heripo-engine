# @heripo/model

> 문서 모델 및 타입 정의

[![npm version](https://img.shields.io/npm/v/@heripo/model.svg)](https://www.npmjs.com/package/@heripo/model)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 전체 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

`@heripo/model`은 heripo engine에서 사용하는 데이터 모델과 TypeScript 타입 정의를 제공합니다.

## 목차

- [개요](#개요)
- [설치](#설치)
- [데이터 모델](#데이터-모델)
- [사용법](#사용법)
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

- `type`: 문서 타입 (예: "pdf")
- `item_index`: 아이템 인덱스
- `json_content`: 문서 내용 (JSON 객체)

### ProcessedDocument

LLM 분석에 최적화된 중간 데이터 모델입니다.

```typescript
import type { ProcessedDocument } from '@heripo/model';

interface ProcessedDocument {
  reportId: string; // 리포트 ID
  pageRangeMap: PageRange[]; // PDF 페이지 → 문서 페이지 매핑
  chapters: Chapter[]; // 계층적 챕터 구조
  images: ProcessedImage[]; // 추출된 이미지 메타데이터
  tables: ProcessedTable[]; // 추출된 테이블 데이터
}
```

### Chapter

문서의 계층적 섹션 구조입니다.

```typescript
import type { Chapter } from '@heripo/model';

interface Chapter {
  id: string; // 챕터 ID
  title: string; // 챕터 제목
  level: number; // 계층 레벨 (1, 2, 3, ...)
  pageNo?: number; // 시작 페이지 번호
  textBlocks: TextBlock[]; // 텍스트 블록
  imageIds: string[]; // 이미지 ID 참조
  tableIds: string[]; // 테이블 ID 참조
  children: Chapter[]; // 하위 챕터
}
```

### TextBlock

원자적 텍스트 단위입니다.

```typescript
import type { TextBlock } from '@heripo/model';

interface TextBlock {
  text: string; // 텍스트 내용
  pageNo?: number; // 페이지 번호
}
```

### ProcessedImage

이미지 메타데이터와 참조 정보입니다.

```typescript
import type { ProcessedImage } from '@heripo/model';

interface ProcessedImage {
  id: string; // 이미지 ID
  caption?: Caption; // 캡션 (선택)
  pdfPageNo?: number; // PDF 페이지 번호
  filePath: string; // 이미지 파일 경로
}
```

### ProcessedTable

테이블 구조와 데이터입니다.

```typescript
import type { ProcessedTable } from '@heripo/model';

interface ProcessedTable {
  id: string; // 테이블 ID
  caption?: Caption; // 캡션 (선택)
  pdfPageNo?: number; // PDF 페이지 번호
  data: ProcessedTableCell[][]; // 2D 그리드 데이터
  numRows: number; // 행 개수
  numCols: number; // 열 개수
}
```

### ProcessedTableCell

테이블 셀 메타데이터입니다.

```typescript
import type { ProcessedTableCell } from '@heripo/model';

interface ProcessedTableCell {
  text: string; // 셀 텍스트
  rowspan: number; // 행 병합
  colspan: number; // 열 병합
  isHeader: boolean; // 헤더 셀 여부
}
```

### Caption

이미지 및 테이블 캡션입니다.

```typescript
import type { Caption } from '@heripo/model';

interface Caption {
  num?: number; // 캡션 번호 (예: "그림 1"의 1)
  fullText: string; // 전체 캡션 텍스트
}
```

### PageRange

PDF 페이지와 문서 페이지 매핑입니다.

```typescript
import type { PageRange } from '@heripo/model';

interface PageRange {
  pdfPageNo: number; // PDF 페이지 번호
  pageNo: number; // 문서 논리적 페이지 번호
}
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
    console.log(`  하위 챕터: ${chapter.children.length}개`);
  });

  // 이미지 확인
  doc.images.forEach((image) => {
    console.log(`이미지 ${image.id}:`);
    if (image.caption) {
      console.log(`  캡션: ${image.caption.fullText}`);
    }
    console.log(`  경로: ${image.filePath}`);
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
  chapter.children.forEach((child) => {
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
