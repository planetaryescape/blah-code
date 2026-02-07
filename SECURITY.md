# Security Policy

## Supported versions

- `main`: supported
- latest release: supported
- older releases: best effort only

## Threat model summary

`blah-code` is a local-first coding agent with high-privilege tools.

Important:

- permission prompts are a UX safety layer, not a hardened sandbox
- local shell/filesystem/MCP tools can execute powerful actions
- for strict isolation, run in Docker/VM/locked-down runner

## Report a vulnerability

Do not open public issues for security bugs.

Use one of:

- GitHub Security Advisory: `Security -> Report a vulnerability`
- email: `blah.chat@bhekani.com` with subject `[SECURITY] ...`

Please include:

- affected component/path
- reproduction steps or PoC
- impact
- suggested fix (optional)

## Response targets

- initial acknowledgement: within 48 hours
- triage and severity assessment: as fast as possible
- coordinated disclosure after fix release

## Out of scope

- insecure third-party MCP server behavior
- insecure local machine setup by user
- provider-side data handling policies (OpenAI/Anthropic/etc)

## Operator hardening checklist

- keep strict permission defaults (`write/exec/network = ask`)
- run with least privilege user
- avoid exposing daemon on public interfaces without auth
- keep Bun/dependencies updated
- rotate API keys and remove leaked keys immediately
