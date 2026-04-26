import type { CliOptionRawScalar, OptionsBase } from "./types";

export function parsePositiveInteger(
    rawValue: CliOptionRawScalar,
    label: string,
): number {
    const errorMessage = `Invalid ${label}: ${rawValue}. Provide a positive integer.`;

    if (typeof rawValue === "number") {
        if (Number.isInteger(rawValue) && rawValue > 0) {
            return rawValue;
        }
        throw new Error(errorMessage);
    }

    if (typeof rawValue !== "string") {
        throw new Error(errorMessage);
    }

    const parsed = Number.parseInt(rawValue ?? "", 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(errorMessage);
    }

    return parsed;
}

export function parseBooleanOption(
    rawValue: boolean | string | number | undefined,
): boolean {
    if (rawValue === undefined) {
        return false;
    }

    if (typeof rawValue === "boolean") {
        return rawValue;
    }

    if (typeof rawValue === "number") {
        return rawValue !== 0;
    }

    const normalized = rawValue.trim().toLowerCase();
    return ["true", "1", "yes", "on"].includes(normalized);
}

export function ensureScalar<T>(value: T | T[]): T {
    if (Array.isArray(value)) {
        return value[value.length - 1] as T;
    }

    return value;
}

/**
 * Preserve explicit empty-string CLI values for CAC string-like options.
 *
 * Why: CAC currently coerces `""` into `0` during parsing for `<value>` options,
 * so `--flag ""` is otherwise indistinguishable from numeric parsing output.
 *
 * Issue: https://github.com/cacjs/cac/issues/165
 *
 * Example:
 * `command.option('--full-name <fullName>', 'Full name', { type: [preserveEmptyStringOption] })`
 */
export function preserveEmptyStringOption(value: unknown): string {
    return value === 0 ? "" : String(value);
}

/**
 * Ensures a scalar option value is one of `choices` (compared as `String(value)`).
 * Use for custom validation; `addCommandOptions` applies this automatically when `config.choices` is set.
 */
function removeBracketsFromOptionRawName(v: string): string {
    const lt = v.indexOf("<");
    const sq = v.indexOf("[");
    const idx = Math.min(lt === -1 ? Infinity : lt, sq === -1 ? Infinity : sq);
    if (idx === Infinity) {
        return v.trim();
    }

    return v.slice(0, idx).trim();
}

function camelcaseDashed(input: string): string {
    return input.replaceAll(
        /([a-z])-([a-z])/g,
        (_, p1: string, p2: string) => p1 + p2.toUpperCase(),
    );
}

function camelcaseOptionSegment(name: string): string {
    return name
        .split(".")
        .map((v, i) => (i === 0 ? camelcaseDashed(v) : v))
        .join(".");
}

/**
 * CAC’s parsed option key for `rawName` (primary name’s first segment, camelCased).
 * Matches `cac`’s `Option` naming so lookups align with `cli.parse()` output.
 */
export function getCliOptionPropertyKey(rawName: string): string {
    const working = rawName.replaceAll(".*", "");
    const names = removeBracketsFromOptionRawName(working)
        .split(",")
        .map((v) => {
            let name = v.trim().replace(/^-{1,2}/, "");
            if (name.startsWith("no-")) {
                name = name.replace(/^no-/, "");
            }

            return camelcaseOptionSegment(name);
        })
        .sort((a, b) => (a.length > b.length ? 1 : -1));
    const primary = names.at(-1);
    if (!primary) {
        throw new Error(`Invalid option rawName: ${rawName}`);
    }

    const [top] = primary.split(".");
    return top ?? primary;
}

/**
 * Ensures every `CliOptionItem` with `config.required` has a defined parsed value
 * (`!== undefined`). Used by `addCommandOptions`; call manually if you register options
 * without that helper.
 */
export function assertRequiredCliOptions(
    options: Record<string, unknown>,
    optionItems: readonly {
        rawName: string;
        config?: { required?: boolean };
    }[],
): void {
    for (const item of optionItems) {
        if (!item.config?.required) {
            continue;
        }

        const key = getCliOptionPropertyKey(item.rawName);
        if (options[key] === undefined) {
            throw new Error(`option \`${item.rawName}\` is required`);
        }
    }
}

export function assertOptionValueInChoices(
    value: unknown,
    choices: readonly string[],
    optionRawName: string,
): void {
    if (choices.length === 0) {
        return;
    }

    if (value === undefined) {
        return;
    }

    const token = String(value);
    if (!choices.includes(token)) {
        throw new Error(
            `option \`${optionRawName}\` must be one of: ${choices.join(", ")} (received: ${token})`,
        );
    }
}

export function processCommandRawOptions<TOptions extends OptionsBase>(
    rawOptions: OptionsBase | null | undefined,
    arrays: readonly string[] = [],
): TOptions {
    const normalizedOptions: OptionsBase = { ...(rawOptions ?? {}) };
    const arrayKeys = new Set(arrays);

    for (const key of Object.keys(normalizedOptions)) {
        if (key === "--") {
            delete normalizedOptions[key];
            continue;
        }

        if (!arrayKeys.has(key)) {
            normalizedOptions[key] = ensureScalar(
                normalizedOptions[key] as unknown,
            );
        }
    }

    return normalizedOptions as TOptions;
}
