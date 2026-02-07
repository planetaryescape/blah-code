# operations

## startup

CLI:

```bash
bun run dev -- run "task"
```

Daemon:

```bash
bun run dev:daemon
```

## required checks

- `GET /health` returns `{ "status": "ok" }`
- `GET /v1/tools` returns tool list
- `POST /v1/sessions` returns `sessionId`

## event debugging

- poll: `GET /v1/sessions/:id/events`
- stream: `GET /v1/sessions/:id/events/stream`

Look for event order:

1. `tool_call`
2. optional `permission_request` -> `permission_resolved`
3. `tool_result` or `error`
4. `assistant`
5. `done`

## common failures

1. `BLAH_API_KEY missing`
- set env or run `blah login` so credential reuse works.

2. model call hangs/fails
- validate `BLAH_BASE_URL`
- check connectivity to blah server
- inspect session events for last emitted step

3. repeated permission denials
- query `GET /v1/sessions/:id/permissions`
- submit reply via `POST /v1/sessions/:id/permissions/:requestId/reply`
- optionally persist policy via `POST /v1/permissions/rules`

## lifecycle

- sqlite db path: `~/.blah-code/sessions.db`
- backup if using as audit trail
