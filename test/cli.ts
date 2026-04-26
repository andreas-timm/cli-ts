#!/usr/bin/env bun

import { cac } from "cac";
import { version } from "../package.json";
import {
    installDefaultCommandHelp,
    installSubcommandHelp,
    registerCompletionCommands,
    run,
} from "../src";
import { registerTestCommands } from "./test.ts";

export function createTestCli() {
    const cli = cac("bun-package-cli");

    registerTestCommands(cli);
    registerCompletionCommands(cli);
    installDefaultCommandHelp(cli);
    installSubcommandHelp(cli);

    cli.version(version);

    return cli;
}

if (import.meta.main) {
    await run(createTestCli());
}
