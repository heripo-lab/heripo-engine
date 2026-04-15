# @heripo/logger

> Logger interface for heripo engine

[![npm version](https://img.shields.io/npm/v/@heripo/logger.svg)](https://www.npmjs.com/package/@heripo/logger)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](../../LICENSE)

**English** | [한국어](./README.ko.md)

> **Note**: Please check the [root README](../../README.md) first for project overview, installation instructions, and roadmap.

`@heripo/logger` provides a minimal, dependency-free logger interface used across heripo engine packages. It acts as a thin adapter: you inject your own logging implementation (e.g. `console`, `pino`, `winston`), and heripo packages call the `Logger` through a consistent API.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
- [License](#license)

## Overview

Heripo engine packages emit debug, info, warn, and error messages through a shared `Logger` interface rather than writing directly to `console`. This keeps the libraries portable — the host application decides where logs go (stdout, a file, a remote sink) and what severity is enabled.

## Installation

```bash
# Install with npm
npm install @heripo/logger

# Install with pnpm
pnpm add @heripo/logger

# Install with yarn
yarn add @heripo/logger
```

## Usage

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

Pass the instance into any heripo engine package that accepts a `Logger`.

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

## Related Packages

- [@heripo/model](../model) - Document models and type definitions
- [@heripo/pdf-parser](../pdf-parser) - PDF parsing and OCR
- [@heripo/document-processor](../document-processor) - Document structure analysis

## License

This package is distributed under the [Apache License 2.0](../../LICENSE).

## Contributing

Contributions are always welcome! Please see the [Contributing Guide](../../CONTRIBUTING.md).

## Project-Wide Information

For project-wide information not covered in this package, see the [root README](../../README.md):

- **Citation and Attribution**: Academic citation (BibTeX) and attribution methods
- **Contributing Guidelines**: Development guidelines, commit rules, PR procedures
- **Community**: Issue tracker, discussions, security policy
- **Roadmap**: Project development plans

---

**heripo lab** | [GitHub](https://github.com/heripo-lab) | [heripo engine](https://github.com/heripo-lab/heripo-engine)
