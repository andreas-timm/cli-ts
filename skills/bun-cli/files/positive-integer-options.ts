import type { CliOptionItem, CliOptionRawScalar } from "@andreas-timm/cli";
import { parsePositiveInteger } from "@andreas-timm/cli";

const _RESEARCH_OPTIONS = [
    {
        rawName: "--lowercase",
        description:
            "Print raw Transaction ID cells from the first N CSV files (case audit)",
    },
    {
        rawName: "--limit <n>",
        description: "Limit",
        config: {
            default: 10,
            type: [
                (v: CliOptionRawScalar) => parsePositiveInteger(v, "--limit"),
            ],
        },
    },
] as const satisfies readonly CliOptionItem[];
