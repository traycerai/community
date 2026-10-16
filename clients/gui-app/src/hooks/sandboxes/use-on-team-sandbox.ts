import { useCallback, useSyncExternalStore } from "react";
import {
  readHostDirectoryEntry,
  subscribeHostRowChanged,
} from "@traycer-clients/shared/host-client/host-connection-registry";
import { isRemoteHostDirectoryEntry } from "@traycer-clients/shared/host-client/remote-fetcher";

/**
 * Whether a host is a team's sandbox, from the person's host directory (the
 * registry `owner`). `false` while the directory cannot say. Read through the
 * context-free registry, since the picker also renders where no host runtime
 * is mounted.
 */
export function useOnTeamSandbox(hostId: string | null): boolean {
  const subscribe = useCallback(
    (callback: () => void) =>
      hostId === null
        ? () => undefined
        : subscribeHostRowChanged(hostId, callback),
    [hostId],
  );
  const getSnapshot = useCallback(() => {
    if (hostId === null) return false;
    const entry = readHostDirectoryEntry(hostId);
    if (entry === null || !isRemoteHostDirectoryEntry(entry)) return false;
    return entry.sandbox !== null && entry.sandbox.ownerTeamId !== null;
  }, [hostId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
