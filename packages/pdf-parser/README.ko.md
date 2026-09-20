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
- [필수 보정 파이프라인](#필수-보정-파이프라인)
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

- **ocrmac 고정 OCR**: Docling 변환은 항상 ocrmac / Apple Vision Framework를 사용
- **필수 VLM 보정**: Docling 이후 텍스트 보정은 필수이며 page gate와 구조 검토는 비활성화 가능
- **Apple Silicon 백엔드**: Docling 변환에서 `mps` accelerator 요청
- **자동 환경 설정**: Python 가상환경 및 docling-serve 자동 설치
- **이미지 추출**: PDF 내 이미지 자동 추출 및 저장
- **문서 유형 검증**: LLM 기반 고고학 보고서 여부 검증 (선택)
- **청크 변환**: 대용량 PDF를 청크로 분할하여 안정적으로 처리
- **이미지 PDF 폴백**: 변환 실패 시 이미지 기반 PDF로 자동 재시도
- **Review Assistance**: page-level VLM review로 audit proposal을 기록하고, 의미 낮은 페이지는 관찰 가능한 사유와 함께 skip하며, 고신뢰도 수정만 자동 적용
- **표 보정 강화**: 표별 work item으로 셀, span, header, 단위, 각주, 인접 페이지 연속표를 검증
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

#### 2. pnpm >= 12

```bash
npm install -g pnpm@12
```

#### 3. Python 3.9 - 3.12

> **중요**: 현재 설치 코드는 Python 3.9–3.12만 허용하고 3.13 이상은 거부합니다. 저장소의 버전 검사 기준이며 모든 upstream Docling 버전의 호환성을 뜻하지는 않습니다.

```bash
# Python 3.11 설치 (권장)
brew install python@3.11

# 버전 확인
export PATH="$(brew --prefix python@3.11)/libexec/bin:$PATH"
python3 --version
```

#### 4. poppler (PDF 텍스트 추출)

PDF 페이지 수 확인(`pdfinfo`)과 텍스트 레이어 추출(`pdftotext`)에 필요하며, Docling 이후 보정의 참조 텍스트로 사용됩니다.

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

#### 7. ImageMagick + Ghostscript

필수 VLM 보정에 사용하는 로컬 PDF 페이지 렌더링과 이미지 PDF 폴백에 필요합니다. `enableImagePdfFallback`과 `forceImagePdf`가 꺼져 있어도 설치하세요.

```bash
brew install imagemagick ghostscript
```

### 최초 실행 설정

`@heripo/pdf-parser`를 처음 사용할 때 자동으로:

1. 현재 작업 디렉토리의 `.venv`에 Python 가상환경 생성 (`venvPath`로 설정 가능)
2. `docling-serve` 및 의존성 설치
3. 로컬 포트에서 docling-serve 프로세스 시작

가상환경은 재사용하지만 로컬 초기화에서 의존성 설치 단계를 다시 실행합니다. 설치 코드는 docling-serve 1.16.1과 명시적인 Docling 런타임 버전을 사용합니다. [python-environment.ts](./src/environment/python-environment.ts)를 참고하세요. 별도 `python3.11` 설치 여부보다 PATH의 `python3` 버전이 중요합니다.

## 설치

```bash
# npm으로 설치
npm install @heripo/pdf-parser @heripo/logger @ai-sdk/openai

# pnpm으로 설치
pnpm add @heripo/pdf-parser @heripo/logger @ai-sdk/openai

# yarn으로 설치
yarn add @heripo/pdf-parser @heripo/logger @ai-sdk/openai
```

## 사용법

### 기본 사용법

ESM 프로젝트에서 실행하세요. 예제의 `HERIPO_MODEL`은 사용자가 설정하는 환경 변수로, 이미지 입력과 구조화된 출력을 지원하는 모델 ID를 지정합니다. `OPENAI_API_KEY`도 설정하세요. 다른 provider는 해당 AI SDK adapter로 대체할 수 있습니다.

```typescript
import { openai } from '@ai-sdk/openai';
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

const correctionModel = openai(process.env.HERIPO_MODEL!);

// 초기화 (환경 설정 및 docling-serve 시작)
try {
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
    {
      correction: {
        models: {
          textCorrection: correctionModel,
          pageGate: correctionModel,
          reviewAssistance: correctionModel,
        },
      },
    }, // PDFConvertOptions
  );

  // 토큰 사용량 리포트 (LLM 사용이 없으면 null)
  console.log('토큰 사용량:', tokenUsageReport);
} finally {
  await pdfParser.dispose();
}
```

### 고급 옵션

```typescript
// 옵션 A: 로컬 서버 (포트 모드)
const pdfParser = new PDFParser({
  logger,
  port: 5001, // Local port must be specified explicitly
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
    // Docling 이후 필수 보정
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
        tableCorrection: openai(process.env.HERIPO_MODEL!),
        reviewAssistanceTasks: {
          text_ocr_hanja: openai(process.env.HERIPO_MODEL!),
          tables: openai(process.env.HERIPO_MODEL!),
        },
      },
      concurrency: {
        pages: 1,
        reviewTasks: 4,
        tables: 1,
      },
      modelConcurrency: 1,
      workItemTimeoutMs: 900000,
      maxRetries: {
        textCorrection: 3,
        pageGate: 3,
        reviewAssistance: 3,
        tableCorrection: 3,
      },
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      temperature: 0,
      outputLanguage: 'ko-KR',
    },
    onReviewAssistanceProgress: (event) => console.log(event),

    // 문서 유형 검증
    documentValidationModel: openai(process.env.HERIPO_MODEL!),

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

### 산출물

콜백은 `output/<reportId>/`의 절대 경로를 받습니다. `result.json`은 보정 결과이고 `result_ocr_origin.json`은 초기 OCR 스냅샷입니다. `images/`와 `pages/`는 추출 이미지와 페이지 이미지입니다. 구조 검토 활성화 시 `result_review_origin.json`, `review_assistance_page_gate.json`, `review_assistance_checkpoint.json`, `review_assistance.json`도 생성됩니다. 실패한 검토 작업은 리포트의 페이지 상태·이슈·call trace를 확인하세요.

`cleanupAfterCallback: true`이면 콜백 이후 산출물 디렉터리가 삭제됩니다. 필요한 파일을 콜백 안에서 다른 위치로 복사하거나 `false`로 보존하세요. 파서는 `result-processed.json`이나 handoff manifest를 만들지 않으며 데모 worker가 별도로 저장합니다.

### 리소스 정리

작업 완료 후 리소스를 정리합니다:

```typescript
// docling-serve 프로세스 종료 및 리소스 해제
await pdfParser.dispose();
```

## 필수 보정 파이프라인

### ocrmac을 고정하는 이유

ocrmac은 macOS의 Apple Vision을 사용하는 고정 OCR 백엔드입니다.

`@heripo/pdf-parser`는 더 이상 OCR strategy를 sampling하거나 VLM OCR 경로로 전환하지 않습니다. Docling 변환은 항상 ocrmac으로 실행하고, VLM 보정은 Docling 이후 실행합니다. 선택적인 언어 감지와 문서 유형 검증에서도 변환 전에 모델을 호출할 수 있습니다.

### 필수 correction 계약

모든 `parse()` 호출은 `correction.models.textCorrection`, `correction.models.pageGate`, `correction.models.reviewAssistance`를 제공해야 합니다. 필수 모델이 누락되면 변환 callback을 감싸기 전에 명확히 실패합니다.

구조 검토가 기본 설정대로 활성화된 경우 보정 단계는 다음과 같습니다.

1. 변경 전 `result_ocr_origin.json`을 저장합니다.
2. `textCorrection` 모델로 페이지 텍스트와 표 셀 OCR을 보정합니다.
3. `pageGate` 모델로 Review Assistance page gate를 실행하고 `review_assistance_page_gate.json`을 기록합니다.
4. task별 모델로 구조 Review Assistance work item을 실행합니다.
5. 감지된 표마다 table-specific correction work item을 실행합니다.
6. 실행 중 `review_assistance_checkpoint.json`을 기록하고, 완료 시 `review_assistance.json`을 기록합니다.

텍스트 보정은 텍스트나 표가 있는 모든 페이지에 적용됩니다. page gate는 구조적 Review Assistance 노이즈만 제어하며, OCR 텍스트 보정 범위를 줄이지 않습니다.

### 로컬 모델 권장 실행 방식

보정 파이프라인은 로컬 VLM 기준으로 설계되었습니다. 큰 context 하나보다 작은 context를 자주 호출하고, deterministic validator와 retry, timeout, checkpoint/resume으로 안정성을 확보합니다. 처음에는 `concurrency.pages: 1`, `concurrency.reviewTasks: 1`, `modelConcurrency: 1`, `temperature: 0`, 충분한 `workItemTimeoutMs`로 시작하고, 모델이 안정화된 뒤 동시성을 높이는 것을 권장합니다.

### 검증

저장소에 정의된 테스트 명령은 `pnpm --filter @heripo/pdf-parser test:coverage`입니다. 테스트는 외부 모델 호출을 모킹하므로 실제 문서의 보정 품질은 별도 확인해야 합니다.

### 보정 옵션과 기본값

세 필수 모델은 구조 검토를 꺼도 모두 제공해야 합니다. `reviewAssistanceEnabled: false`이면 텍스트·표 셀 OCR 보정만 수행하고 page gate와 구조 검토를 생략합니다. `tableCorrectionEnabled: false`는 구조 검토의 표 작업만 생략하며 초기 표 셀 OCR 보정에는 영향을 주지 않습니다.

`forceAutoApply` 기본값은 `false`입니다. `true`이면 검증을 통과한 명령을 신뢰도 임계값과 구조적 제약에 따른 수동 검토 분기 없이 적용합니다. 명령 검증 자체를 생략하는 옵션은 아닙니다.

| Option                                               | Default                |
| ---------------------------------------------------- | ---------------------- |
| `concurrency.pages`                                  | `1`                    |
| `concurrency.reviewTasks`                            | `6`                    |
| `modelConcurrency`                                   | `1`                    |
| `maxRetries.*`                                       | `3`                    |
| `workItemTimeoutMs`                                  | `1800000` (30 minutes) |
| `outputLanguage`                                     | `en-US`                |
| `autoApplyThreshold` / `proposalThreshold`           | `0.85` / `0.5`         |
| `reviewAssistanceEnabled` / `tableCorrectionEnabled` | `true` / `true`        |
| `forceAutoApply` / `temperature`                     | `false` / `0`          |

기본값은 내보낸 `PDF_CORRECTION_DEFAULTS`에서도 확인할 수 있습니다. `concurrency.tables`와 `pageGate.structuralNoiseThreshold`는 타입에 있지만 현재 최상위 파이프라인에서 runner 제어값으로 전달되지 않습니다. 표 작업 동시성은 `reviewTasks`와 `modelConcurrency`로 제어하세요.

### 언어 감지

`ocr_lang`이 있으면 그대로 사용합니다. 없으면 로컬 PDF 텍스트 레이어를 분석하고, 부족한 경우 `languageDetectionModel`로 페이지를 감지합니다. `languageDetectionFallbackModel`도 지정할 수 있습니다. 원격 입력이나 감지할 수 없는 입력은 기본 언어 `ko-KR`, `en-US`를 사용합니다. OCR 엔진 선택 기능은 아니며 OCR은 항상 ocrmac입니다.

## Review Assistance

Review Assistance는 `correction.reviewAssistanceEnabled: true`일 때(라이브러리 기본값) 텍스트 보정 이후 실행되지만 모든 페이지를 같은 강도로 처리하지 않습니다. page gate가 표지, 챕터 표지, 바코드/ISBN 페이지, 장식 중심 페이지를 구조 review 저가치 페이지로 분류합니다. skip된 페이지도 `review_assistance.json`에 info issue와 skip reason으로 남습니다.

eligible page는 text OCR/Hanja, text integrity, text role/footnote, tables, pictures/captions, layout/bbox/order, table-specific correction 같은 작은 work item으로 쪼개집니다. 각 호출의 timing, model id, attempts, target refs, deterministic validation status는 `review_assistance.json`에 기록됩니다.

### 표 보정 전략

표는 page 부속물이 아니라 1급 보정 대상으로 처리합니다. scheduler는 표마다 독립 table-specific work item을 만들기 때문에 한 페이지에 표가 여러 개 있어도 bbox, crop, context, validation 상태가 섞이지 않습니다. table validator는 target identity, 같은 페이지 다른 표 내용 혼입, cell, span, header, unit, footnote, empty-cell expansion, adjacent-page continuation ref를 확인한 뒤에야 auto-apply 또는 proposal 결정을 허용합니다.

```typescript
const tokenUsageReport = await pdfParser.parse(
  'file:///path/to/input.pdf',
  'report-001',
  async (outputPath) => console.log(outputPath),
  false,
  {
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
        tableCorrection: openai(process.env.HERIPO_MODEL!),
      },
      autoApplyThreshold: 0.85,
      proposalThreshold: 0.5,
      maxRetries: {
        textCorrection: 3,
        pageGate: 3,
        reviewAssistance: 3,
        tableCorrection: 3,
      },
      temperature: 0,
      outputLanguage: 'ko-KR',
    },
    onReviewAssistanceProgress: (event) => {
      console.log(event.substage, event.status, event.pageNo);
    },
  },
);
```

전체 파이프라인에는 로컬 `file://` PDF를 사용하세요. HTTP 입력은 Docling에서 받지만 로컬 페이지 렌더링·언어 감지·문서 검증은 건너뜁니다. `pages/page_<index>.png`가 없으면 텍스트 보정을 생략하므로 콜백 성공이 모든 페이지의 보정 성공을 뜻하지는 않습니다. 보정 호출이 실패한 페이지는 OCR 원문을 유지하고 경고를 기록합니다. 고신뢰도 수정은 `result.json`에 적용하고, 원본 snapshot은 `result_review_origin.json`, `result_ocr_origin.json`에 보존하며, `review_assistance_page_gate.json`과 페이지별 결정, 이슈, proposal, call trace, validation status, 요약 count를 담은 `review_assistance.json`을 기록합니다.

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
      correction: {
        models: {
          textCorrection: openai(process.env.HERIPO_MODEL!),
          pageGate: openai(process.env.HERIPO_MODEL!),
          reviewAssistance: openai(process.env.HERIPO_MODEL!),
        },
      },
      documentValidationModel: openai(process.env.HERIPO_MODEL!),
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
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
      },
    },
    chunkedConversion: true,
    chunkSize: 50, // Pages per chunk (default: 10)
    chunkMaxRetries: 3, // Retries per failed chunk (default: 2)
  },
);
```

청크 변환 결과를 합친 뒤 보정을 수행합니다. 현재 구현은 청크 변환 실패 시 `enableImagePdfFallback`과 별개로 이미지 PDF 재시도를 수행하므로 이 경로에도 ImageMagick/Ghostscript가 필요합니다. `chunkedConversion`과 `forceImagePdf`를 함께 지정한 로컬 입력은 청크 분기가 우선합니다.

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
    correction: {
      models: {
        textCorrection: openai(process.env.HERIPO_MODEL!),
        pageGate: openai(process.env.HERIPO_MODEL!),
        reviewAssistance: openai(process.env.HERIPO_MODEL!),
      },
    },
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
    {
      correction: {
        models: {
          textCorrection: openai(process.env.HERIPO_MODEL!),
          pageGate: openai(process.env.HERIPO_MODEL!),
          reviewAssistance: openai(process.env.HERIPO_MODEL!),
        },
      },
    },
    controller.signal, // AbortSignal
  );
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    console.log('파싱이 취소되었습니다');
  }
}
```

