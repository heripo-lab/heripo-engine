# heripo engine

> 고고학 발굴조사보고서 PDF에서 구조화된 데이터를 추출하는 TypeScript 라이브러리

[![CI](https://github.com/heripo-lab/heripo-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/heripo-lab/heripo-engine/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.9--3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10-orange)](https://pnpm.io)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

[English](./README.md) | **한국어**

> ⚠️ **macOS 전용**: 이 프로젝트는 현재 macOS (Apple Silicon 또는 Intel)에서만 지원됩니다.
> 자세한 시스템 요구사항은 [@heripo/pdf-parser README](./packages/pdf-parser/README.ko.md#사전-요구사항)를 참고하세요.

> ℹ️ **참고 사항 (v0.1.x)**:
>
> - **혼합 문자 감지**: 한글·한자 혼용 문서를 자동 감지하여 VLM(Vision Language Model)으로 보정
> - **목차 의존성**: 목차가 없는 보고서는 처리 실패 (의도된 동작). 드문 추출 실패는 human intervention으로 대응 예정
> - **세로쓰기 문서**: 페이지 번호가 한자인 오래된 세로쓰기 문서는 장기 목표이나 현재 계획에 없음

> 🌐 **온라인 데모**: 로컬 설치 없이 바로 체험해 보세요 → [engine-demo.heripo.com](https://engine-demo.heripo.com)

## 목차

- [소개](#소개)
  - [heripo lab 소개](#heripo-lab-소개)
  - [왜 heripo engine인가?](#왜-heripo-engine인가)
  - [데이터 파이프라인](#데이터-파이프라인)
- [주요 기능](#주요-기능)
- [아키텍처](#아키텍처)
- [설치](#설치)
- [패키지](#패키지)
- [사용 예제](#사용-예제)
- [데모 애플리케이션](#데모-애플리케이션)
- [문서](#문서)
- [로드맵](#로드맵)
- [기여하기](#기여하기)
- [인용 및 출처 표기](#인용-및-출처-표기)
- [라이선스](#라이선스)

## 소개

heripo engine은 고고학 발굴조사보고서 PDF를 분석하여 구조화된 데이터를 추출하는 도구 모음입니다. 복잡한 레이아웃, 표, 도면, 사진이 포함된 수백 페이지 분량의 문서를 효과적으로 처리할 수 있도록 설계되었습니다.

### heripo lab 소개

heripo lab은 고고학 도메인 지식과 소프트웨어 엔지니어링 기술을 결합하여, 실질적인 연구 효율화를 이끄는 오픈소스 R&D 그룹입니다.

#### 김홍연 (Lead Engineer)

- Role: LLM 기반 비정형 데이터 추출 파이프라인 설계 및 시스템 구현
- Background: 소프트웨어 엔지니어 (고고학·컴퓨터과학 전공)
- Research:
  - [「대형 언어 모델(LLM)을 활용한 고고학 정보화 연구 -발굴조사보고서의 메타데이터 자동 추출 파이프라인 개념 검증-」](https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003244876) (2025, KCI 등재)

#### 조하영 (Domain Researcher)

- Role: 고고학 데이터 온톨로지 설계, 데이터 스키마 정의 및 학술적 정합성 검증
- Background: 고고학전공 박사과정, 인문정보학 석사
- Research:
  - [「해양문화유산 데이터 구조화에 대한 제언」](https://doi.org/10.22917/island.2025..66.271) (2025, KCI 등재)
  - [「해양문화유산 시맨틱 데이터 설계 : 태안 마도 해역 출수 고선박과 목간을 대상으로」](https://lib.aks.ac.kr/#/search/detail/1036933) (2025, 석사학위논문)

### 왜 heripo engine인가?

고고학 발굴조사보고서는 귀중한 문화유산 정보를 담고 있지만, PDF 형식으로만 존재하는 경우가 많아 체계적인 분석과 활용이 어렵습니다. heripo engine은 다음과 같은 문제를 해결합니다:

- **OCR 품질**: Docling SDK를 활용하여 스캔된 문서도 높은 정확도로 인식
- **구조 추출**: 목차, 장/절, 이미지, 표 등 문서 구조를 자동으로 파악
- **비용 효율성**: 클라우드 OCR 대신 로컬 처리로 비용 절감 (무료)

> **고고학 외 활용**: heripo engine은 고고학 보고서에 최적화되어 있지만, PDF 구조화 기능(텍스트, 표, 이미지, 목차 추출)은 심하게 훼손된 스캔 PDF나 타 도메인 문서(건축, 역사 등)에서도 충분한 성능을 발휘합니다. 포크(Fork)하여 자유롭게 개조해서 사용해도 됩니다.

### 데이터 파이프라인

```
원천 데이터 추출 → 고고학 데이터 원장 → 고고학 데이터 표준 → 분야별 온톨로지 → DB 저장
```

| 단계                 | 설명                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| **원천 데이터 추출** | PDF 보고서의 양식 그대로 구조적으로 추출한 문서 데이터 (고고학적 해석 없음) |
| **데이터 원장**      | 전세계 고고학을 포괄하는 범용 모델로 구조화된 불변의 원장                   |
| **데이터 표준**      | 확장 가능한 표준 모델 (기본 표준 → 국가별 → 분야별 확장)                    |
| **온톨로지**         | 도메인 특화 시맨틱 모델 및 지식 그래프                                      |
| **DB 저장**          | 각 파이프라인 단계별로 독립적 저장 및 활용                                  |

**현재 구현 단계 (v0.1.x):**

- ✅ PDF 파싱 및 OCR (Docling SDK)
- ✅ 문서 구조 추출 (목차, 장/절, 페이지 매핑)
- ✅ 이미지/테이블 추출 및 캡션 파싱

**계획된 단계:**

- 🔜 불변의 원장 (범용 고고학 모델, 개념 추출)
- 🔜 확장 표준화 (계층적 표준 모델, 정규화)
- 🔜 온톨로지 (시맨틱 모델, 지식 그래프)
- 🔜 프로덕션 준비 (성능 최적화, API 안정성)

자세한 로드맵은 [docs/roadmap.ko.md](./docs/roadmap.ko.md)를 참고하세요.

## 주요 기능

### PDF 파싱 (`@heripo/pdf-parser`)

- **고품질 OCR**: Docling SDK를 활용한 문서 인식 (ocrmac / Apple Vision Framework)
- **혼합 문자 자동 감지 및 보정**: 한글·한자 혼용 페이지를 자동 감지하여 VLM으로 보정 — ocrmac은 속도·품질이 우수하여 대량 처리에 최적이지만 혼합 문자 체계를 처리하지 못하므로, 해당 페이지만 VLM으로 보정
- **Apple Silicon 최적화**: M1/M2/M3/M4/M5 칩에서 GPU 가속 지원
- **자동 환경 설정**: Python 가상환경 및 docling-serve 자동 설치
- **이미지 추출**: PDF 내 이미지 자동 추출 및 저장

### 문서 처리 (`@heripo/document-processor`)

- **목차 추출**: 규칙 기반 + LLM 폴백으로 목차 자동 인식
- **계층 구조**: 장/절/소절 계층 구조 자동 생성
- **페이지 매핑**: Vision LLM을 활용한 실제 페이지 번호 매핑
- **캡션 파싱**: 이미지 및 테이블 캡션 자동 파싱
- **LLM 유연성**: OpenAI, Anthropic, Google 등 다양한 LLM 지원

### 데이터 모델 (`@heripo/model`)

- **ProcessedDocument**: LLM 분석에 최적화된 중간 데이터 모델
- **DoclingDocument**: Docling SDK의 원시 출력 형식
- **타입 안전성**: 완전한 TypeScript 타입 정의

## 아키텍처

heripo engine은 pnpm 워크스페이스 기반 모노레포로 구성되어 있습니다.

```
heripo-engine/
├── packages/              # 핵심 라이브러리
│   ├── pdf-parser/        # PDF → DoclingDocument
│   ├── document-processor/ # DoclingDocument → ProcessedDocument
│   ├── model/             # 데이터 모델 및 타입 정의
│   └── shared/            # 내부 유틸리티 (배포 안 함)
├── apps/                  # 애플리케이션
│   └── demo-web/          # Next.js 웹 데모
└── tools/                 # 빌드 도구 설정
    ├── logger/            # 로깅 유틸리티 (배포 안 함)
    ├── tsconfig/          # 공유 TypeScript 설정
    ├── tsup-config/       # 빌드 설정
    └── vitest-config/     # 테스트 설정
```

자세한 아키텍처 설명은 [docs/architecture.ko.md](./docs/architecture.ko.md)를 참고하세요.

## 설치

### 시스템 요구사항

- **macOS** (Apple Silicon 또는 Intel)
- **Node.js** >= 24.0.0
- **pnpm** >= 10.0.0
- **Python** 3.9 - 3.12 (⚠️ Python 3.13+는 지원하지 않음)
- **jq** (JSON 처리 도구)
- **poppler** (PDF 텍스트 추출 도구)

```bash
# Python 3.11 설치 (권장)
brew install python@3.11

# jq 설치
brew install jq

# poppler 설치
brew install poppler

# Node.js 및 pnpm 설치
brew install node
npm install -g pnpm
```

자세한 설치 가이드는 [@heripo/pdf-parser README](./packages/pdf-parser/README.ko.md#사전-요구사항)를 참고하세요.

### 패키지 설치

```bash
# 개별 패키지 설치
pnpm add @heripo/pdf-parser
pnpm add @heripo/document-processor
pnpm add @heripo/model

# 또는 모두 설치
pnpm add @heripo/pdf-parser @heripo/document-processor @heripo/model
```

## 패키지

| 패키지                                                      | 버전  | 설명                       |
| ----------------------------------------------------------- | ----- | -------------------------- |
| [@heripo/pdf-parser](./packages/pdf-parser)                 | 0.1.x | PDF 파싱 및 OCR            |
| [@heripo/document-processor](./packages/document-processor) | 0.1.x | 문서 구조 분석 및 LLM 처리 |
| [@heripo/model](./packages/model)                           | 0.1.x | 데이터 모델 및 타입 정의   |

## 사용 예제

### 기본 사용법

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { DocumentProcessor } from '@heripo/document-processor';
import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';

const logger = Logger(...);

// 1. PDF 파싱
const pdfParser = new PDFParser({
  port: 5001,
  logger,
});

await pdfParser.init();

const tokenUsageReport = await pdfParser.parse(
  'path/to/report.pdf',
  'report-001',
  async (outputPath) => {
    // 2. 문서 처리 (콜백 내부에서)
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

    // 3. 결과 활용
    console.log('목차:', document.chapters);
    console.log('이미지:', document.images);
    console.log('표:', document.tables);
    console.log('각주:', document.footnotes);
    console.log('토큰 사용량:', usage.total);
  },
  true, // cleanupAfterCallback
  {}, // PDFConvertOptions
);

// 정리
await pdfParser.dispose();
```

### 고급 사용법

```typescript
// 컴포넌트별 LLM 모델 지정 + fallback 재시도
const processor = new DocumentProcessor({
  logger,
  fallbackModel: anthropic('claude-opus-4-5'), // 실패 시 재시도용
  pageRangeParserModel: openai('gpt-5.2'),
  tocExtractorModel: openai('gpt-5.1'),
  validatorModel: openai('gpt-5.2'),
  visionTocExtractorModel: openai('gpt-5-mini'),
  captionParserModel: openai('gpt-5-nano'),
  textCleanerBatchSize: 20,
  captionParserBatchSize: 10,
  captionValidatorBatchSize: 10,
  maxRetries: 3,
  enableFallbackRetry: true, // 실패 시 fallbackModel로 자동 재시도 (기본값: false)
  onTokenUsage: (report) => console.log('토큰 사용량:', report.total),
});
```

## 데모 애플리케이션

### 온라인 데모

로컬 설치 없이 바로 체험해 보세요:

**🔗 https://engine-demo.heripo.com**

> 온라인 데모는 일일 사용량 제한(3회)이 있습니다. 전체 기능은 로컬 실행을 권장합니다.

### Web Demo (Next.js)

실시간 PDF 처리 모니터링을 제공하는 웹 애플리케이션:

```bash
cd apps/demo-web
cp .env.example .env
# .env 파일에 LLM API 키 설정

pnpm install
pnpm dev
```

브라우저에서 http://localhost:3000 접속

**주요 기능:**

- PDF 업로드 및 처리 옵션 설정
- 실시간 처리 상태 모니터링 (SSE)
- 처리 결과 시각화 (목차, 이미지, 표)
- 작업 큐 관리

자세한 사용법은 [apps/demo-web/README.ko.md](./apps/demo-web/README.ko.md)를 참고하세요.

## 문서

- [아키텍처 문서](./docs/architecture.ko.md) - 시스템 설계 및 구조
- [로드맵](./docs/roadmap.ko.md) - 개발 계획 및 비전
- [기여 가이드](./CONTRIBUTING.md) - 기여 방법
- [보안 정책](./SECURITY.md) - 취약점 보고 절차
- [행동 강령](./CODE_OF_CONDUCT.md) - 커뮤니티 행동 강령

### 패키지별 문서

- [@heripo/pdf-parser](./packages/pdf-parser/README.ko.md)
- [@heripo/document-processor](./packages/document-processor/README.ko.md)
- [@heripo/model](./packages/model/README.ko.md)

## 로드맵

현재 버전: **v0.1.x** (초기 공개)

### v0.1.x - 원천 데이터 추출 (현재)

- ✅ PDF 파싱 with OCR
- ✅ 문서 구조 추출 (목차, 장/절)
- ✅ 이미지/테이블 추출
- ✅ 페이지 매핑
- ✅ 캡션 파싱

### v0.2.x - 불변의 원장

- 전세계 고고학을 포괄하는 범용 데이터 모델 설계
- 고고학 개념 추출 (유구, 유물, 층위, 조사구역)
- LLM 기반 정보 추출 파이프라인

### v0.3.x - 확장 표준화

- 계층적 표준 모델 설계 (기본 → 국가별 → 분야별)
- 정규화 파이프라인
- 데이터 검증

### v0.4.x - 온톨로지

- 도메인 특화 시맨틱 모델
- 지식 그래프 구축

### v1.0.x - 프로덕션 준비

- 성능 최적화
- API 안정성 보장
- 포괄적인 테스트

자세한 내용은 [docs/roadmap.ko.md](./docs/roadmap.ko.md)를 참고하세요.

## 개발

### 모노레포 명령어

```bash
# 의존성 설치
pnpm install

# 전체 빌드
pnpm build

# 타입 검사
pnpm typecheck

# 린트
pnpm lint
pnpm lint:fix

# 포맷팅
pnpm format
pnpm format:check

# 전체 테스트
pnpm test
pnpm test:coverage
pnpm test:ci

# 특정 패키지 테스트
pnpm --filter @heripo/pdf-parser test
pnpm --filter @heripo/document-processor test
```

### 패키지별 명령어

```bash
# 특정 패키지 빌드
pnpm --filter @heripo/pdf-parser build

# 특정 패키지 테스트 (커버리지)
pnpm --filter @heripo/pdf-parser test:coverage

# 특정 패키지 watch 모드
pnpm --filter @heripo/pdf-parser dev
```

## 기여하기

heripo engine 프로젝트에 기여해 주셔서 감사합니다! 기여 방법은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 참고하세요.

### 기여 방법

1. 이 저장소를 Fork합니다
2. 기능 브랜치를 생성합니다 (`git checkout -b feature/amazing-feature`)
3. 변경사항을 커밋합니다 (`git commit -m 'feat: add amazing feature'`)
4. 브랜치에 Push합니다 (`git push origin feature/amazing-feature`)
5. Pull Request를 생성합니다

### 개발 가이드라인

- 모든 테스트가 통과해야 합니다 (`pnpm test`)
- 100% 코드 커버리지를 유지해야 합니다
- ESLint 및 Prettier 규칙을 준수해야 합니다
- 커밋 메시지는 Conventional Commits 규칙을 따릅니다

## 커뮤니티

- **이슈 트래커**: [GitHub Issues](https://github.com/heripo-lab/heripo-engine/issues)
- **토론**: [GitHub Discussions](https://github.com/heripo-lab/heripo-engine/discussions)
- **보안 취약점**: [보안 정책](./SECURITY.md) 참고

## 인용 및 출처 표기

이 프로젝트를 연구, 서비스 또는 파생 작업에 사용하시는 경우 다음과 같이 출처를 표기해 주세요:

```
Powered by heripo engine
```

이러한 표기는 오픈소스 프로젝트를 지원하고 기여자들에게 공로를 인정하는 데 도움이 됩니다.

### BibTeX 인용

학술 논문이나 연구 문서에서는 다음 BibTeX 항목을 사용하실 수 있습니다:

```bibtex
@software{heripo_engine,
  author = {Kim, Hongyeon and Cho, Hayoung},
  title = {heripo engine: TypeScript Library for Extracting Structured Data from Archaeological Excavation Report PDFs},
  year = {2026},
  url = {https://github.com/heripo-lab/heripo-engine},
  note = {Apache License 2.0}
}
```

## 라이선스

이 프로젝트는 [Apache License 2.0](./LICENSE) 라이선스 하에 배포됩니다.

## 감사의 말

이 프로젝트는 다음 오픈소스 프로젝트들을 사용합니다:

- [Docling SDK](https://github.com/DS4SD/docling) - PDF 파싱 및 OCR
- [Vercel AI SDK](https://sdk.vercel.ai) - LLM 통합

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
