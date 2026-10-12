import { useSyncExternalStore } from "react";

/**
 * A module that is imported on demand and then read WITHOUT suspending.
 *
 * `React.lazy` keeps a module off the start path, but it cannot draw a loaded
 * module on the first frame. Its first render always suspends, even when the
 * module is already in the module cache (the import still resolves a
 * microtask later), so the fallback is committed, and React then holds the
 * content back until 300 ms after that fallback (its retry throttle). Measured
 * on react-dom 19.3: a `lazy()` over an already imported module showed its
 * content 303 to 311 ms after mount. Warming the chunk does not help, because
 * the wait is not for the chunk.
 *
 * Here the loaded value sits in a store. A reader that mounts after
 * {@link PreloadedModule.load} settled gets the value in its first render; one
 * that mounts earlier gets `null`, starts the load, and re-renders when it
 * lands. A failed import is thrown from the read, at render, as `lazy()` would
 * throw it, and it is not retried.
 */
export interface PreloadedModule<T> {
  /** Starts the import on the first call. It settles once the value can be read, and never rejects. */
  readonly load: () => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
  /** The loaded value, or `null` until it lands. Throws the import's failure. */
  readonly read: () => T | null;
}

export function preloadedModule<T>(
  importer: () => Promise<T>,
): PreloadedModule<T> {
  let loaded: { readonly value: T } | null = null;
  let failed: { readonly error: unknown } | null = null;
  let settled: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    load: () => {
      settled ??= importer().then(
        (value) => {
          loaded = { value };
          notify();
        },
        (error: unknown) => {
          failed = { error };
          notify();
        },
      );
      return settled;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => {
      if (failed !== null) throw failed.error;
      return loaded === null ? null : loaded.value;
    },
  };
}

/**
 * The module's value, or `null` while it loads.
 *
 * A reader that finds it missing starts the load in that render, as
 * `React.lazy` starts its import: an effect would start it only after the
 * render's commit, and on a cold start that is the whole first render of the
 * app later. `load` is idempotent, so a render React throws away costs
 * nothing.
 */
export function usePreloadedModule<T>(module: PreloadedModule<T>): T | null {
  const value = useSyncExternalStore(
    module.subscribe,
    module.read,
    module.read,
  );
  if (value === null) void module.load();
  return value;
}
