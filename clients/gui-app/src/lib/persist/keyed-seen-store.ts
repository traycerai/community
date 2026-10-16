import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { basePersistOptions } from "@/lib/persist/persist-options";
import { installCrossWindowRehydrate } from "@/lib/persist/cross-window-rehydrate";

/**
 * A once-per-person notice's memory: which (viewer, subject) pairs have seen
 * it, valued by when. Machine-local, capped (oldest out), re-read from
 * storage before every write so another window's marks survive, and
 * following other windows' writes. The shape the mirror line's store has
 * (`composer-mirror-line-seen-store.ts`), for the notices after it.
 */
export type SeenRecord = Readonly<Record<string, number>>;

export interface KeyedSeenState {
  readonly seen: SeenRecord;
  /** Record that this viewer has seen the notice for this subject. */
  readonly markSeen: (viewerUserId: string, subject: string) => void;
}

function seenKey(viewerUserId: string, subject: string): string {
  return `${viewerUserId}\u0000${subject}`;
}

export function keyedSeen(
  seen: SeenRecord,
  viewerUserId: string,
  subject: string,
): boolean {
  return Object.hasOwn(seen, seenKey(viewerUserId, subject));
}

function markInto(
  seen: SeenRecord,
  key: string,
  at: number,
  cap: number,
): SeenRecord {
  if (Object.hasOwn(seen, key)) return seen;
  const entries = Object.entries(seen);
  const kept =
    entries.length < cap
      ? entries
      : entries.toSorted((a, b) => a[1] - b[1]).slice(entries.length - cap + 1);
  return { ...Object.fromEntries(kept), [key]: at };
}

/** Only finite timestamps survive: a corrupt entry reads as unseen. */
function persistedSeen(persistedState: unknown): SeenRecord {
  if (typeof persistedState !== "object" || persistedState === null) return {};
  if (!("seen" in persistedState)) return {};
  const seen = persistedState.seen;
  if (typeof seen !== "object" || seen === null) return {};
  const next: Record<string, number> = {};
  for (const [key, at] of Object.entries(seen)) {
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    next[key] = at;
  }
  return next;
}

// The store's type is zustand's own persisted-store type, inferred.
export function createKeyedSeenStore(storageKey: string, cap: number) {
  const store = create<KeyedSeenState>()(
    persist(
      (set, get, api) => ({
        seen: {},
        markSeen: (viewerUserId, subject) => {
          // A synchronous storage rehydrates inline: this write keeps what
          // another window marked since this one hydrated.
          void api.persist.rehydrate();
          const current = get().seen;
          const seen = markInto(
            current,
            seenKey(viewerUserId, subject),
            Date.now(),
            cap,
          );
          if (seen !== current) set({ seen });
        },
      }),
      {
        ...basePersistOptions(storageKey),
        storage: createJSONStorage(() => localStorage),
        merge: (persistedState, currentState) => ({
          ...currentState,
          seen: persistedSeen(persistedState),
        }),
        partialize: (state) => ({ seen: state.seen }),
      },
    ),
  );
  installCrossWindowRehydrate(store, storageKey);
  return store;
}
