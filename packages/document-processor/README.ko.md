# @heripo/document-processor

> LLM 기반 문서 구조 분석 및 처리 라이브러리

[![npm version](https://img.shields.io/npm/v/@heripo/document-processor.svg)](https://www.npmjs.com/package/@heripo/document-processor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 전체 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

`@heripo/document-processor`는 DoclingDocument를 ProcessedDocument로 변환하여 LLM 분석에 최적화된 형태로 만드는 라이브러리입니다.

## 목차

- [주요 기능](#주요-기능)
- [설치](#설치)
- [사용법](#사용법)
- [처리 파이프라인](#처리-파이프라인)
- [API 문서](#api-문서)
- [후원](#후원)
- [라이선스](#라이선스)

## 주요 기능

- **목차 추출**: 규칙 기반 + LLM 폴백으로 목차 자동 인식
- **계층 구조**: 장/절/소절 계층 구조 자동 생성
- **페이지 매핑**: Vision LLM을 활용한 실제 페이지 번호 매핑
- **캡션 파싱**: 이미지 및 테이블 캡션 자동 파싱
- **원천 추적성**: Docling 원천 metadata와 node-level reference 보존
- **테이블 그리드 정규화**: row/column span을 보존하고 병합 셀 shadow entry 제거
- **LLM 유연성**: OpenAI, Anthropic, Google 등 다양한 LLM 지원
- **Fallback 재시도**: 실패 시 자동으로 fallback 모델로 재시도

## 설치

```bash
# npm으로 설치
npm install @heripo/document-processor @heripo/model @heripo/logger

# pnpm으로 설치
pnpm add @heripo/document-processor @heripo/model @heripo/logger

# yarn으로 설치
yarn add @heripo/document-processor @heripo/model @heripo/logger
```

추가로 LLM 프로파이더의 SDK가 필요합니다:

```bash
# Vercel AI SDK와 프로파이더 패키지
npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

## 사용법

### 기본 사용법

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

// 기본 사용 - fallback 모델만 지정
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'),
  textCleanerBatchSize: 10,
  captionParserBatchSize: 5,
  captionValidatorBatchSize: 5,
});

// 문서 처리
const { document, usage } = await processor.process(
  doclingDocument, // PDF 파서 출력
  'report-001', // 리포트 ID
  artifactDir, // 이미지/페이지 등 parser 산출물이 있는 디렉토리
);

// 결과 사용
console.log('목차:', document.chapters);
console.log('이미지:', document.images);
console.log('표:', document.tables);
console.log('각주:', document.footnotes);
console.log('토큰 사용량:', usage.total);
```

### 고급 사용법 - 컴포넌트별 모델 지정

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

const processor = new DocumentProcessor({
  logger,
  // Fallback 모델 (실패 시 재시도용)
  fallbackModel: anthropic('claude-opus-4-5'),

  // 컴포넌트별 모델 지정
  pageRangeParserModel: openai('gpt-5.1'), // Vision 필요
  tocExtractorModel: openai('gpt-5.1'), // 구조화 출력
  validatorModel: openai('gpt-5.2'), // 간단한 검증
  visionTocExtractorModel: openai('gpt-5.1'), // Vision 필요
  captionParserModel: openai('gpt-5-mini'), // 캡션 파싱

  // 배치 크기 설정
  textCleanerBatchSize: 20, // 동기 처리 (크게 가능)
  captionParserBatchSize: 10, // LLM 호출 (중간)
  captionValidatorBatchSize: 10, // LLM 호출 (중간)

  // 재시도 설정
  maxRetries: 3,
  maxValidationRetries: 3,
  enableFallbackRetry: true, // fallback 모델로 자동 재시도 (기본값: false)
});

const { document, usage } = await processor.process(
  doclingDocument,
  'report-001',
  artifactDir,
);
```

### 수동 페이지 범위 매핑

페이지 범위 매핑을 이미 검수했다면 `process()`의 네 번째 인자로 전달해
PageRangeParser 자동 실행을 건너뛸 수 있습니다. 전달한 매핑은 추가 후처리 없이
그대로 사용됩니다.

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

### 수동 TOC 항목

목차를 이미 검수했다면 `process()`의 네 번째 인자로 `tocEntries`를 전달해
자동 TOC 추출을 건너뛸 수 있습니다. 전달한 항목은 추가 추출이나 검증 없이
그대로 사용됩니다.

```typescript
import type { TocEntry } from '@heripo/document-processor';

const tocEntries: TocEntry[] = [
  {
    title: '제1장 조사 개요',
    level: 1,
    pageNo: 1,
    children: [
      {
        title: '1. 조사 경위',
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

수동 페이지 범위 매핑과 TOC 항목을 함께 전달하면 두 자동 단계를 모두
건너뜁니다.

```typescript
const { document, usage } = await processor.process(
  doclingDocument,
  'report-001',
  artifactDir,
  { pageRangeMap, tocEntries },
);
```

### 원천 Docling 참조 보존

호출자가 원천 Docling JSON의 저장 위치나 해시를 알고 있다면 `source`로 전달할 수 있습니다. 이 값은 `ProcessedDocument.source`에 그대로 보존됩니다. `validateSourceRefs` 또는 `sourceRefValidationMode`를 사용하면 processor가 생성한 `sourceRef`, `captionSourceRefs`가 입력 `DoclingDocument`에 실제로 존재하는지 검증합니다.

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

`ProcessedDocument.source`는 처리에 사용된 Docling artifact 자체를 가리키는 문서 단위 metadata입니다. `TextBlock.sourceRef`, `Chapter.sourceRefs`, `ProcessedImage.sourceRef`, `ProcessedTable.sourceRef`, `ProcessedFootnote.sourceRef`는 해당 processed node가 어떤 Docling node에서 왔는지 가리키는 node-level 참조입니다. 이미지와 테이블의 `captionSourceRefs`는 resource node가 아니라 caption text node의 참조만 담습니다.

`sourceRefValidationMode: 'error'`는 누락된 참조가 있으면 처리를 실패시킵니다. `validateSourceRefs: true`는 호환용 단축 옵션이며, 별도 mode를 지정하지 않으면 `'error'`와 같습니다.

테이블 셀에는 cell-level `sourceRef`를 만들지 않습니다. 특정 셀의 원천 위치는 `table.sourceRef`와 `grid[row][col]`의 row/column index를 함께 사용해 추적합니다.

### 테이블 그리드 처리

처리된 테이블은 화면에 보이는 셀만 담은 compact `grid`를 제공합니다. processor는 다음을 수행합니다:

- Docling의 row/column span을 `rowSpan`, `colSpan`으로 보존
- 행/열 헤더를 `isHeader`로 표시
- Docling이 병합 셀의 덮인 영역을 반복 제공하는 경우 shadow entry 제거
- Docling의 `data.grid`가 비어 있으면 `table_cells`에서 그리드 구성

`numRows`와 `numCols`는 논리적 테이블 크기를 유지합니다. 개별 셀에는 `sourceRef`를 저장하지 않으므로, 셀의 원천 위치를 추적할 때는 `table.sourceRef`와 `grid[row][col]` 위치를 함께 사용합니다.

## 처리 파이프라인

DocumentProcessor는 다음 5단계 파이프라인으로 문서를 처리합니다:

### 1. 텍스트 정리 (TextCleaner)

- Unicode 정규화 (NFC)
- 공백 정리
- 유효하지 않은 텍스트 필터링 (숫자만 있는 텍스트, 빈 텍스트)

### 2. 페이지 범위 매핑 (PageRangeParser - Vision LLM)

- 페이지 이미지에서 실제 페이지 번호 추출
- PDF 페이지와 문서 논리적 페이지 매핑
- 스캔 오류로 인한 페이지 번호 불일치 처리

### 3. TOC 추출 (5단계 파이프라인)

#### Stage 1: TocFinder (규칙 기반)

- 키워드 검색 (목차, 차례, Contents, Table of Contents)
- 구조 분석 (페이지 번호 패턴이 있는 리스트/테이블)
- 연속 마커가 있는 다중 페이지 TOC 감지

#### Stage 2: MarkdownConverter

- 그룹 → 들여쓰기 리스트 형식
- 테이블 → 마크다운 테이블 형식
- LLM 처리를 위한 계층 구조 보존

#### Stage 3: TocContentValidator (LLM 검증)

- 추출된 내용이 실제 TOC인지 검증
- 신뢰도 점수 및 이유 반환

#### Stage 4: VisionTocExtractor (Vision LLM 폴백)

- 규칙 기반 추출 실패 또는 검증 실패 시 사용
- 페이지 이미지에서 직접 TOC 추출

#### Stage 5: TocExtractor (LLM 구조화)

- 계층적 TocEntry[] 추출 (title, level, pageNo)
- 중첩된 섹션을 위한 재귀적 children 구조

### 4. 리소스 변환

- **이미지**: CaptionParser로 캡션 추출 및 파싱
- **테이블**: 그리드 데이터 변환, 병합 셀 shadow filtering, span 보존 및 캡션 파싱
- **캡션 검증**: CaptionValidator로 파싱 결과 검증

### 5. 챕터 변환 (ChapterConverter)

- TOC 기반 챕터 트리 구성
- Chapter 계층 생성
- 페이지 범위별로 텍스트 블록을 챕터에 연결
- 이미지/테이블 ID를 적절한 챕터에 연결
- 각주 ID를 적절한 챕터에 연결
- TOC 항목이 비어 있으면 TOC 기반 챕터 변환을 진행할 수 없으므로 `TocNotFoundError` 발생

## API 문서

### DocumentProcessor 클래스

#### 생성자 옵션

```typescript
interface DocumentProcessorOptions {
  logger: LoggerMethods; // 로거 인스턴스 (필수)

  // LLM 모델 설정
  fallbackModel: LanguageModel; // Fallback 모델 (필수)
  pageRangeParserModel?: LanguageModel; // 페이지 범위 파서용
  tocExtractorModel?: LanguageModel; // TOC 추출용
  validatorModel?: LanguageModel; // 검증용
  visionTocExtractorModel?: LanguageModel; // Vision TOC 추출용
  captionParserModel?: LanguageModel; // 캡션 파서용

  // 배치 처리 설정
  textCleanerBatchSize: number; // 텍스트 정리 배치 크기 (필수)
  captionParserBatchSize: number; // 캡션 파싱 배치 크기 (필수)
  captionValidatorBatchSize: number; // 캡션 검증 배치 크기 (필수)

  // 재시도 설정
  maxRetries?: number; // LLM API 재시도 횟수 (기본값: 3)
  maxValidationRetries?: number; // TOC 검증 보정 재시도 횟수 (기본값: 3)
  enableFallbackRetry?: boolean; // Fallback 재시도 활성화 (기본값: false)

  // 고급 옵션
  abortSignal?: AbortSignal; // 취소 지원
  onTokenUsage?: (report: TokenUsageReport) => void; // 실시간 토큰 사용량 모니터링
}
```

#### 메서드

##### `process(doclingDoc, reportId, artifactDir, processOptions?): Promise<DocumentProcessResult>`

DoclingDocument를 ProcessedDocument로 변환합니다.

```typescript
interface DocumentProcessorProcessOptions {
  pageRangeMap?: Record<number, PageRange>;
  tocEntries?: TocEntry[];
  source?: ProcessedDocumentSource;
  validateSourceRefs?: boolean;
  sourceRefValidationMode?: 'off' | 'warn' | 'error';
}
```

**파라미터:**

- `doclingDoc` (DoclingDocument): PDF 파서의 출력
- `reportId` (string): 리포트 ID
- `artifactDir` (string): `images/`, `pages/`, `result.json` 같은 parser 산출물이 들어 있는 디렉토리
- `processOptions` (DocumentProcessorProcessOptions, 선택): 문서별 처리 입력값. `pageRangeMap`이 제공되면 자동 페이지 범위 파싱을 건너뜁니다. `tocEntries`가 제공되면 자동 TOC 추출을 건너뜁니다. `source`는 원천 Docling artifact metadata를 결과에 보존하고, `sourceRefValidationMode`는 생성된 원천 참조의 검증 방식을 제어합니다.

**반환값:**

- `Promise<DocumentProcessResult>`: 결과 객체:
  - `document` (ProcessedDocument): 처리된 문서 (`chapters`, `images`, `tables`, `footnotes` 포함)
  - `usage` (TokenUsageReport): 토큰 사용량 리포트

### Fallback 재시도 메커니즘

`enableFallbackRetry: true`로 설정하면 (기본값은 `false`), LLM 컴포넌트가 실패할 때 자동으로 fallbackModel로 재시도합니다:

```typescript
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'), // 재시도용
  pageRangeParserModel: openai('gpt-5.2'), // 첫 시도
  enableFallbackRetry: true, // 실패 시 fallback 사용 (기본값: false)
  textCleanerBatchSize: 10,
  captionParserBatchSize: 5,
  captionValidatorBatchSize: 5,
});

// pageRangeParserModel이 실패하면 자동으로 fallbackModel로 재시도
const { document, usage } = await processor.process(doc, 'id', 'path');
```

### 배치 크기 파라미터

- **textCleanerBatchSize**: 동기 텍스트 정규화 및 필터링 배치 크기. 로컬 처리이므로 큰 값 가능
- **captionParserBatchSize**: LLM 기반 캡션 파싱 배치 크기. API 요청 동시성 및 비용 관리를 위해 작은 값 사용
- **captionValidatorBatchSize**: LLM 기반 캡션 검증 배치 크기. 검증 요청 동시성 제한을 위해 작은 값 사용

## 에러 처리

### TocExtractError

TOC 추출 실패 시 발생하는 에러들:

- `TocNotFoundError`: 문서에서 TOC를 찾을 수 없음
- `TocParseError`: LLM 응답 파싱 실패
- `TocValidationError`: TOC 검증 실패

```typescript
try {
  const { document, usage } = await processor.process(doc, 'id', 'path');
} catch (error) {
  if (error instanceof TocNotFoundError) {
    console.error('TOC를 찾을 수 없습니다. 수동 TOC 검수가 필요합니다.');
  } else if (error instanceof TocParseError) {
    console.error('TOC 파싱 실패:', error.message);
  }
}
```

### PageRangeParseError

페이지 범위 파싱 실패:

```typescript
import { PageRangeParseError } from '@heripo/document-processor';
```

### CaptionParseError & CaptionValidationError

캡션 파싱/검증 실패:

```typescript
import {
  CaptionParseError,
  CaptionValidationError,
} from '@heripo/document-processor';
```

## 토큰 사용량 추적

주요 LLM 컴포넌트는 토큰 사용량을 반환합니다:

```typescript
// PageRangeParser
const { pageRangeMap, tokenUsage } = await pageRangeParser.parse(doc);
console.log('토큰 사용:', tokenUsage);

// TocExtractor
const { entries, tokenUsage } = await tocExtractor.extract(markdown);
console.log('토큰 사용:', tokenUsage);
```

## 관련 패키지

- [@heripo/pdf-parser](../pdf-parser) - PDF 파싱 및 OCR
- [@heripo/model](../model) - 데이터 모델 및 타입 정의

## 후원

heripo lab의 오픈소스 연구를 후원하려면 다음 경로를 이용할 수 있습니다:

- [Open Collective](https://opencollective.com/heripo-project): 전반적인 프로젝트 후원
- [fairy.hada.io/@heripo](https://fairy.hada.io/@heripo): 한국인 개인 후원자를 위한 원화 결제

## 라이선스

이 패키지는 [Apache License 2.0](../../LICENSE) 라이선스 하에 배포됩니다.

## 기여하기

기여는 언제나 환영합니다! [기여 가이드](../../CONTRIBUTING.ko.md)를 참고하세요.

## 이슈 및 지원

- **버그 리포트**: [GitHub Issues](https://github.com/heripo-lab/heripo-engine/issues)
- **토론**: [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)

## 프로젝트 전체 정보

이 패키지에서 다루지 않는 프로젝트 전체 정보는 [루트 README](../../README.ko.md)에서 확인하세요:

- **인용 및 출처 표기**: 학술 인용(BibTeX) 및 출처 표기 방법
- **기여 가이드라인**: 개발 가이드라인, 커밋 규칙, PR 절차
- **커뮤니티**: 이슈 트래커, 토론, 보안 정책
- **로드맵**: 프로젝트 개발 계획

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
