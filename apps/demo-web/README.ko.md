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
- `processed-document.json` 업로드 또는 전처리 결과에서 바로 이어지는 고고학 데이터 원장 (구간별 모델 선택, 기본은 모두 Claude Haiku 5.5)
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

결과 화면은 PDF 물리 페이지(1부터 시작)와 본문 1쪽 기준의 논리 페이지를 구분합니다. 논리 페이지의 음수·0도 표시하고 해당 PDF 페이지로 이동할 수 있습니다.

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

모델 선택 목록에서 OpenAI GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna를 사용할 수 있습니다. 기존에 GPT-5.6 Luna가 기본값이던 단계는 GPT-6 Luna를 사용합니다. 표시되는 비용 추정치는 [Standard 단기 컨텍스트의 입력·출력 요금](https://developers.openai.com/api/docs/pricing?latest-pricing=standard)을 사용하며 캐시된 입력과 장기 컨텍스트 요금은 반영하지 않습니다.

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

### 5. 원장 추출

`Ledger Extraction` 단계는 PDF 파싱과 문서 전처리를 건너뛰고, 전처리된 문서로 `@heripo/ledger-extractor`의 고고학 데이터 원장을 만듭니다. 두 가지로 시작할 수 있습니다.

- **단독 실행:** 파이프라인 스텝퍼에서 **Ledger Extraction**을 고르고 `processed-document.json` 하나(최대 100MB, ZIP 불가)를 첨부한 뒤 구간별 모델(보고서 유형 분류·객체 후보 탐색·후보 중복 검토·원문 배정, 기본은 모두 Claude Haiku 5.5)을 골라 "Start Ledger Extraction"을 누릅니다. 확장자/MIME → 파일 크기 → JSON 파싱 → `ProcessedDocument` 런타임 검증을 거쳐 작업이 큐에 등록됩니다.
- **전처리 후 이어서:** 완료된 Raw Data Extraction 결과 페이지의 "이 결과로 원장 만들기"에서 같은 방식으로 구간별 모델을 고릅니다. 원장 작업은 그 결과의 전처리 문서를 그대로 쓰고 같은 브라우저 세션에 속합니다. 이후 카드는 두 번째 실행을 만들지 않고 그 원장으로 연결합니다(실패·취소된 실행은 다시 만들 수 있음).

작업은 문서 미리보기를 쓴 뒤, 구간마다 고른 모델로 원장 단계를 사람 개입 없이 차례로 실행합니다: 보고서 유형 분류(라우터 1회, 제안 범위에 코드가 제목으로 찾은 조사 장을 더해 쓰고 더한 장은 원장 머리에 표시), 객체 후보 탐색과 중복 검토, 원문 배정 계획, 모든 묶음의 얇은 원문 배정, 사람이 저장한 장소 약칭 표가 없을 때의 약칭 표 제안(원문 배정 모델로 두 번 실행해 똑같이 내고 코드 검사를 통과한 규칙만 작업의 표로 저장하며, 원장 페이지에 자동 제안으로 표시하고 호출 기록은 `place-alias-proposal.json`에 남김), 코드가 남긴 부모 질문의 세 번 판단, 전체 검증을 포함한 원장 조립. 검사를 통과하지 못한 탐색 제안은 실행을 멈추지 않습니다. 이미 후보에서 빠져 있으므로 로그에 적고 원장에 `DROPPED_CANDIDATE_PROPOSAL` 경고로 남깁니다(수동 원문 배정 패널은 지금처럼 그런 스냅샷을 거부합니다). 한 번 실행은 모델 호출 600회·13,000,000토큰을 넘지 않습니다. 남은 예산이 단계의 최대 사용량을 덮지 못하면 그 단계를 시작하지 않고 이유와 함께 작업이 실패합니다. 진행 페이지에서 단계와 로그를 볼 수 있습니다. 저장된 부모 판단과 장소 약칭 표가 있으면 반영하며, 원장 페이지의 단계별 수동 패널로 단계를 다시 실행할 수 있습니다.

원장 페이지의 얇은 배정 패널은 묶음마다 두 번 호출합니다. Anthropic 모델이면 남은 묶음을 메시지 일괄 처리 하나로 제출할 수 있습니다(**일괄 처리**, 기본 켜짐). 요금은 절반이고 응답은 24시간 안에 옵니다. 제출 전에 호출마다 프롬프트 길이만큼의 토큰과 고정 출력 상한 32,000토큰을 예산에서 잡습니다. 실행은 일괄 처리가 끝날 때까지 실행 중으로 남고 서버가 재시작해도 이어지며, 결과를 저장하지 못한 일괄 처리는 다시 제출하지 않고 다음 시작에서 결과를 받아 옵니다. 저장된 호출에는 `batchId`가 남습니다. 오류 항목은 그 묶음을 실패로 만들고, 두 항목이 모두 취소되거나 만료된 묶음은 호출이 없었으므로 남겨 둡니다. 후보 탐색 패널은 후보 판단도 메시지 일괄 처리로 보낼 수 있습니다(**후보 판단 일괄 처리**: 첫 질문을 한 번에 보내고, 그 응답이 요구하는 후속 질문을 다시 한 번에 보냅니다. 답한 묶음은 저장하고 실패한 묶음은 '문제 난 묶음만 다시 추출'로 남깁니다). 중복 검토 블록도 메시지 일괄 처리 하나로 보낼 수 있습니다(**중복 검토 일괄 처리**, 중복 검토 모델이 Anthropic이면 기본 켜짐). 올바른 응답은 블록 감사로 먼저 저장하고 실패한 항목이 있으면 검토를 멈추며, 다음 검토에서는 실패한 블록만 다시 제출합니다. 자동 원장 실행은 후보 판단·중복 검토·원문 배정 모두 그 단계의 모델이 Anthropic 모델이면 일괄 처리로 보냅니다. `batch: false`(JSON 본문) 또는 `batch=false`(폼 필드)로 만든 작업은 바로 호출합니다. 남은 묶음 전체의 최대치가 실행 예산에 들지 않으면 들어가는 묶음을 먼저 보내고, 앞선 일괄 처리의 실제 사용량이 확정되면 나머지를 다음 일괄 처리로 보냅니다. 그래서 큰 보고서도 예약만으로 잘리지 않습니다. 두 원문 배정 실행이 갈린 묶음은 셋째 실행을 받습니다(일괄 처리에서는 첫 일괄 처리 뒤 한 번 더). 다수결로 정한 배정은 `model_majority`로 남습니다. 자동 실행은 그 뒤 코드가 정하지 못한 부모 질문을 원문 배정 모델로 배치마다 세 번씩 판단하고, 원장 조립이 읽는 계획 옆에 저장합니다. 원문 배정 호출은 바로 보내든 일괄 처리로 보내든 Anthropic 추론 강도 `low`(`CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS`)를 씁니다. 일괄 호출은 공식 `@anthropic-ai/sdk`를 쓰며, 요청 본문은 AI SDK에서 가로채 만들어 출력 상한을 빼면 바로 호출할 때와 같습니다.

완료된 원장 작업은 Tasks 페이지에서 "원장" 표시와 함께 보이고, 누르면 고고학 데이터 원장(`/ledger/validation/[taskId]`)이 열립니다. 원장 작업의 `/result/[taskId]`는 그 페이지로 넘어갑니다.

참고:

- JSON은 `@heripo/model`의 `ProcessedDocument` 타입(`packages/model/src/types/processed-document.ts`)과 호환되어야 합니다.
- `ProcessedImage.path`에는 `heripo-web` export 스크립트가 생성한 완전한 public CDN URL이 들어와야 하며, 데모는 이 URL을 그대로 사용할 뿐 fetch하거나 재서명하지 않습니다.
- 테스트용 JSON은 `heripo-web` export 스크립트로 생성하거나, 완료된 Raw Data Extraction 작업의 결과 JSON export로 만들 수 있습니다.

검증 페이지에서 **S0 전체 문서 자원 조회**도 제공합니다. 장·텍스트·이미지·표·실제 grid 셀·각주 전체를 원문/ID/sourceRef 부분 일치, 종류, 직접 소속 장, PDF 페이지, 음수·0을 포함한 논리 페이지로 조회하고 원문 전체와 자원 JSON을 확인할 수 있습니다. 입력 파일 SHA-256을 포함한 색인 JSON도 내려받을 수 있습니다. 세션 접근을 확인하는 `GET /api/tasks/[taskId]/resource-index`가 보관된 입력으로 색인을 재구성하므로 기존 완료 작업도 재업로드 없이 사용할 수 있습니다. LLM 호출이나 원장 객체 등록은 수행하지 않으며 기존 요약 미리보기는 접힌 영역에 남깁니다.

다음 패널은 선택한 장과 하위 장에서 **조사내용 객체 후보**를 제안합니다. 후보 판단과 중복 검토에 쓸 제공자/모델 ID(기본은 둘 다 Claude Haiku 5.5)와 실행 범위를 정해 본문·표 묶음을 처리하며, 진행 상황·제안 후보·원문 인용·출처 위치·자동 검사 문제를 보여줍니다. 후보를 최종 원장으로 확정하지 않습니다. `GET/POST/DELETE /api/tasks/[taskId]/candidates`는 세션 접근을 확인하고 모델 실행은 public mode가 아닐 때만 제공합니다. 실행별 `output/<taskId>/candidate-discovery/<runId>/`에 입력 계획·호출별 프롬프트/응답/토큰 사용량·부분/최종 결과를 보존하며 새 실행은 이전 실행을 덮어쓰지 않습니다. 취소 시 완료한 호출이 남고 서버 재시작 시 미완료 실행은 중단 상태로 표시됩니다. 입력과 모델 응답 전체를 포함한 실행 기록 JSON도 내려받을 수 있습니다. 로컬 단일 프로세스 실행기이며 내구성을 보장하는 백그라운드 작업 서비스는 아닙니다.

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
- `@heripo/ledger-extractor`: 원장 추출 미리보기
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

후보 추출이 모두 끝나면 로컬 실행기가 LLM으로 전체 후보의 중복을 한 번에 검토합니다. 통합 제안 화면에서 통합 전후 개수, 합친 묶음, 모든 원래 후보의 원문·출처, 불확실한 동일성을 확인합니다. 원래 추출 후보도 별도로 확인할 수 있습니다. 실행 전 `deduplication-request.json`, 분할 검사 전 `deduplication-audit.json`을 저장하고 감사 기록 다운로드에 포함합니다. 분할 검사가 실패해도 추출 결과와 감사 기록은 보존됩니다.

“이 추출본으로 중복만 다시 검토”로 후보 추출 없이 통합 단계만 재실행할 수 있습니다. 새 실행은 최초 추출 감사 파일을 바이트 그대로 복사하고, 재현 결과를 검증하고, `discoverySourceRunId`와 새 통합 감사 기록을 남깁니다. 이전 실행은 보존합니다.

“문제 난 묶음만 다시 추출 후 통합”은 추출 검사 문제가 있는 묶음만 다시 실행합니다. 새 실행에 `reusedFromRunId`·`rerunUnitIds`를 남기고, 나머지 응답 파일은 바이트 그대로 복사하며, 선택 호출이 끝나면 전체 후보를 중복 통합합니다. 로컬 API는 `deduplicationOnly`와 별도로 `retryFailedUnits: true`를 받습니다. 기존 실행과 거절된 응답은 보존합니다.

선택 재실행 API는 누락·제외 판단을 검토한 묶음의 `retryUnitIds`도 받습니다(`retryFailedUnits: true`와 함께 전달). 선택 묶음만 병합 표 헤더·챕터 연속 본문을 보존한 새 입력으로 실행하고, 나머지는 원래 입력과 응답 파일을 그대로 유지합니다. 완료 후 전체 후보를 중복 통합합니다.

### 첫 원문 배정 묶음

로컬 원장 페이지의 별도 원문 배정 패널에서 고정 등록부·전체 페이지 순회 계획을 만든 후 첫 요청을 확인하고 `plan.units[0]`만 명시적으로 실행합니다. 텍스트가 없는 물리 페이지도 계획에 남기며 호출하지 않습니다. 첫 묶음이 제목뿐이어도 처리 후 유구 설명까지 자동 이동하지 않습니다. 선택 가능한 실제 출처·전체 요청·모델 원응답·조립된 부분 결과를 표시하며 기존 후보 동일성 불확실성도 스냅샷에 보존합니다.

세션 접근을 검사하는 `GET/POST /api/tasks/[taskId]/content-attachment`는 `{ action: 'prepare', maxUnitChars }`와 `{ action: 'run-first' }`만 받습니다. Public mode에서는 실행할 수 없고 전체 실행·다음 묶음 동작은 없습니다. `GET ?audit=true`는 계획·후보 스냅샷·저장된 첫 감사 기록을 포함합니다. 새 실행은 `output/<taskId>/content-attachment/<runId>/`에 따로 남기고 원래 추출 파일을 보존합니다. 실행 전 입력·계획 hash와 후보 스냅샷을 검사하며, 완료된 실행의 첫 응답은 덮어쓰지 않습니다. 부분 결과는 자동 검사와 사람 검수를 구분하고 원문 및 모든 출처 위치를 유지합니다.

원문 배정 패널은 축약 v2 판단 입력을 전송하며 실제 입력·출력·캐시 토큰 수를 표시합니다. 실행 준비 시 전송용 `first-unit-request.json`과 별도로 `first-unit-code-map.json`을 저장하고 실행 전 검사 및 감사 다운로드에 포함합니다. 원래 ID·출처 위치는 코드 측 저장 자료에 남습니다. 새 실행도 같은 첫 묶음만 처리하며 과거 입력·응답은 보존합니다.

새 원문 배정 호출은 문장별 발췌·명시적인 공유 출토 맥락 배정을 보강한 v3 프롬프트를 사용합니다. 축약 사용자 입력과 출처 매핑은 유지하며 과거 v1·v2 감사 기록도 원응답 수정 없이 재현합니다.

새 원문 배정 호출은 페이지 경계에서 출처 블록과 문장 발췌 단위를 구별하는 v4 프롬프트를 사용합니다. 축약 입력·참조·응답 조립은 유지하고 v1·v2·v3 감사 기록도 계속 재현합니다.

새 원문 배정 호출은 기존 객체를 식별하는 번호·명칭 제목을 본문과 별도로 보존하고 일반 분류 제목을 제외하는 v5 프롬프트를 사용합니다. 축약 입력·출처 매핑·조립은 유지하며 v1~v4 감사 기록도 계속 재현합니다.

원문 붙이기 실행은 공급자 호출마다 `first-unit-api-attempt-<sequence>.json`을 저장하며 구조화 파싱 재시도 이전 응답도 남긴다. 최종 실패 시에도 파일을 유지하고, 성공한 `first-unit-audit.json`의 `callAttempts`에도 같은 목록을 포함한다. SDK 응답 전체와 공급자 종료 정보를 보존하며 원문 선택·재시도 정책은 바꾸지 않는다.

감사 다운로드에도 시도별 체크포인트 `callAttempts`를 포함하여 최종 구조화 감사가 없는 실패 실행을 확인할 수 있다.

### 동일성 미결의 그룹쌍 표시

중복 통합 패널은 좌우 순서와 무관한 통합그룹쌍으로 미결 건수를 세고, 원래 근거 후보쌍 수도 함께 보여줍니다. 미결을 펼치면 각 후보쌍의 원래 이유·인용·출처 위치를 모두 확인할 수 있습니다. 라이브러리가 보존된 결과에서 표시를 계산하므로, 과거 실행도 모델 재호출·원문 붙이기·파일 이관 없이 같은 방식으로 표시됩니다. 모델의 원래 후보쌍과 그룹 구성은 유지됩니다.
