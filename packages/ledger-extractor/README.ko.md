# @heripo/ledger-extractor

> 고고학 보고서 데이터 원장 추출 미리보기 라이브러리

[![npm version](https://img.shields.io/npm/v/@heripo/ledger-extractor.svg)](https://www.npmjs.com/package/@heripo/ledger-extractor)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 개요, 설치 방법, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인해 주세요.

`@heripo/ledger-extractor`는 heripo 데이터 파이프라인의 원장(Ledger) 추출 단계의 첫 번째 수직 슬라이스입니다. `@heripo/document-processor`가 생성한 `ProcessedDocument`를 입력받아 집계 카운트와 대표 샘플로 구성된 `LedgerExtractionPreview`를 만들어, 데이터가 원장 단계까지 온전히 전달되었음을 확인합니다.

> **미리보기 전용**: 이 패키지는 아직 실제 원장 추출을 구현하지 않습니다. LLM 호출, 원장 도메인 스키마, 표준화, DB 저장은 모두 후속 작업입니다.

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

- 입력은 단일 `ProcessedDocument` JSON입니다(`packages/model/src/types/processed-document.ts` 참고). ZIP, manifest, 이미지 파일 묶음은 받지 않습니다.
- `ProcessedImage.path`에는 로컬 파일 경로나 B2 object key가 아니라 `heripo-web` export 스크립트가 생성한 **완전한 public CDN URL**이 들어와야 합니다. 이 URL은 그대로 소비되며, fetch·서명·변환하지 않습니다.
- 입력 문서를 변경(mutate)하지 않습니다.

## 라이선스

Apache-2.0 — [LICENSE](../../LICENSE) 참고.
