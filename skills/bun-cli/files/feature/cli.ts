import type { OptionsBase } from "@andreas-timm/cli";
import {
    addCommandOptions,
    preserveEmptyStringOption,
    processCommandRawOptions,
    registerCommands,
} from "@andreas-timm/cli";
import type { CAC } from "cac";

interface ActionOptions extends OptionsBase {
    env?: string;
    tag?: string[];
    fullName?: string;
}

const OPTIONS = [
    { rawName: "--env <env>", description: "Target environment" },
    { rawName: "--tag <tag>", description: "Attach a tag" },
    {
        rawName: "--full-name <fullName>",
        description: "Allow an explicit empty string",
        config: { type: [preserveEmptyStringOption] },
    },
] as const;

export function registerFeatureCommands(cli: CAC) {
    registerCommands(
        cli,
        ["group action", "ga"],
        "Command summary",
        (command) => {
            addCommandOptions(command, OPTIONS).action(async (rawOptions) => {
                const options = processCommandRawOptions<ActionOptions>(
                    rawOptions,
                    ["tag"],
                );
                // @ts-expect-error — only for this examplee
                const { runAction } = await import("./action-handler");
                await runAction(options);
            });
        },
    );
}
