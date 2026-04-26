/**
 * Scalar value for a CAC value option before `config.type` transforms.
 * CAC exposes parsed options as `{ [k: string]: any }` (`ParsedArgv['options']`), not this union.
 */
export type CliOptionRawScalar = boolean | string | number | undefined;

export interface CliOptionItem {
    rawName: string;
    description: string;
    config?: {
        default?: unknown;
        /** CAC reads `type[0]`; allow `as const` tuples (readonly). */
        type?: readonly unknown[];
        /**
         * When set (non-empty), the parsed option value must equal one of these strings
         * (`String(value)` after any `type` transform). Implemented by composing a `type`
         * wrapper in `addCommandOptions`.
         *
         * Like any CAC `type` option, parsed values may be wrapped in a one-element array;
         * use `ensureScalar` / `processCommandRawOptions` if you need a scalar.
         */
        choices?: readonly string[];
        /**
         * When true, the option must be provided on the command line (parsed value is not
         * `undefined`). Incompatible with `default` (a default always supplies a value).
         * Enforced by `addCommandOptions` via a wrapped command action.
         */
        required?: boolean;
    };
}

export type CommandOptionItem = CliOptionItem;

export type OptionsBase = Record<string, unknown>;
