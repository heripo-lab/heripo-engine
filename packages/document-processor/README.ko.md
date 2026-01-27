# @heripo/document-processor

> LLM 기반 문서 구조 분석 및 처리 라이브러리

[![npm version](https://img.shields.io/npm/v/@heripo/document-processor.svg)](https://www.npmjs.com/package/@heripo/document-processor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
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
- [라이선스](#라이선스)

## 주요 기능

- **목차 추출**: 규칙 기반 + LLM 폴백으로 목차 자동 인식
- **계층 구조**: 장/절/소절 계층 구조 자동 생성
- **페이지 매핑**: Vision LLM을 활용한 실제 페이지 번호 매핑
- **캡션 파싱**: 이미지 및 테이블 캡션 자동 파싱
- **LLM 유연성**: OpenAI, Anthropic, Google 등 다양한 LLM 지원
- **Fallback 재시도**: 실패 시 자동으로 fallback 모델로 재시도

## 설치

```bash
# npm으로 설치
npm install @heripo/document-processor @heripo/model

# pnpm으로 설치
pnpm add @heripo/document-processor @heripo/model

# yarn으로 설치
yarn add @heripo/document-processor @heripo/model
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

const logger = Logger(...);

// 기본 사용 - fallback 모델만 지정
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'),
  textCleanerBatchSize: 10,
  captionParserBatchSize: 5,
  captionValidatorBatchSize: 5,
});

// 문서 처리
const processedDoc = await processor.process(
  doclingDocument, // PDF 파서 출력
  'report-001', // 리포트 ID
  outputPath, // 이미지/페이지가 있는 디렉토리
);

// 결과 사용
console.log('목차:', processedDoc.chapters);
console.log('이미지:', processedDoc.images);
console.log('표:', processedDoc.tables);
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
  enableFallbackRetry: true, // fallback 모델로 자동 재시도
});

const processedDoc = await processor.process(
  doclingDocument,
  'report-001',
  outputPath,
);
```

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
- **테이블**: 그리드 데이터 변환 및 캡션 파싱
- **캡션 검증**: CaptionValidator로 파싱 결과 검증

### 5. 챕터 변환 (ChapterConverter)

- TOC 기반 챕터 트리 구성
- Chapter 계층 생성
- 페이지 범위별로 텍스트 블록을 챕터에 연결
- 이미지/테이블 ID를 적절한 챕터에 연결
- Fallback: TOC가 비어있을 때 단일 "Document" 챕터 생성

## API 문서

### DocumentProcessor 클래스

#### 생성자 옵션

```typescript
interface DocumentProcessorOptions {
  logger: Logger; // 로거 인스턴스 (필수)

  // LLM 모델 설정
  fallbackModel: LanguageModel; // Fallback 모델 (필수)
  pageRangeParserModel?: LanguageModel; // 페이지 범위 파서용
  tocExtractorModel?: LanguageModel; // TOC 추출용
  validatorModel?: LanguageModel; // 검증용
  visionTocExtractorModel?: LanguageModel; // Vision TOC 추출용
  captionParserModel?: LanguageModel; // 캡션 파서용

  // 배치 처리 설정
  textCleanerBatchSize?: number; // 텍스트 정리 (기본값: 10)
  captionParserBatchSize?: number; // 캡션 파싱 (기본값: 5)
  captionValidatorBatchSize?: number; // 캡션 검증 (기본값: 5)

  // 재시도 설정
  maxRetries?: number; // LLM API 재시도 횟수 (기본값: 3)
  enableFallbackRetry?: boolean; // Fallback 재시도 활성화 (기본값: true)
}
```

#### 메서드

##### `process(doclingDoc, reportId, outputPath): Promise<ProcessedDocument>`

DoclingDocument를 ProcessedDocument로 변환합니다.

**파라미터:**

- `doclingDoc` (DoclingDocument): PDF 파서의 출력
- `reportId` (string): 리포트 ID
- `outputPath` (string): 이미지/페이지가 있는 출력 디렉토리

**반환값:**

- `Promise<ProcessedDocument>`: 처리된 문서

### Fallback 재시도 메커니즘

`enableFallbackRetry: true`로 설정하면, LLM 컴포넌트가 실패할 때 자동으로 fallbackModel로 재시도합니다:

```typescript
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'), // 재시도용
  pageRangeParserModel: openai('gpt-5.2'), // 첫 시도
  enableFallbackRetry: true, // 실패 시 fallback 사용
});

// pageRangeParserModel이 실패하면 자동으로 fallbackModel로 재시도
const result = await processor.process(doc, 'id', 'path');
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
  const result = await processor.process(doc, 'id', 'path');
} catch (error) {
  if (error instanceof TocNotFoundError) {
    console.log('TOC를 찾을 수 없습니다. 단일 챕터로 처리됩니다.');
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
