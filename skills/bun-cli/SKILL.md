---
name: bun-cli
description: Implement or refactor any CLI functionality in Bun and TypeScript projects using `@andreas-timm/cli` as the standard foundation for command registration, options (defaults, required flags, choice enums), multi-word commands, validation, help output, zsh completion, and install commands. Use whenever a Bun project needs a CLI entrypoint, subcommands, flags, parsing fixes, help text, completion, install workflows, or migration away from ad-hoc CLI helpers.
---
# Bun CLI With `@andreas-timm/cli`

This skill covers CLI work in Bun projects generally. The default rule is simple: if a Bun project needs CLI functionality, implement it with `cac` plus `@andreas-timm/cli`.

Do not copy helper implementations into the project source. Project code should own command intent and business logic; `@andreas-timm/cli` should own shared CLI mechanics such as command aliases, option normalization, multi-word parsing, help behavior, and completion output.

## Concept

- Treat the CLI as a first-class application surface, not a pile of one-off scripts.
- Use `cac` to define commands and flags.
- Use `@andreas-timm/cli` for reusable CLI infrastructure.
- Keep handlers lazy-loaded and focused on domain logic.
- If a project already has local CLI utilities that duplicate the package, migrate toward the package when touching that area.

## Default Rule

1. Any new CLI functionality in a Bun project should use `@andreas-timm/cli`.
2. Any modified CLI functionality should be moved closer to `@andreas-timm/cli` patterns instead of extending custom local helpers.
3. Only keep project-local CLI helpers when the package does not support a required behavior yet.
4. If the package is missing something important, prefer extending the package over cloning its code into the app.

## Install

```sh
bun add '@andreas-timm/cli'
```

## When This Skill Applies

Use this skill when the task is about any of the following in a Bun project:

- creating or restructuring `cli.ts`
- adding or changing commands, subcommands, or aliases
- adding flags, array options, required options, choice enums, validation, or parsing fixes
- improving `--help`, `help`, or subcommand help behavior
- adding shell completion
- adding an `install` command that symlinks a CLI into `~/.local/bin`
- migrating away from ad-hoc `cac` wrappers or copied helper code

Example requests that should trigger this skill:

- "Add a `deploy run` command to this Bun app"
- "Refactor this Bun CLI to support aliases and nested commands"
- "Fix repeated `--tag` flags in our CLI"
- "Add zsh completion to the Bun CLI"
- "Move these local CLI helpers to `@andreas-timm/cli`"

## Architecture

1. Keep the root `cli.ts` focused on assembly only: create `cac('<app-name>')`, register global options, register command groups, optionally register completion commands, install help behavior, set version, then call `await run(cli)`.
2. Put each command group in its own registrar module such as `registerFeatureCommands`.
3. Keep business logic in lazy-loaded handler modules, not in the registrar.
4. Reuse the package exports instead of re-implementing command registration, option normalization, help patches, or completion generation.

## Package Helpers

Use these exports from `@andreas-timm/cli`:

