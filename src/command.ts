import type { CAC } from "cac";

export type ParsedCommand = {
    name: string;
    rawName: string;
    description: string;
    aliasNames: string[];
    options?: { rawName: string; description: string }[];
    isGlobalCommand?: boolean;
    isDefaultCommand?: boolean;
};

export function isSyntheticDefaultCommand(command: ParsedCommand): boolean {
    // CAC only auto-runs bracket-only defaults (`command('[...args]')`) on bare invocation.
    // Named commands aliased as `!` are treated as defaults for some help layouts, but not for parsing.
    return command.name === "";
}

export function readCommands(cli: CAC): ParsedCommand[] {
    const commands = (cli as { commands?: ParsedCommand[] }).commands;
    return Array.isArray(commands) ? commands : [];
}

export function formatSubcommandDescription(command: ParsedCommand): string {
    const visibleAliases = command.aliasNames.filter(
        (aliasName) => aliasName !== "!",
    );
    if (visibleAliases.length === 0) {
        return command.description;
    }

    return `${command.description} (aliases: ${visibleAliases.join(", ")})`;
}

/**
 * Returns the literal command path of a command, i.e. the portion of its raw name before
 * any positional placeholder (`<arg>` / `[arg]`). For example `test [input-file]` becomes
 * `test`, while `aaa bbb ccc` stays `aaa bbb ccc`.
 */
export function getLiteralCommandName(command: ParsedCommand): string {
    const rawName = command.rawName.trim();
    if (rawName.length === 0) {
        return "";
    }

    const parts: string[] = [];
    for (const part of rawName.split(/\s+/)) {
        if (part.startsWith("<") || part.startsWith("[")) {
            break;
        }
        parts.push(part);
    }

    return parts.join(" ");
}

/** Max positional args CAC accepts for this command; Infinity when variadic. */
export function getMaximumCommandArgsCount(command: ParsedCommand): number {
    const cmdArgs =
        (command as unknown as { args?: { variadic?: boolean }[] }).args ?? [];
    if (cmdArgs.some((arg) => arg.variadic)) {
        return Number.POSITIVE_INFINITY;
    }
    return cmdArgs.length;
}

/**
 * Returns the registered commands whose literal name starts with the given prefix tokens
 * (e.g. `["aaa"]` matches `aaa bbb ccc` and `aaa bbb ddd`). Commands whose literal name is
 * exactly the prefix are excluded so a command like `test [input-file]` is not treated as a
 * subcommand of its own literal `test` path.
 */
export function findPrefixSubcommands(
    cli: CAC,
    prefixTokens: readonly string[],
): ParsedCommand[] {
    const prefix = prefixTokens.join(" ").trim();
    if (!prefix) {
        return [];
    }

    const strictPrefix = `${prefix} `;
    return readCommands(cli).filter((command) => {
        if (command.isGlobalCommand || isSyntheticDefaultCommand(command)) {
            return false;
        }

        const literalName = getLiteralCommandName(command);
        if (literalName.length === 0) {
            return false;
        }

        return literalName.startsWith(strictPrefix);
    });
}
