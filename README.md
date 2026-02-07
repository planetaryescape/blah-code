# blah-code

Local-first coding agent CLI + daemon for blah.chat users.

## install

### npm (recommended)

```bash
npm i -g @blah-code/cli
```

### Homebrew (macOS/Linux)

```bash
brew tap planetaryescape/homebrew-tap
brew install blah-code
```

### from source

```bash
git clone https://github.com/planetaryescape/blah-code.git
cd blah-code
bun install
bun run dev -- login
```

## first run

```bash
blah-code login
blah-code run "summarize this repo"
```

Examples:

```bash
blah-code run "find auth bugs"
blah-code run --model openai:gpt-5-mini "refactor this module"
blah-code run --cwd /path/to/repo "add tests for parser"
blah-code run --json "summarize changes since last commit"
```

## auth

Options:

```bash
blah-code login
blah-code login --api-key blah_xxx
```

Env vars:

- `BLAH_API_KEY` optional if you use `blah-code login`
- `BLAH_BASE_URL` optional (default `https://blah.chat`)

If not logged in via `blah-code`, it can fall back to credentials from existing `blah` CLI login.

## config (`blah-code.json`)

Create in project root:

```json
{
  "model": "openai:gpt-5-mini",
  "permission": {
    "*": "ask",
    "read": "allow",
    "exec": {
      "git status": "allow",
      "*": "ask"
    }
  },
  "mcp": {
    "filesystem": {
      "enabled": true,
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

## daemon API

- `GET /health`
- `GET /v1/tools`
- `GET /v1/permissions/rules`
- `POST /v1/permissions/rules`
- `POST /v1/sessions`
- `POST /v1/sessions/:id/prompt`
- `GET /v1/sessions/:id/events`
- `GET /v1/sessions/:id/events/stream`
- `GET /v1/sessions/:id/permissions`
- `POST /v1/sessions/:id/permissions/:requestId/reply`
- `POST /v1/sessions/:id/checkpoint`
- `POST /v1/sessions/:id/revert`

Run daemon locally:

```bash
bun run dev:daemon
```

## docs

- core docs: `docs/README.md`
- local setup/dev workflow: `docs/development.md`
- permissions: `docs/permissions.md`
- operations/troubleshooting: `docs/operations.md`
- release/publish automation: `docs/release-automation.md`

## open source

- license: `MIT` (`LICENSE`)
- contributing: `CONTRIBUTING.md`
- code of conduct: `CODE_OF_CONDUCT.md`
- security policy: `SECURITY.md`
- support: `SUPPORT.md`
- governance: `GOVERNANCE.md`
- maintainers: `MAINTAINERS.md`
