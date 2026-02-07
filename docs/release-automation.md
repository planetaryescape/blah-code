# release automation

## what is automated

1. `release-please` opens/updates release PRs from commits on `main`.
2. publishing a `cli-vX.Y.Z` GitHub release triggers:
- cross-platform binary build/upload
- npm publish for `@blah-code/cli-*` + `@blah-code/cli`
- Homebrew formula update in `planetaryescape/homebrew-tap` (`Formula/blah-code.rb`)

## required github secrets

1. `RELEASE_PLEASE_TOKEN`
- required by `.github/workflows/release-please.yml`
- needs repo `contents`, `pull_requests`, `issues` write.

2. `NPM_TOKEN`
- required by `.github/workflows/release-cli.yml` (`publish-npm` job)
- npm automation token with publish rights for:
  - `@blah-code/cli`
  - `@blah-code/cli-darwin-arm64`
  - `@blah-code/cli-linux-x64`
  - `@blah-code/cli-linux-arm64`
  - `@blah-code/cli-windows-x64`

3. `HOMEBREW_TAP_TOKEN`
- required by `.github/workflows/release-cli.yml` (`update-homebrew` job)
- PAT with write access to `planetaryescape/homebrew-tap`.

## release tag contract

- release workflow only runs for tags matching `cli-v<semver>`.
- non-matching tags are skipped by design.
- release assets names must stay aligned with:
  - `apps/cli/scripts/compile.ts`
  - `.github/workflows/release-cli.yml`
  - `apps/cli/scripts/publish.ts`
  - Homebrew formula URLs.

## manual verify checklist

After first live release:

1. GitHub release has 4 assets:
- `blah-code-cli-darwin-arm64.tar.gz`
- `blah-code-cli-linux-x64.tar.gz`
- `blah-code-cli-linux-arm64.tar.gz`
- `blah-code-cli-windows-x64.zip`
2. npm has new versions for `@blah-code/cli` and all platform packages.
3. `planetaryescape/homebrew-tap` has updated `Formula/blah-code.rb`.
4. install smoke tests:
- `npm i -g @blah-code/cli && blah-code --version`
- `brew install blah-code && blah-code --version`

## common failures

1. `release-please` not creating PR
- verify workflow runs on `main`
- verify `RELEASE_PLEASE_TOKEN` scopes.

2. npm publish fails
- check `NPM_TOKEN` permissions/scopes
- check package name ownership under `@blah-code`.

3. homebrew update fails
- check `HOMEBREW_TAP_TOKEN` access
- check release assets are present before checksum step.