- `registerCommands` and `registerCommandNames` for primary names plus aliases.
- `addCommandOptions` for declarative option arrays. Each item may include `config` (see [Option defaults](#option-defaults), [Required options](#required-options), [Enum / choice options](#enum--choice-options)).
- `processCommandRawOptions` and `ensureScalar` to normalize repeated scalar flags.
- `preserveEmptyStringOption` when `""` must survive CAC parsing.
- `parsePositiveInteger` for strict positive integer validation.
- `CliOptionRawScalar` (`string | number | undefined`) for typing CAC `config.type` transforms; CAC itself types parsed options as `any`.
- `installDefaultCommandHelp`, `installSubcommandHelp`, and `run` for help behavior, multi-word command parsing, and unknown-command handling. `installDefaultCommandHelp` collapses the top-level "For more info, run any command with the `--help` flag" section into a single note without per-command examples. Pass `{ showHelpHint: false }` to `installSubcommandHelp` to suppress the "For more info, run any subcommand with the `--help` flag" footer section.
- `registerCompletionCommands` and `generateZshCompletion` when the CLI should emit zsh completion. `generateZshCompletion` reads `config.choices` on value options and emits `compadd` for those values after the flag (see [Enum / choice options](#enum--choice-options)).
- `assertOptionValueInChoices` for manual validation when not using `addCommandOptions`.
- `assertRequiredCliOptions` and `getCliOptionPropertyKey` when you validate parsed options yourself (see [Required options](#required-options)); prefer `config.required` on `CliOptionItem` with `addCommandOptions` so checks run automatically.
- `registerInstallCommand` and `runInstallCommand` when the CLI should ship a built-in `install` command that symlinks the app CLI into `~/.local/bin`. By default, `registerInstallCommand` uses `cli.name` for the link name and `process.argv[1]` for the target path; pass `packageName` and `targetPath` when you want explicit control.

## Root Entrypoint Example

See [files/cli.ts](files/cli.ts) for a complete `cli.ts`: global options, command group registration, optional `registerCompletionCommands` / `registerInstallCommand`, `installDefaultCommandHelp` + `installSubcommandHelp`, `cli.version(...)`, and `await run(cli)`.

## Option defaults

`CliOptionItem` supports `config?: { default?: unknown; type?: readonly unknown[]; choices?: readonly string[]; required?: boolean }`. Values are passed through to CAC’s `command.option(name, description, config)` except for `choices` and `required`, which `@andreas-timm/cli` handles around registration. Use `readonly` so `as const` option arrays (including tuple `type: [(v) => …]`) type-check.

- Set `config.default` when a flag should have a value even when the user omits it. CAC merges defaults into parsed options and usually prints `(default: …)` in `--help`.
- Prefer declaring the default on the option instead of repeating `options.foo ?? defaultValue` in the action when the default is unconditional for that command.
- **Conditional defaults** (e.g. “only when `--other` is set”) often still belong in the handler: CAC applies `default` for every run of that command, so the parsed options object will always include that key when omitted.

Example:

```ts
const OPTIONS = [
  { rawName: '--page <n>', description: 'Page number', config: { default: 1 } },
] as const;
```

## Required options

Set `config.required: true` when the user **must** pass the flag so the parsed value is not `undefined`. This is different from CAC’s angle brackets in `rawName` (`--foo <bar>`), which only mean “if the flag is used, a value is required,” not “the flag itself must appear.”

Behavior:

- `addCommandOptions` registers options, then wraps `command.action` so that before your handler runs, every item with `config.required` is checked: `options[getCliOptionPropertyKey(rawName)] !== undefined`.
- **`config.required` and `config.default` cannot be used together** (registration throws): a default always supplies a value, so “required” would be meaningless.
- Boolean flags work as expected: `false` is still a defined value; omitting the flag leaves `undefined` and fails the check.

For options registered without `addCommandOptions`, call `assertRequiredCliOptions(parsedOptions, items)` yourself, or use `getCliOptionPropertyKey('--flag <name>')` to look up the camelCased key CAC uses.

Example:

```ts
import type { CliOptionItem } from '@andreas-timm/cli';

const OPTIONS = [
  {
    rawName: '--env <env>',
    description: 'Target environment',
    config: { required: true },
  },
] as const satisfies readonly CliOptionItem[];
```

## Enum / choice options

Set `config.choices` on a **value** option (`<name>` or `[name]` in `rawName`). `addCommandOptions` composes a `type` wrapper so parse-time validation matches CAC: the value must satisfy `choices.includes(String(value))` after any custom `config.type[0]` transform. Omit `choices` or use an empty array to disable this.

- If you set both `default` and `choices`, the default must appear in `choices` (enforced when registering).
- With `choices`, CAC may still expose values as a one-element array; use `ensureScalar` / `processCommandRawOptions` like other `type` options.
- Prefer `addCommandOptions` for `choices`: CAC’s own `OptionConfig` typings do not include `choices`, and `addCommandOptions` composes validation plus keeps `option.config.choices` populated for `generateZshCompletion`.

Example:

```ts
const OPTIONS = [
  {
    rawName: '--format <format>',
    description: 'Output format',
    config: { choices: ['json', 'text', 'table'] },
  },
] as const satisfies readonly CliOptionItem[];
```

`generateZshCompletion` uses `config.choices` for value completion: after typing `--format `, the script offers only those strings (with the same prefix filtering as flags and subcommands). Options that also have `choices` do not use file/directory inference for that flag.

## Positive integer options in `OPTIONS`

Validate in the option definition with CAC’s `config.type[0]` transform instead of hand-parsing in the action. Use `CliOptionRawScalar` for the callback parameter type. Prefer a label that matches the flag (e.g. `'--limit'`) in `parsePositiveInteger` error messages.

See [files/positive-integer-options.ts](files/positive-integer-options.ts) for a full `OPTIONS` array with `default` + `type: [(v) => parsePositiveInteger(v, '--limit')]`.

Optional value options (no default) need a transform that allows `undefined` (CAC may still run transforms when other flags are parsed); required or defaulted options match that pattern. Boolean flags use `parseBooleanOption` instead; its input type includes `boolean`.

## Command Module Example

See [files/feature/cli.ts](files/feature/cli.ts) for a registrar that uses `registerCommands` with an alias, `addCommandOptions`, `preserveEmptyStringOption`, `processCommandRawOptions` with array keys, and a lazy-loaded handler import.

## Validation Example

See [files/validation-handler.ts](files/validation-handler.ts) for a handler that calls `processCommandRawOptions` then `parsePositiveInteger` on the parsed value.

## Migration Concept

When updating an existing Bun CLI:

1. Keep `cac` command definitions.
2. Replace local helper implementations with imports from `@andreas-timm/cli`.
3. Move heavy command actions into handler modules if they are still inline.
4. Replace direct `cli.parse(...)` calls with `await run(cli)` when multi-word commands or normalized help behavior matter.
5. Remove duplicate local utilities after the package-based path is working.

## Helper Selection

1. Use `registerCommands` when command creation and configuration happen together.
2. Use `registerCommandNames` when command registration and configuration are intentionally split.
3. Pass array option keys to `processCommandRawOptions(..., ['tag'])` so repeated values remain arrays; unlisted keys collapse to the last scalar value.
4. Use `preserveEmptyStringOption` when a flag must distinguish `""` from CAC's default coercion.
5. Use `config: { default: … }` on a `CliOptionItem` when the default should live in the option definition and appear in help; keep handler-side fallbacks only when the default depends on other flags.
6. Use `config: { choices: […] }` for fixed string enums on value options; use `assertOptionValueInChoices` only when you are not registering through `addCommandOptions`.
7. Use `config: { required: true }` when the user must pass the flag (parsed value must not be `undefined`); do not combine with `default`. Use `assertRequiredCliOptions` / `getCliOptionPropertyKey` only when options are not registered via `addCommandOptions`.
8. Use `config: { type: [(v: CliOptionRawScalar) => parsePositiveInteger(v, '--flag')] }` (and optional `default`) for positive integers; use handler-side `parsePositiveInteger` only when validation is conditional on other options.
9. Call `await run(cli)` instead of `cli.parse(...)` whenever the CLI supports multi-word commands or should normalize `help`.
10. Add `registerCompletionCommands(cli)` only when the CLI should ship a built-in `completion zsh` command.
11. Add `registerInstallCommand(cli, options?)` only when the CLI should ship a built-in `install` command. Pass `packageName` and `targetPath` explicitly when you want the link name and target path to be independent from `cli.name` and `process.argv[1]`.
12. Call `installDefaultCommandHelp(cli)` alongside `installSubcommandHelp(cli)` to ensure proper formatting of usage strings and subcommands.

## Behavioral Rules

- Default to `@andreas-timm/cli` for any CLI infrastructure in Bun projects.
- Prefer aliases for frequently used commands.
- Use `.alias('!')` on a named command to treat it as the default command in help layouts without auto-running it on bare invocation.
- Use multi-word command names only when grouping improves discoverability.
- Keep descriptions explicit and short.
- Keep side effects out of registrar files.
- Avoid eager imports of heavy handlers at startup.
- Do not duplicate code from `@andreas-timm/cli` into project utils unless the package is missing a required capability; extend the package instead.

## Verification Checklist

1. Run `<app> --help` and ensure global options appear once.
2. Run `<app> help` and `<app> <command> --help` and confirm `await run(cli)` normalizes both paths correctly.
3. Run all aliases for a command and confirm identical behavior.
4. Run multi-word commands with and without aliases.
5. Pass repeated scalar flags and verify the last value wins.
6. Pass repeated array flags and verify listed array keys preserve all values.
7. Run `<app> completion zsh` if enabled and confirm the script is emitted; for options with `config.choices`, complete after the flag and confirm only those strings are offered.
8. For commands that declare `config.required`, run without those flags and confirm a clear error; run with them and confirm the handler executes.
9. Run `<app> install` if enabled and confirm `~/.local/bin/<link-name>` points at the intended CLI entrypoint path.
10. Confirm removed local CLI helpers are no longer imported anywhere.
