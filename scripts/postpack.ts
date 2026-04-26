#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { packageFilePath, root } from "./shared.ts";

if (!existsSync(packageFilePath)) {
    console.log(
        `postpack: ${packageFilePath} does not exist; skipping README patch`,
    );
    process.exit(0);
}

const tmpDir = mkdtempSync(join(tmpdir(), "andreastimm-cli-pack-"));

function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, {
        cwd: root,
        stdio: "inherit",
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed`);
    }
}

try {
    run("tar", ["-xzf", packageFilePath, "-C", tmpDir]);

    const readmePath = join(tmpDir, "package", "README.md");
    let readme = readFileSync(readmePath, "utf8");
    readme = readme.replaceAll(
        "](./skills/bun-cli/SKILL.md)",
        "](https://github.com/andreas-timm/cli-ts/blob/main/skills/bun-cli/SKILL.md)",
    );
    readme = readme.replace(/\n## Agent skill[\s\S]*$/u, "\n");
    writeFileSync(readmePath, readme);

    run("tar", ["-czf", packageFilePath, "-C", tmpDir, "package"]);
    console.log(`postpack: patched README in ${packageFilePath}`);
} finally {
    rmSync(tmpDir, { force: true, recursive: true });
}
