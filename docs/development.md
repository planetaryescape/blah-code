# development setup

## prerequisites

- Bun `1.3.5+`
- Git
- macOS/Linux/WSL recommended
- a blah.chat account (or API key)

## clone and install

```bash
git clone https://github.com/planetaryescape/blah-code.git
cd blah-code
bun install
```

## authenticate locally

Preferred:

```bash
bun run dev -- login
```

API key mode:

```bash
bun run dev -- login --api-key blah_xxx
```

Env var mode (CI/headless):

```bash
export BLAH_API_KEY=blah_xxx
```

## run locally

Start interactive TUI:

```bash
bun run dev
```

TUI key map:

- `Enter` send
- `Shift+Enter` newline
- `Ctrl+K` command palette
- `Ctrl+N` new session
- `Ctrl+P` previous session
- `Ctrl+Shift+N` next session
- `Ctrl+S` toggle status panel
- `Ctrl+E` toggle system stream

Session naming:

- first prompt in unnamed session triggers auto-title generation
- fallback title uses first prompt words if model naming fails

Run one task:

```bash
bun run dev -- run "summarize this repository"
```

Run daemon API:

```bash
bun run dev -- serve
```

Health check:

```bash
curl -s http://127.0.0.1:3789/health
```

Status and logs:

```bash
bun run dev -- status
bun run dev -- logs --lines 200
```

## config

Create `blah-code.json` in your workspace:

```json
{
  "model": "zai:glm-4.7",
  "timeout": {
    "modelMs": 120000
  },
  "logging": {
    "level": "info",
    "print": false
  },
  "daemon": {
    "host": "127.0.0.1",
    "port": 3789
  },
  "permission": {
    "*": "ask",
    "read": "allow",
    "write": "ask",
    "exec": "ask",
    "network": "ask"
  }
}
```

Docs:

- `docs/permissions.md`
- `docs/operations.md`

## quality checks

```bash
bun run lint
bun run typecheck
bun run test
```

Release-related smoke checks:

```bash
bun run apps/cli/scripts/build.ts
bun run apps/cli/scripts/compile.ts --single
```

## release docs

- `docs/release-automation.md`

## troubleshooting

- `BLAH_API_KEY missing`:
run `blah-code login` or set `BLAH_API_KEY`.

- model calls failing:
check `BLAH_BASE_URL` and verify API key validity.

- run timeouts / blind failures:
check `blah-code status`, inspect `blah-code logs`, then replay `blah-code events <sessionId>`.

- repeated permission denials:
inspect permission policy in `blah-code.json` and allowlist repetitive safe commands deliberately.
