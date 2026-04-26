export { patchArgs } from "./args";
export {
    findPrefixSubcommands,
    getLiteralCommandName,
    getMaximumCommandArgsCount,
    readCommands,
} from "./command";
export {
    generateZshCompletion,
    registerCompletionCommands,
} from "./completion.zsh";
export {
    extendHelp,
    type InstallDefaultCommandHelpOptions,
    installDefaultCommandHelp,
    installSubcommandHelp,
    outputPrefixHelp,
} from "./help";
export { normalizeHelpArgs } from "./help-args";
export * from "./install";
export {
    ensureScalar,
    parseBooleanOption,
    parsePositiveInteger,
    preserveEmptyStringOption,
    processCommandRawOptions,
} from "./options";
export {
    addCommandOptions,
    getCommandOptions,
    registerCommandNames,
    registerCommands,
} from "./register";

export { run } from "./run";
export type {
    CliOptionItem,
    CliOptionRawScalar,
    CommandOptionItem,
    OptionsBase,
} from "./types";
