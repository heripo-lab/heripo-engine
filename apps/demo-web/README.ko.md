# Demo Web - heripo engine 웹 데모

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

> heripo engine의 PDF 처리 기능을 시각화하는 Next.js 웹 애플리케이션

[English](./README.md) | **한국어**

> **참고**: 프로젝트 전체 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

## 개요

Demo Web은 heripo engine의 PDF 파싱 및 문서 처리 기능을 실시간으로 모니터링하고 시각화할 수 있는 풀스택 Next.js 애플리케이션입니다.

홈에서는 heripo engine으로 자체 보고서 데이터를 구축하는 별도의 연구 지원 서비스 [heripo 베이스캠프](https://heripo.app)도 소개합니다. 브라우저 언어에 따라 한국어·영어로 표시하며, 비공개 알파 테스트 상태를 안내합니다. 한국의 발굴조사보고서에서 시작해 국가 경계를 넘어 확장해 나간다는 방향도 소개합니다. 데모에 업로드한 보고서와 처리 결과는 베이스캠프에 반영되지 않습니다.

### 주요 기능

- PDF 업로드 및 처리 옵션 설정
- 실시간 처리 상태 모니터링 (SSE)
- 처리 결과 시각화 (목차, 이미지, 표, 병합 셀, 원천 페이지)
- 처리 결과 ZIP 다운로드 (`result-processed.json`, 원천 Docling JSON, source handoff manifest, 이미지, 렌더링 페이지 포함)
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

**🔗 https://engine-demo.heripo.org**

### 온라인 데모 제한 사항

퍼블릭 모드의 제한은 배포 환경에 따라 달라집니다. 저장소 설정 기준은 다음과 같습니다.

| 항목           | 동작                                                           |
| -------------- | -------------------------------------------------------------- |
| 일일 처리      | `DAILY_LIMIT`; `.env.example`은 3, 미설정 시 1 (UTC 날짜 기준) |
| 동시 작업 제한 | `CONCURRENT_TASK_LIMIT`; 미설정 시 1                           |
| 성공 세션      | 처리 성공 후 해당 브라우저 세션을 7일간 잠금                   |
| 처리 옵션·모델 | 기본값 고정; 인증된 TOTP 우회는 예외                           |
| 업로드         | Turnstile 검증, 대용량 업로드 세션 인증                        |

### 전체 기능 사용

모든 기능을 자유롭게 사용하려면 로컬에서 실행하세요:

- 무제한 PDF 처리
- 모든 처리 옵션 커스터마이징
- 다양한 LLM 모델 선택
- 언어 감지 모델 및 스레드 설정

### 데모의 보정 기본값

라이브러리는 구조 검토와 표 보정을 기본 활성화하지만, 데모 폼은 `reviewAssistanceEnabled: false`, `tableCorrectionEnabled: false`로 시작합니다. 초기 텍스트·표 셀 OCR 보정은 계속 수행합니다. 구조 검토를 활성화하면 worker가 `forceAutoApply: true`를 전달하므로 유효한 명령은 자동 적용됩니다. 수동 승인 대기열은 없습니다.

## 사전 요구사항

### PDF Parser 요구사항

이 애플리케이션은 `@heripo/pdf-parser`에 의존하며, 특정 시스템 요구사항이 있습니다.

**반드시 [@heripo/pdf-parser 문서](../../packages/pdf-parser/README.ko.md#사전-요구사항)를 참고하여 다음을 확인하세요:**

- macOS 시스템 요구사항 (Apple Silicon 또는 Intel)
- Python 버전 요구사항 (3.9-3.12)
- 필수 시스템 의존성 (poppler, jq, lsof)
- 페이지 렌더링 및 이미지 PDF 의존성 (ImageMagick, Ghostscript)
- 최초 실행 설정 안내

### Node.js 및 패키지 관리자

- **Node.js** >= 24.0.0
- **pnpm** 12

### LLM 제공자와 모델

OpenAI, Anthropic, Google, Together AI와 로컬 Ollama·LM Studio를 지원합니다. 모델 ID는 `provider/model-name` 형식이며 각 단계와 fallback에 선택한 클라우드 provider의 API 키를 모두 설정해야 합니다. 로컬 서버만 쓰는 단계에는 클라우드 키가 필요하지 않습니다.

현재 [폼 기본값](./src/features/upload/types/form-values.ts)은 LM Studio, OpenAI, Google fallback을 함께 사용합니다. 환경 변수에 API 키 하나를 추가하는 것만으로 전체 기본 구성이 준비되지는 않습니다. 로컬 서버에서 모델을 로드하거나 UI에서 언어 감지·문서 검증·보정·프로세서·fallback 모델을 사용 가능한 모델로 바꾸세요. 페이지를 읽는 모델은 이미지 입력을, 구조 추출 모델은 구조화된 출력을 지원해야 합니다.

모델 선택 목록에서 OpenAI GPT-6 Astra, Sol, Luna를 사용할 수 있습니다. 기존에 GPT-5.6 Luna가 기본값이던 단계는 GPT-6 Luna를 사용합니다. 표시되는 비용 추정치는 [Standard 단기 컨텍스트의 입력·출력 요금](https://developers.openai.com/api/docs/pricing?latest-pricing=standard)을 사용하며 캐시된 입력과 장기 컨텍스트 요금은 반영하지 않습니다.

## 설치 및 실행

아래 명령은 저장소 루트에서 실행합니다.

### 1. 환경 변수 설정

```bash
# .env.example을 .env로 복사
cp apps/demo-web/.env.example apps/demo-web/.env

# .env 파일을 편집하여 API 키 입력
```

`.env` 파일 예시:

```bash
# 선택한 모든 클라우드 provider의 인증 정보를 설정하세요
OLLAMA_BASE_URL=http://127.0.0.1:11434
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_API_KEY=
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
TOGETHER_AI_API_KEY=...

# 선택사항
PDF_PARSER_PORT=5001
PDF_PARSER_TIMEOUT=10000000
NEXT_PUBLIC_PUBLIC_MODE=false
UPLOAD_SESSION_SECRET=...
```

public mode, webhook, cleanup, Turnstile, upload-session 변수 전체 목록은
[`.env.example`](./.env.example)을 참고하세요.

#### 웹훅 설정 (선택사항)

퍼블릭 모드에서 이벤트 알림을 받으려면 웹훅을 설정할 수 있습니다:

```bash
# 웹훅 설정 (퍼블릭 모드에서만 동작)
WEBHOOK_URL=https://your-endpoint.com/webhook
WEBHOOK_SECRET=your-hmac-secret-key
```

**지원 이벤트:**

| 이벤트                       | 설명                             |
| ---------------------------- | -------------------------------- |
| `task.started`               | 처리 시작                        |
| `task.completed`             | 처리 완료                        |
| `task.failed`                | 처리 실패                        |
| `task.cancelled`             | 처리 취소                        |
| `otp.failed`                 | OTP 인증 실패                    |
| `otp.locked`                 | OTP 3회 실패로 잠금              |
| `rate_limit.exceeded`        | 일일 제한 도달                   |
| `session.weekly_locked`      | 주간 session lock 도달           |
| `document.validation_failed` | 업로드 PDF의 문서 유형 검증 실패 |
| `cleanup.completed`          | 예약 cleanup 완료                |
| `cleanup.failed`             | 예약 cleanup 실패                |

작업 및 사용자 동작 웹훅에는 `event`, `timestamp`, `ip`, `userAgent`, 대개 `filename` 필드가 포함됩니다. cleanup 웹훅은 system event로 cleanup count와 error 정보를 포함합니다. 페이로드는 `WEBHOOK_SECRET`을 사용한 HMAC-SHA256 서명이 `X-Webhook-Signature` 헤더에 포함됩니다.

### 2. 의존성 설치

루트 디렉토리에서:

```bash
pnpm install
pnpm build:packages
```

### 3. 개발 서버 실행

```bash
# 루트에서
pnpm --filter @heripo/demo-web dev

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
- 병합 셀 span이 반영된 테이블 데이터 확인
- 렌더링된 PDF 페이지와 원천 이미지 열람
- 전체 artifact ZIP 다운로드 (`result-processed.json`, `result.json`, `source-handoff-manifest.json`, `images/`, `pages/`)
- 처리된 결과 JSON export

### 4. 작업 관리

- "작업 목록" 페이지에서 모든 작업 확인
- 작업 삭제
- 이전 작업 결과 재확인

## 업로드와 저장 파일

최대 PDF 크기는 2 GiB입니다. 5 MiB 이상은 서명된 업로드 세션과 10 MiB 청크 업로드를 사용하므로 `UPLOAD_SESSION_SECRET`이 필요합니다. 브라우저는 최대 3개 청크를 동시에 업로드하고 실패를 재시도합니다. 업로드 취소와 처리 중 작업 취소도 지원합니다.

경로는 서버의 현재 작업 디렉터리 기준입니다. `pnpm --filter @heripo/demo-web ...`로 실행하면 보통 `apps/demo-web` 아래에 생성됩니다.

- `data/heripo.json`: 작업·로그·업로드 세션·잠금 정보의 JSON 저장소. `schema.sql`이 있어도 실행 중 SQLite를 사용하지 않습니다.
- `data/tasks/<taskId>/input.pdf`: 업로드 원본.
- `output/<taskId>/`: 파서 산출물 및 처리 결과. 저장된 작업의 `artifact_dir`를 기준으로 접근합니다.
- `result.json`: 보정된 Docling 문서. `result_ocr_origin.json`은 초기 OCR 스냅샷입니다.
- `result-processed.json`, `source-handoff-manifest.json`: worker가 저장한 최종 문서와 출처·해시 정보.
- `images/`, `pages/`: 추출 이미지와 렌더링 페이지. 구조 검토 활성화 시 검토 리포트·체크포인트·추가 스냅샷도 생성됩니다.

공식 데모 모드(`NEXT_PUBLIC_HERIPO_OFFICIAL_DEMO=true`)에서는 매일 16:00 UTC에 보관 기간이 지난 작업을 정리합니다. `NEXT_PUBLIC_DATA_RETENTION_DAYS` 기본값은 7일입니다. `NEXT_PUBLIC_*` 값은 빌드에 반영되므로 변경 후 다시 빌드하세요.

## API 경로

작업 API는 브라우저 세션으로 접근 범위를 제한합니다. 삭제 API는 대기·실행 중인 작업을 취소한 뒤 기록과 파일을 삭제합니다.

| 메서드          | 경로                                    | 역할                                    |
| --------------- | --------------------------------------- | --------------------------------------- |
| `GET`, `POST`   | `/api/tasks`                            | 작업 목록 / 5 MiB 미만 직접 업로드·생성 |
| `GET`, `DELETE` | `/api/tasks/[taskId]`                   | 작업 조회 / 취소·삭제                   |
| `GET`           | `/api/tasks/[taskId]/stream`            | SSE 상태·로그·사용량                    |
| `GET`           | `/api/tasks/[taskId]/result`            | 처리된 문서                             |
| `GET`           | `/api/tasks/[taskId]/download`          | 결과 ZIP                                |
| `GET`           | `/api/tasks/[taskId]/images/[imageId]`  | 이미지                                  |
| `GET`           | `/api/tasks/[taskId]/pages/[pageIndex]` | 렌더링 페이지                           |
| `POST`          | `/api/upload/session`                   | 청크 업로드 세션 생성                   |
| `POST`          | `/api/upload/chunks`                    | 청크 업로드                             |
| `POST`          | `/api/upload/complete`                  | 업로드 합치기·작업 생성                 |
| `DELETE`        | `/api/upload/session/[uploadSessionId]` | 업로드 취소                             |
| `GET`           | `/api/rate-limit/check`                 | 퍼블릭 모드 제한 조회                   |
| `GET`           | `/api/system/status`                    | 시스템 상태                             |

현재 ZIP에는 처리된 JSON, 보정된 Docling JSON, handoff manifest, `images/`, `pages/`만 포함됩니다. OCR 스냅샷·검토 리포트·체크포인트는 서버 산출물 디렉터리에 별도로 남습니다.

## 아키텍처

### 폴더 구조

```
src/
├── app/                      # Next.js App Router
│   ├── api/                  # API 라우트
│   │   ├── tasks/            # 작업 CRUD, SSE stream, result, images/pages, download
│   │   ├── upload/           # 청크 업로드 session/chunk/complete API
│   │   ├── rate-limit/       # public mode rate limit 확인
│   │   └── system/           # system status API
│   ├── legal/                # 약관 및 개인정보 처리방침 페이지
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
    ├── auth/                 # TOTP, Turnstile, upload session
    ├── cleanup/              # 예약 task/upload cleanup
    ├── config/               # public mode, webhook, cleanup config
    ├── cost/                 # token 가격 및 비용 계산
    ├── db/                   # JSON 파일 DB
    ├── processing/           # LLM model factory
    ├── queue/                # 작업 큐
    ├── session/              # browser session 관리
    ├── validations/          # Zod validation schema
    ├── webhook/              # webhook client 및 payload
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
- `useDownloadAll({ taskId, filename })` - 전체 작업 artifact ZIP 다운로드
- `useExportJson({ data, filename })` - 처리 결과 JSON export

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
pnpm --filter @heripo/demo-web generate:otp-secret
```

출력된 값을 `.env` 파일의 `TOTP_SECRET`에 설정하세요.

### 업로드 세션 시크릿 생성

대용량 파일(5 MiB 이상) 업로드를 위한 JWT 서명 시크릿을 생성합니다:

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
pnpm demo-web:start
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
pm2 start ecosystem.config.cjs --only demo-web

# ❌ 금지: 클러스터 모드 (멀티 프로세스)
pm2 start pnpm --name "demo-web" -i max -- start
```

ecosystem 설정은 Next.js CLI를 Node로 직접 실행합니다. 따라서 애플리케이션을
재시작할 때 pnpm의 패키지 매니저 버전 전환에 영향을 받지 않습니다.

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
