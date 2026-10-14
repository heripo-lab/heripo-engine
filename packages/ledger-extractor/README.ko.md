# @heripo/ledger-extractor

> 고고학 보고서 데이터 원장 추출 미리보기 라이브러리

[![npm version](https://img.shields.io/npm/v/@heripo/ledger-extractor.svg)](https://www.npmjs.com/package/@heripo/ledger-extractor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

`@heripo/ledger-extractor`는 heripo 데이터 파이프라인의 원장(Ledger) 추출 단계의 첫 번째 수직 슬라이스입니다. `@heripo/document-processor`가 생성한 `ProcessedDocument`를 입력받아 집계 카운트와 대표 샘플로 구성된 `LedgerExtractionPreview`를 만들어, 데이터가 원장 단계까지 온전히 전달되었음을 확인합니다.

> **미리보기 전용**: 이 패키지는 아직 실제 원장 추출을 구현하지 않습니다. 미리보기·S0 API는 LLM을 호출하지 않습니다. 별도의 후보 제안 API는 호출자가 지정한 모델로 근거가 있는 객체를 제안하며, 최종 원장 도메인 스키마·표준화·DB 저장은 후속 작업입니다.

## 주요 기능

- **런타임 검증**: `parseProcessedDocument()`가 업로드된 JSON 등 unknown 입력을 zod로 검증
- **재귀 집계**: `chapters`/`children` 트리 전체에서 챕터와 텍스트 블록 집계
- **테이블 셀 집계**: 모든 테이블의 `grid` 셀 개수 집계
- **샘플 제한**: 챕터 제목, 텍스트 블록, 이미지 URL, 테이블 샘플을 설정 가능한 개수(기본 5개)로 제한하고 긴 텍스트는 잘라냄
- **주입식 로깅**: `console.log`를 직접 사용하지 않고 주입된 logger로 출력

## 설치

```bash
pnpm add @heripo/ledger-extractor
```

## 사용법

```typescript
import {
  LedgerExtractor,
  parseProcessedDocument,
} from '@heripo/ledger-extractor';
import { readFileSync } from 'fs';

const raw = JSON.parse(readFileSync('processed-document.json', 'utf8'));
const document = parseProcessedDocument(raw);

const extractor = new LedgerExtractor({ logger: console, sampleLimit: 5 });
const preview = await extractor.extract(document);
```

## 입력 계약

`pageRangeMap`의 키와 `pdfPageNo`는 1 이상의 정수입니다. 논리 페이지인 `startPageNo`, `endPageNo`, `Chapter.pageNo`는 본문 1쪽 기준의 음수·0·양의 정수를 허용하며 소수는 거부합니다.

- 입력은 단일 `ProcessedDocument` JSON입니다(`packages/model/src/types/processed-document.ts` 참고). ZIP, manifest, 이미지 파일 묶음은 받지 않습니다.
- `ProcessedImage.path`에는 로컬 파일 경로나 B2 object key가 아니라 `heripo-web` export 스크립트가 생성한 **완전한 public CDN URL**이 들어와야 합니다. 이 URL은 그대로 소비되며, fetch·서명·변환하지 않습니다.
- 입력 문서를 변경(mutate)하지 않습니다.

## S0: 전체 문서 자원 색인

`buildDocumentResourceIndex(document)`는 LLM 호출과 I/O 없이 장·텍스트·이미지·표·실제 grid 셀·각주 전체를 색인합니다. `queryDocumentResources(index, query)`는 종류, 직접 소속 장, 정확한 자원 ID, 정확한 sourceRef, PDF 페이지, 음수·0을 포함한 논리 페이지, 문자 그대로의 부분 문자열 필터를 AND로 조합합니다.

```typescript
import {
  buildDocumentResourceIndex,
  queryDocumentResources,
} from '@heripo/ledger-extractor';

const index = buildDocumentResourceIndex(document);
const matches = queryDocumentResources(index, { text: '우물' });
const page = queryDocumentResources(index, { pdfPageNo: 122 });
const source = queryDocumentResources(index, { sourceRef: '#/texts/5616' });
```

원문과 직접 장 소속을 그대로 보존하며, 소속 없는 매체와 복수 소속도 유지합니다. 캡션 참조는 해당 이미지·표로 조회됩니다. 셀은 부모 표의 참조와 실제 grid 배열의 0부터 시작하는 좌표를 사용하며 병합 생략 칸을 복원하지 않습니다. ID·출처·페이지 매핑이 없으면 없는 상태를 유지하고 장의 논리 시작 페이지에서 PDF 페이지를 추정하지 않습니다. 목록은 PDF 읽기 순서를 복원한 결과가 아닌 입력 저장 순서입니다. `key`는 해당 입력 스냅샷 내부 위치를 가리키는 JSON pointer이며 버전 간 원장 ID가 아닙니다. 색인을 내보낼 때 입력 파일 해시를 함께 보관하세요.

S0는 출처 조회 단계입니다. 조사 범위 판정과 고고학 객체 등록은 후속 단계이며 `LedgerExtractor.extract()`의 기존 제한된 미리보기 응답은 유지합니다.

## 조사내용의 객체 후보 제안

다음 단계는 명시적으로 선택한 장과 하위 장에서 후보를 제안합니다. 기존 미리보기·S0 API와 분리되어 있습니다.

```typescript
import {
  assembleCandidateDiscovery,
  discoverCandidateUnit,
  prepareCandidateDiscovery,
} from '@heripo/ledger-extractor';

const plan = prepareCandidateDiscovery(index, {
  scopeChapterId: 'investigation-chapter-id',
  inputSha256: 'sha256-of-original-input-file',
  maxTextChars: 8000,
  tableRowsPerUnit: 12,
});
const audits = [];
for (const unit of plan.units) {
  audits.push(await discoverCandidateUnit(unit, { model, maxRetries: 0 }));
}
const result = await assembleCandidateDiscovery(plan, audits);
```

코드가 하위 장 범위, 본문 블록 묶음, 실제 표 셀 묶음과 읽기 전용 인접 문맥을 정합니다. 하나의 긴 본문 블록은 `maxTextChars`를 넘을 수 있습니다. 각 호출은 `LLMCaller`와 구조화 응답 검증을 사용하며 호출자가 재시도·취소 설정을 제공합니다. 프롬프트 전체·버전·응답·토큰 사용량을 반환하여 호출자가 체크포인트를 보관하고 재생할 수 있습니다. 프롬프트 v3부터 원문 텍스트마다 선택 가능한 `sourceId`를 붙이고 모델 응답 스키마에서 근거·제외 대상의 선택 범위를 그 ID들로 제한합니다. 고유 입력 ID에는 `id:` 접두사를, ID가 없거나 중복되면 정확한 입력 위치에 `path:` 접두사를 붙입니다. 인접 읽기 전용 문맥에는 선택 ID를 부여하지 않습니다. 코드는 선택된 ID의 원래 자원만 조회하여 인용을 검사하며, 다른 블록으로 옮겨 연결하거나 모델 원응답을 고치지 않습니다. 객체 번호가 별도 제목에 있으면 모델이 그 제목 블록과 번호가 포함된 원문 인용도 추가 근거로 선택해야 합니다. 데모는 순차 호출하며 이 단계에서 자율 탐색이나 보고서 전체 보강을 실행하지 않습니다.

후보 종류는 유적·조사구역·트렌치·층위·유구·유물·침몰선·미상의 8개입니다. 유구·유물은 독립 본문 또는 실질적인 표의 개별 항목이 필요하며 모델 지침에서 이전 조사·단순 언급·매체만 있는 대상을 제외합니다. 이 독립 본문·표 조건은 층위에 적용하지 않습니다. 유물의 출토·퇴적 맥락으로 명시된 층위는 별도 제목·문단·표 행이 없어도 층위 후보로 제안하며, 유물 묶음을 제외해도 그 문장에 명시된 층위는 별도로 판단합니다. 프롬프트 지시는 영어로 작성하고 원문과 지정된 출력 언어는 유지합니다. 코드는 근거 인용의 원문 일치, 명칭·번호, 입력 범위와 기본 근거 유형을 검사하지만 모델의 고고학적 판단이나 누락 없음을 보장하지는 않습니다. 모든 결과는 `proposed`로 남깁니다. 부적합 제안·동일 기준 위치의 중복은 문제 목록에 남기며 모델 원응답도 별도로 보존합니다. 같은 기준 위치의 중복은 이중 집계하지 않지만 다른 위치의 동명·동번호는 임의로 병합하지 않습니다. 후보 ID는 입력 해시·종류·첫 인용 위치로 만들어 해당 스냅샷 내 제안을 식별하며 버전 간 최종 원장 ID가 아닙니다.

저장한 응답은 `assembleCandidateDiscovery()`로 모델 재호출 없이 다시 검증·조립할 수 있습니다. 부모·속성·매체 연결과 최종 원장 등록은 이 단계에 포함하지 않습니다.

## 라이선스

Apache-2.0 — [LICENSE](../../LICENSE) 참고.

### 전체 후보 중복 검토

모든 탐색 묶음이 끝난 뒤 `deduplicateCandidates(plan, discovery, options)`가 검증된 전체 후보를 하나의 구조화된 LLM 호출로 검토합니다. 장 경로, 원문 본문, 관련 표 행·머리글과 인접 문맥을 함께 제공합니다. `createCandidateDeduplicationRequest`로 실행 전 입력을 확인할 수 있습니다. `assembleCandidateDeduplication`은 저장된 감사 기록이 전체 입력과 일치하고 모든 후보가 정확히 하나의 묶음에 속하는지 검사합니다. 알 수 없는 후보, 누락, 중복 배정, 서로 다른 종류의 통합이 있으면 묶음 전체를 적용하지 않습니다. 불확실한 동일성은 합치지 않고 검토 사항으로 남깁니다.

`CandidateDeduplicationResult`의 묶음은 원래 후보 ID를 참조합니다. `getCandidateGroupMembers`로 각 후보의 원래 이름·발췌·문자 위치·출처를 그대로 확인합니다. 최초 추출 결과와 모델 감사 기록을 보존하며, 통합은 원문 수정이나 최종 등록·속성·부모 추출을 수행하지 않습니다. 동일 대상 판단은 사람 검토가 필요합니다.

통합 프롬프트는 고고학적 중복·선후·절단 관계와 동일 대상의 반복 기록을 구별합니다. 서로 중복된다는 비고나 번호·규모가 각각 있는 유구를 같은 대상으로 취급하지 않습니다.

### 문제 묶음만 재추출

추출 프롬프트 v5는 번호 없는 원문 명칭 `sourceName`과 원문 식별자 `sourceIdentifier`를 분리합니다. 문맥 명칭과 번호를 합성하거나 접미사를 추가하거나 블록·페이지 경계에서 잘린 단어를 복원하지 않습니다. 불완전한 조각도 각 출처의 정확한 부분 문자열로 따로 인용합니다. 기존 검사 기준을 유지하며 응답을 사후 보정하지 않습니다.

`prepareCandidateDiscoveryRetry(plan, audits)`는 완전히 재현 가능한 추출본에서 검사 문제가 기록된 묶음만 골라 `retryUnitIds`, 변경하지 않은 `retainedAudits`, 부분 `result`를 반환합니다. 선택 묶음만 다시 호출한 뒤 재사용·신규 응답을 함께 조립하고 전체 중복 통합을 수행합니다. 기존 v4와 신규 v5 응답은 각 버전의 정확한 프롬프트와 원래 묶음 입력으로 검증하며, 지원하지 않거나 변조된 감사 기록은 문제로 남깁니다.

추출 v6는 `headerRows`에 원래 헤더 셀의 `text`·`rowSpan`·`colSpan`·`isHeader`를 보존합니다. 번호가 있는 표 후보는 `identifierSourceId`로 번호 셀을 선택하며, 식별자와 첫 인용이 해당 셀의 원문 전체와 같아야 합니다. 명시된 숫자 셀을 인용하면서 식별자를 비운 경우도 검사 문제로 남깁니다. 응답값을 코드로 대체하지 않습니다. 다음 형제 챕터의 실제 제목 앞에 놓인 연속 본문은 앞 챕터의 추출 입력에 함께 배치하되, 원래 경로·ID·페이지·색인의 챕터 소속을 유지합니다. 제목을 찾지 못한 경계는 바꾸지 않습니다.

`prepareCandidateDiscoveryRetry(plan, audits, { unitIds, updatedPlan })`는 제외 판단 등 사람이 검토한 묶음과 갱신된 입력도 받아 교체된 `plan`을 반환합니다. 선택하지 않은 묶음의 입력과 응답은 그대로 보존합니다. 기존 v4/v5 감사 기록은 당시 프롬프트로 재현하며 v6 검사를 소급 적용하지 않습니다.

중복 통합 프롬프트 v3는 번호가 없는 층위도 전처리 입력의 전체 층위 정의·국지적 위치·지층 성격·층위 역할이 같은 대상을 가리키면 통합하도록 합니다. 판단 이유에 그 연결 근거를 명시하며, 일반적인 원지반·토질 명칭만 같은 경우나 별개 하위층은 구분합니다. PDF의 누락 문장을 복원하지 않고 전처리 입력만 사용하며, 원래 후보의 번호 유무와 발췌·출처는 그대로 보존합니다.

## 본문·표 원문 배정 미리보기

`prepareContentAttachment(index, discoveryPlan, discovery, groups, { inputSha256, candidateSnapshotId, pdfPageNumbers, maxUnitChars })`는 검증된 후보 분할을 고정 등록부로 만들고 모델 호출 없이 PDF 페이지 순회 계획을 생성합니다. 본문·표가 없는 쪽도 포함하도록 전처리 문서의 전체 PDF 페이지를 전달합니다. 본문 블록과 원래 표의 한 행은 쪼개지 않으며 `maxUnitChars`는 원문 문자 수의 완화된 한도입니다. 전체 프롬프트나 토큰의 엄격한 제한이 아닙니다. 병합 셀 구조·논리 페이지·장 경로를 보존하고, 이름 필터 없이 전체 등록부와 기존 동일성 불확실성을 제공합니다.

`createContentAttachmentRequest(plan, plan.units[0])`로 실제 입력을 확인한 후 `attachContentUnit(plan, plan.units[0], { model, maxRetries })`로 한 묶음만 처리합니다. 영어 프롬프트는 `assignments`, `unresolved`, `ignoredSources`를 요구합니다. 명확히 여러 후보를 설명하는 원문은 모두에 연결하고 모호한 동일성은 미결로 남깁니다. 출처 블록·셀을 명시적으로 선택하고 블록 경계의 원문 조각은 별도로 보존합니다. 이미지·독립 캡션·각주·속성·부모·관계는 이번 범위 밖입니다.

`assembleContentAttachment(plan, audits)`는 저장된 프롬프트·등록부/출처 참조·정확하고 유일한 원문 인용·조각 순서·자원별 처리 여부를 검사하며 응답을 보정하지 않습니다. 같은 후보의 문자 그대로 같은 조각 배열은 하나로 모으되 모든 등장 출처를 유지합니다. 잘못된 판단은 검사 문제로 남기며 처리 완료가 사람 검수나 의미상 정확성을 뜻하지 않습니다. 결과는 `not_reviewed`로 시작하고 API는 다음 묶음을 자동 호출하거나 새 후보를 등록하지 않습니다.

### 축약 판단 입력(v2)

`createContentAttachmentInput(plan, unit)`는 `payload`와 `codeMap`을 분리해 반환합니다. 모델 요청에는 `payload`만 넣으며, 공통 장 제목 문맥·원래 후보 언급별 고정 열의 행·모든 원문 인용·기존 불확실성·선택 가능한 본문/셀·필요한 표 구조를 제공합니다. 같은 후보 참조의 여러 행으로 통합 그룹의 원래 이름과 언급을 모두 유지합니다. 표는 실제 grid 순서·병합 범위를 보존하고, 선택 가능한 셀 텍스트는 한 번만 보내며 표에서 참조합니다. 의미 요약·표기 정규화·후보 사전 필터는 하지 않습니다.

짧은 후보·출처·표·문맥 참조는 `codeMap`에서 원래 ID·근거·위치에 결정론적으로 연결합니다. 저장 경로·PDF/논리 페이지·문자 위치·스냅샷 해시는 코드 전용 기록과 원래 계획에 남깁니다. v2 감사 기록은 원응답과 함께 매핑을 보존하고, 재현 시 일치 여부를 검사한 뒤 `S` 참조를 원래 출처로 연결합니다. 원문 일치 검사와 출력 구조는 유지합니다. 과거 `content-attachment.v1` 감사 기록은 당시 입력·프롬프트로 재현합니다. 축약 입력 형식은 유지하며 아래 v3 프롬프트에서 문장별 판단을 보강합니다. 이번 변경은 문장 분할을 새로 도입하지 않고 기존 본문 블록·표 행과 발췌 선택 방식을 유지합니다.

### 문장별 공유 발췌(프롬프트 v3)

본문의 배정·미결 항목 하나에는 원문 문장 하나만 담으며, 대상이 같은 연속 문장도 각각 반환합니다. 경계의 불완전한 조각은 그대로 남기고 여러 블록 조각은 한 문장을 구성하는 경우에만 한 항목에 둡니다. 적격 제목·치수 구절·표 항목을 본문 문단과 한 발췌로 묶지 않습니다. 같은 문장이 식별된 대상과 명시된 출토 유구·층위를 함께 설명하면 명확히 관련된 등록부 후보 모두를 한 판단에 연결하고, 뒤의 형태 설명은 해당 대상에만 연결합니다. 모호한 대안은 미결로 남깁니다.

의미에 따른 구절 선택은 모델이 수행합니다. 코드는 응답을 받은 뒤 문장을 나누거나 원문·배정을 수정·추가하지 않으며, 자동 구조 검사로 문장별 완전성이나 의미 정확성을 보장하지 않습니다. v1·v2 감사 기록은 당시 프롬프트로 계속 재현합니다. v3는 축약 사용자 입력·응답 스키마·출처 매핑을 바꾸지 않고 지침만 보강합니다.

### 출처 블록과 경계 조각(프롬프트 v4)

출처 블록은 근거 위치를 식별하는 단위이며, 같은 출처 참조로 여러 독립 문장을 발췌할 수 있습니다. 페이지·작업 묶음 경계에서는 첫 불완전 문장 조각만 별도 항목으로 유지하고 뒤의 완결 문장은 각각 분리합니다. 끝의 불완전 조각도 별도 항목으로 둡니다. 여러 출처 조각은 선택 가능한 블록 사이에서 한 문장이 나뉜 경우에만 한 항목에 둡니다. 프롬프트는 원문 부분 문자열 보존과 블록 전체 복사를 명시적으로 구분하며 누락된 글자를 복원하지 않습니다.

v4는 축약 입력·출처 매핑·응답 스키마·조립을 그대로 두고 지침을 명확히 합니다. v1·v2·v3 감사 기록은 당시의 정확한 프롬프트로 계속 재현합니다. 문장 단위 선택은 모델의 판단이며 자동 문장 수 검사나 응답 사후 재작성은 추가하지 않습니다.

### 등록된 객체의 번호·명칭 제목(프롬프트 v5)

일반 보고서·절·분류 제목은 제외하되, 본문이나 실질적인 표 항목으로 뒷받침되는 기존 등록부 객체를 번호·명칭으로 식별하는 선택 가능 제목은 보존합니다. 구두점과 도면·사진 참조 괄호까지 제목 전체를 별도 원문 구절로 남깁니다. 새 후보 생성이나 매체 연결 추론은 하지 않으며 동일성이 모호하면 미결로 둡니다. 문장·경계 조각 규칙과 명확한 공유 맥락 배정은 유지합니다. v1~v4 감사 기록도 당시 지침으로 계속 재현하며 v5는 모델 프롬프트의 제목 정책만 바꿉니다.
