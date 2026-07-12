interface IOidEntry<TValue> {
  oid: string;
  value: TValue;
}

/**
 * Cache keyed by PR id and pinned to a git oid: a push changes the oid and
 * the stale entry naturally misses, so no explicit invalidation is needed.
 */
export class OidCache<TValue> {
  private readonly entries = new Map<string, IOidEntry<TValue>>();

  get(prId: string, oid: string): TValue | undefined {
    const entry = this.entries.get(prId);
    if (!entry || entry.oid !== oid) {
      return undefined;
    }
    return entry.value;
  }

  set(prId: string, oid: string, value: TValue): void {
    this.entries.set(prId, { oid, value });
  }

  delete(prId: string): void {
    this.entries.delete(prId);
  }
}

/**
 * OidCache for async loads: the in-flight promise is the cache entry, so
 * concurrent loads of the same (prId, oid) share one request. Failed loads
 * are evicted — the next load retries instead of replaying the rejection.
 */
export class AsyncOidCache<TValue> {
  private readonly cache = new OidCache<Promise<TValue>>();

  load(prId: string, oid: string, create: () => Promise<TValue>): Promise<TValue> {
    const cached = this.cache.get(prId, oid);
    if (cached) {
      return cached;
    }
    const promise = create();
    this.cache.set(prId, oid, promise);
    promise.catch(() => {
      // evict only if this promise is still the entry: a newer oid must survive a stale failure
      if (this.cache.get(prId, oid) === promise) {
        this.cache.delete(prId);
      }
    });
    return promise;
  }
}
