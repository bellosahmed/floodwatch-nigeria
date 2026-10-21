// Keep serving the last good answer when a data source goes down, and say so.
// The free forecast API has no uptime guarantee and has returned 503s, so a short outage should show slightly
// older data with a clear notice, not an empty page. This memory is per server instance and is lost on restart.

export type Fresh<T> = {
  value: T;
  stale: boolean; // true when the source failed and this is an earlier answer
  asOf: string; // ISO time the value was actually fetched
};

const cache = new Map<string, { value: unknown; at: number }>();

/** Run `load`. If it throws and an answer younger than `maxAgeMs` is remembered, return that instead. */
export async function withLastGood<T>(key: string, maxAgeMs: number, load: () => Promise<T>, now = Date.now): Promise<Fresh<T>> {
  try {
    const value = await load();
    cache.set(key, { value, at: now() });
    return { value, stale: false, asOf: new Date(now()).toISOString() };
  } catch (err) {
    const hit = cache.get(key);
    if (hit && now() - hit.at <= maxAgeMs) {
      console.warn(`[lastgood] ${key} failed (${err instanceof Error ? err.message : err}); serving data from ${new Date(hit.at).toISOString()}`);
      return { value: hit.value as T, stale: true, asOf: new Date(hit.at).toISOString() };
    }
    throw err;
  }
}

/** For tests. */
export const clearLastGood = () => cache.clear();
