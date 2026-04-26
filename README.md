# @andreas-timm/cli

Helpers for building Bun and TypeScript CLIs on top of `cac`.

## Features

- Register commands and aliases with a small typed wrapper around `cac`.
- Normalize multi-word commands, `help`, `-h`, and `--help` flows.
- Add declarative options with defaults, required flags, choices, and validation.
- Generate zsh completion, including option value choices and path inference.
- Install app CLIs into `~/.local/bin` with a reusable command helper.

## Install

```sh
npm install @andreas-timm/cli
```

## Usage

```ts
import { cac } from "cac";
import {
    installDefaultCommandHelp,
    installSubcommandHelp,
    registerCommands,
    run,
} from "@andreas-timm/cli";

const cli = cac("example");

registerCommands(cli, ["build", "b"], "Build the project", (command) => {
    command.option("--watch", "Watch files");
    command.action(async (options) => {
        console.log("build", options);
    });
});

installDefaultCommandHelp(cli);
installSubcommandHelp(cli);

await run(cli);
```

For the full CLI patterns, option rules, completion behavior, and install-command guidance, see [`skills/bun-cli/SKILL.md`](./skills/bun-cli/SKILL.md).

## Agent skill `bun-cli`

The package ships a Cursor/Agent skill named **bun-cli** so assistants can follow consistent patterns for `cac`, command registration, help, completion, and related CLI work.

- In this repo: [`skills/bun-cli/SKILL.md`](./skills/bun-cli/SKILL.md)
- After installation: `node_modules/@andreas-timm/cli/skills/bun-cli/` (same `SKILL.md` and assets)

To expose the installed skill under a project-local skills directory (paths vary with monorepo layout; point the symlink at `node_modules/@andreas-timm/cli/skills/bun-cli`):

```sh
mkdir -p .agents/skills
ln -s ../../node_modules/@andreas-timm/cli/skills/bun-cli .agents/skills/bun-cli
```
