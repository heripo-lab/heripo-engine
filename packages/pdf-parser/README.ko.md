# @heripo/pdf-parser

> PDF 파싱 라이브러리 - Docling SDK를 활용한 OCR 지원

[![npm version](https://img.shields.io/npm/v/@heripo/pdf-parser.svg)](https://www.npmjs.com/package/@heripo/pdf-parser)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
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
- [왜 macOS 전용인가?](#왜-macos-전용인가)
- [시스템 의존성 상세](#시스템-의존성-상세)
- [API 문서](#api-문서)
- [문제 해결](#문제-해결)
- [라이선스](#라이선스)

## 주요 기능

- **고품질 OCR**: Docling SDK를 활용한 문서 인식
- **Apple Silicon 최적화**: M1/M2/M3/M4/M5 칩에서 GPU 가속 지원
- **자동 환경 설정**: Python 가상환경 및 docling-serve 자동 설치
- **이미지 추출**: PDF 내 이미지 자동 추출 및 저장
- **유연한 설정**: OCR, 포맷, 스레딩 옵션 등 세부 설정 가능

## 사전 요구사항

### 시스템 요구사항

- **macOS** with Apple Silicon (M1/M2/M3) - 최적 성능을 위해 권장
- **macOS** with Intel - 지원되지만 속도가 느림
- **Linux/Windows** - 현재 지원하지 않음

### 필수 의존성

#### 1. Node.js >= 22.0.0

```bash
brew install node
```

#### 2. pnpm >= 9.0.0

```bash
npm install -g pnpm
```

#### 3. Python 3.9 - 3.12

⚠️ **중요**: Python 3.13+는 지원하지 않습니다. Docling SDK의 일부 의존성이 Python 3.13과 호환되지 않습니다.

```bash
# Python 3.11 설치 (권장)
brew install python@3.11

# 버전 확인
python3.11 --version
```

#### 4. jq (JSON 처리 도구)

```bash
brew install jq
```

#### 5. lsof (포트 관리)

macOS에 기본적으로 설치되어 있습니다. 확인:

```bash
which lsof
```

### 최초 실행 설정

`@heripo/pdf-parser`를 처음 사용할 때 자동으로:

1. `~/.heripo/pdf-parser/venv`에 Python 가상환경 생성
2. `docling-serve` 및 의존성 설치
3. 로컬 포트에서 docling-serve 프로세스 시작

이 설정은 한 번만 수행되며 인터넷 연결 상태에 따라 5-10분 정도 소요될 수 있습니다.

## 설치

```bash
# npm으로 설치
npm install @heripo/pdf-parser

# pnpm으로 설치
pnpm add @heripo/pdf-parser

# yarn으로 설치
yarn add @heripo/pdf-parser
```

## 사용법

### 기본 사용법

```typescript
import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';

const logger = Logger(...);

// PDFParser 인스턴스 생성
const pdfParser = new PDFParser({
  pythonPath: 'python3.11', // Python 실행 경로
  logger,
});

// 초기화 (환경 설정 및 docling-serve 시작)
await pdfParser.init();

// PDF 파싱
const outputPath = await pdfParser.parse(
  'path/to/report.pdf', // 입력 PDF 파일
  'output-directory', // 출력 디렉토리
  (resultPath) => {
    // 변환 완료 콜백
    console.log('PDF 변환 완료:', resultPath);
  },
);

// 결과 사용
console.log('출력 경로:', outputPath);
```

### 고급 옵션

```typescript
const pdfParser = new PDFParser({
  pythonPath: 'python3.11',
  logger,

  // docling-serve 설정
  port: 5001, // 사용할 포트 (기본값: 5001)
  timeout: 10000000, // 타임아웃 (밀리초)

  // 외부 docling-serve 사용
  externalDoclingUrl: 'http://localhost:5000', // 외부 서버 사용 시
});

// 변환 옵션 지정
await pdfParser.parse('input.pdf', 'output', (result) => console.log(result), {
  // OCR 설정
  doOcr: true, // OCR 활성화 (기본값: true)

  // 출력 포맷
  formats: ['docling_json', 'md'], // 출력 형식 선택

  // 스레드 수
  pdfBackend: 'dlparse_v2', // PDF 백엔드
});
```

### 이미지 추출

PDF에서 이미지를 자동으로 추출합니다:

```typescript
const outputPath = await pdfParser.parse(
  'report.pdf',
  'output',
  (resultPath) => {
    // 이미지는 output/images/ 디렉토리에 저장됨
    console.log('이미지 추출 완료:', resultPath);
  },
);
```

### 리소스 정리

작업 완료 후 리소스를 정리합니다:

```typescript
// docling-serve 프로세스 종료
await pdfParser.shutdown();
```

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
- **성능**: Apple Silicon M1/M2/M3에서 GPU 가속으로 빠른 처리
- **품질**: 복잡한 레이아웃의 문서도 정확히 인식
- **프라이버시**: 문서가 외부 서버로 전송되지 않음

### Trade-off

- macOS + Apple Silicon 환경에서만 최적 성능
- Linux/Windows 지원은 현재 계획 없음 (아래 "Linux 지원 현황" 참고)

## 시스템 의존성 상세

`@heripo/pdf-parser`는 다음 시스템 레벨 의존성이 필요합니다:

| 의존성 | 필수 버전  | 설치 방법                  | 용도                       |
| ------ | ---------- | -------------------------- | -------------------------- |
| Python | 3.9 - 3.12 | `brew install python@3.11` | Docling SDK 실행 환경      |
| jq     | Any        | `brew install jq`          | JSON 처리 (변환 결과 파싱) |
| lsof   | Any        | macOS 기본 설치됨          | docling-serve 포트 관리    |

> ⚠️ **Python 3.13+는 지원하지 않습니다.** Docling SDK의 일부 의존성이 Python 3.13과 호환되지 않습니다.

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
interface PDFParserOptions {
  pythonPath?: string; // Python 실행 경로 (기본값: 'python3')
  logger?: Logger; // 로거 인스턴스
  port?: number; // docling-serve 포트 (기본값: 5001)
  timeout?: number; // 타임아웃 (밀리초, 기본값: 10000000)
  externalDoclingUrl?: string; // 외부 docling-serve URL (선택)
}
```

#### 메서드

##### `init(): Promise<void>`

Python 환경을 설정하고 docling-serve를 시작합니다.

```typescript
await pdfParser.init();
```

##### `parse(inputPath, outputDir, callback, options?): Promise<string>`

PDF 파일을 파싱합니다.

**파라미터:**

- `inputPath` (string): 입력 PDF 파일 경로
- `outputDir` (string): 출력 디렉토리 경로
- `callback` (function): 변환 완료 시 호출될 콜백 함수
- `options` (ConversionOptions, 선택): 변환 옵션

**반환값:**

- `Promise<string>`: 출력 파일 경로

##### `shutdown(): Promise<void>`

docling-serve 프로세스를 종료합니다.

```typescript
await pdfParser.shutdown();
```

### ConversionOptions

```typescript
interface ConversionOptions {
  doOcr?: boolean; // OCR 활성화 (기본값: true)
  formats?: string[]; // 출력 형식 (기본값: ['docling_json'])
  pdfBackend?: string; // PDF 백엔드 (기본값: 'dlparse_v2')
}
```

## 문제 해결

### Python 버전 오류

**증상**: `Python version X.Y is not supported`

**해결**:

```bash
# Python 3.11 설치
brew install python@3.11

# PDFParser에 명시적으로 지정
const pdfParser = new PDFParser({
  pythonPath: 'python3.11',
  logger,
});
```

### jq를 찾을 수 없음

**증상**: `Command not found: jq`

**해결**:

```bash
brew install jq
```

### 포트 충돌

**증상**: `Port 5001 is already in use`

**해결**:

```bash
# 다른 포트 사용
const pdfParser = new PDFParser({
  pythonPath: 'python3.11',
  port: 5002,  // 다른 포트 지정
  logger,
});
```

### docling-serve 시작 실패

**증상**: `Failed to start docling-serve`

**해결**:

```bash
# 가상환경 재생성
rm -rf ~/.heripo/pdf-parser/venv
# 다시 init() 실행
```

## Linux 지원 현황

현재 **macOS 전용**입니다. Linux 지원은 **완전히 배제한 것은 아니지만**, OCR 성능과 비용 효율성 문제로 **현재는 구체적인 계획이 없습니다**.

| 플랫폼                | 상태    | 비고                            |
| --------------------- | ------- | ------------------------------- |
| macOS + Apple Silicon | ✅ 지원 | 최적 성능, GPU 가속             |
| macOS + Intel         | ✅ 지원 | GPU 가속 없음                   |
| Linux                 | ❓ 미정 | 성능/비용 문제로 현재 계획 없음 |
| Windows               | ❓ 미정 | WSL2 통한 Linux 방식 고려 가능  |

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
