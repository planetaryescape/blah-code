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
blah-code
```

`blah-code` (no args) now opens the interactive TUI.

TUI defaults:

- `Enter` send
- `Shift+Enter` newline
- `Ctrl+K` command palette
- first prompt auto-renames the session title (fallback: first prompt words)

Examples:

```bash
blah-code run "find auth bugs"
blah-code run --model zai:glm-4.7 "refactor this module"
blah-code run --cwd /path/to/repo "add tests for parser"
blah-code run --json "summarize changes since last commit"
blah-code status
blah-code logs --lines 200
blah-code serve
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
- `GET /v1/status`
- `GET /v1/logs?lines=200`
- `GET /v1/tools`
- `GET /v1/permissions/rules`
- `POST /v1/permissions/rules`
- `POST /v1/sessions`
- `GET /v1/sessions?limit=20`
- `PATCH /v1/sessions/:id`
- `POST /v1/sessions/:id/prompt`
- `GET /v1/sessions/:id/events`
- `GET /v1/sessions/:id/events/stream`
- `GET /v1/sessions/:id/permissions`
- `POST /v1/sessions/:id/permissions/:requestId/reply`
- `POST /v1/sessions/:id/checkpoint`
- `POST /v1/sessions/:id/revert`

Run daemon locally:

```bash
blah-code serve
```

Runtime artifacts:

- session DB: `~/.blah-code/sessions.db`
- logs: `~/.blah-code/logs/current.log`

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
