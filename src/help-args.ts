import type { CAC } from "cac";
import {
    findPrefixSubcommands,
    getLiteralCommandName,
    isSyntheticDefaultCommand,
    readCommands,
} from "./command";

function formatChoiceList(values: string[]): string {
    if (values.length === 0) {
        return '"help"';
    }

    const quoted = values.map((value) => `"${value}"`);
    if (quoted.length === 1) {
        return quoted[0] ?? '"help"';
    }

    const tail = quoted.pop();
    return `${quoted.join(", ")}, or ${tail}`;
}

export function listKnownCommands(cli: CAC): string[] {
    return Array.from(
        new Set(
            readCommands(cli)
                .filter(
                    (command) =>
                        !command.isGlobalCommand &&
                        !isSyntheticDefaultCommand(command),
                )
                .map((command) => command.rawName.trim())
                .filter((name) => name.length > 0),
        ),
    ).sort((a, b) => a.localeCompare(b));
}

/**
 * Rewrites argv so `-h` / `--help` after a partial command path resolves to a registered
 * multi-word command (e.g. `tool sub1 -h` → `tool sub1 sub2 --help` when that is the only match).
 *
 * Single-token paths (`foo -h`) resolve only when exactly one command matches `foo` or `foo …`;
 * if several commands share that prefix (e.g. `test -h` with `test [x]` and `test a b`), CAC
 * keeps handling help as usual.
 */
function tryNormalizeNestedHelp(cli: CAC, args: string[]): string[] | null {
    const helpIdx = args.findIndex(
        (arg, i) => i >= 3 && (arg === "-h" || arg === "--help"),
    );
    if (helpIdx === -1) {
        return null;
    }

    const commandTokens = args.slice(2, helpIdx);
    if (commandTokens.length === 0) {
        return null;
    }

    const segments = commandTokens
        .flatMap((token) => token.split(/\s+/))
        .filter(Boolean);
    if (segments.length === 0) {
        return null;
    }

    const resolved =
        segments.length >= 2
            ? resolveLongestMatchingCommandName(cli, segments)
            : resolveUniqueCommandUnderPrefix(cli, segments[0] ?? "");
    if (!resolved) {
        return null;
    }

    const resolvedCommand = readCommands(cli).find(
        (command) =>
            !command.isGlobalCommand &&
            !isSyntheticDefaultCommand(command) &&
            command.rawName === resolved,
    );
    if (!resolvedCommand) {
        return null;
    }

    const literalName = getLiteralCommandName(resolvedCommand).trim();
    if (literalName.length === 0) {
        return null;
    }

    return [args[0] ?? "", args[1] ?? "", literalName, "--help"];
}

/** When the user typed one word before `-h`, resolve only if a single registered command extends it. */
function resolveUniqueCommandUnderPrefix(
    cli: CAC,
    firstToken: string,
): string | undefined {
    const joined = firstToken.trim();
    const commands = readCommands(cli).filter(
        (command) =>
            !command.isGlobalCommand &&
            !isSyntheticDefaultCommand(command) &&
            command.rawName.trim().length > 0,
    );
    const candidates = commands.filter(
        (command) =>
            command.rawName === joined ||
            command.rawName.startsWith(`${joined} `),
    );
    const uniqueByRawName = [
        ...new Map(
            candidates.map((command) => [command.rawName, command]),
        ).values(),
    ];
    if (uniqueByRawName.length !== 1) {
        return undefined;
    }

    const only = uniqueByRawName[0];
    if (!only) {
        return undefined;
    }
    if (only.rawName === joined) {
        return undefined;
    }

    // Optional-arg commands like `test [file]` are matched by CAC on the first word alone; do not
    // rewrite `test -h` into `test [file] --help` (that argv shape does not parse as the same command).
    const afterFirstWord = only.rawName.slice(joined.length).trimStart();
    if (afterFirstWord.startsWith("[")) {
        return undefined;
    }

    return only.rawName;
}

function resolveLongestMatchingCommandName(
    cli: CAC,
    segments: string[],
): string | undefined {
    const joined = segments.join(" ");
    const commands = readCommands(cli).filter(
        (command) =>
            !command.isGlobalCommand &&
            !isSyntheticDefaultCommand(command) &&
            command.rawName.trim().length > 0,
    );
    const candidates = commands.filter(
        (command) =>
            command.rawName === joined ||
            command.rawName.startsWith(`${joined} `),
    );
    if (candidates.length === 0) {
        return undefined;
    }

    const uniqueByRawName = [
        ...new Map(
            candidates.map((command) => [command.rawName, command]),
        ).values(),
    ];
    uniqueByRawName.sort(
        (left, right) => right.rawName.length - left.rawName.length,
    );
    const longest = uniqueByRawName[0];
    if (!longest) {
        return undefined;
    }
    const tied = uniqueByRawName.filter(
        (command) => command.rawName.length === longest.rawName.length,
    );
    if (tied.length > 1) {
        return undefined;
    }

    return longest.rawName;
}

export function normalizeHelpArgs(cli: CAC, args: string[]): string[] {
    const normalized = normalizeHelpArgsCore(cli, args);
    return stripHelpAfterPrefix(cli, normalized);
}

function normalizeHelpArgsCore(cli: CAC, args: string[]): string[] {
    const nested = tryNormalizeNestedHelp(cli, args);
    if (nested) {
        return nested;
    }

    if (args[2] !== "help" && args[2] !== "-h") {
        return args;
    }

    if (!args[3]) {
        const normalized = [...args];
        normalized[2] = "--help";
        return normalized;
    }

    return [...args.slice(0, 2), ...args.slice(3), "--help"];
}

/**
 * When the user asks for help on a partial command path (e.g. `aaa --help`, `help aaa bbb`,
 * or `-h aaa`), drop the trailing `--help` / `-h` so that {@link run} can detect the prefix
 * and print a focused subcommand listing instead of letting CAC's default help flag kick in.
 *
 * A prefix is "known" when it is not itself a registered command but at least one registered
 * command extends it.
 */
function stripHelpAfterPrefix(cli: CAC, args: string[]): string[] {
    if (args.length <= 2) {
        return args;
    }

    const tail = args.slice(2);
    const helpIdx = tail.findIndex(
        (token) => token === "--help" || token === "-h",
    );
    if (helpIdx === -1) {
        return args;
    }

    const commandTokens: string[] = [];
    for (let i = 0; i < helpIdx; i++) {
        const token = tail[i];
        if (!token) {
            continue;
        }
        if (token.startsWith("-")) {
            return args;
        }

        commandTokens.push(...token.split(/\s+/).filter(Boolean));
    }

    if (commandTokens.length === 0) {
        return args;
    }

    const joined = commandTokens.join(" ");
    const commands = readCommands(cli).filter(
        (command) =>
            !command.isGlobalCommand &&
            !isSyntheticDefaultCommand(command) &&
            command.rawName.trim().length > 0,
    );
    const isExactCommand = commands.some(
        (command) =>
            getLiteralCommandName(command) === joined ||
            command.aliasNames.includes(joined),
    );
    if (isExactCommand) {
        return args;
    }

    if (findPrefixSubcommands(cli, commandTokens).length === 0) {
        return args;
    }

    return [...args.slice(0, 2), ...commandTokens];
}

/** Used by {@link run}; not part of the public package API. */
export function formatChoiceListForUnknownCommand(
    knownCommands: string[],
): string {
    return formatChoiceList([...knownCommands, "help"]);
}
