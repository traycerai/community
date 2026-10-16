import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { basePersistOptions, persistKey, STORE_KEYS } from "@/lib/persist";

/**
 * The tasks whose mirror line each person has seen (ticket E17 checkpoint 5:
 * "once per task"), keyed by viewer and epic, valued by when it was seen.
 * Machine-local, like the feature announcements: one more showing on another
 * device is the cost of not syncing a hint. Capped, oldest out, so a person
 * who works in many tasks does not grow it without bound.
 */
export const COMPOSER_MIRROR_LINE_SEEN_CAP = 500;

type SeenRecord = Readonly<Record<string, number>>;

interface ComposerMirrorLineSeenState {
  readonly seen: SeenRecord;
  /** Record that this person has seen the line in this task. Idempotent. */
  readonly markSeen: (viewerUserId: string, epicId: string) => void;
}

function seenKey(viewerUserId: string, epicId: string): string {
  return `${viewerUserId}\u0000${epicId}`;
}

export function composerMirrorLineSeen(
  seen: SeenRecord,
  viewerUserId: string,
  epicId: string,
): boolean {
  return Object.hasOwn(seen, seenKey(viewerUserId, epicId));
}

function markInto(seen: SeenRecord, key: string, at: number): SeenRecord {
  if (Object.hasOwn(seen, key)) return seen;
  const entries = Object.entries(seen);
  const kept =
    entries.length < COMPOSER_MIRROR_LINE_SEEN_CAP
      ? entries
      : entries
          .toSorted((a, b) => a[1] - b[1])
          .slice(entries.length - COMPOSER_MIRROR_LINE_SEEN_CAP + 1);
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

export const useComposerMirrorLineSeenStore =
  create<ComposerMirrorLineSeenState>()(
    persist(
      (set) => ({
        seen: {},
        markSeen: (viewerUserId, epicId) => {
          set((state) => {
            const seen = markInto(
              state.seen,
              seenKey(viewerUserId, epicId),
              Date.now(),
            );
            return seen === state.seen ? state : { seen };
          });
        },
      }),
      {
        ...basePersistOptions(persistKey(STORE_KEYS.composerMirrorLineSeen)),
        storage: createJSONStorage(() => localStorage),
        merge: (persistedState, currentState) => ({
          ...currentState,
          seen: persistedSeen(persistedState),
        }),
        partialize: (state) => ({ seen: state.seen }),
      },
    ),
  );
