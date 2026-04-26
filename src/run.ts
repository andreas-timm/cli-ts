import type { CAC } from "cac";
import { patchArgs } from "./args";
import {
    findPrefixSubcommands,
    getLiteralCommandName,
    getMaximumCommandArgsCount,
    isSyntheticDefaultCommand,
    type ParsedCommand,
    readCommands,
} from "./command";
import { outputPrefixHelp } from "./help";
import {
    formatChoiceListForUnknownCommand,
    listKnownCommands,
    normalizeHelpArgs,
} from "./help-args";

type PipeError = Error & {
    code?: string;
    errno?: number;
    syscall?: string;
};

type CacWithInternals = CAC & {
    globalCommand?: {
        options?: Array<{ rawName: string }>;
    };
    runMatchedCommand?: () => unknown;
};

let isBrokenPipeHandlerInstalled = false;

function isBrokenPipeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const details = error as PipeError;
    return (
        details.code === "EPIPE" ||
        (details.errno === -32 && details.syscall === "write")
    );
}

function installBrokenPipeHandler(): void {
    if (isBrokenPipeHandlerInstalled) {
        return;
    }
    process.stdout.on("error", (error) => {
        if (isBrokenPipeError(error)) {
            process.exit(0);
        }
        throw error;
    });
    isBrokenPipeHandlerInstalled = true;
}

export async function run(
    cli: CAC,
    argv: string[] = process.argv,
): Promise<void> {
    const isDebug = argv.includes("--debug");
    installBrokenPipeHandler();

    // Register --debug if it doesn't exist yet to make it visible in help
    const cliInternals = cli as CacWithInternals;
    const globalOptions = cliInternals.globalCommand?.options ?? [];
    const hasDebugOption = globalOptions.some((option) =>
        option.rawName.includes("--debug"),
    );
    if (!hasDebugOption) {
        cli.option("--debug", "Show full stack trace on error");
    }

    const args = normalizeHelpArgs(cli, patchArgs(cli, argv));
    const hasDefaultCommand = readCommands(cli).some(isSyntheticDefaultCommand);

    if (args.length <= 2 && !hasDefaultCommand) {
        cli.outputHelp();
        return;
    }

    try {
        cli.parse(args, { run: false });

        const matchedCommand = (cli as { matchedCommand?: ParsedCommand })
            .matchedCommand;
        const parsedArgs = (cli as unknown as { args?: string[] }).args ?? [];

        if (!matchedCommand && parsedArgs.length > 0) {
            if (findPrefixSubcommands(cli, parsedArgs).length > 0) {
                outputPrefixHelp(cli, parsedArgs);
                return;
            }

            const knownCommands = listKnownCommands(cli);
            throw new Error(
                `Unknown command "${parsedArgs[0]}". Use ${formatChoiceListForUnknownCommand(knownCommands)}.`,
            );
        }

        if (
            matchedCommand &&
            !isSyntheticDefaultCommand(matchedCommand) &&
            parsedArgs.length > getMaximumCommandArgsCount(matchedCommand)
        ) {
            const literal = getLiteralCommandName(matchedCommand);
            const prefixTokens = [
                ...literal.split(/\s+/).filter(Boolean),
                ...parsedArgs,
            ];
            if (findPrefixSubcommands(cli, prefixTokens).length > 0) {
                outputPrefixHelp(cli, prefixTokens);
                return;
            }
        }

        // `cli.command("")` catches argv that did not match any named subcommand. CAC then
        // attaches any leftover positional tokens to that default command; with zero declared
        // args, `checkUnusedArgs` would throw. Tokens here are not a "bare" invocation (no
        // subcommand) — treat like unknown / prefix help instead of running the default action.
        if (
            matchedCommand &&
            isSyntheticDefaultCommand(matchedCommand) &&
            parsedArgs.length > 0
        ) {
            if (findPrefixSubcommands(cli, parsedArgs).length > 0) {
                outputPrefixHelp(cli, parsedArgs);
                return;
            }

            const knownCommands = listKnownCommands(cli);
            throw new Error(
                `Unknown command "${parsedArgs[0]}". Use ${formatChoiceListForUnknownCommand(knownCommands)}.`,
            );
        }

        const result = cliInternals.runMatchedCommand?.();
        if (result instanceof Promise) {
            await result;
        }
    } catch (error) {
        if (isBrokenPipeError(error)) {
            process.exit(0);
        }
        if (isDebug) {
            console.error(error);
        } else {
            console.error(
                `Error: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        process.exit(1);
    }
}
