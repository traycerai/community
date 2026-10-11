import { useSyncExternalStore } from "react";
import { getThemeRevision, subscribeResolvedTheme } from "@/lib/theme-applier";

/** Updates only after the active palette has reached the CSS cascade. */
export function useThemeRevision(): number {
  return useSyncExternalStore(
    subscribeResolvedTheme,
    getThemeRevision,
    getThemeRevision,
  );
}

/**
 * A value read from the document cascade (`getComputedStyle`), rebuilt once
 * per theme revision and shared by every reader of that revision.
 *
 * The cascade is not something a render can depend on: a component that calls
 * `useThemeRevision()` and then reads `getComputedStyle` gets the read cached
 * by the React Compiler on whatever else it was computed from, and a
 * `useMemo` that only NAMES the revision keeps nothing, because the compiler
 * derives dependencies from what the body uses. So the read lives here, keyed
 * by the revision `theme-applier.ts` bumps each time it rewrites the tokens,
 * and a component takes the result as a subscribed value through
 * {@link useCascadeSnapshot}.
 */
export function createCascadeSnapshot<T>(read: () => T): () => T {
  let cached: { readonly revision: number; readonly value: T } | null = null;
  return () => {
    const revision = getThemeRevision();
    if (cached === null || cached.revision !== revision) {
      cached = { revision, value: read() };
    }
    return cached.value;
  };
}

/** Subscribes to a {@link createCascadeSnapshot} reader. */
export function useCascadeSnapshot<T>(snapshot: () => T): T {
  return useSyncExternalStore(subscribeResolvedTheme, snapshot, snapshot);
}
