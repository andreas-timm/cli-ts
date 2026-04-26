import { describe, expect, it } from "bun:test";
import type { CAC } from "cac";
import { cac } from "cac";
import { version } from "../package.json";
import {
    addCommandOptions,
    ensureScalar,
    generateZshCompletion,
    installDefaultCommandHelp,
    installSubcommandHelp,
    parsePositiveInteger,
    patchArgs,
    preserveEmptyStringOption,
    registerCommands,
    run,
} from "../src";
import {
    assertOptionValueInChoices,
    assertRequiredCliOptions,
    getCliOptionPropertyKey,
} from "../src/options";
import { createTestCli } from "./cli";

function createCliAmbiguousPrefixWithParentProject() {
    const cli = cac("bun-package-cli");
    registerCommands(cli, ["project"], "Parent", (command) =>
        command.action(async () => {}),
    );
    registerCommands(
        cli,
        ["project tasks list"],
        "List project tasks",
        (command) => command.action(async () => {}),
    );
    registerCommands(
        cli,
        ["project tasks sync"],
        "Sync project tasks",
        (command) => command.action(async () => {}),
    );
    installDefaultCommandHelp(cli);
    installSubcommandHelp(cli);
    cli.version(version);
    return cli;
}

type FakeCommand = {
    name: string;
    rawName: string;
    description: string;
    aliasNames: string[];
    isGlobalCommand?: boolean;
    isDefaultCommand?: boolean;
};

async function captureConsoleOutputAsync(
    runWithCapture: () => Promise<void>,
): Promise<string> {
    const originalConsoleLog = console.log;
    const originalConsoleInfo = console.info;
    const lines: string[] = [];

    const capture = (...args: unknown[]) => {
        lines.push(args.map((arg) => String(arg)).join(" "));
    };
    console.log = capture;
    console.info = capture;

    try {
        await runWithCapture();
    } finally {
        console.log = originalConsoleLog;
        console.info = originalConsoleInfo;
    }

    return lines.join("\n");
}

const originalProcessExit = process.exit;
function mockProcessExit() {
    (process as any).exit = (code?: number) => {
        throw new Error(`process.exit(${code})`);
    };
}
function restoreProcessExit() {
    process.exit = originalProcessExit;
}

async function expectRunExitsWithConsoleError(
    cli: CAC,
    argv: string[],
    assert: (ctx: { errorLines: string[]; rawErrors: unknown[] }) => void,
) {
    mockProcessExit();
    const originalConsoleError = console.error;
    const errorLines: string[] = [];
    const rawErrors: unknown[] = [];
    console.error = (msg: unknown) => {
        errorLines.push(String(msg));
        rawErrors.push(msg);
    };

    try {
        await expect(run(cli, argv)).rejects.toThrow("process.exit(1)");
        assert({ errorLines, rawErrors });
    } finally {
        console.error = originalConsoleError;
        restoreProcessExit();
    }
}

describe("patchArgs", () => {
    it("merges registered multi-word commands before parsing", () => {
        const cli = cac("tool");
        registerCommands(cli, ["logs tail"], "Tail logs", () => {});

        expect(patchArgs(cli, ["bun", "tool", "logs", "tail"])).toEqual([
            "bun",
            "tool",
            "logs tail",
        ]);
    });
});

