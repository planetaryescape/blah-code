# operations

## startup

TUI (default):

```bash
bun run dev
```

One-shot run:

```bash
bun run dev -- run "task"
```

Daemon:

```bash
bun run dev -- serve
```

## required checks

- `GET /health` returns `{ "status": "ok" }`
- `GET /v1/status` returns daemon runtime details
- `GET /v1/logs?lines=200` returns recent logs
- `GET /v1/tools` returns tool list
- `POST /v1/sessions` returns `sessionId`

## event debugging

- poll: `GET /v1/sessions/:id/events`
- stream: `GET /v1/sessions/:id/events/stream`

Look for event order:

1. `run_started`
2. `tool_call`
3. optional `permission_request` -> `permission_resolved`
4. `tool_result` or `error`
5. `assistant` (+ optional `assistant_delta`)
6. `run_finished` + `done`

## common failures

1. `BLAH_API_KEY missing`
- set env or run `blah-code login`.

2. model call hangs/fails
- validate `BLAH_BASE_URL`
- check connectivity to blah server
- inspect session events for last emitted step
- inspect logs with `blah-code logs --lines 200`
- check timeout value (`--timeout-ms` or `timeout.modelMs`)

3. repeated permission denials
- query `GET /v1/sessions/:id/permissions`
- submit reply via `POST /v1/sessions/:id/permissions/:requestId/reply`
- optionally persist policy via `POST /v1/permissions/rules`

4. daemon visibility unknown
- run `blah-code status`
- if down, run `blah-code serve`
- verify with `GET /v1/status`

## lifecycle

- sqlite db path: `~/.blah-code/sessions.db`
- log file path: `~/.blah-code/logs/current.log`
- backup if using as audit trail
