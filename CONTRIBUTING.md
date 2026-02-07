# Contributing to blah-code

Thanks for contributing.

## Before you start

- Read `docs/critical-details.md`
- Check open issues first.
- Open an issue before large changes.

## Good contribution types

- bug fixes
- tool/runtime reliability improvements
- provider/auth improvements
- docs and onboarding improvements
- test coverage improvements

For major UX/product shifts, discuss in an issue first.

## Local setup

Prerequisites:

- Bun `1.3.5+`
- Git
- blah.chat account/API key

Install + run:

```bash
bun install
bun run dev -- login
bun run dev -- run "summarize this repo"
```

Daemon mode:

```bash
bun run dev:daemon
```

Detailed setup + debugging: `docs/development.md`

## Configuration

Project config file:

- `blah-code.json` in repo root (or `.blah-code.json`)

Auth options:

- `blah-code login` (recommended)
- `blah-code login --api-key blah_xxx`
- `BLAH_API_KEY` env var

## Validate changes

Run before opening PR:

```bash
bun run lint
bun run typecheck
bun run test
```

If you touch release logic, also run:

```bash
bun run apps/cli/scripts/build.ts
bun run apps/cli/scripts/compile.ts --single
```

## PR requirements

- issue linked in PR description (`Fixes #123`)
- small, focused diff
- conventional commit title (`feat:`, `fix:`, `docs:`, `chore:`)
- include verification steps in PR body
- include screenshots/videos for UI changes

## Commit format

Use:

```text
type: short description
```

Examples:

- `feat: add session replay endpoint`
- `fix: prevent permission request timeout leak`
- `docs: expand release token setup guide`

## Style

- Bun only (no npm/pnpm/yarn)
- TypeScript strict
- Keep blast radius small
- Prefer battle-tested libraries over custom implementations

## Where to add docs

- user/operator docs: `docs/`
- contributor process docs: repo root (`CONTRIBUTING.md`, `SECURITY.md`, etc)

## License

By contributing, you agree your contributions are licensed under MIT (`LICENSE`).
