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

  peek(prId: string): TValue | undefined {
    return this.entries.get(prId)?.value;
  }

  delete(prId: string): void {
    this.entries.delete(prId);
  }
}
