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

Run one task:

```bash
bun run dev -- run "summarize this repository"
```

Run daemon API:

```bash
bun run dev:daemon
```

Health check:

```bash
curl -s http://127.0.0.1:3789/health
```

## config

Create `blah-code.json` in your workspace:

```json
{
  "model": "openai:gpt-5-mini",
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

- repeated permission denials:
inspect permission policy in `blah-code.json` and allowlist repetitive safe commands deliberately.
