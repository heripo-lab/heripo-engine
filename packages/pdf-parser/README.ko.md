# @heripo/pdf-parser

> PDF 파싱 라이브러리 - Docling SDK를 활용한 OCR 지원

[![npm version](https://img.shields.io/npm/v/@heripo/pdf-parser.svg)](https://www.npmjs.com/package/@heripo/pdf-parser)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.9--3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 전체 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

`@heripo/pdf-parser`는 Docling SDK를 기반으로 PDF 문서를 파싱하고 OCR 처리하는 라이브러리입니다. 고고학 발굴조사보고서와 같은 복잡한 레이아웃의 문서를 효과적으로 처리할 수 있도록 설계되었습니다.

## 목차

- [주요 기능](#주요-기능)
- [사전 요구사항](#사전-요구사항)
- [설치](#설치)
- [사용법](#사용법)
- [OCR 전략 시스템](#ocr-전략-시스템)
- [Review Assistance](#review-assistance)
- [문서 유형 검증](#문서-유형-검증)
- [대용량 PDF 청크 변환](#대용량-pdf-청크-변환)
- [이미지 PDF 폴백](#이미지-pdf-폴백)
- [AbortSignal 지원](#abortsignal-지원)
- [서버 크래시 복구](#서버-크래시-복구)
- [왜 macOS 전용인가?](#왜-macos-전용인가)
- [시스템 의존성 상세](#시스템-의존성-상세)
- [API 문서](#api-문서)
- [문제 해결](#문제-해결)
- [후원](#후원)
- [라이선스](#라이선스)

## 주요 기능

- **고품질 OCR**: Docling SDK를 활용한 문서 인식 (ocrmac / Apple Vision Framework)
- **한국어 보고서 VLM 보정**: 한국어 보고서를 자동 감지하고 모든 페이지에 VLM 텍스트 보정을 적용
- **Apple Silicon 최적화**: M1/M2/M3/M4/M5 칩에서 GPU 가속 지원
- **자동 환경 설정**: Python 가상환경 및 docling-serve 자동 설치
- **이미지 추출**: PDF 내 이미지 자동 추출 및 저장
- **문서 유형 검증**: LLM 기반 고고학 보고서 여부 검증 (선택)
- **청크 변환**: 대용량 PDF를 청크로 분할하여 안정적으로 처리
- **이미지 PDF 폴백**: 변환 실패 시 이미지 기반 PDF로 자동 재시도
- **Review Assistance**: 선택적 page-level VLM review로 audit proposal을 기록하고 고신뢰도 수정만 자동 적용
- **AbortSignal 지원**: 진행 중인 파싱 작업 취소
- **서버 크래시 복구**: ECONNREFUSED 발생 시 docling-serve 자동 재시작

## 사전 요구사항

### 시스템 요구사항

- **macOS** with Apple Silicon (M1/M2/M3/M4/M5) - 최적 성능을 위해 권장
- **macOS** with Intel - 지원되지만 속도가 느림
- **Linux/Windows** - 현재 지원하지 않음

### 필수 의존성

#### 1. Node.js >= 24.0.0

```bash
brew install node
```

#### 2. pnpm >= 10.0.0

```bash
npm install -g pnpm
```

#### 3. Python 3.9 - 3.12

> **중요**: Python 3.13+는 지원하지 않습니다. Docling SDK의 일부 의존성이 Python 3.13과 호환되지 않습니다.

```bash
# Python 3.11 설치 (권장)
brew install python@3.11

# 버전 확인
python3.11 --version
```

#### 4. poppler (PDF 텍스트 추출)

PDF 페이지 수 확인(`pdfinfo`)과 텍스트 레이어 추출(`pdftotext`)에 필요하며, OCR 전략 시스템의 텍스트 레이어 사전 검사에 사용됩니다.

```bash
brew install poppler
```

#### 5. jq (JSON 처리 도구)

```bash
brew install jq
```

#### 6. lsof (포트 관리)

macOS에 기본적으로 설치되어 있습니다. 확인:

```bash
which lsof
```

#### 7. ImageMagick + Ghostscript (선택)

이미지 PDF 폴백 기능(`enableImagePdfFallback` 또는 `forceImagePdf`)을 사용할 때만 필요합니다.

```bash
brew install imagemagick ghostscript
```

### 최초 실행 설정

`@heripo/pdf-parser`를 처음 사용할 때 자동으로:

1. 현재 작업 디렉토리의 `.venv`에 Python 가상환경 생성 (`venvPath`로 설정 가능)
2. `docling-serve` 및 의존성 설치
3. 로컬 포트에서 docling-serve 프로세스 시작

이 설정은 한 번만 수행되며 인터넷 연결 상태에 따라 5-10분 정도 소요될 수 있습니다.

## 설치

```bash
# npm으로 설치
npm install @heripo/pdf-parser @heripo/logger

# pnpm으로 설치
pnpm add @heripo/pdf-parser @heripo/logger

# yarn으로 설치
yarn add @heripo/pdf-parser @heripo/logger
```

## 사용법

### 기본 사용법

```typescript
import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';

const logger = new Logger({
  debug: (...args) => console.debug('[heripo]', ...args),
  info: (...args) => console.info('[heripo]', ...args),
  warn: (...args) => console.warn('[heripo]', ...args),
  error: (...args) => console.error('[heripo]', ...args),
});

// PDFParser 인스턴스 생성 (logger는 필수)
const pdfParser = new PDFParser({
  port: 5001,
  logger,
});

// 초기화 (환경 설정 및 docling-serve 시작)
await pdfParser.init();

// PDF 파싱
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/report.pdf', // PDF URL (file:// 또는 http://)
  'report-001', // 리포트 ID
  async (outputPath) => {
    // 변환 완료 콜백
    console.log('PDF 변환 완료:', outputPath);
  },
  false, // cleanupAfterCallback
  {}, // PDFConvertOptions
);

// 토큰 사용량 리포트 (LLM 사용이 없으면 null)
console.log('토큰 사용량:', tokenUsageReport);
```

### 고급 옵션

```typescript
// 옵션 A: 로컬 서버 (포트 모드)
const pdfParser = new PDFParser({
  logger,
  port: 5001,                      // 사용할 포트 (기본값: 5001)
  timeout: 10000000,                // 타임아웃 (밀리초)
  venvPath: '/custom/path/.venv',   // 커스텀 venv 경로 (기본값: CWD/.venv)
  killExistingProcess: true,        // 포트의 기존 프로세스 종료 (기본값: false)
  enableImagePdfFallback: true,     // 이미지 PDF 폴백 활성화 (기본값: false)
});

// 옵션 B: 외부 docling-serve 사용
const pdfParser = new PDFParser({
  logger,
  baseUrl: 'http://localhost:5000', // 외부 서버 URL
});

// 변환 옵션과 함께 파싱
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    // OCR 전략 옵션
    strategySamplerModel: openai('gpt-5.1'),
    vlmProcessorModel: openai('gpt-5.1'),
    vlmConcurrency: 3,

    // 문서 유형 검증
    documentValidationModel: openai('gpt-5.1'),

    // 선택적 page-level review assistance
    reviewAssistance: {
      enabled: true,
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      outputLanguage: 'ko-KR',
    },
    onReviewAssistanceProgress: (event) => console.log(event),

    // 대용량 PDF 청크 변환
    chunkedConversion: true,
    chunkSize: 50,
    chunkMaxRetries: 3,

    // 이미지 PDF 사전 변환 강제
    forceImagePdf: false,

    // 문서 처리 타임아웃 (초)
    document_timeout: 600,

    // 토큰 사용량 추적
    onTokenUsage: (report) => console.log('토큰 사용량:', report),
  },
);
```

### 리소스 정리

작업 완료 후 리소스를 정리합니다:

```typescript
// docling-serve 프로세스 종료 및 리소스 해제
await pdfParser.dispose();
```

## OCR 전략 시스템

### 왜 이 전략인가?

**ocrmac(Apple Vision Framework)은 매우 우수한 OCR 엔진입니다** -- 무료이고, GPU 가속을 지원하며, 고품질 결과를 제공합니다. 수천~수백만 권의 고고학 보고서를 처리할 때 이만한 솔루션이 없습니다.

**그러나 한국어 고고학 보고서는 문자 체계 인식 보정이 자주 필요합니다.** 한자 복원, CJK mojibake, 음독 치환, 기관명 등은 표준 OCR만으로 안정적으로 처리하기 어렵습니다. VLM을 기본 OCR 엔진으로 쓰는 대신, 빠른 ocrmac 파이프라인을 먼저 실행한 뒤 한국어 보고서에 VLM 텍스트 보정을 적용합니다.

### 2단계 한국어 감지 (`OcrStrategySampler`)

1. **텍스트 레이어 사전 검사** (비용 없음): `pdftotext`로 문서의 텍스트 레이어를 추출하여 한글을 확인합니다. 한글이 있으면 즉시 한국어 문서로 판별합니다.
2. **VLM 샘플링** (필요 시에만): 최대 15페이지를 샘플링(앞뒤 10%는 표지·부록으로 제외)하여 Vision LLM으로 언어를 판정합니다. `ko-KR` 감지 시 즉시 종료합니다.

### 전체 문서 보정 (`VlmTextCorrector`)

한국어 보고서가 감지되면, 모든 페이지를 VLM에 전송하여 보정합니다:

- 각 페이지의 OCR 텍스트 요소와 표 셀을 추출
- `pdftotext` 참조 텍스트를 품질 기준으로 활용
- VLM이 치환 기반 보정(find -> replace)을 반환
- 실패한 페이지는 원본 OCR 텍스트를 유지하며 건너뜀

### 전략 옵션

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    // OCR 전략 샘플링 활성화 (Vision LLM 모델 제공)
    strategySamplerModel: openai('gpt-5.1'),

    // VLM 텍스트 보정 모델 (한국어 보고서 감지 시 필요)
    vlmProcessorModel: openai('gpt-5.1'),

    // VLM 페이지 처리 동시성 (기본값: 1)
    vlmConcurrency: 3,

    // 샘플링을 건너뛰고 특정 OCR 방식 강제
    forcedMethod: 'ocrmac', // 또는 'vlm'
  },
);
```

## Review Assistance

`reviewAssistance`는 Docling 변환 후 선택적으로 실행되는 page-level VLM
review입니다. 렌더링된 페이지 이미지, 텍스트, 테이블, 캡션, 그림, reading
order, role, bounding box, 도메인 패턴을 점검하고, 고신뢰도 수정만
`result.json`에 적용하면서 audit report를 남깁니다.

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    strategySamplerModel: openai('gpt-5.1'),
    vlmProcessorModel: openai('gpt-5.1'),
    reviewAssistance: {
      enabled: true,
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: 3,
      temperature: 0,
      outputLanguage: 'ko-KR',
    },
    onReviewAssistanceProgress: (event) => {
      console.log(event.substage, event.status, event.pageNo);
    },
  },
);
```

Review Assistance는 로컬 `file://` PDF와 `vlmProcessorModel` 또는
`strategySamplerModel`이 필요합니다. 고신뢰도 수정은 `result.json`에 적용하고,
원본 snapshot은 `result_review_origin.json`, `result_ocr_origin.json`에 보존하며,
페이지별 결정, 이슈, proposal, 요약 count는 `review_assistance.json`에 기록합니다.

## 문서 유형 검증

LLM 기반으로 PDF가 고고학 발굴조사보고서인지 검증하는 선택적 기능입니다. `documentValidationModel`을 제공하면 파서가 PDF에서 텍스트를 추출하고 LLM을 사용하여 문서 유형을 확인한 후 처리합니다. 검증에 실패하면 `InvalidDocumentTypeError`가 발생합니다.

```typescript
import { InvalidDocumentTypeError } from '@heripo/pdf-parser';

try {
  await pdfParser.parse(
    'file:///path/to/input.pdf',
    'report-001',
    async (outputPath) => console.log(outputPath),
    false,
    {
      documentValidationModel: openai('gpt-5.1'),
    },
  );
} catch (error) {
  if (error instanceof InvalidDocumentTypeError) {
    console.error('고고학 보고서가 아닙니다:', error.message);
  }
}
```

## 대용량 PDF 청크 변환

타임아웃이나 메모리 문제를 일으킬 수 있는 대용량 PDF의 경우, 청크 변환을 활성화하여 PDF를 작은 청크로 분할하고 개별적으로 처리할 수 있습니다. 로컬 파일(`file://` URL)에서만 동작합니다.

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/large-report.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    chunkedConversion: true,
    chunkSize: 50, // 청크당 페이지 수 (기본값: 상수에서 설정)
    chunkMaxRetries: 3, // 실패한 청크의 최대 재시도 횟수 (기본값: 상수에서 설정)
  },
);
```

## 이미지 PDF 폴백

변환이 실패하면 파서가 PDF를 이미지 기반 PDF로 변환한 후 재시도할 수 있습니다. 복잡하거나 손상된 구조의 PDF에 유용합니다. ImageMagick과 Ghostscript가 필요합니다.

### 자동 폴백 (실패 시)

생성자 옵션으로 활성화합니다. 변환이 실패하면 파서가 자동으로 이미지 기반 PDF로 재시도합니다:

```typescript
const pdfParser = new PDFParser({
  logger,
  port: 5001,
  enableImagePdfFallback: true, // 자동 폴백 활성화
});
```

### 강제 이미지 PDF (항상)

parse 옵션으로 이미지 기반 PDF 사전 변환을 강제합니다:

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    forceImagePdf: true, // 항상 이미지 PDF로 먼저 변환
  },
);
```

원본 변환과 폴백 변환 모두 실패하면 두 에러를 모두 포함하는 `ImagePdfFallbackError`가 발생합니다.

## AbortSignal 지원

`AbortSignal`을 전달하여 진행 중인 파싱 작업을 취소할 수 있습니다:

```typescript
const controller = new AbortController();

// 5분 후 취소
setTimeout(() => controller.abort(), 5 * 60 * 1000);

try {
  await pdfParser.parse(
    'file:///path/to/input.pdf',
    'report-001',
    async (outputPath) => console.log(outputPath),
    false,
    {},
    controller.signal, // AbortSignal
  );
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('파싱이 취소되었습니다');
  }
}
```

## 서버 크래시 복구

로컬 docling-serve 인스턴스(포트 모드)를 사용할 때, 파서가 서버 크래시(ECONNREFUSED 에러)를 자동으로 감지하고 서버를 재시작합니다. 이 과정은 `parse()` 호출 중에 투명하게 처리되며, 실패한 작업은 서버 재시작 후 재시도됩니다.

> **참고**: 서버 크래시 복구는 로컬 서버 모드(`port` 옵션)에서만 사용 가능합니다. 외부 서버(`baseUrl` 옵션)를 사용할 때는 복구를 시도하지 않습니다.

## 왜 macOS 전용인가?

`@heripo/pdf-parser`는 **의도적으로 macOS에 강하게 의존**합니다. 이 결정의 핵심 이유는 **Docling SDK의 로컬 OCR 성능**입니다.

### OCR 선택 배경

고고학 발굴조사보고서 PDF는 다음과 같은 특성이 있습니다:

- 수백 페이지 분량의 스캔 문서
- 복잡한 표, 도면, 사진이 포함된 레이아웃
- 정밀한 텍스트 추출이 필수적

### OCR 옵션 비교

| 방식                    | 성능  | 비용 | 설명                                    |
| ----------------------- | ----- | ---- | --------------------------------------- |
| **Docling (로컬)**      | ★★★★★ | 무료 | Apple Silicon에서 압도적 성능, GPU 활용 |
| Cloud OCR (Google, AWS) | ★★★★  | $$$  | 수백 페이지당 수십 달러                 |
| Tesseract (로컬)        | ★★    | 무료 | 한국어 인식률 낮음, 레이아웃 분석 부족  |

### 핵심 장점

- **비용**: 클라우드 OCR 대비 100배 이상 저렴 (무료)
- **성능**: Apple Silicon M1/M2/M3/M4/M5에서 GPU 가속으로 빠른 처리
- **품질**: 복잡한 레이아웃의 문서도 정확히 인식
- **프라이버시**: 문서가 외부 서버로 전송되지 않음

### Trade-off

- macOS + Apple Silicon 환경에서만 최적 성능
- Linux/Windows 지원은 현재 계획 없음 (아래 "Linux 지원 현황" 참고)

## 시스템 의존성 상세

`@heripo/pdf-parser`는 다음 시스템 레벨 의존성이 필요합니다:

| 의존성      | 필수 버전  | 설치 방법                  | 용도                                                           |
| ----------- | ---------- | -------------------------- | -------------------------------------------------------------- |
| Python      | 3.9 - 3.12 | `brew install python@3.11` | Docling SDK 실행 환경                                          |
| poppler     | Any        | `brew install poppler`     | PDF 페이지 수 확인 (pdfinfo) 및 텍스트 레이어 추출 (pdftotext) |
| jq          | Any        | `brew install jq`          | JSON 처리 (변환 결과 파싱)                                     |
| lsof        | Any        | macOS 기본 설치됨          | docling-serve 포트 관리                                        |
| ImageMagick | Any (선택) | `brew install imagemagick` | 이미지 PDF 폴백 및 페이지 렌더링                               |
| Ghostscript | Any (선택) | `brew install ghostscript` | 이미지 PDF 폴백 (PDF를 이미지로 변환)                          |

> **Python 3.13+는 지원하지 않습니다.** Docling SDK의 일부 의존성이 Python 3.13과 호환되지 않습니다.

### Python 버전 확인

```bash
# 설치된 Python 버전 확인
python3 --version
python3.11 --version

# 여러 버전이 설치된 경우
ls -la /usr/local/bin/python*
```

### jq 설치 확인

```bash
# jq 버전 확인
jq --version

# jq 경로 확인
which jq
```

## API 문서

### PDFParser 클래스

#### 생성자 옵션

```typescript
type Options = {
  logger: LoggerMethods; // 로거 인스턴스 (필수)
  timeout?: number; // 타임아웃 (밀리초, 기본값: 10000000)
  venvPath?: string; // Python venv 경로 (기본값: CWD/.venv)
  killExistingProcess?: boolean; // 포트의 기존 프로세스 종료 (기본값: false)
  enableImagePdfFallback?: boolean; // 이미지 PDF 폴백 활성화 (기본값: false, ImageMagick + Ghostscript 필요)
} & (
  | { port?: number } // 로컬 서버 모드 (기본 포트: 5001)
  | { baseUrl: string } // 외부 서버 모드
);
```

#### 메서드

##### `init(): Promise<void>`

Python 환경을 설정하고 docling-serve를 시작합니다.

```typescript
await pdfParser.init();
```

##### `parse(url, reportId, onComplete, cleanupAfterCallback, options, abortSignal?): Promise<TokenUsageReport | null>`

PDF 파일을 파싱합니다.

**파라미터:**

- `url` (string): PDF URL (로컬 파일은 `file://`, 원격은 `http://`)
- `reportId` (string): 고유 리포트 식별자 (출력 디렉토리 이름에 사용)
- `onComplete` (ConversionCompleteCallback): 변환 완료 시 출력 디렉토리 경로와 함께 호출되는 콜백 함수
- `cleanupAfterCallback` (boolean): 콜백 완료 후 출력 디렉토리 삭제 여부
- `options` (PDFConvertOptions): 변환 옵션
- `abortSignal` (AbortSignal, 선택): 작업 취소를 위한 시그널

**반환값:**

- `Promise<TokenUsageReport | null>`: LLM 작업의 토큰 사용량 리포트, LLM 사용이 없으면 `null`

##### `dispose(): Promise<void>`

파서 인스턴스를 해제하고, 로컬 docling-serve 프로세스를 종료(시작한 경우)하며, 리소스를 해제합니다.

```typescript
await pdfParser.dispose();
```

### PDFConvertOptions

```typescript
type PDFConvertOptions = {
  // OCR 전략 옵션
  strategySamplerModel?: LanguageModel; // OCR 전략 샘플링용 Vision LLM
  vlmProcessorModel?: LanguageModel; // 텍스트 보정용 Vision LLM
  vlmConcurrency?: number; // 병렬 페이지 처리 (기본값: 1)
  skipSampling?: boolean; // 전략 샘플링 건너뛰기
  forcedMethod?: 'ocrmac' | 'vlm'; // 특정 OCR 방식 강제

  // 이미지 PDF 옵션
  forceImagePdf?: boolean; // 이미지 기반 PDF 사전 변환 강제

  // 토큰 사용량 추적
  aggregator?: LLMTokenUsageAggregator; // 토큰 사용량 집계기
  onTokenUsage?: (report: TokenUsageReport) => void; // 토큰 사용량 업데이트 콜백

  // 문서 처리
  document_timeout?: number; // 문서 처리 타임아웃 (초)
  documentValidationModel?: LanguageModel; // 문서 유형 검증용 LLM

  // Review Assistance
  reviewAssistance?: boolean | ReviewAssistanceOptions; // 선택적 page-level review
  onReviewAssistanceProgress?: (event: ReviewAssistanceProgressEvent) => void; // 진행 상황 callback

  // 청크 변환 (대용량 PDF)
  chunkedConversion?: boolean; // 청크 변환 활성화
  chunkSize?: number; // 청크당 페이지 수
  chunkMaxRetries?: number; // 실패한 청크의 최대 재시도 횟수

  // Docling 변환 옵션 (상속)
  num_threads?: number; // 처리 스레드 수
  ocr_lang?: string[]; // OCR 언어
  // ... 기타 Docling ConversionOptions 필드
};
```

### ReviewAssistanceOptions

```typescript
interface ReviewAssistanceOptions {
  enabled?: boolean; // page-level review assistance 활성화
  autoApplyThreshold?: number; // 자동 적용 최소 confidence (기본값: 0.85)
  proposalThreshold?: number; // sidecar proposal 최소 confidence (기본값: 0.5)
  maxRetries?: number; // page-level VLM 호출별 최대 재시도 횟수 (기본값: 3)
  temperature?: number; // VLM 생성 temperature (기본값: 0)
  outputLanguage?: string; // 사람이 읽는 review reason 언어 (기본값: en-US)
}
```

### ConvertWithStrategyResult

```typescript
interface ConvertWithStrategyResult {
  /** 결정된 OCR 전략 */
  strategy: OcrStrategy;
  /** 샘플링 및/또는 VLM 처리의 토큰 사용량 리포트 (LLM 사용이 없으면 null) */
  tokenUsageReport: TokenUsageReport | null;
}
```

### ConversionCompleteCallback

```typescript
type ConversionCompleteCallback = (outputPath: string) => Promise<void> | void;
```

### 에러 타입

#### `InvalidDocumentTypeError`

PDF가 문서 유형 검증에 실패할 때 발생합니다 (즉, 고고학 발굴조사보고서가 아닌 경우).

```typescript
import { InvalidDocumentTypeError } from '@heripo/pdf-parser';
```

#### `ImagePdfFallbackError`

원본 변환과 이미지 PDF 폴백 변환이 모두 실패할 때 발생합니다. 두 에러에 대한 참조를 포함합니다.

```typescript
import { ImagePdfFallbackError } from '@heripo/pdf-parser';
```

## 문제 해결

### jq를 찾을 수 없음

**증상**: `Command not found: jq`

**해결**:

```bash
brew install jq
```

### poppler를 찾을 수 없음

**증상**: `poppler is not installed. Please install poppler using: brew install poppler`

**해결**:

```bash
brew install poppler
```

### 포트 충돌

**증상**: `Port 5001 is already in use`

**해결**:

```typescript
// 다른 포트 사용
const pdfParser = new PDFParser({
  port: 5002,  // 다른 포트 지정
  logger,
});

// 또는 기존 프로세스 종료
const pdfParser = new PDFParser({
  port: 5001,
  killExistingProcess: true,
  logger,
});
```

### docling-serve 시작 실패

**증상**: `Failed to start docling-serve`

**해결**:

```bash
# 가상환경 재생성 (기본 위치)
rm -rf .venv
# 다시 init() 실행
```

### ImageMagick / Ghostscript를 찾을 수 없음

**증상**: `ImageMagick is not installed but enableImagePdfFallback is enabled`

**해결**:

```bash
brew install imagemagick ghostscript
```

## Linux 지원 현황

현재 **macOS 전용**입니다. Linux 지원은 **완전히 배제한 것은 아니지만**, OCR 성능과 비용 효율성 문제로 **현재는 구체적인 계획이 없습니다**.

| 플랫폼                | 상태 | 비고                            |
| --------------------- | ---- | ------------------------------- |
| macOS + Apple Silicon | 지원 | 최적 성능, GPU 가속             |
| macOS + Intel         | 지원 | GPU 가속 없음                   |
| Linux                 | 미정 | 성능/비용 문제로 현재 계획 없음 |
| Windows               | 미정 | WSL2 통한 Linux 방식 고려 가능  |

### Linux 미지원 사유

Docling SDK의 로컬 OCR은 macOS에서 Apple Metal GPU 가속을 활용해 성능과 비용 효율성을 모두 달성합니다. Linux에서 동등한 성능과 비용 효율성을 제공하는 OCR 솔루션을 아직 찾지 못했습니다.

### 아이디어 제안 환영

성능과 비용을 모두 잡으면서 Linux를 지원할 수 있는 아이디어가 있다면, [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions) 또는 Issue로 제안해 주세요. 특히 다음과 같은 정보가 도움이 됩니다:

- Linux에서 한국어 문서 OCR 경험
- 복잡한 레이아웃(표, 도면) 처리 가능한 OCR 솔루션
- 수백 페이지 처리 시 비용 추산

## 관련 패키지

- [@heripo/document-processor](../document-processor) - 문서 구조 분석 및 LLM 처리
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
- **보안 취약점**: [보안 정책](../../SECURITY.ko.md) 참고

## 프로젝트 전체 정보

이 패키지에서 다루지 않는 프로젝트 전체 정보는 [루트 README](../../README.ko.md)에서 확인하세요:

- **인용 및 출처 표기**: 학술 인용(BibTeX) 및 출처 표기 방법
- **기여 가이드라인**: 개발 가이드라인, 커밋 규칙, PR 절차
- **커뮤니티**: 이슈 트래커, 토론, 보안 정책
- **로드맵**: 프로젝트 개발 계획

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
