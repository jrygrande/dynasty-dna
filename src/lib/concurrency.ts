
/**
 * Maps over an array with a concurrency limit.
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
            try {
                results[i] = await mapper(items[i], i);
            } catch (err) {
                throw err; // Fail fast
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
