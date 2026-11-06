type StoredResponse = {
  bytes: Uint8Array;
  headers: [string, string][];
  storedAt: number;
  retryAt: number;
};

type CachedResult = { entry: StoredResponse; stale: boolean };
const marker = "X-Voluki-Blog-Stored-At";
const memoryBudget = 16 * 1024 * 1024;

// The edge cache retains a last successful version for outages. Freshness is
// checked separately, so its one-day retention never extends the normal 60s TTL.
export function createBlogCache(now: () => number = Date.now) {
  const memory = new Map<string, StoredResponse>();
  const pending = new Map<string, Promise<CachedResult>>();
  let memoryBytes = 0;

  const remember = (key: string, entry: StoredResponse) => {
    memoryBytes -= memory.get(key)?.bytes.byteLength ?? 0;
    memory.delete(key);
    memory.set(key, entry);
    memoryBytes += entry.bytes.byteLength;
    while (memoryBytes > memoryBudget || memory.size > 64) {
      const oldest = memory.keys().next().value!;
      memoryBytes -= memory.get(oldest)!.bytes.byteLength;
      memory.delete(oldest);
    }
  };
  const responseFor = (entry: StoredResponse) => new Response(entry.bytes.slice(), { headers: entry.headers });

  return {
    async get(
      key: string,
      load: (previous?: Response) => Promise<Response>,
      edge?: Cache,
      { freshSeconds = 60, retainSeconds = 86400 } = {}
    ): Promise<{ response: Response; stale: boolean }> {
      let entry = memory.get(key);
      if ((!entry || now() - entry.storedAt >= freshSeconds * 1000) && edge) {
        try {
          const saved = await edge.match(key);
          const storedAt = Number(saved?.headers.get(marker));
          if (saved && storedAt > 0 && (!entry || storedAt > entry.storedAt)) {
            const headers = new Headers(saved.headers);
            headers.delete(marker);
            headers.delete("Cache-Control");
            entry = { bytes: new Uint8Array(await saved.arrayBuffer()), headers: [...headers], storedAt, retryAt: 0 };
            remember(key, entry);
          }
        } catch { /* An unavailable edge cache must not prevent a GitHub read. */ }
      }
      const age = entry ? now() - entry.storedAt : Infinity;
      if (entry && (age < freshSeconds * 1000 || (age < retainSeconds * 1000 && now() < entry.retryAt))) {
        return { response: responseFor(entry), stale: age >= freshSeconds * 1000 };
      }

      let refresh = pending.get(key);
      if (!refresh) {
        const previous = entry;
        refresh = (async (): Promise<CachedResult> => {
          try {
            const result = await load(previous ? responseFor(previous) : undefined);
            if (!result.ok) throw new Error("Blog refresh failed.");
            const next: StoredResponse = {
              bytes: new Uint8Array(await result.arrayBuffer()),
              headers: [...result.headers], storedAt: now(), retryAt: 0
            };
            if (next.bytes.byteLength > 8 * 1024 * 1024) throw new Error("Blog cache entry is too large.");
            remember(key, next);
            if (edge) {
              try {
                const saved = responseFor(next);
                saved.headers.set(marker, String(next.storedAt));
                saved.headers.set("Cache-Control", `public, max-age=${retainSeconds}`);
                await edge.put(key, saved);
              } catch { /* The in-memory copy still serves this successful refresh. */ }
            }
            return { entry: next, stale: false };
          } catch (error) {
            if (!previous || now() - previous.storedAt >= retainSeconds * 1000) throw error;
            previous.retryAt = now() + 15000;
            console.warn("Blog refresh failed; serving the last successful cached version.");
            return { entry: previous, stale: true };
          } finally {
            pending.delete(key);
          }
        })();
        pending.set(key, refresh);
      }
      const result = await refresh;
      return { response: responseFor(result.entry), stale: result.stale };
    }
  };
}
