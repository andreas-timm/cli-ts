import type { CAC } from "cac";
import {
    findPrefixSubcommands,
    formatSubcommandDescription,
    isSyntheticDefaultCommand,
    type ParsedCommand,
    readCommands,
} from "./command";

type HelpSection = {
    title?: string;
    body: string;
};

type HelpCallback = (sections: HelpSection[]) => undefined | HelpSection[];

function readHelpCallback(cli: CAC): HelpCallback | undefined {
    const globalCommand = (
        cli as { globalCommand?: { helpCallback?: HelpCallback } }
    ).globalCommand;
    return globalCommand?.helpCallback;
}

function readMatchedCommand(cli: CAC): ParsedCommand | undefined {
    return (cli as { matchedCommand?: ParsedCommand }).matchedCommand;
}

function readCliDescription(cli: CAC): string {
    const globalCommand = (cli as { globalCommand?: { description?: string } })
        .globalCommand;
    return globalCommand?.description?.trim() ?? "";
}

function hasRegisteredHelpOption(cli: CAC): boolean {
    const globalCommand = (
        cli as { globalCommand?: { options?: { rawName?: string }[] } }
    ).globalCommand;
    return (
        Array.isArray(globalCommand?.options) &&
        globalCommand.options.some(
            (option) =>
                option.rawName?.includes("--help") ||
                option.rawName?.includes("-h"),
        )
    );
}

export function extendHelp(
    cli: CAC,
    transform: (sections: HelpSection[]) => HelpSection[] | undefined,
): void {
    const previous = readHelpCallback(cli);
    const callback: HelpCallback = (sections: HelpSection[]) => {
        const baseSections = previous?.(sections) ?? sections;
        return transform(baseSections) ?? baseSections;
    };

    if (hasRegisteredHelpOption(cli)) {
        const globalCommand = (
            cli as { globalCommand?: { helpCallback?: HelpCallback } }
        ).globalCommand;
        if (globalCommand) {
            globalCommand.helpCallback = callback;
        }
        cli.showHelpOnExit = true;
        return;
    }

    cli.help(callback);
}

export type InstallDefaultCommandHelpOptions = {
    /**
     * When true, removes blank lines from the Commands section body in root help output.
     */
    compactCommandsSection?: boolean;
};

function compactCommandsSectionBody(section: HelpSection): HelpSection {
    if (section.title !== "Commands") {
        return section;
    }
    const body = section.body
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n");
    return { ...section, body };
}

function moveOptionsAfterUsageSection(sections: HelpSection[]): HelpSection[] {
    const usageIndex = sections.findIndex(
        (section) => section.title === "Usage",
    );
    const optionsIndex = sections.findIndex(
        (section) => section.title === "Options",
    );

    if (
        usageIndex === -1 ||
        optionsIndex === -1 ||
        optionsIndex === usageIndex + 1
    ) {
        return sections;
    }

    const ordered = [...sections];
    const [optionsSection] = ordered.splice(optionsIndex, 1);
    if (!optionsSection) {
        return sections;
    }
    const adjustedUsageIndex =
        optionsIndex < usageIndex ? usageIndex - 1 : usageIndex;
    ordered.splice(adjustedUsageIndex + 1, 0, optionsSection);
    return ordered;
}

