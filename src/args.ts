import type { CAC } from "cac";
import { readCommands } from "./command";

type CommandCandidate = {
    candidate: string;
    parts: string[];
};

function collectMultiWordCommandCandidates(cli: CAC): CommandCandidate[] {
    const commands = readCommands(cli);
    if (commands.length === 0) {
        return [];
    }

    return Array.from(
        new Set(
            commands.flatMap((command) => [
                command.name,
                ...(command.aliasNames || []),
            ]),
        ),
    )
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.includes(" "))
        .map((candidate) => ({ candidate, parts: candidate.split(/\s+/) }))
        .sort((left, right) => {
            const partDiff = right.parts.length - left.parts.length;
            if (partDiff !== 0) {
                return partDiff;
            }

            return right.candidate.length - left.candidate.length;
        });
}

export function patchArgs(cli: CAC, argv: string[] = process.argv): string[] {
    const patchedArgs = [...argv];

    const candidates = collectMultiWordCommandCandidates(cli);
    if (candidates.length === 0) {
        return patchedArgs;
    }

    const commandStartIndex = patchedArgs.length > 2 ? 2 : 0;

    for (const { candidate, parts } of candidates) {
        for (
            let i = commandStartIndex;
            i <= patchedArgs.length - parts.length;
            i++
        ) {
            if (patchedArgs[i]?.startsWith("-")) {
                continue;
            }

            const isMatch = parts.every(
                (part, offset) => patchedArgs[i + offset] === part,
            );
            if (!isMatch) {
                continue;
            }

            patchedArgs.splice(i, parts.length, candidate);
            break;
        }
    }

    return patchedArgs;
}