describe("run", () => {
    it("normalizes help subcommands into --help calls", async () => {
        const commands: FakeCommand[] = [
            {
                aliasNames: [],
                description: "Tail logs",
                name: "logs tail",
                rawName: "logs tail",
            },
        ];
        let receivedArgs: string[] | undefined;
        let receivedRunFlag: boolean | undefined;

        const cli = {
            args: [],
            commands,
            globalCommand: { options: [] },
            matchedCommand: commands[0],
            name: "tool",
            outputHelp: () => {},
            option: () => {},
            parse: (args: string[], options?: { run?: boolean }) => {
                receivedArgs = args;
                receivedRunFlag = options?.run;
            },
            runMatchedCommand: () => {},
        } as unknown as CAC;

        await run(cli, ["bun", "tool", "help", "logs", "tail"]);

        expect(receivedArgs).toEqual(["bun", "tool", "logs tail", "--help"]);
        expect(receivedRunFlag).toBeFalse();
    });

    it("normalizes -h into --help calls", async () => {
        const commands: FakeCommand[] = [
            {
                aliasNames: [],
                description: "Tail logs",
                name: "logs tail",
                rawName: "logs tail",
            },
        ];
        let receivedArgs: string[] | undefined;
        let receivedRunFlag: boolean | undefined;

        const cli = {
            args: [],
            commands,
            globalCommand: { options: [] },
            matchedCommand: commands[0],
            name: "tool",
            outputHelp: () => {},
            option: () => {},
            parse: (args: string[], options?: { run?: boolean }) => {
                receivedArgs = args;
                receivedRunFlag = options?.run;
            },
            runMatchedCommand: () => {},
        } as unknown as CAC;

        await run(cli, ["bun", "tool", "-h", "logs", "tail"]);

        expect(receivedArgs).toEqual(["bun", "tool", "logs tail", "--help"]);
        expect(receivedRunFlag).toBeFalse();
    });

    it("shows top-level help when a named command uses ! as an alias", async () => {
        const cli = cac("tool");
        let outputHelpCalls = 0;

        cli.command("serve", "Serve")
            .alias("!")
            .action(() => {
                throw new Error(
                    "named ! aliases should not auto-run as synthetic defaults",
                );
            });

        cli.outputHelp = () => {
            outputHelpCalls += 1;
        };

        await run(cli, ["bun", "tool"]);

        expect(outputHelpCalls).toBe(1);
    });

    it("runs synthetic bracket-only default commands with no args", async () => {
        const cli = cac("tool");
        let executed = false;

        cli.command("[...files]", "Build files").action(() => {
            executed = true;
        });

        await run(cli, ["bun", "tool"]);

        expect(executed).toBeTrue();
    });

    it("handles errors gracefully without debug flag", async () => {
        const cli = cac("tool");
        cli.command("fail").action(() => {
            throw new Error("Something went wrong");
        });

        mockProcessExit();
        const originalConsoleError = console.error;
        const errorLines: string[] = [];
        console.error = (msg: any) => errorLines.push(String(msg));

        try {
            await expect(run(cli, ["bun", "tool", "fail"])).rejects.toThrow(
                "process.exit(1)",
            );
            expect(errorLines).toEqual(["Error: Something went wrong"]);
        } finally {
            console.error = originalConsoleError;
            restoreProcessExit();
        }
    });

    it("shows full error with debug flag", async () => {
        const cli = cac("tool");
        const err = new Error("Something went wrong");
        cli.command("fail").action(() => {
            throw err;
        });

        mockProcessExit();
        const originalConsoleError = console.error;
        const errorLines: any[] = [];
        console.error = (msg: any) => errorLines.push(msg);

        try {
            expect(
                run(cli, ["bun", "tool", "fail", "--debug"]),
            ).rejects.toThrow("process.exit(1)");
            expect(errorLines).toContain(err);
        } finally {
            console.error = originalConsoleError;
            restoreProcessExit();
        }
    });

    it("handles async errors gracefully without debug flag", async () => {
        const cli = cac("tool");
        cli.command("fail").action(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            throw new Error("Async failure");
        });

        mockProcessExit();
        const originalConsoleError = console.error;
        const errorLines: string[] = [];
        console.error = (msg: any) => errorLines.push(String(msg));

        try {
            expect(run(cli, ["bun", "tool", "fail"])).rejects.toThrow(
                "process.exit(1)",
            );
            expect(errorLines).toEqual(["Error: Async failure"]);
        } finally {
            console.error = originalConsoleError;
            restoreProcessExit();
        }
    });
});

