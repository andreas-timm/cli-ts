import type { CAC } from "cac";
import { readCommands } from "./command";
import { registerCommands } from "./register";

type ParsedCommandArg = {
    required: boolean;
    value: string;
    variadic: boolean;
};

type ParsedCommandOption = {
    rawName: string;
    description: string;
    config?: {
        choices?: readonly string[];
    };
};

type ParsedCommand = {
    name: string;
    rawName: string;
    description: string;
    aliasNames: string[];
    args?: ParsedCommandArg[];
    options?: ParsedCommandOption[];
    isGlobalCommand?: boolean;
    isDefaultCommand?: boolean;
};

type CompletionKind = "files" | "directories";

type ZshCompletionData = {
    knownPaths: string[];
    subcommandsByPath: Map<string, string[]>;
    optionsByPath: Map<string, string[]>;
    optionValueFlags: string[];
    fileOptionFlagsByPath: Map<string, string[]>;
    directoryOptionFlagsByPath: Map<string, string[]>;
    /** Merged global + command-local: flag → allowed values from `config.choices`. */
    optionChoicesByPath: Map<string, Map<string, string[]>>;
    positionalKindsByPath: Map<string, string[]>;
    variadicPositionalKindByPath: Map<string, string>;
};

function isSyntheticDefaultCommand(command: ParsedCommand): boolean {
    return command.name === "";
}

function readGlobalOptions(cli: CAC): ParsedCommandOption[] {
    const globalCommand = (
        cli as { globalCommand?: { options?: ParsedCommandOption[] } }
    ).globalCommand;
    return Array.isArray(globalCommand?.options) ? globalCommand.options : [];
}

function extractLiteralCommandParts(rawName: string): string[] {
    const parts = rawName
        .trim()
        .split(/\s+/)
        .filter((part) => part.length > 0);
    const literalParts: string[] = [];

    for (const part of parts) {
        if (part.startsWith("<") || part.startsWith("[")) {
            break;
        }
        literalParts.push(part);
    }

    return literalParts;
}

function extractOptionFlags(rawName: string): string[] {
    const flags: string[] = [];

    for (const rawPart of rawName.split(",")) {
        const [flag] = rawPart
            .trim()
            .split(/\s+/)
            .filter((part) => part.length > 0);
        if (!flag?.startsWith("-")) {
            continue;
        }
        flags.push(flag);
    }

    return flags;
}

function extractPlaceholderNames(rawName: string): string[] {
    return Array.from(
        rawName.matchAll(/[<[]([^>\]]+)[>\]]/g),
        (match) => match[1] ?? "",
    );
}

function inferCompletionKind(
    value: string | undefined,
): CompletionKind | undefined {
    const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized.length === 0) {
        return undefined;
    }

    if (
        normalized === "cwd" ||
        normalized.includes("directory") ||
        normalized.includes("folder") ||
        normalized.includes("workdir") ||
        normalized.endsWith("dir")
    ) {
        return "directories";
    }

    if (normalized.includes("file") || normalized.includes("path")) {
        return "files";
    }

    return undefined;
}

function addSetValue(
    map: Map<string, Set<string>>,
    key: string,
    value: string,
): void {
    const values = map.get(key) ?? new Set<string>();
    values.add(value);
    map.set(key, values);
}

function addSetValues(
    map: Map<string, Set<string>>,
    key: string,
    values: readonly string[],
): void {
    for (const value of values) {
        addSetValue(map, key, value);
    }
}

function getOrCreateSet(
    map: Map<string, Set<string>>,
    key: string,
): Set<string> {
    const values = map.get(key);
    if (values) {
        return values;
    }

    const nextValues = new Set<string>();
    map.set(key, nextValues);
    return nextValues;
}

function toSortedArray(values?: Set<string>): string[] {
    return values ? Array.from(values).sort((a, b) => a.localeCompare(b)) : [];
}

