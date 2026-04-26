import type { CAC, Command } from "cac";
import {
    assertOptionValueInChoices,
    assertRequiredCliOptions,
} from "./options";
import type { CliOptionItem } from "./types";

const commandOptionItemsRegistry = new WeakMap<Command, CliOptionItem[]>();
const commandsWithWrappedAction = new WeakSet<Command>();

/** CAC types `type` as mutable `any[]`; we accept `readonly unknown[]` on `CliOptionItem`. */
type CacOptionConfig = NonNullable<Parameters<Command["option"]>[2]>;

function assertDefaultInChoices(item: CliOptionItem): void {
    const { config } = item;
    if (!config?.choices?.length || config.default === undefined) {
        return;
    }

    const token = String(config.default);
    if (!config.choices.includes(token)) {
        throw new Error(
            `Option \`${item.rawName}\`: default ${JSON.stringify(config.default)} is not in choices [${config.choices.join(", ")}]`,
        );
    }
}

function assertRequiredCompatibleWithDefault(item: CliOptionItem): void {
    const { config } = item;
    if (config?.required && config.default !== undefined) {
        throw new Error(
            `Option \`${item.rawName}\`: config.required cannot be used with config.default.`,
        );
    }
}

function wrapCommandActionForRequiredOptions(command: Command): void {
    if (commandsWithWrappedAction.has(command)) {
        return;
    }

    commandsWithWrappedAction.add(command);
    const originalAction = command.action.bind(command);
    command.action = ((callback: (...args: unknown[]) => unknown) => {
        return originalAction(function wrappedCliOptionsAction(
            this: unknown,
            ...args: unknown[]
        ) {
            const options = args[args.length - 1] as Record<string, unknown>;
            const items = commandOptionItemsRegistry.get(command) ?? [];
            if (items.some((item) => item.config?.required)) {
                assertRequiredCliOptions(options, items);
            }

            return (
                callback as (this: unknown, ...args: unknown[]) => unknown
            ).apply(this, args);
        });
    }) as typeof command.action;
}

function buildCacOptionConfig(item: CliOptionItem): CacOptionConfig {
    const { config } = item;
    if (!config?.choices?.length) {
        return config as CacOptionConfig;
    }

    const hasValuePlaceholder =
        item.rawName.includes("<") || item.rawName.includes("[");
    if (!hasValuePlaceholder) {
        throw new Error(
            `choices were given for option \`${item.rawName}\`, but this option has no value placeholder (\`<name>\` or \`[name]\`).`,
        );
    }

    assertDefaultInChoices(item);

    const userType = Array.isArray(config.type) ? config.type[0] : undefined;
    const choices = config.choices;

    return {
        ...config,
        type: [
            (raw: unknown) => {
                const next =
                    typeof userType === "function"
                        ? (userType as (v: unknown) => unknown)(raw)
                        : raw;
                if (next === undefined) {
                    return next;
                }
                assertOptionValueInChoices(next, choices, item.rawName);
                return next;
            },
        ],
    };
}

export function registerCommandNames(
    cli: CAC,
    names: string[],
    description: string,
): Command {
    const [primaryName, ...aliases] = names;

    if (!primaryName) {
        throw new Error(
            "registerCommandNames requires at least one command name.",
        );
    }

    const command = cli.command(primaryName, description);

    for (const alias of aliases) {
        command.alias(alias);
    }

    return command;
}

export function registerCommands(
    cli: CAC,
    names: string[],
    description: string,
    configure: (command: Command) => void,
): Command {
    const command = registerCommandNames(cli, names, description);
    configure(command);
    return command;
}

export function addCommandOptions(
    command: Command,
    optionItems: readonly CliOptionItem[],
): Command {
    const previous = commandOptionItemsRegistry.get(command) ?? [];
    commandOptionItemsRegistry.set(command, [...previous, ...optionItems]);

    for (const optionItem of optionItems) {
        assertRequiredCompatibleWithDefault(optionItem);
        const cacConfig = optionItem.config
            ? buildCacOptionConfig(optionItem)
            : undefined;
        command.option(optionItem.rawName, optionItem.description, cacConfig);
    }

    const merged = commandOptionItemsRegistry.get(command) ?? [];
    if (merged.some((item) => item.config?.required)) {
        wrapCommandActionForRequiredOptions(command);
    }

    return command;
}

export async function getCommandOptions<T>(
    command: Command,
    optionItems: readonly CliOptionItem[],
): Promise<T> {
    return new Promise((resolve) => {
        addCommandOptions(command, optionItems).action(async (options) => {
            resolve(options as T);
        });
    });
}
