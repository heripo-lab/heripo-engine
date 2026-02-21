# Demo Web - heripo engine 웹 데모

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

> heripo engine의 PDF 처리 기능을 시각화하는 Next.js 웹 애플리케이션

[English](./README.md) | **한국어**

> **참고**: 프로젝트 전체 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

## 개요

Demo Web은 heripo engine의 PDF 파싱 및 문서 처리 기능을 실시간으로 모니터링하고 시각화할 수 있는 풀스택 Next.js 애플리케이션입니다.

### 주요 기능

- PDF 업로드 및 처리 옵션 설정
- 실시간 처리 상태 모니터링 (SSE)
- 처리 결과 시각화 (목차, 이미지, 표)
- 작업 큐 관리

### 기술 스택

- **프레임워크**: Next.js 16 (App Router)
- **상태 관리**: React Query (TanStack Query)
- **폼 관리**: TanStack React Form
- **UI**: shadcn/ui + Tailwind CSS
- **실시간 통신**: Server-Sent Events (SSE)
- **LLM 통합**: Vercel AI SDK

## 온라인 데모

로컬 설치 없이 바로 체험할 수 있습니다:

**🔗 https://engine-demo.heripo.com**

### 온라인 데모 제한 사항

온라인 데모는 서버 자원 보호를 위해 다음과 같은 제한이 있습니다:

| 항목           | 제한        |
| -------------- | ----------- |
| 일일 처리 횟수 | 3회         |
| 동시 처리      | 1개         |
| 처리 옵션      | 기본값 고정 |
| LLM 모델 선택  | 기본값 고정 |

### 전체 기능 사용

모든 기능을 자유롭게 사용하려면 로컬에서 실행하세요:

- 무제한 PDF 처리
- 모든 처리 옵션 커스터마이징
- 다양한 LLM 모델 선택
- OCR 언어 및 스레드 설정

## 사전 요구사항

### PDF Parser 요구사항

이 애플리케이션은 `@heripo/pdf-parser`에 의존하며, 특정 시스템 요구사항이 있습니다.