## 서버 크래시 복구

로컬 docling-serve 인스턴스(포트 모드)를 사용할 때, 파서가 서버 크래시(ECONNREFUSED 에러)를 자동으로 감지하고 서버를 재시작합니다. 이 과정은 `parse()` 호출 중에 투명하게 처리되며, 실패한 작업은 서버 재시작 후 재시도됩니다.

> **참고**: 서버 크래시 복구는 로컬 서버 모드(`port` 옵션)에서만 사용 가능합니다. 외부 서버(`baseUrl` 옵션)를 사용할 때는 복구를 시도하지 않습니다.

## 왜 macOS 전용인가?

패키지는 `os: ["darwin"]`을 선언하고 `init()`에서 macOS와 로컬 도구를 확인합니다. `baseUrl`로 외부 Docling 서버를 연결해도 이 클라이언트 제한은 유지됩니다. ocrmac OCR은 macOS의 Apple Vision을 사용합니다.

Docling OCR은 로컬에서 실행할 수 있지만 VLM 보정에는 설정한 모델을 호출합니다. 클라우드 모델을 선택하면 문서 텍스트와 페이지 이미지가 해당 provider로 전송될 수 있고 API 비용이 발생합니다. 전체 처리를 로컬에 유지하려면 언어 감지·문서 검증·보정·fallback·후속 문서 처리 모델까지 로컬로 설정해야 합니다.

