import { isRemoteHostDirectoryEntry } from "@traycer-clients/shared/host-client/remote-fetcher";
import { useHostDirectoryEntry } from "@/hooks/host/use-host-directory-entry";

/**
 * Whether a host is a team's sandbox, from the person's host directory (the
 * registry `owner`). `false` while the directory cannot say.
 */
export function useOnTeamSandbox(hostId: string | null): boolean {
  const entry = useHostDirectoryEntry(hostId);
  if (entry === null || !isRemoteHostDirectoryEntry(entry)) return false;
  return entry.sandbox !== null && entry.sandbox.ownerTeamId !== null;
}