export function installDefaultCommandHelp(
    cli: CAC,
    options?: InstallDefaultCommandHelpOptions,
): void {
    const compactCommandsSection = options?.compactCommandsSection ?? false;
    extendHelp(cli, (sections: HelpSection[]) => {
        const defaultCommands = readCommands(cli).filter(
            isSyntheticDefaultCommand,
        );
        const hasDefaultCommands = defaultCommands.length > 0;
        const defaultCommandNotes = defaultCommands
            .map((command) => command.description.trim())
            .filter(Boolean);
        const defaultCommandBody = defaultCommandNotes
            .map((description) => `Without command: ${description}`)
            .join("\n");

        const cliDescription = readCliDescription(cli);
        const matchedCommand = readMatchedCommand(cli);
        const shouldRewriteUsage =
            !matchedCommand ||
            matchedCommand.isGlobalCommand ||
            isSyntheticDefaultCommand(matchedCommand);
        const globalUsage = (
            (cli as { globalCommand?: { usageText?: string } }).globalCommand
                ?.usageText ?? "<command> [options]"
        ).trim();
        const defaultRawNames = new Set(
            defaultCommands
                .map((command) => command.rawName.trim())
                .filter(Boolean),
        );
        const blankDefaultDescriptions = new Set(
            defaultCommands
                .filter((command) => command.rawName.trim().length === 0)
                .map((command) => command.description.trim())
                .filter(Boolean),
        );
        const defaultHelpLines = new Set(
            defaultCommands.map(
                (command) =>
                    `$ ${cli.name}${command.name === "" ? "" : ` ${command.name}`} --help`,
            ),
        );

        const mapped = sections.flatMap((section) => {
            if (!section.title && cliDescription && shouldRewriteUsage) {
                return [
                    section,
                    {
                        body: cliDescription,
                    },
                ];
            }

            if (
                section.title === "Usage" &&
                hasDefaultCommands &&
                shouldRewriteUsage
            ) {
                const usageSection = {
                    ...section,
                    body: defaultCommandBody
                        ? `  $ ${cli.name}${globalUsage ? ` ${globalUsage}` : ""}\n\n${defaultCommandBody}`
                        : `  $ ${cli.name}${globalUsage ? ` ${globalUsage}` : ""}`,
                };

                return [usageSection];
            }

            if (section.title === "Commands" && hasDefaultCommands) {
                const body = section.body
                    .split("\n")
                    .filter((line) => {
                        const trimmedLine = line.trimStart();
                        const trimmedBody = line.trim();

                        if (blankDefaultDescriptions.has(trimmedBody)) {
                            return false;
                        }

                        for (const rawName of defaultRawNames) {
                            if (trimmedLine.startsWith(rawName)) {
                                return false;
                            }
                        }

                        return true;
                    })
                    .join("\n");

                return body ? [{ ...section, body }] : [];
            }

            if (
                section.title ===
                "For more info, run any command with the `--help` flag"
            ) {
                const body = hasDefaultCommands
                    ? section.body
                          .split("\n")
                          .filter((line) => !defaultHelpLines.has(line.trim()))
                          .join("\n")
                    : section.body;

                if (!body) {
                    return [];
                }

                return [{ body: section.title }];
            }

            return [section];
        });
        const ordered =
            hasDefaultCommands && shouldRewriteUsage
                ? moveOptionsAfterUsageSection(mapped)
                : mapped;

        if (!compactCommandsSection) {
            return ordered;
        }
        return ordered.map(compactCommandsSectionBody);
    });
}

type GlobalOption = { rawName: string; description: string };

function readCliVersion(cli: CAC): string {
    return (
        (cli as { globalCommand?: { versionNumber?: string } }).globalCommand
            ?.versionNumber ?? ""
    );
}

function readGlobalHelpOptions(cli: CAC): GlobalOption[] {
    const globalCommand = (
        cli as { globalCommand?: { options?: GlobalOption[] } }
    ).globalCommand;
    return Array.isArray(globalCommand?.options) ? globalCommand.options : [];
}

/**
 * Prints a focused help screen for a partial command path (e.g. `aaa` when the CLI only
 * has `aaa bbb ccc` / `aaa bbb ddd` registered). The output lists the prefix's subcommands
 * together with a hint to rerun any of them with `--help`.
 */
