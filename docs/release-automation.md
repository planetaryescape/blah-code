# release automation

## what is automated

1. push to `main` -> `release-please` updates/opens release PR.
2. published tag `cli-vX.Y.Z` -> workflow builds binaries, uploads release assets, publishes npm, updates Homebrew formula.

## where workflows live

- `.github/workflows/release-please.yml`
- `.github/workflows/release-cli.yml`
- `.release-please-config.json`
- `.release-please-manifest.json`

## one-time setup checklist

1. create 3 secrets in `planetaryescape/blah-code`:
- `RELEASE_PLEASE_TOKEN`
- `NPM_TOKEN`
- `HOMEBREW_TAP_TOKEN`
2. confirm Actions permission in repo:
- `Settings -> Actions -> General -> Workflow permissions -> Read and write permissions`
- enable `Allow GitHub Actions to create and approve pull requests`
3. verify npm scope access for `@blah-code`.
4. verify token owner can push to `planetaryescape/homebrew-tap`.

## token setup: RELEASE_PLEASE_TOKEN

Purpose: release-please needs a PAT so downstream release workflows trigger correctly.

Create token (GitHub fine-grained PAT):

1. GitHub avatar -> `Settings`.
2. `Developer settings`.
3. `Personal access tokens` -> `Fine-grained tokens`.
4. `Generate new token`.
5. Token name: `blah-code-release-please`.
6. Resource owner: your org/user owning `planetaryescape/blah-code`.
7. Repository access: `Only select repositories` -> select `blah-code`.
8. Repository permissions:
- `Contents: Read and write`
- `Pull requests: Read and write`
- `Issues: Read and write`
- `Metadata: Read-only` (default)
9. Generate token and copy once.

Add as repo secret:

1. `planetaryescape/blah-code` -> `Settings`.
2. `Secrets and variables` -> `Actions`.
3. `New repository secret`.
4. Name: `RELEASE_PLEASE_TOKEN`.
5. Value: token from above.

## token setup: NPM_TOKEN

Purpose: publish `@blah-code/cli` and platform packages.

Create token (npm):

1. Sign into npm with account that has publish rights to `@blah-code`.
2. `Account Settings` -> `Access Tokens`.
3. `Generate New Token`.
4. Choose token type:
- preferred: `Granular Access Token`
5. For granular token set:
- Packages and scopes: include `@blah-code`.
- Permissions: `Read and write`.
- Expiration: set per your policy.
- CIDR whitelist: leave empty unless your org requires it.
6. Generate and copy token once.

Add as repo secret:

1. `planetaryescape/blah-code` -> `Settings` -> `Secrets and variables` -> `Actions`.
2. `New repository secret`.
3. Name: `NPM_TOKEN`.
4. Value: npm token.

## token setup: HOMEBREW_TAP_TOKEN

Purpose: commit updated formula to `planetaryescape/homebrew-tap`.

Create token (GitHub fine-grained PAT):

1. GitHub avatar -> `Settings` -> `Developer settings`.
2. `Personal access tokens` -> `Fine-grained tokens` -> `Generate new token`.
3. Token name: `blah-code-homebrew-tap`.
4. Resource owner: org/user owning `planetaryescape/homebrew-tap`.
5. Repository access: `Only select repositories` -> `homebrew-tap`.
6. Repository permissions:
- `Contents: Read and write`
- `Metadata: Read-only` (default)
7. Generate and copy token once.

Add as repo secret:

1. `planetaryescape/blah-code` -> `Settings` -> `Secrets and variables` -> `Actions`.
2. `New repository secret`.
3. Name: `HOMEBREW_TAP_TOKEN`.
4. Value: token from above.

## release tag contract

- release workflow runs only for tags matching `cli-v<semver>`.
- asset names must stay aligned across:
- `apps/cli/scripts/compile.ts`
- `.github/workflows/release-cli.yml`
- `apps/cli/scripts/publish.ts`
- `Formula/blah-code.rb` URL template.

## first release smoke test

1. merge a conventional commit to `main`.
2. release-please PR opens; merge it.
3. confirm published release tag looks like `cli-vX.Y.Z`.
4. confirm release assets exist:
- `blah-code-cli-darwin-arm64.tar.gz`
- `blah-code-cli-linux-x64.tar.gz`
- `blah-code-cli-linux-arm64.tar.gz`
- `blah-code-cli-windows-x64.zip`
5. confirm npm packages published:
- `@blah-code/cli`
- `@blah-code/cli-darwin-arm64`
- `@blah-code/cli-linux-x64`
- `@blah-code/cli-linux-arm64`
- `@blah-code/cli-windows-x64`
6. confirm `planetaryescape/homebrew-tap/Formula/blah-code.rb` updated.
7. smoke install:
- `npm i -g @blah-code/cli && blah-code --version`
- `brew install blah-code && blah-code --version`

## common failures

1. release-please PR not opening
- check `RELEASE_PLEASE_TOKEN` exists and has permissions above.
- check workflow is on `main`.

2. npm publish denied
- check `NPM_TOKEN` not expired/revoked.
- check npm user is maintainer of `@blah-code`.

3. Homebrew formula update fails
- check `HOMEBREW_TAP_TOKEN` has `Contents: Read and write` on `homebrew-tap`.
- check release asset URLs are valid before checksum step.