describe("parsePositiveInteger", () => {
    it("accepts positive integer values and rejects invalid input", () => {
        expect(parsePositiveInteger("5", "--limit")).toBe(5);
        expect(() => parsePositiveInteger("0", "--limit")).toThrow(
            "Invalid --limit: 0. Provide a positive integer.",
        );
    });
});

describe("preserveEmptyStringOption", () => {
    it("preserves empty-string values coerced by CAC", () => {
        expect(preserveEmptyStringOption(0)).toBe("");
        expect(preserveEmptyStringOption("alice")).toBe("alice");
    });
});

describe("assertOptionValueInChoices", () => {
    it("throws when the value is not in the list", () => {
        expect(() =>
            assertOptionValueInChoices("bad", ["a", "b"], "--mode <mode>"),
        ).toThrow("a, b");
    });

    it("allows undefined", () => {
        expect(() =>
            assertOptionValueInChoices(undefined, ["a"], "--x"),
        ).not.toThrow();
    });
});

describe("getCliOptionPropertyKey", () => {
    it("matches CAC parsed option keys for aliases", () => {
        const cli = cac("tool");
        const cmd = cli.command("go", "Go");
        cmd.option("-c, --config <path>", "Config path");
        const cacName = cmd.options[0]?.name;
        expect(cacName).toBeDefined();
        if (cacName === undefined) {
            throw new Error("expected option name");
        }

        const [firstSegment = cacName] = cacName.split(".");
        expect(getCliOptionPropertyKey("-c, --config <path>")).toBe(
            firstSegment,
        );
    });
});

describe("assertRequiredCliOptions", () => {
    it("throws when a required option is absent", () => {
        expect(() =>
            assertRequiredCliOptions({}, [
                { rawName: "--mode <mode>", config: { required: true } },
            ]),
        ).toThrow("required");
    });

    it("allows a defined value including false", () => {
        expect(() =>
            assertRequiredCliOptions({ verbose: false }, [
                { rawName: "--verbose", config: { required: true } },
            ]),
        ).not.toThrow();
    });
});

describe("addCommandOptions with config.required", () => {
    it("errors when the option is omitted", async () => {
        const cli = cac("tool");
        const cmd = cli.command("go", "Go");
        addCommandOptions(cmd, [
            {
                rawName: "--mode <mode>",
                description: "Mode",
                config: { required: true },
            },
        ]);
        cmd.action(() => {});

        await expectRunExitsWithConsoleError(
            cli,
            ["bun", "tool", "go"],
            ({ errorLines }) => {
                expect(errorLines.join("\n")).toContain("required");
            },
        );
    });

    it("accepts the option when passed", async () => {
        const cli = cac("tool");
        let mode: string | undefined;
        const cmd = cli.command("go", "Go");
        addCommandOptions(cmd, [
            {
                rawName: "--mode <mode>",
                description: "Mode",
                config: { required: true },
            },
        ]);
        cmd.action((opts: { mode?: string }) => {
            mode = opts.mode;
        });

        await run(cli, ["bun", "tool", "go", "--mode", "fast"]);
        expect(mode).toBe("fast");
    });

    it("throws at registration when required is combined with default", () => {
        const cli = cac("tool");
        const cmd = cli.command("go", "Go");
        expect(() =>
            addCommandOptions(cmd, [
                {
                    rawName: "--mode [mode]",
                    description: "Mode",
                    config: { required: true, default: "slow" },
                },
            ]),
        ).toThrow("default");
    });

    it("wraps action when a later addCommandOptions adds required", async () => {
        const cli = cac("tool");
        const cmd = cli.command("go", "Go");
        addCommandOptions(cmd, [{ rawName: "--a <a>", description: "A" }]);
        addCommandOptions(cmd, [
            {
                rawName: "--b <b>",
                description: "B",
                config: { required: true },
            },
        ]);
        cmd.action(() => {});

        await expectRunExitsWithConsoleError(
            cli,
            ["bun", "tool", "go", "--a", "1"],
            ({ errorLines }) => {
                expect(errorLines.join("\n")).toContain("--b");
            },
        );
    });

    it("satisfies required from a second addCommandOptions when both flags are passed", async () => {
        const cli = cac("tool");
        let out: string | undefined;
        const cmd = cli.command("go", "Go");
        addCommandOptions(cmd, [{ rawName: "--a <a>", description: "A" }]);
        addCommandOptions(cmd, [
            {
                rawName: "--b <b>",
                description: "B",
                config: { required: true },
            },
        ]);
        cmd.action((opts: { a?: string; b?: string }) => {
            out = `${opts.a},${opts.b}`;
        });

        await run(cli, ["bun", "tool", "go", "--a", "1", "--b", "2"]);
        expect(out).toBe("1,2");
    });
});

