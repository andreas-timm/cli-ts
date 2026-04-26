import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { CAC } from "cac";
import { registerCommands } from "./register";

export interface InstallCommandOptions {
    binDir?: string;
    packageName: string;
    targetPath: string;
}

export interface RegisterInstallCommandOptions {
    argv?: string[];
    binDir?: string;
    packageName?: string;
    targetPath?: string;
}

export interface InstallCommandPaths {
    binDir: string;
    linkPath: string;
    packageName: string;
    targetPath: string;
}

function resolveDefaultTargetPath(argv: string[] = process.argv): string {
    const rawTargetPath = argv[1];

    if (!rawTargetPath) {
        throw new Error(
            "Cannot resolve CLI entrypoint from argv. Pass `targetPath` to registerInstallCommand().",
        );
    }

    return resolve(rawTargetPath);
}

export function resolveInstallCommandPaths(
    options: InstallCommandOptions,
): InstallCommandPaths {
    const binDir = options.binDir ?? resolve(homedir(), ".local/bin");
    const packageName = options.packageName;
    const targetPath = resolve(options.targetPath);
    const linkPath = resolve(binDir, packageName);

    return {
        binDir,
        linkPath,
        packageName,
        targetPath,
    };
}

async function readExistingSymlinkTarget(
    linkPath: string,
): Promise<string | undefined> {
    try {
        const entry = await lstat(linkPath);
        if (!entry.isSymbolicLink()) {
            throw new Error(
                `Refusing to replace non-symlink path: ${linkPath}`,
            );
        }

        return resolve(dirname(linkPath), await readlink(linkPath));
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            return undefined;
        }

        throw error;
    }
}

export async function runInstallCommand(
    options: InstallCommandOptions,
): Promise<void> {
    const { linkPath, packageName, targetPath } =
        resolveInstallCommandPaths(options);
    const existingTarget = await readExistingSymlinkTarget(linkPath);

    if (existingTarget === targetPath) {
        console.log(`${packageName} already installed at ${linkPath}`);
        return;
    }

    await mkdir(dirname(linkPath), { recursive: true });

    if (existingTarget) {
        await rm(linkPath, { force: true });
    }

    await symlink(targetPath, linkPath);

    console.log(
        `${existingTarget ? "Updated" : "Installed"} ${packageName}: ${linkPath} -> ${targetPath}`,
    );
}

export function registerInstallCommand(
    cli: CAC,
    options: RegisterInstallCommandOptions = {},
): void {
    registerCommands(
        cli,
        ["install"],
        "Create a ~/.local/bin symlink to this CLI",
        (command) => {
            command.action(async () => {
                await runInstallCommand({
                    binDir: options.binDir,
                    packageName: options.packageName ?? cli.name,
                    targetPath:
                        options.targetPath ??
                        resolveDefaultTargetPath(options.argv),
                });
            });
        },
    );
}
