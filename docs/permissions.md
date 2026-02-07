# permissions

## policy format

`blah-code.json`:

```json
{
  "permission": {
    "*": "ask",
    "read": "allow",
    "exec": {
      "git status": "allow",
      "*": "ask"
    },
    "tool.exec": "deny",
    "tool.mcp.filesystem.write": "ask"
  }
}
```

Values:

- scalar: `"allow" | "deny" | "ask"`
- map: `{ "pattern": "allow|deny|ask" }`

## matching semantics

- exact match is allowed (`"git status"`)
- glob patterns supported (`"git *"`, `"**/*.ts"`)
- wildcard `*` works as fallback in map entries

## recommendation

Start strict:

- keep `write/exec/network` at `ask`
- allowlist only repetitive safe commands
- prefer per-op rule maps over global allow
