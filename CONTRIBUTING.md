# Contributing

Thank you for your interest in this project! This guide explains local development, testing, code style, and the PR process.

## Development Environment

- Node.js: >= 22
- Package manager: pnpm 9
- Monorepo: pnpm workspaces with Turbo
- Language/Runtime: TypeScript, ESM (ES2022)

### Project Setup

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

### Useful Scripts

```bash
# Build all packages (uses Turbo for caching)
pnpm build

# Type checking across all workspaces
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix

# Formatting
pnpm format
pnpm format:check

# Run all tests
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm test:ci
```

### Package-specific Commands

```bash
# Build specific package
pnpm --filter @heripo/pdf-parser build

# Test specific package
pnpm --filter @heripo/pdf-parser test
pnpm --filter @heripo/pdf-parser test:coverage

# Run a single test file
pnpm --filter @heripo/pdf-parser test src/utils/jq.test.ts
```

## Code Style

- ESLint (typescript-eslint), Prettier
- Import sorting: `@trivago/prettier-plugin-sort-imports`
- Before committing: run `pnpm lint` `pnpm typecheck` `pnpm test`
- All comments, JSDoc, and documentation must be written in English

## Testing Guide

- Test runner: Vitest
- Environment: Node (`environment: 'node'`), ESM, globals `describe/test/expect/vi`
- File pattern: `src/**/*.{test,spec}.{ts,js,mjs}`
- Coverage: v8, threshold 100% (lines/functions/branches/statements)
- Always use `test()` instead of `it()` for test cases

### Mocking Principles

- Mock all side effects: network/file/process/time/randomness
- Use `vi.mock()` for external modules
- Make time/randomness deterministic (`Date.now`, `crypto.randomUUID`)

## Fork & Pull Request Workflow

### 1. Fork the Repository

Click "Fork" button on GitHub: https://github.com/heripo-lab/heripo-engine

### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR_USERNAME/heripo-engine.git
cd heripo-engine
```

### 3. Add Upstream Remote

```bash
git remote add upstream https://github.com/heripo-lab/heripo-engine.git
git remote -v  # Verify: origin (your fork), upstream (original repo)
```

### 4. Create a Branch

```bash
git checkout -b feat/your-feature-name
# or: fix/bug-description, docs/update-readme, etc.
```

Branch naming: `feat/...`, `fix/...`, `chore/...`, `docs/...`, `test/...`

### 5. Make Changes & Test Locally

```bash
# Install dependencies
pnpm install

# Make your changes, then verify:
pnpm lint
pnpm typecheck
pnpm build
pnpm test

# Keep 100% coverage!
pnpm test:coverage
```

### 6. Commit Your Changes

```bash
git add .
git commit -m "feat: add amazing feature"
```

Commit messages: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)

### 7. Push to Your Fork

```bash
git push origin feat/your-feature-name
```

### 8. Create Pull Request

1. Go to your fork on GitHub: `https://github.com/YOUR_USERNAME/heripo-engine`
2. Click "Compare & pull request" button
3. Base repository: `heripo-lab/heripo-engine` base: `main`
4. Head repository: `YOUR_USERNAME/heripo-engine` compare: `feat/your-feature-name`
5. Fill in PR template with description of changes
6. Submit!

### 9. Respond to Review Feedback

```bash
# Make requested changes
git add .
git commit -m "fix: address review feedback"
git push origin feat/your-feature-name

# PR will auto-update
```

### 10. Keep Your Fork Updated

```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

## PR Checklist

- [ ] I followed the Code of Conduct (see CODE_OF_CONDUCT.md)
- [ ] Forked repo and created feature branch
- [ ] I ran: `pnpm lint` `pnpm typecheck` `pnpm build` `pnpm test`
- [ ] Tests added/updated; coverage remains 100%
- [ ] Docs/README updated if needed
- [ ] No external side effects (network/file/process/time) in tests — use mocks
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains what/why/how

## CI

- Location: `.github/workflows/ci.yml`
- Triggers: Pull Request, manual
- Steps: Lint → Typecheck → Build → Test (coverage)
- Node version: 22, pnpm version: 9

## Issues / Questions

- Please open GitHub Issues for bug reports/feature requests.
- Include reproduction steps, expected/actual results, logs/screenshots to speed up review.
