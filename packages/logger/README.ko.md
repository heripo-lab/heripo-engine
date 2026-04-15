# @heripo/logger

> heripo engine을 위한 Logger 인터페이스

[![npm version](https://img.shields.io/npm/v/@heripo/logger.svg)](https://www.npmjs.com/package/@heripo/logger)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

[English](./README.md) | **한국어**

> **참고**: 프로젝트 개요, 설치, 로드맵은 [루트 README](../../README.ko.md)를 먼저 확인하세요.

`@heripo/logger`는 heripo engine 패키지 전반에서 사용하는 의존성 없는 최소 Logger 인터페이스입니다. 얇은 어댑터로서, 사용자(호스트 애플리케이션)가 자신의 로깅 구현체(예: `console`, `pino`, `winston`)를 주입하면 heripo 패키지들이 일관된 API로 `Logger`를 호출합니다.

## 목차

- [개요](#개요)
- [설치](#설치)
- [사용법](#사용법)
- [API](#api)
- [라이선스](#라이선스)

## 개요

heripo engine 패키지들은 debug, info, warn, error 메시지를 `console`에 직접 출력하지 않고 공용 `Logger` 인터페이스를 통해 내보냅니다. 이렇게 하면 라이브러리의 이식성이 유지됩니다 — 로그를 어디로 보낼지(stdout, 파일, 원격 수집기)와 어떤 심각도 레벨을 활성화할지는 호스트 애플리케이션이 결정합니다.

## 설치

```bash
# npm
npm install @heripo/logger

# pnpm
pnpm add @heripo/logger

# yarn
yarn add @heripo/logger
```

## 사용법

```typescript
import { Logger } from '@heripo/logger';

const logger = new Logger({
  debug: (...args) => console.debug('[heripo]', ...args),
  info: (...args) => console.info('[heripo]', ...args),
  warn: (...args) => console.warn('[heripo]', ...args),
  error: (...args) => console.error('[heripo]', ...args),
});

logger.info('pipeline started');
```

생성한 인스턴스를 `Logger`를 받는 heripo engine 패키지에 전달하면 됩니다.

## API

### `Logger`

```typescript
class Logger {
  constructor(methods: LoggerMethods);
  readonly debug: LogFn;
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;
}
```

### `LoggerMethods`

```typescript
interface LoggerMethods {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}
```

### `LogFn`

```typescript
type LogFn = (...args: any[]) => void;
```

## 관련 패키지

- [@heripo/model](../model) - 문서 모델 및 타입 정의
- [@heripo/pdf-parser](../pdf-parser) - PDF 파싱 및 OCR
- [@heripo/document-processor](../document-processor) - 문서 구조 분석

## 라이선스

이 패키지는 [Apache License 2.0](../../LICENSE)으로 배포됩니다.

## 기여하기

기여는 언제나 환영입니다! [Contributing Guide](../../CONTRIBUTING.md)를 참고하세요.

## 프로젝트 전체 정보

패키지에 포함되지 않은 프로젝트 전반의 정보는 [루트 README](../../README.ko.md)를 참고하세요:

- **Citation 및 Attribution**: 학술 인용(BibTeX)과 표기 방법
- **기여 가이드라인**: 개발 가이드라인, 커밋 규칙, PR 절차
- **커뮤니티**: 이슈 트래커, 토론, 보안 정책
- **로드맵**: 프로젝트 개발 계획

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