describe("addCommandOptions with config.choices", () => {
    it("accepts a value listed in choices", async () => {
        const cli = cac("tool");
        let mode: string | undefined;
        const cmd = cli.command("go", "Go");
        addCommandOptions(cmd, [
            {
                rawName: "--mode <mode>",
                description: "Mode",
                config: { choices: ["fast", "slow"] },
            },
        ]);
        cmd.action((opts: { mode?: string | string[] }) => {
            mode = ensureScalar(opts.mode as string | string[]);
        });

        await run(cli, ["bun", "tool", "go", "--mode", "slow"]);
        expect(mode).toBe("slow");
    });

    it("rejects a value not listed in choices", async () => {
        const cli = cac("tool");
        const cmd = cli.command("go", "Go");
        addCommandOptions(cmd, [
            {
                rawName: "--mode <mode>",
                description: "Mode",
                config: { choices: ["fast", "slow"] },
            },
        ]);
        cmd.action(() => {});

        await expectRunExitsWithConsoleError(
            cli,
            ["bun", "tool", "go", "--mode", "bad"],
            ({ errorLines }) => {
                const text = errorLines.join("\n");
                expect(text).toContain("fast");
                expect(text).toContain("slow");
                expect(text).toContain("bad");
            },
        );
    });

    it("throws at registration when default is not in choices", () => {
        const cli = cac("tool");
        const cmd = cli.command("go", "Go");
        expect(() =>
            addCommandOptions(cmd, [
                {
                    rawName: "--mode [mode]",
                    description: "Mode",
                    config: { choices: ["a", "b"], default: "c" },
                },
            ]),
        ).toThrow("default");
    });

    it("throws at registration when choices are set on a boolean flag", () => {
        const cli = cac("tool");
        const cmd = cli.command("go", "Go");
        expect(() =>
            addCommandOptions(cmd, [
                {
                    rawName: "--verbose",
                    description: "Verbose",
                    config: { choices: ["a"] },
                },
            ]),
        ).toThrow("value placeholder");
    });

    it("runs an existing type transform before checking choices", async () => {
        const cli = cac("tool");
        let n: number | undefined;
        const cmd = cli.command("go", "Go");
        addCommandOptions(cmd, [
            {
                rawName: "--n <n>",
                description: "N",
                config: {
                    choices: ["1", "2", "3"],
                    type: [Number],
                },
            },
        ]);
        cmd.action((opts: { n?: number | number[] }) => {
            n = ensureScalar(opts.n as number | number[]);
        });

        await run(cli, ["bun", "tool", "go", "--n", "2"]);
        expect(n).toBe(2);
    });
});

