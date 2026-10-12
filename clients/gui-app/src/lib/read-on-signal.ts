/**
 * A read of something React cannot see (a query cache, a registry, a mutable
 * service), valid for `signals`: values that change when that source does.
 *
 * Wrap the read itself with it, inside a `useMemo` or `useCallback`:
 *
 * ```ts
 * useMemo(
 *   () => readOnSignal(() => scanCache(client, ids), page),
 *   [client, ids, page],
 * );
 * ```
 *
 * It replaces naming the signal as a bare statement (`void page;`). That
 * satisfies `exhaustive-deps` and nothing else: the React Compiler derives a
 * memo's dependencies from what its body uses, deletes the statement, and the
 * memo then keeps its first answer for as long as its other inputs hold. A
 * call beside the read is not enough either, the compiler caches the two
 * apart. A signal passed here is an argument of the call that PRODUCES the
 * value, so the cached value depends on it.
 *
 * Prefer a subscription whose snapshot is the value, or taking the changed
 * data itself as an argument, wherever the source allows it. This is for a
 * source that only says "something changed".
 */
export function readOnSignal<T>(
  read: () => T,
  ..._signals: ReadonlyArray<unknown>
): T {
  return read();
}