function getPathDepth(path: string): number {
    return path.length === 0 ? 0 : path.split(" ").length;
}

function quoteSingle(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildZshCompletionData(cli: CAC): ZshCompletionData {
    const commands = readCommands(cli) as ParsedCommand[];
    const visibleCommands = commands.filter(
        (command) =>
            !command.isGlobalCommand && !isSyntheticDefaultCommand(command),
    );
    const defaultCommands = commands.filter(
        (command) =>
            !command.isGlobalCommand && isSyntheticDefaultCommand(command),
    );
    const globalOptionItems = readGlobalOptions(cli);
    const globalOptionsSet = new Set(
        globalOptionItems.flatMap((option) =>
            extractOptionFlags(option.rawName.trim()),
        ),
    );
    const optionValueFlagSet = new Set<string>();
    const globalFileOptionFlags = new Set<string>();
    const globalDirectoryOptionFlags = new Set<string>();

    if (globalOptionsSet.has("--help") && !globalOptionsSet.has("-h")) {
        globalOptionsSet.add("-h");
    }

    const globalOptions = Array.from(globalOptionsSet).sort((a, b) =>
        a.localeCompare(b),
    );
    const defaultCommandOptions = Array.from(
        new Set(
            defaultCommands.flatMap((command) =>
                (command.options ?? []).flatMap((option) =>
                    extractOptionFlags(option.rawName),
                ),
            ),
        ),
    ).sort((a, b) => a.localeCompare(b));
    const pathSet = new Set<string>([""]);
    const subcommandSets = new Map<string, Set<string>>();
    const optionSets = new Map<string, Set<string>>();
    const fileOptionFlagSets = new Map<string, Set<string>>();
    const directoryOptionFlagSets = new Map<string, Set<string>>();
    const optionChoiceFlagSets = new Map<string, Map<string, string[]>>();
    const positionalKindsByPath = new Map<string, string[]>();
    const variadicPositionalKindByPath = new Map<string, string>();

    const ensureChoiceFlagMap = (pathKey: string): Map<string, string[]> => {
        const existing = optionChoiceFlagSets.get(pathKey);
        if (existing) {
            return existing;
        }

        const created = new Map<string, string[]>();
        optionChoiceFlagSets.set(pathKey, created);
        return created;
    };

    const addOptionCompletionMetadata = (
        pathKey: string,
        optionItems: readonly ParsedCommandOption[],
        fileOptionFlags: Set<string>,
        directoryOptionFlags: Set<string>,
    ): void => {
        for (const option of optionItems) {
            const flags = extractOptionFlags(option.rawName);
            if (flags.length === 0) {
                continue;
            }

            const choices = option.config?.choices;
            if (choices && choices.length > 0) {
                for (const flag of flags) {
                    optionValueFlagSet.add(flag);
                }

                const choiceMap = ensureChoiceFlagMap(pathKey);
                for (const flag of flags) {
                    choiceMap.set(flag, [...choices]);
                }
                continue;
            }

            const placeholderName = extractPlaceholderNames(option.rawName)[0];
            if (!placeholderName) {
                continue;
            }

            for (const flag of flags) {
                optionValueFlagSet.add(flag);
            }

            const completionKind = inferCompletionKind(placeholderName);
            if (completionKind === "files") {
                for (const flag of flags) {
                    fileOptionFlags.add(flag);
                }
            } else if (completionKind === "directories") {
                for (const flag of flags) {
                    directoryOptionFlags.add(flag);
                }
            }
        }
    };

    const setPositionalCompletionMetadata = (
        path: string,
        args: readonly ParsedCommandArg[] | undefined,
    ): void => {
        if (!Array.isArray(args) || args.length === 0) {
            return;
        }

        const positionalKinds: string[] = [];
        let variadicPositionalKind = "";

        for (const arg of args) {
            const completionKind = inferCompletionKind(arg.value) ?? "";
            if (arg.variadic) {
                variadicPositionalKind = completionKind;
                break;
            }

            positionalKinds.push(completionKind);
        }

        if (positionalKinds.length > 0) {
            positionalKindsByPath.set(path, positionalKinds);
        }

        if (variadicPositionalKind.length > 0) {
            variadicPositionalKindByPath.set(path, variadicPositionalKind);
        }
    };

    for (const globalOption of globalOptions) {
        addSetValue(optionSets, "", globalOption);
    }

    addOptionCompletionMetadata(
        "",
        globalOptionItems,
        globalFileOptionFlags,
        globalDirectoryOptionFlags,
    );

    for (const defaultCommandOption of defaultCommandOptions) {
        addSetValue(optionSets, "", defaultCommandOption);
    }

    for (const defaultCommand of defaultCommands) {
        addOptionCompletionMetadata(
            "",
            defaultCommand.options ?? [],
            getOrCreateSet(fileOptionFlagSets, ""),
            getOrCreateSet(directoryOptionFlagSets, ""),
        );
        setPositionalCompletionMetadata("", defaultCommand.args);
    }

    for (const command of visibleCommands) {
        const commandOptions = Array.from(
            new Set(
                (command.options ?? []).flatMap((option) =>
                    extractOptionFlags(option.rawName),
                ),
            ),
        );
        const commandNames = [
            command.rawName,
            ...command.aliasNames.filter((aliasName) => aliasName !== "!"),
        ];

        for (const commandName of commandNames) {
            const commandPathParts = extractLiteralCommandParts(commandName);
            if (commandPathParts.length === 0) {
                continue;
            }

            for (let index = 0; index < commandPathParts.length; index++) {
                const child = commandPathParts[index];
                if (!child) {
                    continue;
                }
                const parentPath = commandPathParts.slice(0, index).join(" ");
                const fullPath = commandPathParts.slice(0, index + 1).join(" ");
                addSetValue(subcommandSets, parentPath, child);
                pathSet.add(fullPath);
            }

            const fullPath = commandPathParts.join(" ");
            for (const optionName of commandOptions) {
                addSetValue(optionSets, fullPath, optionName);
            }

            addOptionCompletionMetadata(
                fullPath,
                command.options ?? [],
                getOrCreateSet(fileOptionFlagSets, fullPath),
                getOrCreateSet(directoryOptionFlagSets, fullPath),
            );
            setPositionalCompletionMetadata(fullPath, command.args);
        }
    }

    const rootChoiceMap =
        optionChoiceFlagSets.get("") ?? new Map<string, string[]>();

    for (const path of pathSet) {
        for (const optionName of globalOptions) {
            addSetValue(optionSets, path, optionName);
        }

        addSetValues(
            fileOptionFlagSets,
            path,
            Array.from(globalFileOptionFlags),
        );
        addSetValues(
            directoryOptionFlagSets,
            path,
            Array.from(globalDirectoryOptionFlags),
        );
    }

    const knownPaths = Array.from(pathSet).sort((a, b) => {
        const depthDiff = getPathDepth(a) - getPathDepth(b);
        return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
    });

    const mergedOptionChoicesByPath = new Map<string, Map<string, string[]>>();
    for (const path of knownPaths) {
        const merged = new Map(rootChoiceMap);
        if (path !== "") {
            const localChoices = optionChoiceFlagSets.get(path);
            if (localChoices) {
                for (const [flag, vals] of localChoices) {
                    merged.set(flag, vals);
                }
            }
        }
        mergedOptionChoicesByPath.set(path, merged);
    }

    return {
        knownPaths,
        subcommandsByPath: new Map(
            knownPaths.map((path) => [
                path,
                toSortedArray(subcommandSets.get(path)),
            ]),
        ),
        optionsByPath: new Map(
            knownPaths.map((path) => [
                path,
                toSortedArray(optionSets.get(path)),
            ]),
        ),
        optionValueFlags: toSortedArray(optionValueFlagSet),
        fileOptionFlagsByPath: new Map(
            knownPaths.map((path) => [
                path,
                toSortedArray(fileOptionFlagSets.get(path)),
            ]),
        ),
        directoryOptionFlagsByPath: new Map(
            knownPaths.map((path) => [
                path,
                toSortedArray(directoryOptionFlagSets.get(path)),
            ]),
        ),
        optionChoicesByPath: mergedOptionChoicesByPath,
        positionalKindsByPath: new Map(
            knownPaths.map((path) => [
                path,
                positionalKindsByPath.get(path) ?? [],
            ]),
        ),
        variadicPositionalKindByPath: new Map(
            knownPaths.map((path) => [
                path,
                variadicPositionalKindByPath.get(path) ?? "",
            ]),
        ),
    };
}

function buildZshOptionChoiceCaseLines(
    knownPaths: readonly string[],
    optionChoicesByPath: Map<string, Map<string, string[]>>,
): string[] {
    const pathsWithChoices = knownPaths.filter(
        (path) => (optionChoicesByPath.get(path)?.size ?? 0) > 0,
    );
    if (pathsWithChoices.length === 0) {
        return [];
    }

    const lines: string[] = ['    case "$current_path" in'];

    for (const path of pathsWithChoices) {
        const pathLabel = path.length === 0 ? '""' : quoteSingle(path);
        const choiceMap = optionChoicesByPath.get(path);
        if (!choiceMap) {
            continue;
        }
        const sortedFlags = Array.from(choiceMap.keys()).sort((a, b) =>
            a.localeCompare(b),
        );
        lines.push(`        ${pathLabel})`);
        lines.push('            case "$previous_word" in');

        for (const flag of sortedFlags) {
            const choices = choiceMap.get(flag);
            if (!choices || choices.length === 0) {
                continue;
            }

            const quotedFlag = quoteSingle(flag);
            const choiceWords = choices.map(quoteSingle).join(" ");
            lines.push(`                ${quotedFlag})`);
            lines.push("                    filtered_choice_matches=()");
            lines.push('                    if [[ -n "$match_query" ]]; then');
            lines.push(
                `                        for value in ${choiceWords}; do`,
            );
            lines.push(
                '                            if [[ "${value[1,${#match_query}]}" == "$match_query" ]]; then',
            );
            lines.push(
                '                                filtered_choice_matches+=("$value")',
            );
            lines.push("                            fi");
            lines.push("                        done");
            lines.push("                    else");
            lines.push(
                `                        filtered_choice_matches=(${choiceWords})`,
            );
            lines.push("                    fi");
            lines.push(
                "                    if (( ${#filtered_choice_matches[@]} > 0 )); then",
            );
            lines.push(
                '                        compadd -- "${filtered_choice_matches[@]}"',
            );
            lines.push("                    fi");
            lines.push("                    return");
            lines.push("                    ;;");
        }

        lines.push("            esac");
        lines.push("            ;;");
    }

    lines.push("    esac");
    return lines;
}

export function generateZshCompletion(cli: CAC): string {
    const {
        knownPaths,
        subcommandsByPath,
        optionsByPath,
        optionValueFlags,
        fileOptionFlagsByPath,
        directoryOptionFlagsByPath,
        optionChoicesByPath,
        positionalKindsByPath,
        variadicPositionalKindByPath,
    } = buildZshCompletionData(cli);
    const knownPathPatterns = knownPaths
        .filter((path) => path.length > 0)
        .map((path) => quoteSingle(path))
        .join("|");
    const pathPattern = knownPathPatterns.length > 0 ? knownPathPatterns : "''";
    const optionValueFlagList = optionValueFlags
        .map((value) => quoteSingle(value))
        .join(" ");
    const lines: string[] = [
        `#compdef ${cli.name}`,
        "",
        '    local current_path=""',
        '    local candidate_path=""',
        '    local token=""',
        '    local current_word="${words[CURRENT]}"',
        "    local previous_index=$((CURRENT - 1))",
        '    local previous_word="${words[previous_index]}"',
        "    local positional_count=0",
        "    local skip_next_value=0",
        '    local match_query="$PREFIX$SUFFIX"',
        '    local positional_kind=""',
        '    local variadic_positional_kind=""',
        '    local value=""',
        "    local -a subcommands",
        "    local -a options",
        "    local -a positional_kinds",
        "    local -a option_value_flags",
        "    local -a file_option_flags",
        "    local -a directory_option_flags",
        "    local -a filtered_option_matches",
        "    local -a filtered_subcommand_matches",
        "    local -a filtered_choice_matches",
        "",
        `    option_value_flags=(${optionValueFlagList})`,
        "",
        '    if [[ -z "$match_query" ]]; then',
        '        match_query="$current_word"',
        "    fi",
        "",
        "    local index=2",
        "    while (( index < CURRENT )); do",
        '        token="${words[index]}"',
        "        if (( skip_next_value )); then",
        "            skip_next_value=0",
        "            ((index++))",
        "            continue",
        "        fi",
        "",
        '        if [[ "$token" == -* ]]; then',
        '            if [[ "$token" != *=* ]] && (( ${option_value_flags[(Ie)$token]} )); then',
        "                skip_next_value=1",
        "            fi",
        "            ((index++))",
        "            continue",
        "        fi",
        "",
        '        candidate_path="$current_path"',
        '        if [[ -n "$candidate_path" ]]; then',
        '            candidate_path="$candidate_path $token"',
        "        else",
        '            candidate_path="$token"',
        "        fi",
        "",
        '        case "$candidate_path" in',
        `            ${pathPattern})`,
        '                current_path="$candidate_path"',
        "                ;;",
        "            *)",
        "                ((positional_count++))",
        "                ;;",
        "        esac",
        "",
        "        ((index++))",
        "    done",
        "",
        '    case "$current_path" in',
    ];

    for (const path of knownPaths) {
        const subcommands = subcommandsByPath.get(path) ?? [];
        const options = optionsByPath.get(path) ?? [];
        const positionalKinds = positionalKindsByPath.get(path) ?? [];
        const variadicPositionalKind =
            variadicPositionalKindByPath.get(path) ?? "";
        const fileOptionFlags = fileOptionFlagsByPath.get(path) ?? [];
        const directoryOptionFlags = directoryOptionFlagsByPath.get(path) ?? [];
        const pathLabel = path.length === 0 ? '""' : quoteSingle(path);
        const subcommandList = subcommands
            .map((value) => quoteSingle(value))
            .join(" ");
        const optionList = options.map((value) => quoteSingle(value)).join(" ");
        const positionalKindList = positionalKinds
            .map((value) => quoteSingle(value))
            .join(" ");
        const fileOptionFlagList = fileOptionFlags
            .map((value) => quoteSingle(value))
            .join(" ");
        const directoryOptionFlagList = directoryOptionFlags
            .map((value) => quoteSingle(value))
            .join(" ");
        lines.push(`        ${pathLabel})`);
        lines.push(`            subcommands=(${subcommandList})`);
        lines.push(`            options=(${optionList})`);
        lines.push(`            positional_kinds=(${positionalKindList})`);
        lines.push(
            `            variadic_positional_kind=${quoteSingle(variadicPositionalKind)}`,
        );
        lines.push(`            file_option_flags=(${fileOptionFlagList})`);
        lines.push(
            `            directory_option_flags=(${directoryOptionFlagList})`,
        );
        lines.push("            ;;");
    }

    lines.push("        *)");
    lines.push("            subcommands=()");
    lines.push("            options=()");
    lines.push("            positional_kinds=()");
    lines.push("            variadic_positional_kind=''");
    lines.push("            file_option_flags=()");
    lines.push("            directory_option_flags=()");
    lines.push("            ;;");
    lines.push("    esac");
    lines.push("");
    lines.push("    filtered_option_matches=()");
    lines.push('    if [[ -n "$match_query" ]]; then');
    lines.push('        for value in "${options[@]}"; do');
    lines.push(
        '            if [[ "${value[1,${#match_query}]}" == "$match_query" ]]; then',
    );
    lines.push('                filtered_option_matches+=("$value")');
    lines.push("            fi");
    lines.push("        done");
    lines.push("    else");
    lines.push('        filtered_option_matches=("${options[@]}")');
    lines.push("    fi");
    lines.push("");
    lines.push('    if [[ "$current_word" == -* ]]; then');
    lines.push("        if (( ${#filtered_option_matches[@]} > 0 )); then");
    lines.push('            compadd -- "${filtered_option_matches[@]}"');
    lines.push("        fi");
    lines.push("        return");
    lines.push("    fi");
    lines.push("");
    lines.push(
        "    if (( ${directory_option_flags[(Ie)$previous_word]} )); then",
    );
    lines.push("        _files -/");
    lines.push("        return");
    lines.push("    fi");
    lines.push("");
    lines.push("    if (( ${file_option_flags[(Ie)$previous_word]} )); then");
    lines.push("        _files");
    lines.push("        return");
    lines.push("    fi");
    lines.push("");
    const optionChoiceCaseLines = buildZshOptionChoiceCaseLines(
        knownPaths,
        optionChoicesByPath,
    );
    for (const line of optionChoiceCaseLines) {
        lines.push(line);
    }

    if (optionChoiceCaseLines.length > 0) {
        lines.push("");
    }

    lines.push("    if (( positional_count < ${#positional_kinds[@]} )); then");
    lines.push(
        '        positional_kind="${positional_kinds[$((positional_count + 1))]}"',
    );
    lines.push('    elif [[ -n "$variadic_positional_kind" ]]; then');
    lines.push('        positional_kind="$variadic_positional_kind"');
    lines.push("    fi");
    lines.push("");
    lines.push('    if [[ -n "$positional_kind" ]]; then');
    lines.push("        if (( ${#filtered_option_matches[@]} > 0 )); then");
    lines.push('            compadd -- "${filtered_option_matches[@]}"');
    lines.push("        fi");
    lines.push('        case "$positional_kind" in');
    lines.push("            directories)");
    lines.push("                _files -/");
    lines.push("                ;;");
    lines.push("            files)");
    lines.push("                _files");
    lines.push("                ;;");
    lines.push("        esac");
    lines.push("        return");
    lines.push("    fi");
    lines.push("");
    lines.push("    filtered_subcommand_matches=()");
    lines.push('    if [[ -n "$match_query" ]]; then');
    lines.push('        for value in "${subcommands[@]}"; do');
    lines.push(
        '            if [[ "${value[1,${#match_query}]}" == "$match_query" ]]; then',
    );
    lines.push('                filtered_subcommand_matches+=("$value")');
    lines.push("            fi");
    lines.push("        done");
    lines.push("    else");
    lines.push('        filtered_subcommand_matches=("${subcommands[@]}")');
    lines.push("    fi");
    lines.push("");
    lines.push("    if (( ${#filtered_subcommand_matches[@]} > 0 )); then");
    lines.push('        compadd -- "${filtered_subcommand_matches[@]}"');
    lines.push("    fi");
    lines.push("");
    lines.push("    if (( ${#filtered_option_matches[@]} > 0 )); then");
    lines.push('        compadd -- "${filtered_option_matches[@]}"');
    lines.push(
        '    elif [[ -z "$match_query" ]] && (( ${#options[@]} > 0 )); then',
    );
    lines.push('        compadd -- "${options[@]}"');
    lines.push("    fi");
    lines.push("");

    return lines.join("\n");
}

export function registerCompletionCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["completion zsh"],
        "Print a zsh completion script",
        (command) => {
            command.action(() => {
                process.stdout.write(generateZshCompletion(cli));
            });
        },
    );
}