**반드시 [@heripo/pdf-parser 문서](../../packages/pdf-parser/README.ko.md#사전-요구사항)를 참고하여 다음을 확인하세요:**

- macOS 시스템 요구사항 (Apple Silicon 또는 Intel)
- Python 버전 요구사항 (3.9-3.12)
- 필수 시스템 의존성 (jq, lsof)
- 최초 실행 설정 안내

### Node.js 및 패키지 관리자

- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0

### LLM API 키

다음 LLM 프로파이더 중 하나 이상의 API 키가 필요합니다:

- OpenAI (권장)
- Anthropic
- Google Generative AI
- Together AI

## 설치 및 실행

### 1. 환경 변수 설정

```bash
# .env.example을 .env로 복사
cp .env.example .env

# .env 파일을 편집하여 API 키 입력
```

`.env` 파일 예시:

```bash
# 최소 하나의 API 키는 필수입니다
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# 선택사항
PDF_PARSER_PORT=5001
PDF_PARSER_TIMEOUT=10000000
```

#### 웹훅 설정 (선택사항)

퍼블릭 모드에서 이벤트 알림을 받으려면 웹훅을 설정할 수 있습니다:

```bash
# 웹훅 설정 (퍼블릭 모드에서만 동작)
WEBHOOK_URL=https://your-endpoint.com/webhook
WEBHOOK_SECRET=your-hmac-secret-key
```

**지원 이벤트:**

| 이벤트                | 설명                |
| --------------------- | ------------------- |
| `task.started`        | 처리 시작           |
| `task.completed`      | 처리 완료           |
| `task.failed`         | 처리 실패           |
| `task.cancelled`      | 처리 취소           |
| `otp.failed`          | OTP 인증 실패       |
| `otp.locked`          | OTP 3회 실패로 잠금 |
| `rate_limit.exceeded` | 일일 제한 도달      |

모든 웹훅에는 `event`, `timestamp`, `ip`, `userAgent`, `filename` 필드가 포함됩니다. 페이로드는 `WEBHOOK_SECRET`을 사용한 HMAC-SHA256 서명이 `X-Webhook-Signature` 헤더에 포함됩니다.

### 2. 의존성 설치

루트 디렉토리에서:

```bash
pnpm install
```

### 3. 개발 서버 실행

```bash
# 루트에서
pnpm --filter demo-web dev

# 또는 demo-web 디렉토리에서
cd apps/demo-web
pnpm dev
```

브라우저에서 http://localhost:3000 접속

## 사용 가이드

### 1. PDF 업로드

1. 홈 페이지에서 "PDF 파일 선택" 버튼 클릭
2. 처리할 PDF 파일 선택
3. LLM 프로파이더 및 모델 선택
4. "처리 시작" 버튼 클릭

### 2. 실시간 모니터링

- 처리 페이지로 자동 이동
- 실시간 로그 확인
- 처리 단계별 진행 상태 표시

### 3. 결과 확인

처리 완료 후:

- 목차 구조 시각화
- 추출된 이미지 보기
- 테이블 데이터 확인

### 4. 작업 관리

- "작업 목록" 페이지에서 모든 작업 확인
- 작업 삭제
- 이전 작업 결과 재확인

## 아키텍처

### 폴더 구조

```
src/
├── app/                      # Next.js App Router
│   ├── api/                  # API 라우트
│   │   └── tasks/            # 작업 관리 API
│   ├── tasks/                # 작업 목록 페이지
│   ├── process/[taskId]/     # 실시간 처리 페이지
│   └── result/[taskId]/      # 결과 페이지
├── components/
│   ├── layout/               # 레이아웃 컴포넌트
│   ├── providers/            # React Query Provider
│   └── ui/                   # shadcn/ui 컴포넌트
├── features/                 # 기능별 모듈
│   ├── upload/               # PDF 업로드 & 설정
│   ├── process/              # 실시간 처리
│   ├── result/               # 결과 표시
│   └── tasks/                # 작업 관리
└── lib/
    ├── api/                  # API 클라이언트
    ├── db/                   # JSON 파일 DB
    ├── queue/                # 작업 큐
    └── query-client.ts       # React Query 설정
```

### React Query 사용

**중요**: 이 앱에서는 모든 API 호출에 React Query를 사용합니다. 컴포넌트에서 직접 `fetch()`를 사용하지 마세요.

```typescript
// ✅ 올바른 방법: React Query 훅 사용
import { useTasks } from '~/features/tasks';

const { data, isLoading } = useTasks();

// ❌ 잘못된 방법: 직접 fetch 호출
const response = await fetch('/api/tasks');
```

**제공되는 훅:**

- `useTaskResult(taskId)` - 작업 결과 조회
- `useTasks()` - 작업 목록 조회
- `useDeleteTask()` - 작업 삭제 (mutation)
- `useCreateTask()` - 작업 생성 (mutation)
- `useTaskStream(taskId)` - SSE 실시간 스트림

## 테스트에 대해

> **참고**: demo-web은 핵심 로직이나 제품이 아닌, heripo engine의 기능을 시각화하고 체험하기 위한 **데모용 웹 애플리케이션**입니다. 따라서 별도의 테스트 코드를 작성하지 않습니다.

핵심 비즈니스 로직과 테스트는 다음 패키지에 집중되어 있습니다:

- `@heripo/pdf-parser`: PDF 파싱 핵심 로직
- `@heripo/document-processor`: 문서 처리 파이프라인
- `@heripo/shared`: 공유 유틸리티

## 개발 가이드

### OTP 시크릿 생성

퍼블릭 모드 우회를 위한 TOTP 시크릿을 생성합니다:

```bash
pnpm --filter demo-web generate:otp-secret
```

출력된 값을 `.env` 파일의 `OTP_SECRET`에 설정하세요.

### 업로드 세션 시크릿 생성

대용량 파일(50MB 이상) 업로드를 위한 JWT 서명 시크릿을 생성합니다:

```bash
# Node.js로 랜덤 시크릿 생성
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 또는 openssl 사용
openssl rand -base64 32
```

출력된 값을 `.env` 파일의 `UPLOAD_SESSION_SECRET`에 설정하세요.

### 타입 검사

```bash
pnpm typecheck
```

### 린트

```bash
pnpm lint
pnpm lint:fix
```

### 빌드

```bash
pnpm build
```

### 프로덕션 실행

```bash
pnpm build
pnpm start
```

## 배포 시 주의사항

### 싱글 프로세스만 지원 (의도적 설계)

> **중요**: 이 애플리케이션은 **싱글 프로세스 환경에서만** 정상 동작합니다. pm2 클러스터 모드 등 멀티 프로세스 환경을 **지원하지 않으며, 앞으로도 지원 계획이 없습니다**.

**왜 멀티 프로세스를 지원하지 않나요?**

Demo Web은 heripo engine의 기능을 시연하기 위한 **데모용 애플리케이션**입니다. 프로덕션 환경을 위한 고가용성 시스템이 아닙니다.

멀티 프로세스 지원을 위해서는 Redis, PostgreSQL, 메시지 큐 등 복잡한 인프라 도입이 필요합니다. 이는 데모 앱의 본래 목적에 비해 과도한 오버엔지니어링이며, 코드 복잡도가 급격히 증가하여 오히려 핵심 라이브러리(`@heripo/pdf-parser`, `@heripo/document-processor`)의 이해와 활용을 방해합니다.

따라서 **의도적으로 단순한 아키텍처를 유지**하며, 멀티 프로세스 지원은 로드맵에 포함되어 있지 않습니다.

**현재 아키텍처의 제약:**

| 컴포넌트         | 멀티 프로세스 시 문제                |
| ---------------- | ------------------------------------ |
| JSON 파일 DB     | 동시 쓰기 시 데이터 손실             |
| TaskQueueManager | 프로세스별 별도 큐 → 중복 처리       |
| SSE EventEmitter | 프로세스 로컬 → 실시간 업데이트 누락 |
| PDFParserManager | 포트 충돌                            |

**올바른 pm2 실행 방법:**

```bash
# ✅ 올바름: fork 모드 (싱글 프로세스)
pm2 start pnpm --name "demo-web" -- start

# ❌ 금지: 클러스터 모드 (멀티 프로세스)
pm2 start pnpm --name "demo-web" -i max -- start
```

## 문제 해결

### API 키 오류

**증상**: "API key not configured"

**해결**:

- `.env` 파일이 있는지 확인
- 올바른 API 키가 설정되어 있는지 확인
- 개발 서버 재시작

### PDF 처리 실패

**증상**: "Failed to parse PDF"

**해결**:

- [@heripo/pdf-parser 문서](../../packages/pdf-parser/README.ko.md#문제-해결)의 문제 해결 섹션 참고
- Python 버전 확인 (3.9-3.12)
- jq가 설치되어 있는지 확인

### 포트 충돌

**증상**: "Port 3000 already in use"

**해결**:

```bash
# 다른 포트 사용
PORT=3001 pnpm dev
```

## 라이선스

이 프로젝트는 [Apache License 2.0](../../LICENSE) 라이선스 하에 배포됩니다.

## 프로젝트 전체 정보

이 패키지에서 다루지 않는 프로젝트 전체 정보는 [루트 README](../../README.ko.md)에서 확인하세요:

- **인용 및 출처 표기**: 학술 인용(BibTeX) 및 출처 표기 방법
- **기여 가이드라인**: 개발 가이드라인, 커밋 규칙, PR 절차
- **커뮤니티**: 이슈 트래커, 토론, 보안 정책
- **로드맵**: 프로젝트 개발 계획

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
