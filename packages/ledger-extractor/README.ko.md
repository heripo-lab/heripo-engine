# @heripo/ledger-extractor

> 고고학 보고서 데이터의 고고학 데이터 원장 추출 라이브러리

[![npm version](https://img.shields.io/npm/v/@heripo/ledger-extractor.svg)](https://www.npmjs.com/package/@heripo/ledger-extractor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

`@heripo/ledger-extractor`는 heripo 데이터 파이프라인의 원장(Ledger) 추출 단계입니다. `@heripo/document-processor`가 생성한 `ProcessedDocument`를 입력받아 `archaeology-ledger.v1` 원장을 만듭니다. 원장에는 조사된 객체(유적·조사구역·트렌치·층위·유구·유물·침몰선)마다 기록 하나와, 그 객체를 설명하는 원문 문장·표 칸과 정확한 출처 위치, 상위 계층, 도면·사진 참조, 속성, 객체 간 관계, 검수 항목, 검증 보고가 담깁니다. 원문은 바꾸지 않고 그대로 잘라 담으며 다시 쓰거나 변환·정규화하지 않습니다. 코드와 모델이 정하지 못한 것은 사람이 결정할 검수 항목으로 남깁니다.

모델 호출은 보고서 분류, 후보 탐색, 중복 검토, 얇은 원문 배정, 장소 약칭 제안, 부모 판단의 별도 단계에서 일어나며, 각 단계는 호출자가 체크포인트로 보관할 수 있도록 프롬프트·원응답·사용량을 돌려줍니다. 그다음 `buildArchaeologyLedger()`가 저장된 결과로 원장을 결정론적으로, 모델 호출 없이 조립하므로 같은 입력이면 항상 같은 원장이 나옵니다. 처음 만든 `LedgerExtractor.extract()` 집계 미리보기와 S0 자원 색인도 그대로 제공하며, 둘 다 LLM을 호출하지 않습니다.

> **실험적 형식**: `buildArchaeologyLedger()`는 호출자가 지정한 모델로 전처리 문서에서 `archaeology-ledger.v1` 원장을 만들지만, 이 형식은 아직 실험적입니다. 필드와 검수 항목, 지시문은 0.2.x 릴리스 안에서도 이전 형식 변환 없이 바뀔 수 있으므로, 원본 전처리 문서를 보관해 두고 업그레이드 뒤에는 원장을 다시 만드세요. 미리보기·S0 API는 LLM을 호출하지 않으며, 표준화와 DB 저장은 후속 작업입니다.

> **검증 범위 한계**: 원장 단계는 보고서 3종(『태안 마도 해역 수중발굴조사』, 『부여 화지산 백제과원 및 둘레길 조성사업부지내 유적』, 『거제 사등성 하수관로 매설구간 내 유적 발굴조사』)만 대상으로 개발하고 측정했습니다. 다른 유형과 형식의 보고서에서는 부족한 점이 많을 수 있으며, 데이터를 차차 쌓아 가면서 규칙과 지시문을 개선해 나갈 예정입니다.

## 목차

- [주요 기능](#주요-기능)
- [설치](#설치)
- [사용법](#사용법)
- [입력 계약](#입력-계약)
- [비용 상한](#비용-상한)
- [S0: 전체 문서 자원 색인](#s0-전체-문서-자원-색인)
- [보고서 프로필](#보고서-프로필)
- [조사내용의 객체 후보 제안](#조사내용의-객체-후보-제안)
- [묶음 단위 얇은 원문 배정](#묶음-단위-얇은-원문-배정)
- [고고학 데이터 원장](#고고학-데이터-원장)
- [포함 계층 신호와 코드 확정 부모](#포함-계층-신호와-코드-확정-부모)
- [도면·사진 참조](#도면사진-참조)
- [표 속성](#표-속성)
- [객체 간 관계](#객체-간-관계)
- [원장 검증](#원장-검증)
- [원장 한 번에 조립하기](#원장-한-번에-조립하기)
- [추출 미리보기](#추출-미리보기)
- [지시문 변경 이력](#지시문-변경-이력)
- [라이선스](#라이선스)

## 주요 기능

- **보고서 프로필**: 결정론적인 보고서 신호와 분류 호출 한 번(`prepareReportProfile`), 또는 사람이 확인해 주입한 `ReportProfile`. 무인 실행에서는 `completeReportScope`가 제안된 범위를 조사 장으로 보완
- **후보 탐색**: 선택한 장에서 원문 ID로 근거를 제한한 8개 종류의 후보 제안. 코드 검사, 필요한 것만 묻는 후속 호출 한 번, 문제 묶음만 재추출
- **중복 검토**: 코드가 확정하는 병합과, 애매한 블록만 모델에 묻는 검토(`deduplicateCandidateBlocks`). 불확실한 동일성은 합치지 않고 검수로 남김
- **묶음 단위 얇은 원문 배정**: 묶음마다 짧은 호출 하나를 기본 두 번 보내고, 두 실행이 함께 돌려준 대상, 또는 동점 해소 실행 뒤 세 실행 중 둘이 돌려준 대상(`model_majority`)을 확정하며 나머지는 검수로 보냄
- **상위 계층과 장소 약칭**: 출토 위치 표현과 소속 열로 코드가 정하는 부모, 나머지에 대한 모델 3회 판단, 사람이 정하거나 모델이 제안한 장소 약칭 표(`place-aliases.v1`)
- **도면·사진, 속성, 관계**: 도면·사진 참조, 원문 그대로의 표·본문 속성, 관계 문장과 관계 열에서 찾은 객체 간 관계. 모두 모델 호출 없음
- **검증**: `validateArchaeologyLedger`가 구조·계층·출처·원문 충실도를 전처리 문서와 대조
- **한 번에 조립**: `buildArchaeologyLedger`가 저장된 모델 결과로 오프라인 단계를 모두 차례로 실행
- **비용 상한**: `@heripo/shared`에서 다시 내보내는 `createSpendGuard`가 한 실행의 모든 모델 호출 횟수와 토큰을 제한
- **재현 가능한 감사 기록**: 이전 프롬프트 버전으로 저장된 감사 기록도 당시 프롬프트로 다시 재현
- **미리보기와 S0**: `LedgerExtractor.extract()` 집계 미리보기와 전체 문서 자원 색인. LLM 호출 없음

## 설치

```bash
pnpm add @heripo/ledger-extractor
# 아래 예제에서 쓰는 AI SDK 제공자
pnpm add @ai-sdk/anthropic
```

## 사용법

모델 단계를 차례로 실행하고 그 결과는 호출자가 저장하며, 원장은 마지막에 오프라인으로 조립합니다. 아래의 `baseModel`은 구조화 출력을 지원하는 AI SDK `LanguageModel`이면 됩니다. 예제는 `@ai-sdk/anthropic`으로 Claude Haiku 5.5를 씁니다.

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import {
  assembleCandidateDeduplication,
  assembleCandidateDiscovery,
  assembleContentAttachmentThin,
  attachContentThinUnit,
  buildArchaeologyLedger,
  buildDocumentResourceIndex,
  collectReportSignals,
  completeReportScope,
  createRelationParentRequests,
  createSpendGuard,
  deduplicateCandidateBlocks,
  discoverCandidateUnit,
  judgeRelationParentBatch,
  parseProcessedDocument,
  prepareCandidateDiscovery,
  prepareContentAttachment,
  prepareReportProfile,
  reportProfileSha256,
  resolveContentAttachmentThinPolicy,
} from '@heripo/ledger-extractor';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const raw = readFileSync('processed-document.json');
const document = parseProcessedDocument(JSON.parse(raw.toString('utf8')));
const inputSha256 = createHash('sha256').update(raw).digest('hex');
const index = buildDocumentResourceIndex(document);
const baseModel = anthropic('claude-haiku-5-5'); // ANTHROPIC_API_KEY를 읽음

// One budget for every model call of the run
const guard = createSpendGuard({ maxCalls: 2000, maxTotalTokens: 30_000_000 });
const model = guard.wrap(baseModel);

// 1. Report profile: one router call (or pass a person-confirmed `profile`)
const { profile } = await prepareReportProfile(document, index, {
  inputSha256,
  model,
});
if (!profile) throw new Error('The router proposed no profile');

// 2. Complete the router's proposed scope with the investigation chapters
const discoveryScope = completeReportScope(
  index,
  collectReportSignals(document, index, { inputSha256 }),
  profile.scopeChapterIds,
);

// 3. Candidate discovery and duplicate review
const discoveryPlan = prepareCandidateDiscovery(index, {
  scopeChapterId: discoveryScope.scopeChapterIds,
  inputSha256,
  maxTextChars: 8000,
  tableRowsPerUnit: 12,
});
const audits = [];
for (const unit of discoveryPlan.units)
  audits.push(await discoverCandidateUnit(unit, { model, maxRetries: 0 }));
const discovery = await assembleCandidateDiscovery(discoveryPlan, audits);
const groups = assembleCandidateDeduplication(
  discoveryPlan,
  discovery,
  await deduplicateCandidateBlocks(discoveryPlan, discovery, {
    model,
    maxRetries: 0,
  }),
);

// 4. Attachment plan (no calls) and thin attachment of every unit
const { policy, decisions } = resolveContentAttachmentThinPolicy(profile);
const plan = await prepareContentAttachment(
  index,
  discoveryPlan,
  discovery,
  groups,
  {
    inputSha256,
    candidateSnapshotId: 'discovery-run-1',
    pdfPageNumbers: Object.keys(document.pageRangeMap).map(Number),
    maxUnitChars: 8000,
    thinPolicy: policy,
    thinPolicyDecisions: decisions,
    profile: {
      profileSha256: await reportProfileSha256(profile),
      source: profile.source,
    },
  },
);
const results = [];
for (const unit of plan.units)
  results.push(await attachContentThinUnit(plan, unit, { model }));
const attachments = assembleContentAttachmentThin(plan, results);

// 5. Build once to get the parent questions code leaves open, judge them,
//    then build the final ledger (the build itself makes no model calls)
const now = new Date().toISOString();
const meta = {
  ledgerId: 'ledger-1',
  extractorVersion: '0.2.0',
  extractedAt: now,
  createdAt: now,
};
const first = await buildArchaeologyLedger({
  document,
  plan,
  attachments,
  meta,
  discoveryScope,
});
const parentJudgments = [];
for (const request of createRelationParentRequests(
  plan,
  first.result,
  first.stages.parents,
))
  parentJudgments.push(
    ...(await judgeRelationParentBatch(request, { model })).judgments,
  );
const { result: ledger, validation } = await buildArchaeologyLedger({
  document,
  plan,
  attachments,
  meta,
  discoveryScope,
  parentJudgments,
  droppedProposals: discovery.issues,
});

console.log(ledger.records.length, validation.status, guard.used());
```

감사 기록·호출·결과는 받는 즉시 저장하세요. 각 단계는 저장된 결과로 모델을 다시 부르지 않고 재조립할 수 있습니다. 사람은 여러 지점에서 모델 단계를 결정으로 대신할 수 있습니다: 주입한 보고서 프로필이나 범위, 검토한 탐색 묶음(`prepareCandidateDiscoveryRetry`), 얇은 배정 규칙 재정의(`resolveContentAttachmentThinPolicy`), 장소 약칭 표(`placeAliases`). 아래 절들은 파이프라인 순서대로 각 단계를 설명합니다.

## 입력 계약

`pageRangeMap`의 키와 `pdfPageNo`는 1 이상의 정수입니다. 논리 페이지인 `startPageNo`, `endPageNo`, `Chapter.pageNo`는 본문 1쪽 기준의 음수·0·양의 정수를 허용하며 소수는 거부합니다.

- 입력은 단일 `ProcessedDocument` JSON입니다(`packages/model/src/types/processed-document.ts` 참고). ZIP, manifest, 이미지 파일 묶음은 받지 않습니다.
- `ProcessedImage.path`에는 로컬 파일 경로나 B2 object key가 아니라 `heripo-web` export 스크립트가 생성한 **완전한 public CDN URL**이 들어와야 합니다. 이 URL은 그대로 소비되며, fetch·서명·변환하지 않습니다.
- 입력 문서를 변경(mutate)하지 않습니다.

## 비용 상한

`createSpendGuard(caps?)`는 한 실행의 모든 모델 호출이 함께 쓰는 예산 하나를 돌려줍니다. `@heripo/shared`에서 `SpendLimitError`, `spendInputTokenBound`, `SPEND_GUARD_DEFAULT_MAX_OUTPUT_TOKENS`(32,000), `SPEND_GUARD_ATTEMPT_OVERHEAD_TOKENS`(1,000)와 함께 다시 내보냅니다.

- `guard.wrap(model, { defaultMaxOutputTokens? })`는 스키마 재시도와 동시 호출을 포함한 모든 제공자 시도가 보내기 전에 최악의 경우를 예약하고, 제공자가 보고한 사용량으로 정산하는 모델을 돌려줍니다. 최악의 경우는 직렬화한 프롬프트·스키마·도구의 `spendInputTokenBound`에 그 시도의 출력 한도를 더한 값입니다.
- 예약이 `maxCalls`나 `maxTotalTokens`를 넘으면 제공자를 부르지 않고 `SpendLimitError`를 던집니다. 상한이 있으면 출력 한도가 없는 시도에 `defaultMaxOutputTokens`를 주고, URL이나 제공자 참조로 파일을 넘기는 프롬프트는 크기를 알 수 없으므로 거절합니다. 실패한 시도는 예약 전체를 그대로 쓴 것으로 두며, 한 시도가 예약보다 많이 쓰면 그 뒤의 예약은 모두 거절합니다.
- `reserve(label, amount)`는 제공자 일괄 처리 API처럼 다른 경로로 보내는 호출의 최악의 경우를 정산할 때까지 잡아 둡니다. `used()`, `left()`, `refused()`는 정산된 사용량, 상한에 남은 양, 마지막 거절을 알려 줍니다. 실패한 호출을 결과로 바꾸는 단계는 뒤에 `refused()`를 확인해, 상한에 닿은 실행이 묻지 못한 채로 계속하지 않고 멈추게 할 수 있습니다.
- 상한이 없으면 세기만 합니다. 한도에 닿지 않으며 감싼 시도는 자기 출력 한도를 그대로 씁니다.

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

## 보고서 프로필

보고서마다 성격이 다르므로(육상 발굴, 트렌치 위주 시굴, 수중 도록형 등), 이후 단계는 모든 보고서에 같은 규칙을 쓰지 않고 사람이 확인한 `ReportProfile`(`report-profile.v1`)을 읽습니다. 프로필에는 원본 입력 해시, `REPORT_TRAIT_IDS` 특성별 판정(`yes`·`no`·`unclear`), 이번 조사 객체가 있는 장 목록(서로 겹치거나 포함하지 않음), 출처(`router`·`manual`), 확인 시각을 담습니다. 특성 목록은 열려 있어서, 새로운 유형의 보고서에서 나온 특성은 분기에 쓰이기 전까지 `x-` 접두 특성으로 기록합니다.

`collectReportSignals(document, index, { inputSha256 })`는 보고서 라우터가 특성을 판정하기 전에 읽는 결정론적 코드 신호 `report-signals.v1`을 돌려주며 모델을 호출하지 않습니다. 목차(깊이, 본문 길이, 표·이미지·캡션 수, 부록류·조사류 제목)와 범용 패턴으로 센 값이 들어 있습니다. 트렌치 제목, 격자 크기·번호 구역, 유구·유물 없음 문장, 이전 조사 언급, 문장 중간에서 끝나는 본문 블록 비율, 캡션 없는 이미지가 많은 장, 줄 머리 번호 접두와 변이, 도록 계측값·라틴 문자 전용 블록, 일지형 표, 등록표(첫 열 고유 비율, 부록 위치), 번호 층 단위와 반복되는 일반 층 이름입니다. 값마다 원문 표본(장, PDF 쪽, `id:`/`path:` 원문 ID)을 최대 3개 남깁니다. 신호에는 문턱이 없으며 특성 판정은 라우터와 프로필을 확인하는 사람의 몫입니다.

`createReportRouterRequest(index, signals)`는 모델을 호출하지 않고 라우터 요청 `report-router.v2`(`REPORT_ROUTER_VERSION`)를 만듭니다. 영어 지시문, 특성 목록과 정의(`REPORT_TRAIT_DEFINITIONS`), 목차, 압축 신호, 코드가 고른 인용 가능한 발췌(신호 표본, 도록형 항목 앞의 두 개와 뒤따르는 블록, 조사 장 안의 이전 조사 언급, 가장 넓게 반복되는 층 이름 두 개, 조사·부록류 장의 첫 블록, 등록표·일지 표의 머리글)가 들어갑니다. 모델은 특성마다 `yes`/`no`/`unclear`와 확신도, 한국어 이유, 원문 그대로의 인용이나 신호 이름을 답하고, 겹치지 않는 최소 범위 장을 고르며, 새 특성을 제안할 수 있습니다. 입력은 v1 시범 요청과 같고 v2는 스키마만 바꿉니다(`createReportRouterSchema()`). 특성 ID·값·확신도·신호 이름은 작은 고정 목록으로 두고, 원문·장 참조는 코드가 확인하는 일반 문자열로 둡니다. 엄격한 구조화 출력을 쓰는 provider가 큰 열거형을 거부하기 때문입니다. `inspectReportRouterResponse(request, rawResponse)`는 응답을 고치지 않고 그 요청에 비춰 검사해 `report-profile-proposal.v1`을 돌려줍니다. 특성마다 자기 문제(모르는 원문, 발췌의 정확한 부분 문자열이 아닌 인용, 근거·신호 없는 `yes`/`no`, 모르는 신호, 측정 신호로 뒷받침할 수 없는 `yes` — 트렌치·일지 표·등록표·번호 변이·도록 신호가 모두 없음)를 남기고, 범위 문제(장 없음, 모르는·반복·중첩된 장, 범위 밖 장의 이유), 누락·반복·모르는 특성, 새 특성 인용 문제도 남깁니다. 라우터 형식이 아닌 응답은 제안을 만들지 않습니다. 저장된 v1 시범 요청도 같은 방식으로 검사됩니다.

`routeReport(index, signals, { model, maxRetries = 0, abortSignal, onAttempt })`는 그 요청을 한 번 보내고, 요청 원본·신호·받은 그대로의 출력·사용량·시도 기록·검사 결과를 담은 호출을 돌려줍니다. 실패는 예외 대신 실패한 호출로 돌려줍니다. `createReportProfileFromProposal(proposal, { inputSha256, confirmedAt, routerRunId?, scopeChapterIds? })`은 제안을 `source: 'router'` 프로필로 바꿉니다. 한 번만, 문제 없이, 확신도 high로 판정된 특성만 값을 유지하고, 나머지는 `unclear`가 되어 얇은 배정 정책에서 그 특성이 정하는 분기에 결정 필요 표시가 붙습니다. 세 보고서에 Haiku 5.5로 잰 결과 high 판정은 모두 사람 프로필과 일치했고 오답은 medium이었습니다. 라우터의 범위 오류가 체계적이어서 제안 범위는 제안으로만 남기며(`scopeStatus: 'proposed'`), 후보 탐색은 이 범위로 시작하지 않아야 합니다. 주입한 범위는 제안 범위를 대신하고 결정된 범위로 봅니다. 어떤 특성을 왜 unclear로 바꿨는지와 범위 출처는 메모에 남습니다. `CONTENT_ATTACHMENT_THIN_POLICY_TRAITS`는 지금 얇은 배정 분기를 정하는 특성(`local_stratigraphy`, `catalog_artifacts`) 목록입니다. `prepareReportProfile(document, index, { inputSha256, profile?, scopeChapterIds?, model?, ... })`은 `DocumentProcessor`가 쪽 범위와 목차를 정하는 방식으로 프로필을 정합니다. 프로필을 주입하면 라우터를 건너뛰고, 아니면 라우터 1회 호출로 제안합니다. 주입한 범위는 어느 쪽이든 프로필 범위를 대신합니다. 프로필(호출이 실패하거나 출력 형식이 맞지 않으면 `null`), 출처(`injected`/`router`), 호출, 라우터 검사·프로필 검증 문제를 돌려주며 아무것도 고치지 않습니다. 프로필을 주입하지 않으면 모델이 필요합니다.

`completeReportScope(index, signals, proposedChapterIds)`는 사람 없이 도는 실행에서 제안 범위를 보완합니다. 결정론적이며 모델을 호출하지 않습니다. 신호가 조사 장(조사 범위·방법·내용·시굴·발굴 제목)으로 표시한 장을 모두 더하고, 문서 순서대로 가장 바깥 장만 남깁니다. 결과 `report-scope-completion.v1`에는 범위, 받은 그대로의 제안, 더한 장, 더 넓은 장 안으로 들어간 제안 장이 담깁니다. 상위 제목에 장비가 함께 적혀 있으면 라우터가 이번 조사의 구역을 정의하는 장을 뺄 수 있습니다. 태안 보고서의 라우터는 `III. 조사장비 및 내용 > 2. 조사내용`을 빼 23-1~6, 23-A-1~10 구역을 잃었습니다. 배경·고찰 장은 더하지 않습니다. 결과를 `buildArchaeologyLedger`의 `discoveryScope`로 넘기면 원장 머리(`ledger.discoveryScope`)에 기록됩니다.

`validateReportProfile(index, inputSha256, profile)`은 프로필을 고치지 않고 찾은 문제를 모두 돌려줍니다(다른 입력, 모르는 특성·값, 없거나 반복되거나 겹치는 범위 장, 모르는 범위 상태, 모르는 출처, 잘못된 시각). 빈 목록이면 쓸 수 있는 프로필입니다. `scopeChapterIds`는 그대로 `prepareCandidateDiscovery`에 넘길 수 있으며, `scopeSource: { kind: 'profile', profileSha256 }`도 함께 넘기면 범위가 그 프로필에서 왔다는 사실이 계획에 남습니다. `reportProfileSha256(profile)`은 키를 정렬해 해시하므로 같은 판정이면 같은 해시가 나옵니다. `contentAttachmentThinPolicyFromProfile(profile)`은 특성을 얇은 배정 규칙으로 바꿉니다. 층서가 국지적이지 않다고 확인된 경우(`local_stratigraphy: 'no'`)와 프로필이 없는 경우만 `layers: 'all'`이고, 나머지는 `layers: 'local'`입니다. 프로필이 있으면 `areas: 'unanimous'`도 넣고, `catalog_artifacts` 특성이 `'yes'`이면 `catalog: 'fields'`도 넣으며, 프로필이 없으면 면적은 항상 검수로 갑니다. 프로필은 `trivial: 'code'`도 설정합니다. 이때 컴파일은 겉보기로 어떤 후보도 서술하지 않는 구간을 모델의 구간 목록에서 빼고 `codeMap.codeNone`에 남기므로, 그 구간은 배정되지 않고 출력 비용도 들지 않습니다. 판정은 `isContentAttachmentThinTrivialText(text)`가 합니다. 숫자·구분 기호·단위 없는 계측값만 있는 구간(쪽 번호, 표의 개수), "6월 7일" 같은 날짜(조사 일지 표처럼 요일이나 소요 시간이 뒤에 붙은 "2023년8월19일(토)", "14:30~15:30(60분)"도 포함), 번호가 붙은 그림·사진·도판·표 이름표 중 문장처럼 끝나지 않고 `CONTENT_ATTACHMENT_THIN_TRIVIAL_LABEL_MAX_LENGTH`(120)자 이하인 것입니다. 그 낱말은 읽기 맥락으로 창에 남습니다. 세 보고서의 저장된 Haiku 5.5 실행에 적용하면 6,534구간 중 1,260구간이 해당했고, 3회 실행 기준은 그중 어느 것에도 배정하지 않았으며 32구간을 검수로 보냈습니다. `resolveContentAttachmentThinPolicy(profile, { traitOverrides, policyOverrides })`는 자동 프로필 밖에서 분기를 정하려는 호출자를 위해 `{ policy, decisions }`를 돌려줍니다. `DocumentProcessor`가 검토된 `pageRangeMap`·`tocEntries`를 받는 방식과 같습니다. 우선순위는 분기 직접 지정(`policyOverrides`: `layers` `all|local`, `continuity` `linked|none`, `areas` `unanimous|review`, `catalog` `fields|none`, `trivial` `code|model`), 호출자 특성 지정(`traitOverrides`, 목록에 있는 특성 ID와 `yes|no|unclear`), 프로필 특성, 기본값 순이며, 모르는 ID나 값은 예외를 던집니다. 결정마다 분기·값·출처(`policy_override`, `trait_override`, `trait`, `profile`, `default`)와 해당 특성·특성 값을 남깁니다. 특성이 unclear이거나 없어 기본값으로 정해진 분기에는 `needsDecision`이 붙어 외부 검수자가 정할 수 있습니다. `contentAttachmentThinPolicyFromProfile(profile)`은 지정 없이 같은 방식으로 정한 정책입니다. 결정 목록은 `prepareContentAttachment`에 `thinPolicyDecisions`로 넘기면 계획에 남습니다. 정책은 `prepareContentAttachment`에 `thinPolicy`로(프로필의 해시와 출처는 `profile`로) 넘기며, 계획에 그대로 남아 컴파일·검사·분류·조립이 모두 계획에서 정책을 읽습니다. `layers: 'local'`에서 분류는 여러 층위가 함께 쓰는 층 이름에 대해 근거가 그 묶음에 있는 층위만, 그중에서도 구간 앞쪽에 가장 가까운 근거가 있는 층위만 검수 제안으로 남깁니다. 한 층위만 쓰는 이름은 영향을 받지 않습니다. 같은 정책에서 컴파일(`content-attachment-thin-compile.v3`, `CONTENT_ATTACHMENT_THIN_LOCAL_COMPILE_VERSION`)은 근거가 한 묶음에만 있는 층위를 그 묶음에 제시하고, 바로 앞뒤 묶음에는 층위의 근거 장(그 장 또는 상위 장)이 같을 때만 제시합니다. 근거가 여러 묶음에 있거나 없는 층위는 계속 모든 묶음에 제시합니다. 분류도 그 묶음에 제시된 층위만 검수 제안으로 올리며, 앞뒤 묶음에서 온 한 묶음 층위는 같은 장의 구간에만 제안합니다. 확인된 프로필은 `continuity: 'linked'`도 설정합니다. 이때 묶음 첫 본문 블록 바로 앞의 읽기 전용 블록은 원본 문서가 쪽 경계에서 새 장을 시작해도 첫 블록과 같은 읽기 순서에 남고, 그 블록을 등록 근거로 삼은 제시 후보를 `evidenceOf`로 표시합니다. 이 컴파일은 `content-attachment-thin-compile.v4`(`CONTENT_ATTACHMENT_THIN_LINKED_COMPILE_VERSION`, 층위 all) 또는 `.v5`(`CONTENT_ATTACHMENT_THIN_LOCAL_LINKED_COMPILE_VERSION`, 층위 local)이고, 요청은 쪽 경계 규칙 하나를 더한 프롬프트 `content-attachment-thin.v9`(`CONTENT_ATTACHMENT_THIN_LINKED_VERSION`)를 씁니다. 이 필드가 없는 계획은 이전과 바이트 단위로 같게 컴파일됩니다. 정책이 없으면 컴파일은 `content-attachment-thin-compile.v1`이고 이전과 바이트 단위로 같습니다.

## 조사내용의 객체 후보 제안

후보 탐색은 명시적으로 선택한 장과 하위 장에서 후보를 제안합니다. 기존 미리보기·S0 API와 분리되어 있습니다.

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

코드가 하위 장 범위, 본문 블록 묶음, 실제 표 셀 묶음과 읽기 전용 인접 문맥을 정합니다. 하나의 긴 본문 블록은 `maxTextChars`를 넘을 수 있습니다. 본문 묶음이 짧은 블록(`CANDIDATE_DISCOVERY_SHORT_BLOCK_CHARS`, 120자 미만)의 연속으로 끝나고 같은 장의 다음 블록이 길면, 그 연속은 다음 묶음 앞으로 옮겨집니다. 그래서 객체의 표제·번호·필드 줄이 설명과 같은 묶음에 남습니다. `CANDIDATE_DISCOVERY_MAX_MOVED_BLOCKS`(10개)보다 긴 연속과 짧은 블록만으로 된 묶음은 경계를 그대로 둡니다. 저장된 계획과 실행은 기록된 묶음으로 재현됩니다. 각 호출은 `LLMCaller`와 구조화 응답 검증을 사용하며 호출자가 재시도·취소 설정을 제공합니다. 프롬프트 전체·버전·응답·토큰 사용량을 반환하여 호출자가 체크포인트를 보관하고 재생할 수 있습니다. 프롬프트 v3부터 원문 텍스트마다 선택 가능한 `sourceId`를 붙이고 모델 응답 스키마에서 근거·제외 대상의 선택 범위를 그 ID들로 제한합니다. 고유 입력 ID에는 `id:` 접두사를, ID가 없거나 중복되면 정확한 입력 위치에 `path:` 접두사를 붙입니다. 인접 읽기 전용 문맥에는 선택 ID를 부여하지 않습니다. 코드는 선택된 ID의 원래 자원만 조회하여 인용을 검사하며, 다른 블록으로 옮겨 연결하거나 모델 원응답을 고치지 않습니다. 객체 번호가 별도 제목에 있으면 모델이 그 제목 블록과 번호가 포함된 원문 인용도 추가 근거로 선택해야 합니다. 데모는 순차 호출하며 이 단계에서 자율 탐색이나 보고서 전체 보강을 실행하지 않습니다.

`discoverCandidateUnit`은 묶음마다 같은 시스템 프롬프트를 제공자의 프롬프트 캐시 지점으로 표시하고, 추론 강도는 기본값을 유지합니다. Anthropic 추론 강도 `low`에서 Haiku 5.5는 표본 17개 묶음에서 후보 104개를 찾았고, 기본 추론 두 번은 135개와 140개를 찾았습니다. `low` 후보 중 기본 실행과 같은 것은 51~62%로, 기본 실행끼리의 69%보다 낮았습니다. 일괄 처리 API처럼 호출을 직접 보내는 호출자는 `createCandidateDiscoveryUnitCall(unit)`(첫 호출의 시스템 프롬프트·사용자 프롬프트·스키마), `createCandidateDiscoveryFollowUpCall(unit, firstResponse)`(응답이 요구하는 후속 호출, 없으면 `null`), `recordCandidateDiscoveryUnit(unit, first, second?)`를 씁니다. 마지막 함수는 같은 감사를 만들며, 필요한 후속 호출이 없거나 필요 없는 후속 호출이 오면 예외를 던집니다.

후보 종류는 유적·조사구역·트렌치·층위·유구·유물·침몰선·미상의 8개입니다. 유구·유물은 독립 본문 또는 실질적인 표의 개별 항목이 필요하며 모델 지침에서 이전 조사·단순 언급·매체만 있는 대상을 제외합니다. 이 독립 본문·표 조건은 층위에 적용하지 않습니다. 유물의 출토·퇴적 맥락으로 명시된 층위는 별도 제목·문단·표 행이 없어도 층위 후보로 제안하며, 유물 묶음을 제외해도 그 문장에 명시된 층위는 별도로 판단합니다. 프롬프트 지시는 영어로 작성하고 원문과 지정된 출력 언어는 유지합니다. 코드는 근거 인용의 원문 일치, 명칭·번호, 입력 범위와 기본 근거 유형을 검사하지만 모델의 고고학적 판단이나 누락 없음을 보장하지는 않습니다. 모든 결과는 `proposed`로 남깁니다. 부적합 제안·동일 기준 위치의 중복은 문제 목록에 남기며 모델 원응답도 별도로 보존합니다. 같은 기준 위치의 중복은 이중 집계하지 않지만 다른 위치의 동명·동번호는 임의로 병합하지 않습니다. 후보 ID는 입력 해시·종류·첫 인용 위치로 만들어 해당 스냅샷 내 제안을 식별하며 버전 간 최종 원장 ID가 아닙니다.

한 조사의 객체가 여러 장에 나뉘어 기술되면(예: 조사구역은 조사 방법 장, 유물은 출토 유물 장) `scopeChapterId`에 장 ID 배열을 넘깁니다. 장들은 서로 겹치거나 포함 관계이면 안 됩니다. 코드는 문서 순서대로 계획하며, 앞 장에서 이어진 문단을 옮기는 처리는 같은 장 범위 안의 형제 장 사이에서만 합니다. 계획과 조립 결과는 첫 장을 `scopeChapterId`로, 모든 장을 `scopeChapterIds`로 남기고, `scopeTitle`에 제목을 이어 붙입니다. 여러 장의 후보 전체는 중복 검토 한 번으로 검토하며, 재시도는 같은 장 구성을 유지해야 합니다. 장 ID 하나, 또는 ID 하나짜리 배열은 기존 단일 범위 계획과 똑같은 결과를 만듭니다. `isSameCandidateDiscoveryScope(a, b)`로 두 계획·결과가 같은 장 구성인지 확인할 수 있습니다.

저장한 응답은 `assembleCandidateDiscovery()`로 모델 재호출 없이 다시 검증·조립할 수 있습니다. 부모·속성·매체 연결과 최종 원장 등록은 이 단계에 포함하지 않습니다.

### 전체 후보 중복 검토

모든 탐색 묶음이 끝난 뒤 `deduplicateCandidates(plan, discovery, options)`가 검증된 전체 후보를 하나의 구조화된 LLM 호출로 검토합니다. 장 경로, 원문 본문, 관련 표 행·머리글과 인접 문맥을 함께 제공합니다. `createCandidateDeduplicationRequest`로 실행 전 입력을 확인할 수 있습니다. `assembleCandidateDeduplication`은 저장된 감사 기록이 전체 입력과 일치하고 모든 후보가 정확히 하나의 묶음에 속하는지 검사합니다. 알 수 없는 후보, 누락, 중복 배정, 서로 다른 종류의 통합이 있으면 묶음 전체를 적용하지 않습니다. 현재 프롬프트 v7(`CANDIDATE_DEDUPLICATION_PROMPT_VERSION`)은 한 그룹을 한 종류 안에서만 만들게 하므로 이름이 같은 유적과 조사구역을 한 그룹으로 묶을 수 없으며, 병합만 요청합니다. `mergesByKind`는 한 종류 안에서 둘 이상을 묶는 그룹만 담고, 어느 병합에도 없는 후보는 각자 단독 기록으로 남습니다. 조립은 그런 후보를 코드 사유 `CANDIDATE_DEDUPLICATION_UNMERGED_REASON`을 단 단독 그룹으로 더하고, 모든 그룹을 첫 구성원의 후보 풀 순서로 정렬합니다. 중복되거나 알 수 없는 후보, 종류 섞임, 풀에 없는 종류의 목록, 같은 그룹 안의 불확실 일치는 계속 거절합니다. 그래서 모델이 후보 하나를 빠뜨려도 결과 전체가 무효가 되지 않고 그 후보만 병합되지 않은 채 남습니다. 이전 프롬프트 버전으로 저장된 감사 기록은 각자의 응답 형식으로 재현하며 여전히 완전한 분할을 요구합니다([지시문 변경 이력](https://github.com/heripo-lab/heripo-engine/blob/main/packages/ledger-extractor/docs/prompt-history.ko.md#중복-검토-프롬프트-변경-이력) 참고). 불확실한 동일성은 합치지 않고 검토 사항으로 남깁니다.

`deduplicateCandidateBlocks(plan, discovery, { model, maxRetries, abortSignal, completed, onBlock })`는 데모가 쓰는 나눠서 하는 중복 검토입니다. 먼저 `planCandidateDeduplication(plan, discovery)`가 모델 없이 결정론적으로 정합니다. 종류·번호·이름이 같은 쌍은 묶고(`same_number`), 이름이 같고 한쪽 번호가 다른 쪽의 근거 블록이나 표 행에 다른 꼴의 번호로 나오는 쌍은 그 대응이 일대일이면 묶습니다(`number_correspondence`, "마도23-3 마도발굴23-28" 같은 대응표). 같은 꼴의 번호가 나란히 있는 경우("33호 … 5호")는 중복 같은 관계 표기로 보고, 한 후보를 여러 후보와 잇는 번호는 모델에 넘깁니다. 모델은 중복일 수 있는 쌍만 판정합니다. 맥락으로 구별하는 종류(`CANDIDATE_DEDUPLICATION_CONTEXT_KINDS`: 유적·구역·트렌치·층위·난파선·미상)의 모든 쌍, 번호는 같고 이름이 다른 쌍, 번호 없이 이름이 같은 쌍, 번호 있는 후보가 하나뿐인 이름의 번호 없는 언급, 일대일이 아닌 대응, 그리고 (분할 `candidate-deduplication-split.v2`) 한 이름이 다른 이름을 품는 두 후보를 다른 꼴의 번호가 잇는 쌍("마도23-26 마도시굴23-12" 제목 아래의 `마도23-26 청자양각연판문병(호)`와 표 행의 `마도시굴23-12 청자양각연판문 병(호)저부편`)이 여기에 듭니다. 분할 v1은 이런 쌍을 묻지 않고 따로 두었고, 저장된 감사는 자기 분할 판으로 다시 계획합니다. 이런 쌍이 이어진 무리마다 블록이 되고, `createCandidateDeduplicationBlockRequest`는 블록을 프롬프트 `candidate-deduplication.v8`(v7 병합 프롬프트에 블록 규칙 하나를 더함)로, 그 후보의 근거가 있는 묶음만 붙여 보냅니다. 블록마다 같은 시스템 프롬프트는 제공자의 프롬프트 캐시 지점으로 표시하고, Anthropic 추론 강도는 `low`(`CANDIDATE_DEDUPLICATION_BLOCK_PROVIDER_OPTIONS`)로 보냅니다. 저장된 블록 32개에서 `low`는 전체 요청 병합 134쌍 중 132쌍을 지켰고(기본 추론 131쌍), 출력 토큰은 27% 적었습니다. `completed`는 저장된 블록 감사를 다시 쓰고, `onBlock`은 새 블록 감사를 하나씩 받습니다. `createCandidateDeduplicationBlockSchema(discovery, block)`는 일괄 처리 API처럼 블록 요청을 직접 보내는 호출자를 위해 블록의 응답 스키마를 돌려줍니다. `assembleCandidateDeduplication`은 이 나눈 감사도 받습니다(직접 쓰려면 `assembleCandidateDeduplicationSplit`). 나누기와 블록 요청을 모두 다시 계산하고, 규칙 병합과 모델 병합을 이어 같은 `ledger-candidate-groups.v1` 그룹을 만들며, 나누기가 달라졌거나 블록이 없거나 요청이 다르거나 응답이 잘못되면 고치지 않고 문제로 남깁니다. 세 보고서의 저장된 실행에서 규칙은 화지산(후보 517개)의 Haiku 병합 93쌍 중 81쌍, 마도 두 실행의 25쌍 중 12쌍과 11쌍 중 10쌍을 같게 묶었고, Haiku가 따로 둔 쌍을 묶은 경우는 대응표와 본문이 어긋난 마도 1행뿐이었습니다. 나머지 Haiku 병합은 모두 한 블록 안에 들었습니다. 가장 큰 블록 요청은 약 81,000자로, 전체 후보 요청 773,000자 대신 Haiku 5.5의 10만 토큰 장문 요금 아래에 머뭅니다.

`CandidateDeduplicationResult`의 묶음은 원래 후보 ID를 참조합니다. `getCandidateGroupMembers`로 각 후보의 원래 이름·발췌·문자 위치·출처를 그대로 확인합니다. 최초 추출 결과와 모델 감사 기록을 보존하며, 통합은 원문 수정이나 최종 등록·속성·부모 추출을 수행하지 않습니다. 동일 대상 판단은 사람 검토가 필요합니다.

통합 프롬프트는 고고학적 중복·선후·절단 관계와 동일 대상의 반복 기록을 구별합니다. 서로 중복된다는 비고나 번호·규모가 각각 있는 유구를 같은 대상으로 취급하지 않습니다.

중복 통합 프롬프트는 v3부터 번호가 없는 층위도 전처리 입력의 전체 층위 정의·국지적 위치·지층 성격·층위 역할이 같은 대상을 가리키면 통합하도록 합니다. 판단 이유에 그 연결 근거를 명시하며, 일반적인 원지반·토질 명칭만 같은 경우나 별개 하위층은 구분합니다. PDF의 누락 문장을 복원하지 않고 전처리 입력만 사용하며, 원래 후보의 번호 유무와 발췌·출처는 그대로 보존합니다.

### 문제 묶음만 재추출

추출 프롬프트 v5는 번호 없는 원문 명칭 `sourceName`과 원문 식별자 `sourceIdentifier`를 분리합니다. 문맥 명칭과 번호를 합성하거나 접미사를 추가하거나 블록·페이지 경계에서 잘린 단어를 복원하지 않습니다. 불완전한 조각도 각 출처의 정확한 부분 문자열로 따로 인용합니다. 기존 검사 기준을 유지하며 응답을 사후 보정하지 않습니다.

`prepareCandidateDiscoveryRetry(plan, audits)`는 완전히 재현 가능한 추출본에서 검사 문제가 기록된 묶음만 골라 `retryUnitIds`, 변경하지 않은 `retainedAudits`, 부분 `result`를 반환합니다. 선택 묶음만 다시 호출한 뒤 재사용·신규 응답을 함께 조립하고 전체 중복 통합을 수행합니다. 기존 v4와 신규 v5 응답은 각 버전의 정확한 프롬프트와 원래 묶음 입력으로 검증하며, 지원하지 않거나 변조된 감사 기록은 문제로 남깁니다.

현재 추출 프롬프트는 v15(`CANDIDATE_DISCOVERY_PROMPT_VERSION`)입니다. `headerRows`에 원래 헤더 셀의 `text`·`rowSpan`·`colSpan`·`isHeader`를 보존하고, 응답 첫머리에 `tableRole`을 답하게 하며, 제외마다 `category` 하나를 고르게 하고, 표 항목은 번호 칸(`identifierSourceId`)과 이름 칸(`nameSourceId`)을 고르게 합니다. 코드는 무엇보다 항목 표의 모든 데이터 행이 후보나 행 단위 제외로 답해졌는지, 독립 본문 근거의 유구·유물 후보가 근거 블록 중 하나의 앞 15자(공백 제외, `CANDIDATE_DISCOVERY_NAME_LEAD_CHARS`) 안에 이름이나 식별자를 갖는지 검사합니다. 본문 원문에는 제목 구간(`section`, `sectionHeading`)이 표시됩니다. 첫 응답이 항목 표의 행이나 좌우 나란한 표의 행 블록을 남기거나, 검사에 걸리거나, 번호 붙은 객체를 가리키는 구간 제목을 제외하거나, 번호 붙은 본문 블록을 후보도 제외도 없이 넘기거나, 본문 유물의 도록 번호를 빠뜨리면 `discoverCandidateUnit`은 필요한 규칙만(`followUpRules`) 붙인 후속 호출을 한 번 보냅니다. 감사 기록은 이를 `followUp`으로 남기고, 그래도 답이 없는 것은 검사 문제가 되어 그 묶음을 다시 실행할 수 있습니다. 잘못된 응답은 검사 문제로 남으며 응답값을 코드로 대체하지 않습니다. `createCandidateDiscoveryRequest(unit, promptVersion?)`는 저장된 어느 버전이든 시스템·사용자 프롬프트를 그대로 다시 만들며(기본은 현재 버전), 저장된 감사 기록은 당시 프롬프트와 검사로 재현합니다. 새 추출 감사 기록에는 `finishReason`, `structuredAttempts`와, 제공자가 사고 토큰을 보고하면 `usage.reasoningTokens`도 남습니다. v6부터 v15까지 버전별 변경과 측정 결과는 [지시문 변경 이력](https://github.com/heripo-lab/heripo-engine/blob/main/packages/ledger-extractor/docs/prompt-history.ko.md#후보-탐색-프롬프트-변경-이력)에 있습니다.

`prepareCandidateDiscoveryRetry(plan, audits, { unitIds, updatedPlan })`는 제외 판단 등 사람이 검토한 묶음과 갱신된 입력도 받아 교체된 `plan`을 반환합니다. 선택하지 않은 묶음의 입력과 응답은 그대로 보존합니다. 기존 v4/v5 감사 기록은 당시 프롬프트로 재현하며 v6 검사를 소급 적용하지 않습니다.

## 묶음 단위 얇은 원문 배정

얇은 경로는 고정된 후보 목록에 본문 문장과 표 항목을 배정하는 현재 방식입니다. `prepareContentAttachment` 계획을 그대로 쓰고, 구간마다 부르던 수신 대상 호출 대신 묶음마다 짧은 호출 하나를 기본 두 번 보냅니다. 호출자의 모델을 부르는 `attachContentThinUnit`을 빼면 모두 결정론적이고 오프라인으로 동작합니다.

`prepareContentAttachment(index, discoveryPlan, discovery, groups, { inputSha256, candidateSnapshotId, pdfPageNumbers, maxUnitChars })`는 검증된 후보 분할을 고정 등록부로 만들고 모델 호출 없이 PDF 페이지 순회 계획을 생성합니다. 본문·표가 없는 쪽도 포함하도록 전처리 문서의 전체 PDF 페이지를 전달합니다. 본문 블록과 원래 표의 한 행은 쪼개지 않으며 `maxUnitChars`는 원문 문자 수의 완화된 한도입니다. 전체 프롬프트나 토큰의 엄격한 제한이 아닙니다. 병합 셀 구조·논리 페이지·장 경로를 보존하고, 이름 필터 없이 전체 등록부와 기존 동일성 불확실성을 제공합니다.

- **컴파일** — `createContentAttachmentThinInput(plan, unit)`은 `{ version, input, codeMap }`(`content-attachment-thin-compile.v1`)을 돌려줍니다. 코드가 원문을 문장 구간으로 나누고, 모델은 최대 16단어짜리 Q 창(`CONTENT_ATTACHMENT_THIN_WINDOW_WORDS`)으로 원문 단어를 가리킵니다. 모델에 보일 후보도 코드가 먼저 거릅니다. 면적·트렌치·층위는 항상 넣고, 이름과 번호가 원문에 그대로 나오는 후보, 같은 장의 번호, 제목 핵심어가 묶음에 나오는 장의 후보(장 구성원 30개 이하, `CONTENT_ATTACHMENT_THIN_CHAPTER_MEMBER_LIMIT`)를 넣습니다. 장×유형 핸들(`H` 참조)은 그룹 전체를 가리킵니다. 원문 순서, 캡션, 표 위치를 유지합니다. 등록 행, 셀에서 등록된 후보, 유형명이 유일하게 맞는 표 행(`createContentAttachmentThinRowOwners`)은 코드가 배정하고 모델에 보내지 않습니다.
- **요청** — `createContentAttachmentThinRequest(compilation)`은 얇은 배정 지시문(처음 버전은 `content-attachment-thin.v8`, 현재 기본값은 다음 항목 참고)과, 모든 구간 키를 요구하는 공급자 스키마를 만듭니다. 각 판정은 `k: a|n`이며 대상, 핸들, 제외 참조, 대상 정체 대안, 관계 주체 대안, Q/L 근거를 담습니다. `contentAttachmentThinRestoredRules()`는 `segment-recipients.v26` 지시문에서 그대로 가져온 배정 규칙을 돌려줍니다.
- **요청 형식** — `createContentAttachmentThinRequest(compilation)`은 프롬프트 `content-attachment-thin.v13`(`CONTENT_ATTACHMENT_THIN_AGGREGATE_VERSION`)을 기본으로 씁니다. v11(`CONTENT_ATTACHMENT_THIN_HEADINGS_VERSION`)은 v10에 규칙 하나를 더합니다. 등록된 후보를 지목하는 제목은 도면·사진 번호가 붙어도 그 후보를 서술하고, 후보를 지목하지 않는 주제 제목은 `n`이며, 글이 이름을 밝힌 후보를 다룬다는 문장은 그 후보를 서술합니다. 프롬프트 v12(`CONTENT_ATTACHMENT_THIN_CATALOG_VERSION`)는 v11에 도록 항목 규칙을 더합니다. 유물을 항목마다 하나씩 싣는 도록에서 번호·이름·외국어 이름·출수위치·출수일·계측값 줄을 포함한 항목의 모든 줄은, 다음 항목의 번호 줄이 나오기 전까지 그 항목의 유물을 서술합니다. 프롬프트 v13은 v11에, v14(`CONTENT_ATTACHMENT_THIN_AGGREGATE_CATALOG_VERSION`)는 v12에 수량·집합 요약 규칙을 더합니다. 이번 조사에서 보고서가 정의한 집합이나 그 안의 한 부류를 서술하거나 세는 문장은 그 집합·부류의 등록 구성원 모두를 서술하며, 일부·대부분에 대한 후속 설명도 포함합니다. 집합 안 한 종류만 말하는 문장은 그 종류의 등록 구성원만 서술하므로 집합 핸들 없이 개별로 적습니다. 등록되지 않은 유물까지 세어 등록 구성원보다 수량이 분명히 많으면 어떤 후보도 서술하지 않습니다. `attachContentThinUnit`은 계획의 `thinPolicy.catalog`가 `'fields'`이면 v14를, 아니면 v13을 보내며, 저장된 v11·v12·v15·v16 요청은 기록된 대로 재현됩니다. 프롬프트 v15는 v13에, v16(`CONTENT_ATTACHMENT_THIN_LAYER_CATALOG_VERSION`)은 v14에 층위 맥락 규칙을 더합니다. 등록된 현재 층위에 대해서는 관계 상대 규칙 대신 이 규칙을 따릅니다. 확인된 유물이나 유구가 어떤 층위에서 출토되었거나, 그 층위를 굴착했거나, 그 층위를 기반으로 조성되었다는 구간은 대상과 층위를 모두 설명하고, 층위 자체의 형성·구성·순서·깊이·범위를 말하는 구간은 그 층위를 설명합니다. 유구를 드러내려고 걷어 낸 층으로만 나온 층위는 붙이지 않으며, 표토 같은 일반 이름만으로는 한 층위로 정하지 않습니다. v15·v16은 `{ version }`으로 골라 쓰는 선택 버전입니다. 세 보고서에서 다시 실행했을 때 출토 위치·기반 층위를 두 실행 중 한 번만 붙여 그 구간이 검수에 남았고, 전체 검수도 줄지 않았습니다. `{ version }`을 넘기면 저장된 어느 버전이든 다시 만듭니다. 배열 형식은 프롬프트 v10(`CONTENT_ATTACHMENT_THIN_ARRAY_VERSION`)에서 도입됐습니다. `d`는 구간마다 항목 하나인 배열(`s`가 구간 참조)이고, 스키마(`createContentAttachmentThinArraySchema()`)는 모든 묶음에서 같으며 구간·후보·묶음·범위 참조의 형식만 확인합니다. 엄격한 구조화 출력을 쓰는 provider는 큰 묶음의 구간별 객체 스키마를 너무 복잡하다며 거부하지만, 배열 스키마는 작게 유지됩니다. `{ format: 'object' }`를 넘기면 구간·제시 후보·묶음·창을 열거하는 v8/v9 요청을 만듭니다.
- **검사** — `inspectContentAttachmentThinResponse(plan, unit, { request, rawResponse })`는 저장된 요청의 버전(v10/v11은 배열, v8/v9는 객체)으로 요청을 다시 컴파일해 바뀐 요청을 거부하므로, 저장된 실행은 그대로 재현됩니다. 구간·후보·묶음·범위가 실제로 있는지는 여기서 확인하며, 배열 형식에서 구간 참조가 없는 항목은 검사 문제이고 같은 구간이 두 번 나오면 검사 문제로 남기고 그 구간은 제외합니다. 그 밖에 구조를 검사한 뒤 핸들과 근거를 원문 단어와 UTF-16 위치로 풉니다. 원응답은 고치지 않고 `{ issues, findings, decisions }`를 돌려줍니다.
- **분류** — `routeContentAttachmentThinSegments(plan, unit, compilation, runs, { wholeUnitReview })`는 모든 호출이 같이 고른 대상만 자동 확정합니다. 대상이 갈리거나, 불확실성 그룹이 다르거나, 무효인 호출이 있거나, 면적이 나오면 그 구간은 검수로 갑니다. 모든 실행이 고른 대상은 개수와 상관없이 확정하므로, 모든 실행이 묶음 전체에(직접 또는 장 핸들로) 붙인 집계·요약 문장은 검수 없이 붙습니다. 이전 버전은 확정 대상이 50개를 넘거나(`large_collective`) 핸들로 들어온 대상이 10개를 넘으면(`large_handle`) 검수로 보냈습니다. 그 사유가 있는 저장된 배정도 그대로 읽히며, 크기 상수는 더 이상 내보내지 않습니다. 기본값에서는 면적이 항상 검수로 갑니다. 계획의 `thinPolicy.areas`가 `'unanimous'`이면 모든 호출이 같이 고른 면적은 다른 대상처럼 확정되고, 일부 호출만 고른 면적은 다툼 대상이 됩니다. `contentAttachmentThinPolicyFromProfile`은 프로필이 있으면 이 선택값을 넣습니다. 선택값은 계획마다 고정되므로, 이전에 준비한 계획의 분류 결과는 그대로입니다. `checkContentAttachmentThinOutliers(segments, runs)`는 혼자 다른 답을 낸 비율이 25%를 넘고 3구간 이상인 호출을 이상 호출로 표시합니다(`CONTENT_ATTACHMENT_THIN_OUTLIER_RATE`, `CONTENT_ATTACHMENT_THIN_OUTLIER_MIN_COUNT`). 구간에 이름이 그대로 나왔지만 어느 실행도 고르지 않은 층위는 검수로 보내지 않고 `layerMentions`에 남깁니다. 지시문이 출토 위치나 기반 층 같은 관계 상대를 이후 단계로 넘기므로, 그 구간은 다른 대상을 그대로 붙이고 층위는 관계 후보가 됩니다. "표토층과 현대 퇴적층을 제거하자"처럼 걷어 낸 층으로만 나온 층위는 남기지 않고, 일부 실행만 고른 층위는 다른 대상처럼 갈린 대상으로 다룹니다. `assembleContentAttachmentThin`은 이를 `layerMentions`(구간, 위치, 층위, 그 구간의 확정 대상)로 모읍니다. 예전 `layer` 사유가 있는 저장된 배정도 그대로 읽힙니다. 저장된 화지산 실행을 다시 배정하면 층위 검수 27개가 층위 언급 후보 15개로 바뀌고 검수 항목은 70개에서 48개로 줄었습니다.
- **실행** — `attachContentThinUnit(plan, unit, { model, runs = 2, providerOptions, maxRetries = 0, abortSignal, onAttempt, onCall })`은 `providerOptions`를 주지 않으면 모든 호출을 `CONTENT_ATTACHMENT_THIN_PROVIDER_OPTIONS`(Anthropic 추론 강도 `low`, 다른 제공자는 무시)로 보내고(`{}`이면 제공자 기본값), 호출마다 그 옵션을 기록합니다. 세 보고서의 저장된 묶음 24개에서 Haiku 5.5의 `low`는 저장된 기본 추론 실행과 구간의 5.2%가 달랐고, 저장된 실행끼리는 6.0%가 달랐으며, 출력 토큰은 38% 적었습니다. 추론을 끄면 검사 문제가 284건 나왔고 11.7%가 달랐습니다. 이 함수는 r1을 보낸 뒤 r2를 보냅니다(`CONTENT_ATTACHMENT_THIN_DEFAULT_RUNS`). r2가 제공자의 프롬프트 캐시를 다시 쓸 수 있게 하기 위해서입니다. 모든 구간은 두 호출로 라우팅하며, 두 호출이 모두 고른 대상만 확정됩니다. 실패한 호출은 다시 보내지 않고 묶음이 실패합니다. 2회 실행에는 이상 호출 검사가 없으므로 `outliers`에는 `finalRuns`(`r1`, `r2`)와 `wholeUnitReview: false`만 남습니다. 세 보고서의 저장된 Haiku 5.5 실행을 `trivial: 'code'`에서 이 방식으로 다시 판정하면 구간의 89.8%, 95.1%, 96.3%가 자동으로 정해졌습니다. 저장된 3회 라우팅은 89.1%, 94.1%, 94.7%였고, 호출은 758회에서 512회로, 출력 토큰은 약 3분의 1 줄었습니다. 저장된 실행을 돌려 가며 빠진 한 실행과 비교하면, 두 실행이 일치한 자동 구간은 0.8~1.3%, 한 실행만 쓴 자동 구간은 1.6~3.0%가 달랐습니다. `runs: 3`이면 r1을 보낸 뒤 r2와 r3을 함께 보냅니다. 이상 호출이 정확히 하나면 대체 호출(r4)을 한 번 보냅니다. 대체 호출도 이상 호출이면 호출들이 두 가지 읽기로 갈린 것으로 보고, 네 호출 모두로 구간별 라우팅합니다(`finalRuns`가 r1~r4). 네 호출이 모두 고른 대상만 확정되고, 하나라도 다르면 검수로 갑니다. 대체 호출이 실패하면 묶음 전체가 검수로 갑니다. 저장된 결과는 기록된 라우팅을 그대로 유지합니다. 각 호출은 요청, 원응답, 사용량, 검사 결과와 함께 `onCall`로 전달됩니다. 결과 상태는 `routed`, `failed`, `no_llm_segments` 중 하나입니다.
- **외부에서 한 호출** — `createContentAttachmentThinUnitRequest(plan, unit)`은 `attachContentThinUnit`이 보내는 고정 요청(`catalog: 'fields'`이면 프롬프트 v14, 아니면 v13)을 돌려주고, 모델이 판정할 구간이 없는 묶음이면 `null`을 돌려줍니다. 호출자는 이 요청을 제공자의 일괄 처리 API 같은 다른 경로로 보낼 수 있습니다. `recordContentAttachmentThinCall(plan, unit, { run, request, rawResponse, usage?, finishReason?, error?, callAttempts? })`은 각 응답을 같은 호출 기록으로 바꾸며, 검사를 거치고 고치지 않습니다. `error`가 있으면 실패한 호출로 기록합니다. `routeContentAttachmentThinTwoRuns(plan, unit, calls)`는 기본 2회 경로를 r1과 r2로 라우팅해 같은 묶음 결과를 돌려줍니다. 둘 중 하나가 없거나 실패하면 `failed`, 호출이 필요 없으면 `no_llm_segments`이고, 호출의 요청이 묶음의 현재 요청과 다르면 예외를 던집니다. `attachContentThinUnit`도 이 세 함수를 씁니다.
- **셋째 실행** — 2회 실행에서 `attachContentThinUnit`은 `contentAttachmentThinNextRun`이 요구하는 대로 r3, 그다음 r4를 더 보냅니다. 망가진 실행(`isContentAttachmentThinDegenerate`: 완료됐지만 구간 절반 이상의 판정이 빠진 응답, 추론 강도 `low`의 Haiku 5.5가 가끔 돌려줌)을 대체하거나, 쓸 수 있는 두 실행이 서로 달라서만 검수로 보낸 구간(대상 다툼, 미결 묶음 차이, 한쪽 응답 무효, `isContentAttachmentThinTiebreakable`)이 있을 때입니다. 실패한 호출 뒤에는 더 보내지 않고, 끄려면 `tiebreak: false`를 씁니다. `routeContentAttachmentThinTiebreak`는 r1과 r2가 같은 구간은 그대로 두고, 나머지는 r3과 같은 쪽으로 정하며(`decidedBy: 'majority'`), 그래도 정해지지 않으면 세 실행 모두로 검수에 남깁니다. 면적이나 단위 전체 검수 때문에 검수로 간 구간은 이렇게 정하지 않습니다. `routeContentAttachmentThinTwoRuns`는 쓸 수 있는 앞의 두 실행으로 라우팅하고, 셋째로 쓸 수 있는 실행이 있으면 그것으로 다수결합니다. 쓸 수 있는 실행이 둘보다 적으면 r1과 r2를 그대로 씁니다. 저장된 마도 3회 실행에서 r1·r2가 검수로 보낸 127구간 중 125구간은 r3이 한쪽과 같았고, 해당 묶음은 111개 중 24개였습니다. 이런 다수결이 얼마나 맞는지는 넷째 실행 없이 잴 수 없습니다.
- **조립** — `assembleContentAttachmentThin(plan, results)`은 `ledger-content-attachments.v2`를 돌려줍니다. 배정 내용은 원문 구간을 자원 키와 위치로 가리키며, 근거 종류는 `model_unanimous`, `model_majority`(셋째 실행으로 정함), `code_row_owner`, `code_typed_row`, `code_cell_registration` 중 하나입니다. 검수 항목에는 최종 호출 각각의 판정이 남습니다. 검수 항목의 확정·다툼 대상이 구성원 5개 이상(`CONTENT_ATTACHMENT_THIN_COLLECTIVE_REVIEW_MIN_MEMBERS`)인 장 집합 하나의 구성원과 정확히 같으면 `collectiveHandle`(핸들 참조, 장 경로, 종류, 구성원 수, 가장 깊은 장 우선)이 붙습니다. 검수자는 같은 집합의 항목을 한 번에 결정할 수 있으며, 이 표시만으로 자동 확정되지는 않습니다. 결과는 `not_reviewed`로 시작합니다. 관계 상대(예: "3호 수혈에 의해 파괴"의 3호 수혈)는 이 단계에서 배정하지 않으며, `scope.relationCounterparts`는 `deferred_to_link_extraction`입니다.

## 고고학 데이터 원장

`assembleArchaeologyLedger(plan, attachments, { ledgerId, processedDocumentId, extractorVersion, extractedAt, createdAt })`는 엔진이 지금 추출하는 결과로 `archaeology-ledger.v1`을 조립합니다. 결정론적이며 모델을 호출하지 않습니다.

- **원장** — 원장 머리 정보입니다. 가공 문서, 추출기·배정 프롬프트 버전, `validationStatus`(`applyLedgerValidation`이 정하기 전까지 `not_run`), `reviewStatus: 'not_reviewed'`, 후보 스냅숏, 계획에 있으면 보고서 프로필과 얇은 배정 규칙·규칙 결정을 담습니다.
- **기록** — 고정된 후보 목록 항목마다 기록 하나(`record-<groupId>`)를 만들고, 종류·원문 식별자·이름과 `content`를 담습니다. `content`는 가공 문서에서 바꾸지 않고 잘라 낸 원문 문장이나 표 항목이며, 같은 원문은 출처를 모두 가진 발췌 하나로 합칩니다.
- **출처** — 각 발췌가 나온 곳입니다. 자원 키와 글자 위치(`locator`), PDF 쪽, 장, 본문 블록이나 표 칸, 가공 문서 참조, `basis`(후보 자체 근거는 `registration`, 그 밖에는 배정 근거 종류)를 담습니다. 계획 밖 자원의 등록 근거는 저장된 인용문으로 대신합니다.
- **검수 항목** — 사람이 결정할 것이며 엔진은 결정하지 않습니다. `segment` 항목은 배정 검수(제안 기록과 이미 확정된 기록, 이유, 구간 원문, 제안이 장 집합과 같으면 `collective`)에서, `identity` 항목은 불확실한 후보 병합에서, `profile_decision` 항목은 `needsDecision`인 얇은 배정 규칙 결정에서 나옵니다. 집합 항목이 아닌 검수 항목에서 모든 호출이 동의하지 않은 채 제안되었거나 동일성이 불확실한 기록은 `needsReview`입니다. 집합 항목은 집합 전체를 한 번에 결정하므로 구성원마다 표시하지 않습니다.
- **미추출 부분** — 상위 계층은 아래 `applyLedgerParents`가, 도면·사진 참조는 `applyLedgerMedia`가, 속성은 `applyLedgerAttributes`가, 관계는 `applyLedgerLinks`가 넣습니다. `attributes`, `mediaReferences`, `mediaCandidates`는 이들을 실행하기 전까지 비어 있고, `layerMentions`에는 첨부 결과의 층위 언급(`named_in_segment`: 층위 기록, 그 구간의 기록, 문장, 위치, 쪽)이 검수 없이 관계 후보로 들어가며, `links`에는 `applyLedgerLinks` 전까지 부모 옆에 남긴 관계만 있습니다. `pending`(`ARCHAEOLOGY_LEDGER_PENDING_PARTS`)에 빠진 부분을 적어 사용하는 쪽이 빈 결과가 아니라 미추출로 표시하게 합니다.

## 포함 계층 신호와 코드 확정 부모

아래 함수들은 부모 후보를 모으고, 코드가 정할 수 있는 부모를 정한 뒤, 남은 질문을 세 번 호출하는 모델 판단으로 넘기고, 그 결과를 원장에 넣습니다. `judgeRelationParentBatch`를 빼면 모두 결정론적이며 모델을 호출하지 않습니다.

- **신호** — `collectRelationSignals(plan, ledger)`는 `relation-signals.v1`을 돌려줍니다. 기록마다 부모 후보와 그 원문을 담습니다.
  - `phrase`: 기록 자신의 발췌 속 출토 위치 표현(`X에서 출토된`, `출수위치 X`)입니다. 확인 동사(`확인`, `검출`, `발견`)이면 `finding`이 false입니다.
  - `table_row`: 기록 자신의 표 행에 나온 다른 기록입니다. `header`는 그 열의 첫 행 칸이고, `finding`은 출토 위치나 소속 열(`출토`, `출수`, `수습`, `위치`, `소속`)일 때만 true입니다. 트렌치의 유구 목록처럼 행의 다른 칸은 후보만 제시합니다.
  - `heading_scope`: 읽기 순서에서 기록의 첫 원문이 속한 기록 제목입니다. 기록을 가리키지 않는 번호 제목에서 범위가 끝납니다.
  - `chapter_title`: 기록 자신의 장 제목이 가리키는 기록입니다.

  이름은 식별자와 이름을 함께 보고 가장 긴 이름을 먼저 씁니다. 정확한 형태와 숫자 뒤 `호`를 뺀 형태로 모두 맞추므로 `98호 수혈`은 식별자 `98`, 이름 `수혈`로 등록된 기록과도 만납니다. 한 장소에 여러 기록이 맞으면(시대마다 번호를 새로 매겨 `29호 수혈`과 `29 수혈`이 다른 장에 등록된 경우) 말한 기록과 장 경로가 가장 가까운 기록을 남기고, 그래도 같으면 정확한 형태를 고릅니다. 끝까지 같으면 모호한 대상으로 남깁니다. 기록 자신을 가리키는 장소는 출토 위치가 아닙니다. 아래 관계 문장 이름 찾기도 같은 방식으로 고릅니다. 번호가 붙은 장소(`98호 수혈`)는 번호 없는 이름만 가진 기록과 맞추지 않습니다. 표 행·제목·장 제목에서 같은 종류의 기록은 형제나 분류 제목이므로 건너뜁니다. 종류별 계층은 가정하지 않습니다. 어떤 기록과도 맞지 않는 출토 위치 표현은 대상 없이 남깁니다.

- **코드 확정 부모** — `resolveRelationParents(signals, ledger)`는 `relation-parents.v1`을 돌려줍니다.
  - 출토 표현과 출토 위치·소속 열의 표 행이 정확히 한 기록을 가리킬 때만 부모로 정합니다. 유구 하나와 다른 종류의 기록을 함께 가리키면 유구를 부모로 하고, 나머지는 관계 후보로 남깁니다.
  - 제목 범위와 장 제목 신호로는 부모를 정하지 않고 질문으로 넘깁니다. 확인 표현, 그 밖의 표 행(`row_only`), 맞는 기록이 없는 장소, 모호하거나 충돌하는 대상, 순환을 만드는 부모도 질문이 됩니다.
  - 질문은 후보와 신호를 담아, 이후 판단이나 사람이 결정하게 합니다.
- **부모 판단** — 코드가 정하지 못한 질문은 모델이 부모를 판단합니다. 호출자의 모델을 부르는 것은 `judgeRelationParentBatch`뿐입니다.
  - `createRelationParentRequests(plan, ledger, parents, { batchSize = 12, maxCandidates = 15 })`는 모델 호출 없이 `relation-parent-judgment.v2` 요청을 만듭니다. 질문은 원장 순서대로 묶음으로 나눕니다.
  - 질문마다 신호가 가리킨 후보를 제시합니다. 장소가 어떤 기록과도 맞지 않은 출토 표현에는 다른 종류이면서 이름 단어를 공유하고, 장소에 번호가 있으면 번호도 공유하는 기록을 더합니다. 예를 들어 `발굴 1구역`에는 `23-1 구역`을 제시합니다.
  - 맞는 기록이 없는 장소에는 답으로 고를 수 없는 참고 기록을 최대 3개 함께 보여 줍니다. 참고 기록은 제시된 후보와 같은 종류이면서, 어떤 후보에도 없는 장소 단어를 이름에 가진 기록입니다. 번호 코드가 든 발췌를 함께 보여 줍니다. 예를 들어 `발굴 1구역`에는 조사구역 `정밀발굴조사`와 그 "23-1~6구역" 서술이 붙어, 원문이 범위를 밝힐 때만 모델이 이 약칭을 `23-1 구역`과 연결할 수 있습니다.
  - 근거는 신호 원문과, 기록의 첫 발췌를 둘러싼 최대 300자 블록 원문입니다. 모델은 질문마다 후보 ID나 `none`, 근거 ID, 짧은 이유로 답합니다. 지시문은 원문에 적힌 포함 관계만 인정하고, 종류 순서·근접성·추정한 표기 대응은 인정하지 않습니다.
  - `inspectRelationParentResponse(request, rawResponse)`는 응답을 고치지 않고 답마다 해당 질문 기준으로 검사합니다.
  - `judgeRelationParentBatch(request, { model, maxRetries = 0, abortSignal, onAttempt, onCall })`는 r1을 보낸 뒤 r2와 r3을 함께 보냅니다. 실패한 호출은 다시 보내지 않고, 그 묶음은 모두 검수로 넘깁니다.
  - `decideRelationParents(request, inspections)`는 모든 호출이 유효하게 일치할 때만 부모나 `none`으로 정하고, 나머지는 검수로 남깁니다.
- **원장 반영** — `applyLedgerParents(ledger, parents, judgments = [])`는 부모가 정해진 기록에 `parentRecordId`, `parentBasis`(`code` 또는 `judgment`), `parentEvidence`를 넣은 원장을 돌려줍니다.
  - 나머지 질문은 이유 `unresolved_parent`, 후보, 호출별 답을 담은 `parent` 검수 항목이 되고, 해당 기록에 검수 표시가 붙습니다. 판단하지 않은 질문, 호출끼리 갈린 판단, 그리고 장소가 적혀 있지만 맞는 기록이 없는데 모두 `none`으로 답한 경우가 여기에 해당합니다. 이 마지막 경우는 장소가 적혀 있으나 등록되지 않은 것입니다.
  - 그 밖의 질문에 모두 `none`으로 답하면 부모 없이 두고 검수로 보내지 않습니다.
  - 순환을 만드는 부모는 되돌려 검수로 넘깁니다. 부모 옆의 관계 후보는 `links`가 되고, `parent_hierarchy`는 `pending`에서 빠집니다.
- **장소 약칭 대응** — 보고서의 장소 약칭이 등록된 이름과 어떻게 대응하는지(예: `발굴 {n}구역` → `23-{n} 구역`) 사람이 한 번 정해 `place-aliases.v1`(`PlaceAliasTable`)로 주입할 수 있습니다. 보고서 프로필 주입과 같은 방식입니다.
  - **표:** 입력 해시, `source`(사람이 정한 표는 `'manual'`, 남긴 제안은 `'model'`), 확인 시각을 담습니다. 규칙마다 `id`, 원문 표기 `written`, 등록 이름 `registered`, 자리표시자 `{n}`의 숫자 범위 `numbers`(선택), 대상 종류 `recordKind`(선택), 그리고 대응을 밝히는 원문 인용 `basis.quote`(필수)를 둡니다.
  - **`validatePlaceAliases(plan, ledger, table)`**는 표를 고치지 않고 `{ errors, warnings }`를 돌려줍니다.
    - 오류가 있으면 쓸 수 없습니다: 버전·입력·출처·시각 문제, 규칙 없음, ID 누락·중복, 빈 표기, `{n}`을 모든 곳에 한 번씩 쓰지 않거나 아예 쓰지 않은 경우가 아닌 것, 잘못된 범위, 모르는 종류, 문서에서 찾을 수 없는 근거 인용, 한 표기를 두 이름으로 보내는 규칙.
    - 경고는 오류 없는 표에만 냅니다: 기록과 맞지 않거나 여러 기록과 맞는 등록 이름, 문서에 한 번도 나오지 않는 규칙, 약칭 그대로 등록된 기록(동일성 검수 대상).
  - `PlaceAliasValidationError`는 잘못된 표를 거부하는 호출자를 위해 오류 목록을 담습니다.
  - **적용:** 표는 `collectRelationSignals(plan, ledger, { placeAliases, placeAliasesSha256 })`로 넘깁니다. `placeAliasesSha256(table)`은 키를 정렬해 표의 해시를 만들고, 오류가 있는 표는 예외를 던집니다.
    - 어떤 기록 이름과도 맞지 않은 출토 위치 표현과 출토·소속 열의 표 칸은 규칙으로 다시 맞춥니다. 장소가 원문 표기로 끝나야 하고(끝의 문장부호는 무시), 숫자는 범위 안이어야 합니다. 규칙 종류의 등록 이름이 기록 하나와 맞으면 그 기록이 대상이 되고, 신호에 규칙이 `alias`로 남습니다. 맞지 않으면 장소는 미결로 남습니다(`alias_unresolved`).
    - 규칙만으로 정해진 부모의 결정 근거는 `alias`입니다. 원장에서는 `parentBasis: 'alias'`가 되고, 원문 표현이나 칸과 함께 규칙·`<원문 표기> → <등록 이름>`·근거 인용을 담은 `alias_rule` 근거가 붙습니다.
    - 약칭 그대로 등록된 기록(`23-2 구역` 옆의 `발굴 2구역`)은 규칙으로 부모를 정하지 않습니다. 등록 기록과 함께 `identity` 검수 항목(`alias_duplicate`)이 되며, 합치지 않고 부모 질문도 만들지 않습니다.
    - 원장 머리 정보에 적용한 표(`placeAliases`: 규칙 ID, 출처, 확인 시각, 입력 해시, 주어지면 표 해시)를 기록합니다. `buildArchaeologyLedger`도 적용한 표의 `source`를 알려 줍니다.
  - **제안(`place-alias-proposal.v1`):** 사람이 정한 표가 없으면 코드가 남긴 부모 질문을 바탕으로 모델이 표를 제안할 수 있습니다.
    - `createPlaceAliasProposalRequest(plan, ledger, parents)`는 모델 호출 없이 요청을 만들거나 null을 돌려줍니다. 어떤 기록 이름과도 맞지 않은 원문 장소, 그 장소가 가리킬 수 있는 등록 이름(부모 판단에 제시하는 후보와 같되, `발굴 2구역`처럼 원문 장소 모양으로 등록된 기록은 뺌), 그리고 근거 문장을 담습니다. 근거 문장은 계획의 400자 이하 텍스트 블록 가운데 번호 코드(23-1, 23-A), 등록 이름에 없는 장소 낱말, 등록 이름의 낱말을 모두 담은 것입니다(예: `1) 정밀발굴조사(23-1~ 6구역)`). 기록이 아니라 보고서 원문에서 고릅니다.
    - `proposePlaceAliases(plan, ledger, request, { model })`는 두 번의 실행을 함께 보냅니다. 한 호출이라도 실패하면 표를 제안하지 않습니다.
    - `assemblePlaceAliasProposal`은 두 실행이 똑같이(원문 표기·등록 이름·숫자 범위) 낸 규칙 가운데 코드 검사를 통과한 것만 고치지 않고 남기며, 뺀 규칙은 이유와 함께 모두 적습니다. 검사: 두 실행 모두 근거를 문장 ID로 인용, 번호 규칙의 숫자 범위, 등록 이름에 없는 원문 낱말(맨 `{n}구역`은 대응하지 않음), 그 낱말과 등록 코드(`23-A-{n} 구역`의 `23-A`)를 담은 근거, `validatePlaceAliases`, 그리고 원문 장소 하나 이상을 기록 하나에 맞추는지. 남긴 규칙은 근거 문장 전체를 인용으로 담은 `source: 'model'` 표가 됩니다.

## 도면·사진 참조

아래 함수들은 기록과 이미지를 연결하고 그 결과를 원장에 넣습니다. 결정론적이며 모델을 호출하지 않습니다.

- **캡션 색인** — `indexMediaCaptions(index)`는 `media-caption-index.v1`을 돌려줍니다.
  - 캡션이 있는 이미지마다 캡션 번호로 표기를 만듭니다(`도면 1`, `사진 45`, `원색도판 3`, `도 12-1`; 유형은 `MEDIA_LABEL_TYPES`). 캡션 원문은 바꾸지 않습니다.
  - 여러 이미지가 같은 표기를 가지면 `byLabel`에서 보입니다. 캡션이 없거나 번호가 이런 표기가 아닌 이미지는 따로 모읍니다.
- **본문 참조** — `collectMediaReferences(captions, ledger)`는 `media-references.v1`을 돌려줍니다.
  - 기록 자신의 발췌가 인용한 표기를 찾습니다(예: 유물 제목의 `(도면 31, 사진 143)`). 범위(`사진 45~49`, 최대 60개)와 나열(`도판 10· 11`, `사진 45, 46`)은 펼칩니다. 한글 바로 뒤의 표기는 참조로 보지 않으므로 `마도23-1`을 `도 23-1`로 읽지 않습니다.
  - 표기가 이미지 하나와 맞으면 그 이미지와 연결하고(`text_reference`), 인용한 발췌를 함께 남깁니다. 맞는 이미지가 없으면 `missing`, 여러 이미지와 맞으면 `ambiguous`입니다.
- **캡션 참조** — `collectCaptionReferences(captions, plan, ledger, textReferences)`는 `caption-references.v1`을 돌려줍니다.
  - 캡션이 유물이 아닌 번호 붙은 기록 하나만 가리키면(`도면 41 … 1호 수혈 평면도`) 연결합니다(`caption_name`). `지점`처럼 번호 없는 이름은 기록만큼 종류도 자주 가리키므로 쓰지 않습니다.
  - 번호 범위(`11~20호 수혈`, `1~4호 건물지와 주변…`)는 그 이름의 번호 붙은 기록마다 연결합니다(`caption_range`).
  - 번호는 절마다 다시 시작할 수 있습니다. 그래서 캡션에서 이름 앞에 나온 장 제목 단어(예: `조선시대`)가 기록의 장 제목에 없고 같은 종류의 다른 기록에는 있으면, 그 기록을 제외합니다. 그 종류의 기록 이름에 쓰이는 단어(`수혈`)는 세지 않습니다. 남은 기록 중에서는 정확한 이름 형태, 그다음 이미지의 장이 결정하고, 그래도 정해지지 않으면 미결로 보고합니다.
  - 괄호 안 유물 번호(`출토유물(24~28)`)는 연결을 만들지 않습니다. 같은 이미지에 본문 참조로 연결된 유물을 확인하는 데만 씁니다(`artifactNumberChecks`: 일치·불일치).
- **같은 쪽 후보** — `collectSamePageCandidates(index, ledger)`는 캡션 없는 이미지를 같은 PDF 쪽에 발췌가 있는 기록과 묶습니다(예: 유물 2개와 사진 6장이 있는 도록 쪽). 캡션도 위치 정보도 없으면 어느 이미지가 어느 기록인지 코드로 알 수 없으므로 연결하지 않고, 쪽마다 검수 질문이 아닌 쪽 단위 후보 하나로 둡니다.
- **원장 반영** — `applyLedgerMedia(ledger, { captions, text, caption, samePage })`는 `mediaReferences`와 `mediaCandidates`를 채웁니다.
  - 본문 참조를 먼저, 그다음 캡션 이름과 번호 범위를 넣습니다. 기록–이미지 짝은 한 번만 두고, 연결한 발췌와 캡션 모두, 원문 그대로의 캡션과 그 표기 단어(`mediaType`, `sequenceNo`), 기록 안에서의 순서 `ordinal`을 담습니다.
  - 같은 쪽 묶음은 `mediaCandidates`(`same_page`: 쪽, 이미지 ID, 원장 순서의 그 쪽 기록)가 됩니다. 이미지를 기록 하나에 잇지 않고 검수 항목도 만들지 않습니다.
  - `media` 검수 항목을 더합니다. 인용한 표기가 여러 이미지와 맞는 경우(`media_ambiguous`, 기록에 검수 표시)와 캡션이 여러 기록을 가리키는 경우(`media_caption_several`, 이미지에 관한 질문이라 기록에 표시하지 않음)입니다.
  - 맞는 이미지가 없는 인용 표기와 맞지 않는 유물 번호는 `REFERENCE_LABEL_MISMATCH` 경고로, 정해지지 않은 캡션 번호는 `MEDIA_MATCH_AMBIGUOUS` 경고로 `issues`에 남기고, `media_references`는 `pending`에서 빠집니다.

## 표 속성

`collectTableAttributes(index, plan)`는 속성의 첫 출처인 `table-attributes.v2`를 돌려주며, 결정론적이고 모델을 호출하지 않습니다.

- 기록은 원래 식별자 칸부터 오른쪽까지의 표 행 구간을 소유합니다. 원문 배정의 행 소유 규칙과 같습니다. 그래서 트렌치 행의 `도로유구 1기` 칸은 트렌치의 속성으로 남습니다.
- `logicalTableCells(tableKey, table)`은 저장된 칸을 논리 격자에 놓습니다. 전처리 격자는 병합으로 가려진 칸을 빼고 저장하므로, 저장된 열 번호가 실제 열과 다를 수 있습니다.
- 열 키는 첫 소유 행보다 위의 행들을 논리 격자에서 위에서 아래로 읽어 만듭니다(`규모(cm) / 길이`). 입력의 머리글 표시는 믿지 않습니다. 숫자만 있는 행은 머리글이 아닙니다. 머리글 조각은 한글이나 두 글자 이상의 영문 단어가 있을 때만 셉니다. 그래서 옆에 붙어 들어온 다른 표의 숫자는 키가 되지 않고, 그런 칸은 `cellsWithoutHeader`에 모읍니다. 전처리에서 가로 병합이 사라진 머리글(한 칸 뒤에 빈 칸이 이어지고 그 아래에 이름 있는 하위 머리글이 있는 경우, `길이/높이 · 입지름/너비 · …` 위의 `크기(cm)`)은 그 빈 칸들로 이어 주므로, 모든 열이 `크기(cm) / …` 키와 단위를 유지합니다.
- 소유 행이 없는 두 열짜리 문자 라벨 표는 키·값 표입니다. 그 표에 등록된 기록이 정확히 하나면, 나머지 행마다 그 행의 라벨을 키로 하는 속성을 그 기록에 줍니다.
- 각 속성은 칸 원문을 `valueText`와 `sourceText`로, 키 괄호 안의 단위를 `unitText`(`(cm)`)로 담고, `extractionMethod: 'table_mapping'`과 표·행·논리 열·쪽을 남깁니다. 기록 자신의 등록 칸과 빈 칸은 속성으로 만들지 않으며, 값을 환산하거나 표준화하지 않습니다.

`collectTextAttributes(plan, ledger)`는 두 번째 출처인 `text-attributes.v2`를 기록 자신의 발췌에서 돌려주며, 역시 모델을 호출하지 않습니다.

- 한 문장 안에서 쉼표나 `와·과·및`로 이어진 치수들은 쪼개지 않고 원문 그대로 값 하나로 둡니다(`길이 4.9m, 너비 3.89m이상, 깊이 3.7m`, `높이 7.8cm 입지름(추정) 16.0cm 굽지름 6.6cm`, `238×28×32cm`). 치수 단어에는 앞 수식어(`잔존 너비`), 붙은 접두어(`굽지름`), 괄호 수식어(`높이(잔존)`)가 올 수 있고, 값 뒤에 부위 표시와 같은 치수의 다음 값이 이어질 수 있어(`굽높이 0.5cm(내) 0.5cm(외)`) 값을 빠뜨리지 않습니다. 문장은 공백·줄바꿈 앞의 마침표에서만 끊으므로 `4.9m`를 자르지 않습니다.
- 키는 구절 바로 앞에 적힌 항목명입니다(`전체 규모는` → `전체 규모`, `조사면적은` → `조사면적`). 조사로 끝나는 수식어(`수혈의 규모는`)는 뺍니다. 항목명이 없으면 치수가 하나일 때 그 단어, 여럿일 때 `크기`를 키로 씁니다. 구절의 치수가 모두 같은 단위면 `unitText`를 두고, 환산은 하지 않습니다.
- 번호 없는 묶음 기록의 이름 바로 뒤 수량(`수혈 5기`)은 `수량`이 됩니다.
- 문장이 같은 종류의 다른 번호 기록도 언급하면 값을 배정하지 않고, 그 기록들과 함께 소유자 질문(`ownerQuestions`)으로 남깁니다.

`applyLedgerAttributes(ledger, { table, text })`는 둘을 원장 `attributes`에 표 속성부터 `attribute-N`으로 넣습니다. 각 속성은 키·값·단위·원문·`extractionMethod`와 값의 위치(`tableId`·`cellKey` 또는 `sourceId`·`locator`, 그리고 쪽)를 가집니다. 여러 곳에서 나온 값은 합치지 않고 모두 남깁니다. 소유자 질문은 문장과 값마다 `attribute` 검수 항목(`attribute_owner_ambiguous`) 하나로 묶어, `recordIds`에 그 값을 두고 물은 기록 전부를, `candidateRecordIds`에 문장이 언급한 다른 기록을, `detail`에 `키: 값`을 담고 물은 기록마다 검수 표시를 합니다. "10 × 10m 크기의 그리드를 하나의 구역으로 설치하고 23-1구역부터 23-6구역까지 …" 같은 문장은 구역마다가 아니라 한 항목이 됩니다. 한 번 적힌 값은 합계일 수도 있어서 기록들에 나눠 주지는 않습니다. 머리글 없는 소유 칸은 표마다 개수로 `UNMAPPED_TABLE_CELL` 정보 문제로 `issues`에 남깁니다. `attributes`는 `pending`에서 빠집니다.

## 객체 간 관계

세 단계가 결정론적으로, 모델 호출 없이 기록 간 관계를 모으고 정해 원장에 넣습니다. 관계 이름은 원문의 짧은 낱말이며 온톨로지 술어가 아닙니다.

- `collectRelationSentences(plan, ledger, tableAttributes?)`는 `relation-sentences.v1`을 돌려줍니다. 기록 자신의 발췌 문장이 다른 등록 기록을 언급하고, 기록 이름을 가린 뒤에도 어느 절에 관계 단서(중복·절단·인접·거리·연결·접합·둘러쌈)가 있으면 남깁니다. 번호 붙은 기록의 이름은 모두 씁니다. 무번호 이름은 3자 이상이고 한 기록에만 속하며 번호 기록들이 공유하는 종류 이름(`트렌치`, `구상유구`)이 아닐 때만 씁니다. 기록의 조상·자손 이름은 포함 관계라 뺍니다. 층 차례(`차례로`)는 단서가 아닙니다. 머리글이 관계를 말하는 열(`중복관계`, `선후관계`)의 소유 칸도 그 칸이 언급한 기록과 함께 남깁니다.
- `resolveRecordLinks(sentences)`는 `record-links.v1`을 돌려줍니다. 쉼표로 나눈 한 절 안에서 이름 뒤에 조사와 서술어가 바로 이어질 때만 link를 만듭니다.
  - `B와 중복`, `B와 인접`, `B와 접합`, `B와 연결될 가능성`은 대칭 link가 됩니다.
  - `B를 파괴`, `B에 의해 파괴`는 방향 있는 link가 됩니다.
  - 거리·방향(`B가 4.3m 떨어져`, `B와 8.5m 거리를 두고`, `동쪽으로 B가 위치`)은 `위치` link가 됩니다.
  - 관계 열 칸이 기록 하나를 말하면 머리글을 이름으로 하는 link가 됩니다.
- 나열된 이름(`72호 수혈 및 96호 수혈과 중복`)은 서술어를 함께 씁니다. 대칭 쌍은 양쪽 기록의 근거를 모두 담은 link 하나입니다.
- 나머지는 다음으로 갑니다.
  - **질문:** 둘러쌈(`B로 감싸여진`, `B 내부`, `B를 사이에 두고`)은 `link_enclosure`가 됩니다. 단서 절 안의 서술어 없는 이름이나 방향으로 놓인 나열 항목은 `link_several_targets` 또는 `link_unclear`가 됩니다.
  - **미결 대상:** 여러 기록이 공유하는 이름과 등록되지 않은 `N호 …` 이름입니다.
  - **건너뛰고 개수만 셈:** 기록이 들어 있는 장소(`B 내`, `B 중앙부`, `A는 B 북쪽 …`), 번호 범위 속 이름(`2~4호 건물지`), 단서 없는 절의 이름입니다.

`applyLedgerLinks(ledger, recordLinks)`는 정한 관계를 `links`에 넣습니다. 각 link는 `basis`(`rule` 또는 `table_column`), `symmetric`, 관계를 말한 모든 문장(`excerpt` 근거)이나 칸(`table_cell` 근거)을 가집니다. 부모 옆에 남긴 link와 같은 이름·쌍이면 그 link에 근거를 더합니다. 질문은 이유·후보 기록·문장을 담은 `link` 검수 항목이 되고 말한 기록에 검수 표시를 합니다. 미결 대상은 `UNRESOLVED_LINK_TARGET` 경고로 `issues`에 남깁니다. `links`는 `pending`에서 빠집니다.

## 원장 검증

`validateArchaeologyLedger(ledger, { document, plan, attachments? })`는 `ledger-validation.v1`을 돌려줍니다. 조립한 원장을 원래 전처리 문서와 대조해 검사합니다(구현 명세 §22). 결정론적이며 모델을 호출하지 않습니다. 원장은 바꾸지 않고 `reviewStatus`도 건드리지 않습니다.

- 검사마다 본 항목 수와 실패 수를 남겨, `0/0`과 실행하지 않은 검사를 구별합니다. 실패는 명세 코드, 심각도, 기록·속성·관계, 위치를 담은 문제가 됩니다.
- **구조:** ID 중복이 없는지, 출처·속성·매체·관계·검수 항목·부모가 가리키는 기록이 있는지, ledgerId와 이미지 ID가 맞는지 봅니다.
- **계층:** 자기 부모와 순환이 없는지, 부모마다 확정 방식과 근거가 있는지 봅니다.
- **출처:**
  - 기록마다 등록 출처가 있는지
  - 발췌 출처가 있고, 그 기록의 것이며, 문장이 같은지
  - 출처 자원이 있고 문자 범위가 문서 원문과 같은지
  - sourceRef와 표 칸 좌표가 맞는지
  - 속성마다 출처가 있는지
  - `attachments`가 있으면 계획한 묶음마다 배정이 추적되는지
- **원문 충실성:** 속성 값과 단위가 출처에 그대로 있는지, 관계 근거가 양쪽 기록 원문 중 하나에 있는지 봅니다.
- **심각도:**
  - 계약 위반은 모두 `error`입니다.
  - 이름이나 식별자가 기록의 등록 발췌와 이름 근거, 등록 표 캡션, 장 제목, 후보 근거 어디에도 없으면 `warning`(`UNSUPPORTED_CONTENT_CLAIM`)입니다.

`applyLedgerNameAnchors(ledger, plan, document)`는 그 근거에 기록 이름이 없을 때 이름이 적힌 위치를 더합니다. 도록은 `번호 / 이름(한자) / 영문명 / …`을 따로 된 블록으로 싣고 소제목은 범위 이름을 본문 한 블록 위에 적으므로, 등록 근거가 이름 줄을 놓칠 수 있습니다. 같은 장에서 등록 본문 블록의 앞뒤 `NAME_ANCHOR_DISTANCE`(3) 블록 안에서 공백을 무시하고 이름을 찾습니다. 짧은 제목형 블록, 가까운 블록, 앞 블록 순으로 고르고, 이름의 원문 구간을 `name_anchor` 출처로 더합니다. 이름·발췌·`content`는 바꾸지 않으며, 문서 자체가 잘못 읽은 이름(OCR)은 적힌 그대로 둡니다.

- 공백만 다른 발췌와 같은 키의 서로 다른 값은 `info`(`DIFFERING_SOURCE_VALUES`)이며, 둘 다 원문 그대로 남깁니다.
- 같은 종류의 기록이 이름을 공유하면(시대마다 번호를 새로 매긴 `29호 수혈`과 `29 수혈`) `info`(`AMBIGUOUS_RECORD_IDENTITY`)입니다. 서로 다른 기록으로 남기고 장으로 구별합니다.
- `status`는 error가 있으면 `failed`, warning만 있으면 `warnings`, 그 밖에는 `passed`입니다.

원장 `issues`는 모든 단계에서 같은 구조입니다: `{ code, severity, stage, recordId?, attributeId?, linkId?, imageId?, message, locator? }`이며 `stage`는 `assembly`, `media`, `attributes`, `links`, `validation` 중 하나입니다. 조립은 배정 문제를 `UNRESOLVED_EVIDENCE_ASSIGNMENT`로 남깁니다(빠진 묶음은 error). `apply*` 단계는 문제를 더하기만 하고 `validationStatus`를 정하지 않습니다. 원장은 `applyLedgerValidation(ledger, report)`가 검증 문제를 더하고, warning이 가리키는 기록에 `needsReview`를 표시하고, 모든 문제의 심각도로 `validationStatus`를 한 번 정할 때까지 `not_run`입니다.

## 원장 한 번에 조립하기

`buildArchaeologyLedger({ document, plan, attachments, meta, placeAliases?, parentJudgments?, discoveryScope?, droppedProposals? })`는 원장 단계를 모두 차례로 실행합니다. 결정론적이며 모델을 호출하지 않습니다. `droppedProposals`(탐색 `issues`: 검사를 통과하지 못해 기록이 되지 않은 제안)는 단계 `discovery`의 `DROPPED_CANDIDATE_PROPOSAL` 경고로 `issues`에 남아, 탐색이 무엇을 뺐는지 사용하는 쪽이 알 수 있습니다.

1. 저장된 얇은 배정 결과로 조립
2. 장소 약칭 표 적용(`validatePlaceAliases`에 오류가 없을 때만)
3. 관계 신호, 코드 부모 확정, 저장된 부모 판단 반영
4. 도면·사진
5. 표·본문 속성
6. 객체 간 관계
7. 이름 근거 보강(`applyLedgerNameAnchors`)
8. `validationStatus`를 정하는 전체 검증
9. 명세 §23 정렬

모델 단계(후보 탐색, 얇은 배정, 부모 판단)는 밖에서 실행하고 그 저장 결과를 입력으로 받으므로, 같은 입력이면 항상 같은 원장이 나옵니다. `meta`에는 원장 ID, 추출기 버전, 시각을 넣고, `processedDocumentId`는 기본값이 문서의 `reportId`입니다.

결과는 `{ result, validation, placeAliases, stages }`입니다.

- `placeAliases`는 표를 적용했는지 알려 줍니다: `none`, 규칙 ID·해시·경고를 담은 `applied`, 오류를 담은 `invalid`.
- `stages`에는 측정과 디버깅을 위해 단계마다 만든 것(신호, 부모, 캡션 색인, 도면·사진 참조, 속성 원자료, 관계 문장, 관계 결정)이 담깁니다.

`sortArchaeologyLedger(ledger, document)`는 ID나 값을 바꾸지 않고 정렬만 따로 적용합니다.

- 기록: 부모 깊이, 부모, `ordinal`, ID 순
- 발췌: 첫 출처의 문서 순서
- 속성: 기록과 출처 위치 순
- 출처: 기록, PDF 쪽, 위치 순
- 도면·사진: 기록과 순번 순
- 관계: 양쪽 기록과 이름 순

화면에서는 읽기 순서를 위해 `ordinal`로 다시 정렬할 수 있습니다.

## 추출 미리보기

`LedgerExtractor.extract()`는 이 패키지의 첫 번째 수직 슬라이스로, 모델 없이 확인하는 작은 기능으로 남겨 두었습니다. `ProcessedDocument`를 집계 카운트와 대표 샘플로 구성된 `LedgerExtractionPreview`로 요약해, 데이터가 원장 단계까지 온전히 전달되었음을 확인합니다.

- **런타임 검증**: `parseProcessedDocument()`가 업로드된 JSON 등 unknown 입력을 zod로 검증
- **재귀 집계**: `chapters`/`children` 트리 전체에서 챕터와 텍스트 블록 집계
- **테이블 셀 집계**: 모든 테이블의 `grid` 셀 개수 집계
- **샘플 제한**: 챕터 제목, 텍스트 블록, 이미지 URL, 테이블 샘플을 설정 가능한 개수(기본 5개)로 제한하고 긴 텍스트는 잘라냄
- **주입식 로깅**: `console.log`를 직접 사용하지 않고 주입된 logger로 출력

```typescript
import {
  LedgerExtractor,
  parseProcessedDocument,
} from '@heripo/ledger-extractor';
import { readFileSync } from 'fs';

// 1. Validate unknown input (e.g. an uploaded processed-document.json)
const raw = JSON.parse(readFileSync('processed-document.json', 'utf8'));
const document = parseProcessedDocument(raw);

// 2. Run the extraction preview
const extractor = new LedgerExtractor({
  logger: console, // any debug/info/warn/error logger
  sampleLimit: 5,
});
const preview = await extractor.extract(document);

console.log(preview.counts);
// { chapters: 24, textBlocks: 831, images: 173, tables: 48, tableCells: 1240, footnotes: 91 }
console.log(preview.samples.images[0]?.url);
// https://cdn.example.com/images/report-id/file-id/image.png
```

로그 출력 예:

```text
[LedgerExtractor] ProcessedDocument loaded: reportId=...
[LedgerExtractor] chapters=24, textBlocks=831
[LedgerExtractor] images=173, tables=48, tableCells=1240, footnotes=91
[LedgerExtractor] sample image URL: https://...
[LedgerExtractor] extraction preview completed
```

### `parseProcessedDocument(input: unknown): ProcessedDocument`

unknown 값을 검증해 타입이 지정된 `ProcessedDocument`를 돌려줍니다. 검증에 실패하면 문제 목록(개수 제한)을 담은 `ProcessedDocumentValidationError`를 던집니다.

### `new LedgerExtractor(options?: LedgerExtractorOptions)`

| 옵션          | 타입                    | 기본값       | 설명                              |
| ------------- | ----------------------- | ------------ | --------------------------------- |
| `logger`      | `LedgerExtractorLogger` | no-op logger | debug/info/warn/error 로그 수신자 |
| `sampleLimit` | `number`                | `5`          | 샘플 목록별 최대 항목 수          |

### `extract(document: ProcessedDocument): Promise<LedgerExtractionPreview>`

집계 카운트(`chapters`, `textBlocks`, `images`, `tables`, `tableCells`, `footnotes`)와 샘플(`chapterTitles`, `textBlocks`, `images`, `tables`)을 돌려줍니다.

## 지시문 변경 이력

이전의 원문 배정 경로(`content-attachment.v74`까지의 묶음 단위 지시문, `segment-recipients.v26`까지의 구간별 수신 대상 판단, 근거 창 계약)와 후보 탐색·중복 검토 프롬프트의 버전별 기록은 [docs/prompt-history.ko.md](https://github.com/heripo-lab/heripo-engine/blob/main/packages/ledger-extractor/docs/prompt-history.ko.md)에 옮겨 두었습니다. 저장된 감사 기록을 다시 재연할 수 있도록 이 API들은 계속 내보내며, 새 실행은 위의 묶음 단위 얇은 원문 배정을 씁니다.

## 라이선스

Apache-2.0 — [LICENSE](../../LICENSE) 참고.
