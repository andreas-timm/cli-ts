# Contributing

## Releasing

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io) on pushes to `main`.

### How a release happens

1. Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org): `fix:` releases a
   patch, `feat:` a minor, and a `BREAKING CHANGE:` footer or `!` suffix a major. Other types (`chore:`,
   `docs:`, `refactor:`, ...) do not trigger a release.
2. The `Semantic Release` workflow verifies the package (lint, test, build, audit), then runs
   `semantic-release`, which:
   - determines the next version from the commits since the last release tag
   - updates `CHANGELOG.md`, unless the version's section is already hand-written
   - commits `CHANGELOG.md` and `package.json` as `chore(release): <version> [skip ci]`, GPG-signed
   - creates the signed tag `<version>` (no `v` prefix) and the GitHub release
3. When a release was published, follow-up jobs publish the tagged version to npmjs (trusted publishing
   with `--provenance`) and to GitHub Packages.

### Previewing the next release

```sh
bun run release:preview
```

This is a dry run: it prints the next version and the commit-derived release notes without changing
anything, and reports when `CHANGELOG.md` already contains a hand-written section for that version.

### Hand-written release notes

Commit-derived notes are the fallback. To write the notes yourself, add the version's section to
`CHANGELOG.md` before the release lands on `main`:

```markdown
# [0.2.0](https://github.com/andreas-timm/cli-ts/compare/0.1.0...0.2.0) (2026-07-02)

Summary of the release...
```

When a section for the next version already exists, semantic-release keeps it verbatim and uses it as the
GitHub release notes and the release commit body.

### Required repository configuration

- `RELEASE_GPG_PRIVATE_KEY` actions secret: ASCII-armored (or base64-encoded) GPG private signing subkey;
  release commits and tags are signed with it.
- `RELEASE_GIT_NAME` and `RELEASE_GIT_EMAIL` actions variables: the Git identity of the release commits and
  tags; must match the GPG key's UID.

  ```sh
  gh variable set RELEASE_GIT_NAME --repo andreas-timm/cli-ts --body '<NAME>'
  gh variable set RELEASE_GIT_EMAIL --repo andreas-timm/cli-ts --body '<EMAIL>'
  ```

- npm trusted publishing configured on npmjs.com for this repository and the `semantic-release.yml`
  workflow.
- `main` must allow the workflow's `GITHUB_TOKEN` to push the release commit and tag.