export function outputPrefixHelp(
    cli: CAC,
    prefixTokens: readonly string[],
): boolean {
    const subcommands = findPrefixSubcommands(cli, prefixTokens);
    if (subcommands.length === 0) {
        return false;
    }

    const prefix = prefixTokens.join(" ").trim();
    const cliName = cli.name || "";
    const version = readCliVersion(cli);
    const longestName = Math.max(
        ...subcommands.map((command) => command.rawName.length),
    );

    const lines: string[] = [];
    if (cliName) {
        lines.push(version ? `${cliName}/${version}` : cliName);
        lines.push("");
    }

    lines.push("Usage:");
    const usageName = cliName ? `${cliName} ` : "";
    lines.push(`  $ ${usageName}${prefix} <subcommand> [options]`);
    lines.push("");
    lines.push("Subcommands:");
    for (const command of subcommands) {
        lines.push(
            `  ${command.rawName.padEnd(longestName)}  ${formatSubcommandDescription(command)}`,
        );
    }
    lines.push("");
    lines.push("For more info, run any subcommand with the `--help` flag");
    for (const command of subcommands) {
        lines.push(`  $ ${usageName}${command.name} --help`);
    }

    const globalOptions = readGlobalHelpOptions(cli);
    if (globalOptions.length > 0) {
        const longestOption = Math.max(
            ...globalOptions.map((option) => option.rawName.length),
        );
        lines.push("");
        lines.push("Options:");
        for (const option of globalOptions) {
            lines.push(
                `  ${option.rawName.padEnd(longestOption)}  ${option.description}`,
            );
        }
    }

    console.log(lines.join("\n"));
    return true;
}

export function installSubcommandHelp(
    cli: CAC,
    options?: { showHelpHint?: boolean },
): void {
    const showHelpHint = options?.showHelpHint ?? true;
    const filterHint = (sections: HelpSection[]) =>
        showHelpHint
            ? sections
            : sections.filter(
                  (s) =>
                      s.title !==
                      "For more info, run any command with the `--help` flag",
              );

    extendHelp(cli, (sections: HelpSection[]) => {
        const commands = (cli as { commands?: ParsedCommand[] }).commands;
        const matchedCommand = (cli as { matchedCommand?: ParsedCommand })
            .matchedCommand;
        if (!commands || !matchedCommand) {
            return filterHint(sections);
        }
        if (
            matchedCommand.isGlobalCommand ||
            isSyntheticDefaultCommand(matchedCommand)
        ) {
            return filterHint(sections);
        }

        const strictPrefix = `${matchedCommand.rawName} `;
        let subcommands = commands.filter((command) =>
            command.rawName.startsWith(strictPrefix),
        );

        // Optional-arg commands like `app test [file]` share a first token with `app test sub …`;
        // list those as subcommands when there is no longer strict-prefix child.
        if (
            subcommands.length === 0 &&
            /\[[^\]]+\]/.test(matchedCommand.rawName)
        ) {
            const bracketIdx = matchedCommand.rawName.indexOf("[");
            const prefixBeforeBracket = matchedCommand.rawName
                .slice(0, bracketIdx)
                .trimEnd();
            const loosePrefix = `${prefixBeforeBracket} `;
            subcommands = commands.filter(
                (command) =>
                    command.rawName.startsWith(loosePrefix) &&
                    command.rawName !== matchedCommand.rawName,
            );
        }

        if (subcommands.length === 0) {
            return filterHint(sections);
        }

        const longestName = Math.max(
            ...subcommands.map((command) => command.rawName.length),
        );
        const extraSections: HelpSection[] = [
            {
                title: "Subcommands",
                body: subcommands
                    .map(
                        (command) =>
                            `  ${command.rawName.padEnd(longestName)}  ${formatSubcommandDescription(command)}`,
                    )
                    .join("\n"),
            },
            ...(showHelpHint
                ? [
                      {
                          title: "For more info, run any subcommand with the `--help` flag",
                          body: subcommands
                              .map(
                                  (command) =>
                                      `  $ ${cli.name} ${command.name} --help`,
                              )
                              .join("\n"),
                      },
                  ]
                : []),
        ];

        const filteredSections = sections.filter(
            (s) =>
                s.title !==
                "For more info, run any command with the `--help` flag",
        );

        return [...filteredSections, ...extraSections];
    });
}
