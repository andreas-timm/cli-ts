#!/usr/bin/env bun

import {
    installDefaultCommandHelp,
    installSubcommandHelp,
    registerCompletionCommands,
    registerInstallCommand,
    run,
} from "@andreas-timm/cli";
import { cac } from "cac";
// @ts-expect-error — only for this example
import packageJson from "../package.json";
import { registerFeatureCommands } from "./feature/cli";

const cli = cac(packageJson.name);

cli.option("--verbose, -v", "Enable verbose logging");

registerFeatureCommands(cli);
registerCompletionCommands(cli); // Optional.
registerInstallCommand(cli, {
    packageName: packageJson.name,
    targetPath: process.argv[1],
}); // Optional.
installDefaultCommandHelp(cli);
installSubcommandHelp(cli);
cli.version(packageJson.version);

await run(cli);
