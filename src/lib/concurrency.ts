
/**
 * Maps over an array with a concurrency limit.
 *
 * Error semantics: first-error rejection. The first failing mapper rejects the
 * returned promise, but in-flight sibling workers continue draining their
 * current item — there is no AbortSignal threaded through. Workers that have
 * not yet started a new item will exit early once the queue is exhausted, but
 * they will NOT abandon work already in progress. Callers that need true
 * cancellation should pass an AbortController through `mapper` themselves.
 *
 * @param items Array of items to map over
 * @param mapper Async function to apply to each item
 * @param concurrency Maximum number of concurrent executions
 * @returns Promise resolving to an array of results
 */
export async function pMap<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;

    const worker = async () => {
        while (index < items.length) {
            const i = index++;
            results[i] = await mapper(items[i], i);
        }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return results;
}

export type PSettledResult<R> =
    | { status: "fulfilled"; value: R }
    | { status: "rejected"; reason: unknown };

/**
 * Maps over an array with a concurrency limit, returning per-item settled
 * results instead of failing fast.
 *
 * Use this when a single failure should not abort sibling work but the caller
 * still wants to inspect (and re-throw) the errors after the batch completes.
 *
 * @param items Array of items to map over
 * @param mapper Async function to apply to each item
 * @param concurrency Maximum number of concurrent executions
 * @returns Per-item settled results in input order
 */
export async function pMapSettled<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    concurrency: number
): Promise<PSettledResult<R>[]> {
    const results: PSettledResult<R>[] = new Array(items.length);
    let index = 0;

    const worker = async () => {
        while (index < items.length) {
            const i = index++;
            try {
                const value = await mapper(items[i], i);
                results[i] = { status: "fulfilled", value };
            } catch (reason) {
                results[i] = { status: "rejected", reason };
            }
        }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return results;
}
