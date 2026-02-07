# blah-code

Local-first coding agent CLI + daemon for blah.chat users.

## quickstart

```bash
bun install
bun run dev -- run "summarize this repo"
```

## config

Create `blah-code.json` in your project root:

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

## env

- `BLAH_API_KEY` optional if you run `blah-code login`
- `BLAH_BASE_URL` optional (default `https://blah.chat`)

Auth options:

```bash
blah-code login
blah-code login --api-key blah_xxx
```

If you never run `blah-code login`, it can still reuse credentials from existing `blah` CLI login.

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