describe("generateZshCompletion", () => {
    it("includes registered subcommands and options in the completion output", () => {
        const cli = cac("tool");
        cli.option("--help", "Display this message");
        cli.option("--verbose", "Verbose logging");
        registerCommands(cli, ["logs tail"], "Tail logs", (command) => {
            command.option("--follow", "Follow output");
        });

        const completion = generateZshCompletion(cli);

        expect(completion).toContain("#compdef tool");
        expect(completion).toContain("'logs tail')");
        expect(completion).toContain("'--verbose'");
        expect(completion).toContain("'--follow'");
        expect(completion).toContain("'--help'");
        expect(completion).toContain("'-h'");
    });

    it("keeps named ! aliases visible while surfacing synthetic default options at root", () => {
        const cli = cac("tool");
        cli.command("[...files]", "Build files").option(
            "--manifest <manifest>",
            "Manifest file",
        );
        cli.command("serve", "Serve")
            .alias("!")
            .option("--port <port>", "Port");
        cli.command("deploy", "Deploy");

        const completion = generateZshCompletion(cli);

        expect(completion).toContain("subcommands=('deploy' 'serve')");
        expect(completion).toContain("'--manifest'");
        expect(completion).not.toContain(
            "options=('--help' '--manifest' '--port'",
        );
    });
});

describe("nested help with duplicate registrations", () => {
    it("still resolves partial -h when the same command name is registered twice", async () => {
        const cli = createTestCli();
        registerCommands(
            cli,
            ["deploy preview status"],
            "Duplicate registration",
            () => {},
        );

        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(cli, [
                "bun",
                "bun-package-cli",
                "deploy",
                "preview",
                "-h",
            ]);
        });

        expect(helpOutput).toContain("$ bun-package-cli deploy preview status");
        expect(helpOutput).not.toContain("Unknown command");
    });
});

describe("createTestCli", () => {
    it("shows compact top-level help hints for bun-package-cli", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), ["bun", "bun-package-cli", "-h"]);
        });

        expect(helpOutput).toContain(
            "Without command: Run the default workflow",
        );
        expect(helpOutput).toContain("--cwd <workdir>");
        expect(helpOutput).toContain("--profile <profile>");
        expect(helpOutput).toContain(
            "For more info, run any command with the `--help` flag",
        );
    });

    it("runs the empty-name default command with options", async () => {
        const output = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "--cwd",
                "src",
                "--profile",
                "ci",
            ]);
        });

        expect(output).toContain("Ran default workflow");
    });

    it("resolves partial nested paths with -h to the longest matching command", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "deploy",
                "preview",
                "-h",
            ]);
        });

        expect(helpOutput).toContain("$ bun-package-cli deploy preview status");
        expect(helpOutput).not.toContain("Unknown command");
    });

    it("resolves single-token prefix with -h when exactly one command extends it", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "deploy",
                "-h",
            ]);
        });

        expect(helpOutput).toContain("$ bun-package-cli deploy preview status");
        expect(helpOutput).not.toContain("Unknown command");
    });

    it("shows optional-arg command help for bundle -h without unknown command", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "bundle",
                "-h",
            ]);
        });

        expect(helpOutput).toContain("$ bun-package-cli bundle [entry-file]");
        expect(helpOutput).not.toContain("Unknown command");
    });

    it("lists subcommands when an ambiguous prefix is invoked without a flag", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), ["bun", "bun-package-cli", "project"]);
        });

        expect(helpOutput).toContain(
            "$ bun-package-cli project <subcommand> [options]",
        );
        expect(helpOutput).toContain("project tasks list");
        expect(helpOutput).toContain("project tasks sync");
        expect(helpOutput).toContain(
            "$ bun-package-cli project tasks list --help",
        );
        expect(helpOutput).not.toContain("Unknown command");
    });

    it("lists subcommands when a deeper ambiguous prefix is invoked", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "project",
                "tasks",
            ]);
        });

        expect(helpOutput).toContain(
            "$ bun-package-cli project tasks <subcommand> [options]",
        );
        expect(helpOutput).toContain("project tasks list");
        expect(helpOutput).toContain("project tasks sync");
        expect(helpOutput).not.toContain("Unknown command");
    });

    it("lists subcommands for an ambiguous prefix followed by --help", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "project",
                "--help",
            ]);
        });

        expect(helpOutput).toContain(
            "$ bun-package-cli project <subcommand> [options]",
        );
        expect(helpOutput).toContain("project tasks list");
        expect(helpOutput).toContain("project tasks sync");
        expect(helpOutput).not.toContain("Unknown command");
    });

    it('lists subcommands for "help <ambiguous-prefix>"', async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "help",
                "project",
                "tasks",
            ]);
        });

        expect(helpOutput).toContain(
            "$ bun-package-cli project tasks <subcommand> [options]",
        );
        expect(helpOutput).toContain("project tasks list");
        expect(helpOutput).toContain("project tasks sync");
        expect(helpOutput).not.toContain("Unknown command");
    });

    it("lists subcommands for ambiguous prefix with -h when a shorter parent command also exists", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createCliAmbiguousPrefixWithParentProject(), [
                "bun",
                "bun-package-cli",
                "project",
                "tasks",
                "-h",
            ]);
        });

        expect(helpOutput).toContain(
            "$ bun-package-cli project tasks <subcommand> [options]",
        );
        expect(helpOutput).toContain("project tasks list");
        expect(helpOutput).toContain("project tasks sync");
        expect(helpOutput).not.toContain("Unused args");
        expect(helpOutput).not.toContain("Unknown command");
    });

    it("still runs a command that accepts a positional when the path matches a longer literal", async () => {
        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(createTestCli(), [
                "bun",
                "bun-package-cli",
                "bundle",
                "src/index.ts",
            ]);
        });

        expect(helpOutput).toContain("Bundled entry file");
        expect(helpOutput).not.toContain("project tasks <subcommand>");
    });
});

