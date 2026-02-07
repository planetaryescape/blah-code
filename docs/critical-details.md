# critical details

## 1) runtime truth

- `blah-code` is local-first orchestration.
- model inference currently routes through blah API (`/api/v1/cli/rpc` + `/api/v1/cli/messages/stream/:conversationId`).
- tool execution is local (filesystem, shell, MCP).

Implication: local tool power + remote model dependency.

## 2) trust boundary

- remote: model output is untrusted text.
- local: tool runtime can read/write/exec based on policy.
- policy engine is hard gate before every tool call.

## 3) permission defaults

- default policy baseline:
  - `* = ask`
  - `read = allow`
  - `write = ask`
  - `exec = ask`
  - `network = ask`
- ask-mode requests are auto-denied after 5 min if unanswered (daemon path).

## 4) policy precedence

Evaluation order:

1. `*` baseline
2. op rule (`read`/`write`/`exec`/`network`)
3. subject rule (`tool.<name>` if present)
4. specific patterns override wildcard entries

This is defined in `packages/policy/src/index.ts`.

## 5) filesystem safety

Built-in file tools resolve against cwd and block path escape (`..` outside workspace).

## 6) MCP caveat

- MCP tools are exposed as `mcp.<server>.<tool>`.
- permission default for MCP:
  - `read` only if MCP tool advertises `readOnlyHint`
  - otherwise `exec`

Treat unknown MCP tools as high privilege.

## 7) durable state

- sessions/events stored in sqlite (`~/.blah-code/sessions.db`).
- event log is source of truth for replay/inspection.

## 8) current parity gaps vs opencode

Not complete yet:

- no LSP tool pack
- no subagent orchestration
- no rich TUI app yet (CLI run + daemon done)
- checkpoint/revert currently event markers, not full workspace snapshot restore

## 9) production caution

Do not treat this as fully hardened sandbox yet. Use conservative permission rules in CI/automation.