## 시스템 의존성 상세

`@heripo/pdf-parser`는 다음 시스템 레벨 의존성이 필요합니다:

| 의존성      | 필수 버전  | 설치 방법                  | 용도                                                           |
| ----------- | ---------- | -------------------------- | -------------------------------------------------------------- |
| Python      | 3.9 - 3.12 | `brew install python@3.11` | Docling SDK 실행 환경                                          |
| poppler     | Any        | `brew install poppler`     | PDF 페이지 수 확인 (pdfinfo) 및 텍스트 레이어 추출 (pdftotext) |
| jq          | Any        | `brew install jq`          | JSON 처리 (변환 결과 파싱)                                     |
| lsof        | Any        | macOS 기본 설치됨          | docling-serve 포트 관리                                        |
| ImageMagick | Any        | `brew install imagemagick` | 이미지 PDF 폴백 및 페이지 렌더링                               |
| Ghostscript | Any        | `brew install ghostscript` | 이미지 PDF 폴백 (PDF를 이미지로 변환)                          |

> **현재 설치 코드는 Python 3.13 이상을 거부합니다.** [python-version.ts](./src/utils/python-version.ts)의 검사를 참고하세요.

### Python 버전 확인

```bash
# 설치된 Python 버전 확인
python3 --version
export PATH="$(brew --prefix python@3.11)/libexec/bin:$PATH"
python3 --version

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
  timeout?: number; // 타임아웃 (밀리초, 기본값: 100000)
  venvPath?: string; // Python venv 경로 (기본값: CWD/.venv)
  killExistingProcess?: boolean; // 포트의 기존 프로세스 종료 (기본값: false)
  enableImagePdfFallback?: boolean; // 이미지 PDF 폴백 활성화 (기본값: false, ImageMagick + Ghostscript 필요)
} & (
  | { port?: number } // 로컬 모드; port를 명시해야 함 (런타임 기본값 없음)
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

##### `isReady(): Promise<boolean>` / `ensureReady(): Promise<void>`

`isReady()`는 복구 없이 상태만 확인합니다. 초기화 후 사용하는 `ensureReady()`는 로컬 서버 복구를 시도하며 외부 서버 오류는 그대로 전달합니다. `dispose()`는 재사용한 서버를 포함해 설정된 로컬 포트의 프로세스를 종료하므로 외부에서 수명을 관리하는 서버는 `baseUrl`로 연결하세요.

### PDFConvertOptions

```typescript
type PDFConvertOptions = {
  // Docling 이후 필수 보정
  correction: PDFCorrectionOptions;

  // 이미지 PDF 옵션
  forceImagePdf?: boolean; // 이미지 기반 PDF 사전 변환 강제

  // 토큰 사용량 추적
  aggregator?: LLMTokenUsageAggregator; // 토큰 사용량 집계기
  onTokenUsage?: (report: TokenUsageReport) => void; // 토큰 사용량 업데이트 콜백

  // 문서 처리
  document_timeout?: number; // 문서 처리 타임아웃 (초)
  languageDetectionModel?: LanguageModel;
  languageDetectionFallbackModel?: LanguageModel;
  documentValidationModel?: LanguageModel; // 문서 유형 검증용 LLM

  // 보정 진행 상황
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

### PDFCorrectionOptions

```typescript
interface PDFCorrectionOptions {
  models: {
    textCorrection: LanguageModel; // 필수: 페이지 텍스트와 표 셀 OCR 보정
    textCorrectionFallback?: LanguageModel; // 선택: textCorrection 실패 시 fallback
    pageGate: LanguageModel; // 필수: 구조 Review Assistance page gate
    pageGateFallback?: LanguageModel; // 선택: pageGate 실패 시 fallback
    reviewAssistance: LanguageModel; // 필수: 기본 구조 review 모델
    reviewAssistanceFallback?: LanguageModel; // 선택: reviewAssistance 공통 fallback
    tableCorrection?: LanguageModel; // 선택: 표 전용 보정 override
    tableCorrectionFallback?: LanguageModel; // 선택: tableCorrection 실패 시 fallback
    reviewAssistanceTasks?: Partial<
      Record<
        | 'text_ocr_hanja'
        | 'text_integrity'
        | 'text_role_footnote'
        | 'tables'
        | 'pictures_captions'
        | 'layout_bbox_order',
        LanguageModel
      >
    >;
    reviewAssistanceTasksFallback?: Partial<
      Record<
        | 'text_ocr_hanja'
        | 'text_integrity'
        | 'text_role_footnote'
        | 'tables'
        | 'pictures_captions'
        | 'layout_bbox_order',
        LanguageModel
      >
    >;
  };
  concurrency?: {
    pages?: number; // 페이지 단위 text correction/page gate 동시성
    reviewTasks?: number; // 구조 Review Assistance work-item 동시성
    tables?: number; // Accepted but not forwarded by the top-level pipeline
  };
  maxRetries?: {
    textCorrection?: number;
    pageGate?: number;
    reviewAssistance?: number;
    tableCorrection?: number;
  };
  modelConcurrency?: number; // 로컬 모델 요청 동시성 상한
  workItemTimeoutMs?: number; // work item별 timeout
  outputLanguage?: string; // 사람이 읽는 review reason 언어 (기본값: en-US)
  pageGate?: {
    structuralNoiseThreshold?: number;
  };
  autoApplyThreshold?: number; // 자동 적용 최소 confidence (기본값: 0.85)
  proposalThreshold?: number; // sidecar proposal 최소 confidence (기본값: 0.5)
  forceAutoApply?: boolean; // true일 경우, confidence 임계값에 관계없이 review-assistance 명령을 자동 적용 (기본값: false)
  reviewAssistanceEnabled?: boolean; // false일 경우, review-assistance 단계를 완전히 건너뜀 (기본값: true)
  tableCorrectionEnabled?: boolean; // false일 경우, table-correction 작업을 건너뜀 (기본값: true)
  temperature?: number; // VLM 생성 temperature (기본값: 0)
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

현재 `@heripo/pdf-parser`는 macOS 전용이며 Linux/Windows 실행 경로를 제공하지 않습니다. 플랫폼 관련 제안은 [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)에 남겨주세요.

## 관련 패키지

- [@heripo/document-processor](../document-processor/README.ko.md) - 문서 구조 분석 및 LLM 처리
- [@heripo/model](../model/README.ko.md) - 데이터 모델 및 타입 정의

## 후원

heripo lab의 오픈소스 연구를 후원하려면 다음 경로를 이용할 수 있습니다:

- [Open Collective](https://opencollective.com/heripo-project): 전반적인 프로젝트 후원
- [fairy.hada.io/@heripo](https://fairy.hada.io/@heripo): 한국인 개인 후원자를 위한 원화 결제

## 라이선스

이 패키지는 [Apache License 2.0](../../LICENSE) 라이선스 하에 배포됩니다.

## 기여하기

기여는 언제나 환영합니다! [기여 가이드](../../CONTRIBUTING.md)를 참고하세요.

## 이슈 및 지원

- **버그 리포트**: [GitHub Issues](https://github.com/heripo-lab/heripo-engine/issues)
- **토론**: [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)
- **보안 취약점**: [보안 정책](../../SECURITY.md) 참고

## 프로젝트 전체 정보

이 패키지에서 다루지 않는 프로젝트 전체 정보는 [루트 README](../../README.ko.md)에서 확인하세요:

- **인용 및 출처 표기**: 학술 인용(BibTeX) 및 출처 표기 방법
- **기여 가이드라인**: 개발 가이드라인, 커밋 규칙, PR 절차
- **커뮤니티**: 이슈 트래커, 토론, 보안 정책
- **로드맵**: 프로젝트 개발 계획

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