describe("installDefaultCommandHelp", () => {
    it("replaces synthetic default usage with the global usage text", async () => {
        const cli = cac("tool");
        cli.usage("<command> [options]");
        cli.command("[...files]", "Build files").option(
            "--minimize",
            "Minimize output",
        );
        cli.command("deploy", "Deploy");
        installDefaultCommandHelp(cli);

        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(cli, ["bun", "tool", "--help"]);
        });

        expect(helpOutput).toContain("$ tool <command> [options]");
        expect(helpOutput).toContain(
            "For more info, run any command with the `--help` flag",
        );
        expect(helpOutput).not.toContain("$ tool deploy --help");
        expect(helpOutput).toContain("--minimize");
        expect(helpOutput).not.toContain("[...files]");
    });

    it("leaves real subcommand help untouched", async () => {
        const cli = cac("tool");
        cli.command("[...files]", "Build files").option(
            "--manifest <manifest>",
            "Manifest file",
        );
        cli.command("completion zsh", "Print a zsh completion script");
        installDefaultCommandHelp(cli);

        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(cli, ["bun", "tool", "completion", "zsh", "--help"]);
        });

        expect(helpOutput).toContain("$ tool completion zsh");
    });

    it("always collapses top-level help examples into a single note", async () => {
        const cli = cac("tool");
        cli.command("deploy", "Deploy");
        cli.command("completion zsh", "Print a zsh completion script");
        installDefaultCommandHelp(cli);

        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(cli, ["bun", "tool", "--help"]);
        });

        expect(helpOutput).toContain(
            "For more info, run any command with the `--help` flag",
        );
    });

    it("still hides synthetic defaults in CAC ! alias help layouts", async () => {
        const cli = cac("tool");
        cli.command("serve", "Serve")
            .alias("!")
            .option("--port <port>", "Port");
        cli.command("[...files]", "Build files").option(
            "--manifest <manifest>",
            "Manifest file",
        );
        installDefaultCommandHelp(cli);

        const helpOutput = await captureConsoleOutputAsync(async () => {
            await run(cli, ["bun", "tool", "serve", "--help"]);
        });

        expect(helpOutput).toContain("$ tool serve");
        expect(helpOutput).not.toContain("$ tool <command> [options]");
        expect(helpOutput).not.toContain("[...files]");
        expect(helpOutput).not.toContain("$ tool --help");
    });
});
