# [0.2.0](https://github.com/andreas-timm/cli-ts/compare/0.1.3...0.2.0) (2026-07-04)

Generated zsh completion binaries can now be registered under a custom name, arguments after `--` are
forwarded to command positionals, and versioning, changelog, and publishing are automated with
semantic-release.

### Bug Fixes

* **cli:** pass double-dash args to command positionals ([1ce7beb](https://github.com/andreas-timm/cli-ts/commit/1ce7beb7c96d748aaec9c0b269693f9e725ec0f3))

### Features

* **completion:** add `--name` option for custom zsh completion bin name ([1466856](https://github.com/andreas-timm/cli-ts/commit/146685627a79a202c49b841865a90e006f3d8b70))
* **release:** add semantic-release automation ([b3da363](https://github.com/andreas-timm/cli-ts/commit/b3da363bad3a1ea82ab9b533a7fb4de3c23b7734))

# 0.1.3 (2026-04-26)

Initial release: CAC helpers for Bun and TypeScript CLIs, including command workflow wiring and zsh
completion generation.
