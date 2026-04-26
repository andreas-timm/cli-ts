import {
    parsePositiveInteger,
    processCommandRawOptions,
} from "@andreas-timm/cli";

type SyncOptions = {
    retry?: string | number;
};

export async function runSync(rawOptions: Record<string, unknown>) {
    const options = processCommandRawOptions<SyncOptions>(rawOptions);
    const _retryCount = parsePositiveInteger(options.retry, "retry count");
    // Run sync logic with _retryCount.
}
