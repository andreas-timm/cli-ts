import type { CAC } from "cac";
import { addCommandOptions, registerCommands } from "../src";

export function registerTestCommands(cli: CAC): void {
    const defaultCommand = cli.command("", "Run the default workflow");
    defaultCommand.option("--cwd <workdir>", "Working directory");
    addCommandOptions(defaultCommand, [
        {
            rawName: "--profile <profile>",
            description: "Profile",
            config: { choices: ["dev", "ci"] },
        },
    ]);
    defaultCommand.action(async () => {
        console.log("Ran default workflow");
    });

    registerCommands(
        cli,
        ["project tasks list"],
        "List project tasks",
        (command) => {
            command.action(async () => {
                console.log("Listed project tasks");
            });
        },
    );
    registerCommands(
        cli,
        ["project tasks sync"],
        "Sync project tasks",
        (command) => {
            command.action(async () => {
                console.log("Synced project tasks");
            });
        },
    );

    registerCommands(
        cli,
        ["deploy preview status"],
        "Show preview deployment status",
        (command) => {
            command.action(async () => {
                console.log("Preview deployment is ready");
            });
        },
    );

    registerCommands(
        cli,
        ["bundle [entry-file]"],
        "Bundle an entry file",
        (command) => {
            command.option("--output <output-dir>", "Output dir");
            addCommandOptions(command, [
                {
                    rawName: "--format <format>",
                    description: "Output format",
                    config: { choices: ["esm", "cjs"] },
                },
            ]);

            command.action(async () => {
                console.log("Bundled entry file");
            });
        },
    );
}
