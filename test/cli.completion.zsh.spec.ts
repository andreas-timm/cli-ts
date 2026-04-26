import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateZshCompletion } from "../src";
import { createTestCli } from "./cli.ts";

function quoteForZsh(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

function createCli() {
    return createTestCli();
}

function createCompletionFixture() {
    const cli = createCli();
    const completionDir = mkdtempSync(
        join(tmpdir(), "bun-package-cli-completion-"),
    );
    const completionPath = join(completionDir, `_${cli.name}`);
    writeFileSync(completionPath, generateZshCompletion(cli));

    return { cli, completionDir };
}

function runCompletion(
    words: string[],
    options?: { prefix?: string },
): string[] {
    const cli = createCli();
    const completionScript = generateZshCompletion(cli);
    const completionFunction = "_test_completion";
    const zshScript = [
        `${completionFunction}() {`,
        'compadd() { print -- "compadd:$*"; }',
        '_files() { print -- "_files:$*"; }',
        completionScript,
        "}",
        `words=(${words.map((word) => quoteForZsh(word)).join(" ")})`,
        `CURRENT=${words.length}`,
        `PREFIX=${quoteForZsh(options?.prefix ?? "")}`,
        `IPREFIX=''`,
        `SUFFIX=''`,
        `ISUFFIX=''`,
        completionFunction,
    ].join("\n");

    return executeZsh(zshScript);
}

function runAutoloadedCompletion(words: string[]): string[] {
    const { completionDir } = createCompletionFixture();

    try {
        const zshScript = [
            `autoload -Uz compinit`,
            `fpath=(${quoteForZsh(completionDir)} $fpath)`,
            `compinit -u -D`,
            'compadd() { print -- "compadd:$*"; }',
            '_files() { print -- "_files:$*"; }',
            `words=(${words.map((word) => quoteForZsh(word)).join(" ")})`,
            `CURRENT=${words.length}`,
            "completion_function=${_comps[bun-package-cli]}",
            "$completion_function",
        ].join("\n");

        return executeZsh(zshScript);
    } finally {
        rmSync(completionDir, { recursive: true, force: true });
    }
}

function runInteractiveCompletion(input: string): string {
    const { completionDir } = createCompletionFixture();
    const zdotdir = mkdtempSync(join(tmpdir(), "bun-package-cli-zdotdir-"));
    const zshrcPath = join(zdotdir, ".zshrc");

    writeFileSync(
        zshrcPath,
        [
            "PROMPT='% '",
            "PS1='% '",
            `fpath=(${quoteForZsh(completionDir)} $fpath)`,
            "autoload -Uz compinit",
            "compinit -u -D",
        ].join("\n"),
    );

    const expectScript = [
        "set timeout 10",
        "spawn env TERM=dumb ZDOTDIR=$env(ZDOTDIR_PATH) zsh -i",
        'expect "% "',
        `send -- {${input}}`,
        'send "\\t"',
        "expect {",
        '  -re {globbed-files} { puts "FAIL:$expect_out(buffer)"; exit 1 }',
        '  -re {README\\.md|package\\.json|src/} { puts "OK:$expect_out(buffer)"; exit 0 }',
        '  timeout { puts "TIMEOUT:$expect_out(buffer)"; exit 2 }',
        "}",
    ].join("\n");

    try {
        const result = Bun.spawnSync({
            cmd: ["expect", "-c", expectScript],
            env: {
                ...process.env,
                ZDOTDIR_PATH: zdotdir,
            },
            stdout: "pipe",
            stderr: "pipe",
        });

        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr).trim();

        expect(result.exitCode, stderr || stdout).toBe(0);

        return stdout;
    } finally {
        rmSync(zdotdir, { recursive: true, force: true });
        rmSync(completionDir, { recursive: true, force: true });
    }
}

function executeZsh(zshScript: string): string[] {
    const result = Bun.spawnSync({
        cmd: ["zsh", "-lc", zshScript],
        stdout: "pipe",
        stderr: "pipe",
    });

    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();

    expect(result.exitCode, stderr || stdout).toBe(0);

    return stdout.length === 0 ? [] : stdout.split("\n");
}

describe("zsh completion", () => {
    test("loads as an autoloaded fpath completion", () => {
        const output = runAutoloadedCompletion(["bun-package-cli", ""]);

        expect(output.some((line) => line.includes("completion"))).toBe(true);
        expect(output.some((line) => line.includes("bundle"))).toBe(true);
    });

    test("offers file completion for positional file arguments", () => {
        const output = runCompletion(["bun-package-cli", "bundle", ""]);

        expect(output).toContain("_files:");
        expect(output.some((line) => line.includes("--output"))).toBe(true);
    });

    test("filters root subcommands by typed prefix", () => {
        const output = runCompletion(["bun-package-cli", ""], { prefix: "c" });

        expect(output).toEqual(["compadd:-- completion"]);
    });

    test("offers empty-name default command options at the root", () => {
        const output = runCompletion(["bun-package-cli", "--"], {
            prefix: "--",
        });

        expect(output.some((line) => line.includes("--cwd"))).toBe(true);
        expect(output.some((line) => line.includes("--profile"))).toBe(true);
    });

    test("offers choice completion for empty-name default command options", () => {
        const output = runCompletion(["bun-package-cli", "--profile", ""]);

        expect(
            output.some(
                (line) => line.startsWith("compadd:") && line.includes("dev"),
            ),
        ).toBe(true);
        expect(
            output.some(
                (line) => line.startsWith("compadd:") && line.includes("ci"),
            ),
        ).toBe(true);
    });

    test("offers directory completion for directory-valued options", () => {
        const output = runCompletion([
            "bun-package-cli",
            "bundle",
            "--output",
            "",
        ]);

        expect(output).toContain("_files:-/");
    });

    test("offers choice completion for options with config.choices", () => {
        const output = runCompletion([
            "bun-package-cli",
            "bundle",
            "--format",
            "",
        ]);

        expect(
            output.some(
                (line) => line.startsWith("compadd:") && line.includes("esm"),
            ),
        ).toBe(true);
        expect(
            output.some(
                (line) => line.startsWith("compadd:") && line.includes("cjs"),
            ),
        ).toBe(true);
    });

    test("does not break interactive path completion for positional file arguments", () => {
        const output = runInteractiveCompletion("bun-package-cli bundle ./");

        expect(output).toContain("OK:");
    }, 15_000);
});
