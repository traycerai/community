import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@/lib/host";

/**
 * Whether `harnessId` is one a team sandbox does not offer, on `hostId` when
 * that host is a team's (ticket E17 checkpoint 6, B5). Fails closed while the
 * host's catalog has not answered. `false` on any other host.
 */
export function useTeamSandboxHarnessBlocked(_input: {
  readonly hostId: string | null;
  readonly client: HostClient<HostRpcRegistry> | null;
  readonly harnessId: string | null;
}): boolean {
  return false;
}
