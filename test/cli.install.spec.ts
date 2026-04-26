import { afterEach, describe, expect, it } from "bun:test";
import {
    lstat,
    mkdir,
    mkdtemp,
    readlink,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallCommandPaths, runInstallCommand } from "../src/install";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(
        tempDirs
            .splice(0)
            .map((dir) => rm(dir, { force: true, recursive: true })),
    );
});

describe("resolveInstallCommandPaths", () => {
    it("uses package.name for the ~/.local/bin symlink path", () => {
        expect(
            resolveInstallCommandPaths({
                binDir: "/tmp/.local/bin",
                packageName: "@scope/app",
                targetPath: "/tmp/pkg/src/cli.ts",
            }),
        ).toEqual({
            binDir: "/tmp/.local/bin",
            linkPath: "/tmp/.local/bin/@scope/app",
            packageName: "@scope/app",
            targetPath: "/tmp/pkg/src/cli.ts",
        });
    });
});

describe("runInstallCommand", () => {
    it("creates the requested symlink and parent dirs", async () => {
        const sandbox = await createTempDir("andreastimm-cli-install");
        const packageRoot = join(sandbox, "pkg");
        const binDir = join(sandbox, ".local/bin");
        const targetPath = join(packageRoot, "src/cli.ts");
        const linkPath = join(binDir, "@scope/app");

        await mkdir(join(packageRoot, "src"), { recursive: true });
        await writeFile(targetPath, "#!/usr/bin/env bun\n");

        await runInstallCommand({
            binDir,
            packageName: "@scope/app",
            targetPath,
        });

        expect((await lstat(linkPath)).isSymbolicLink()).toBeTrue();
        expect(await readlink(linkPath)).toBe(targetPath);
    });

    it("does not recreate an identical symlink", async () => {
        const sandbox = await createTempDir("andreastimm-cli-install");
        const packageRoot = join(sandbox, "pkg");
        const binDir = join(sandbox, ".local/bin");
        const targetPath = join(packageRoot, "src/cli.ts");
        const linkPath = join(binDir, "@scope/app");

        await mkdir(join(packageRoot, "src"), { recursive: true });
        await mkdir(join(binDir, "@scope"), { recursive: true });
        await writeFile(targetPath, "#!/usr/bin/env bun\n");
        await symlink(targetPath, linkPath);

        await runInstallCommand({
            binDir,
            packageName: "@scope/app",
            targetPath,
        });

        expect((await lstat(linkPath)).isSymbolicLink()).toBeTrue();
        expect(await readlink(linkPath)).toBe(targetPath);
    });

    it("replaces an existing symlink that points somewhere else", async () => {
        const sandbox = await createTempDir("andreastimm-cli-install");
        const packageRoot = join(sandbox, "pkg");
        const binDir = join(sandbox, ".local/bin");
        const targetPath = join(packageRoot, "src/cli.ts");
        const oldTargetPath = join(packageRoot, "src/old-cli.ts");
        const linkPath = join(binDir, "@scope/app");

        await mkdir(join(packageRoot, "src"), { recursive: true });
        await mkdir(join(binDir, "@scope"), { recursive: true });
        await writeFile(targetPath, "#!/usr/bin/env bun\n");
        await writeFile(oldTargetPath, "#!/usr/bin/env bun\n");
        await symlink(oldTargetPath, linkPath);

        await runInstallCommand({
            binDir,
            packageName: "@scope/app",
            targetPath,
        });

        expect((await lstat(linkPath)).isSymbolicLink()).toBeTrue();
        expect(await readlink(linkPath)).toBe(targetPath);
    });

    it("fails when target path already exists as a regular file", async () => {
        const sandbox = await createTempDir("andreastimm-cli-install");
        const packageRoot = join(sandbox, "pkg");
        const binDir = join(sandbox, ".local/bin");
        const targetPath = join(packageRoot, "src/cli.ts");
        const linkPath = join(binDir, "@scope/app");

        await mkdir(join(packageRoot, "src"), { recursive: true });
        await mkdir(join(binDir, "@scope"), { recursive: true });
        await writeFile(targetPath, "#!/usr/bin/env bun\n");
        await writeFile(linkPath, "existing file\n");

        await expect(
            runInstallCommand({
                binDir,
                packageName: "@scope/app",
                targetPath,
            }),
        ).rejects.toThrow(`Refusing to replace non-symlink path: ${linkPath}`);
    });
});
