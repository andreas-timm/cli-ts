import { describe, expect, it } from "bun:test";
import { cac } from "cac";
import { readCommands } from "../src";
import { registerInstallCommand } from "../src/install";

describe("registerInstallCommand", () => {
    it("registers an install command on app CLIs", () => {
        const cli = cac("@scope/app");

        registerInstallCommand(cli, { targetPath: "/tmp/app/src/cli.ts" });

        const commandNames = readCommands(cli).map(
            (command) => command.rawName,
        );
        expect(commandNames).toContain("install");
    });
});
