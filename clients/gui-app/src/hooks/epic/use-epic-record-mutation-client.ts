import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import { useEpicSessionHostClient } from "@/hooks/epic/use-epic-session-host-client";
import { useHostBinding } from "@/lib/host";
import { resolveNamedHostClient } from "@/lib/host/binding-host-client";
import { readLocalHostIdSnapshot } from "@/lib/host/local-host-id-snapshot";
import {
  readSelectionFleetSnapshot,
  routeOwnerGoneWrite,
} from "@/lib/host/owner-gone-write-routing";

export interface EpicRecordMutationTarget {
  readonly hostId: string | null;
}

export interface EpicRecordMutationContext extends EpicRecordMutationTarget {
  readonly viewerHostId: string | null;
}

/** Record writes follow their owner; the viewing epic may only hold a replica. */
export function useEpicRecordMutationClient(): (
  target: EpicRecordMutationTarget,
) => HostClient<HostRpcRegistry> | null {
  const sessionClient = useEpicSessionHostClient();
  const binding = useHostBinding();
  return ({ hostId }) => {
    if (hostId === null) return null;
    if (sessionClient?.getActiveHostId() === hostId) return sessionClient;
    return resolveNamedHostClient(binding, hostId);
  };
}

/**
 * Archive and delete of an agent record (`epic.setChatArchived`,
 * `epic.deleteChat`, `epic.deleteTuiAgent`, and the archive's read-back).
 *
 * Sent to the record's owner, like every record write, while the owner's
 * session can serve. When it cannot, the same call goes to a live host - the
 * epic's session host first, then this machine's host, then any other live host
 * of the account (`routeOwnerGoneWrite`) - which writes the change to the
 * cloud row and answers `outcome: "requested"`. With no live host the call
 * still goes to the owner and fails the way it always has.
 *
 * Rename is not on this path: only archive and delete have a cloud write a
 * host other than the owner may make.
 */
export function useEpicRecordLifecycleMutationClient(): (
  target: EpicRecordMutationTarget,
) => HostClient<HostRpcRegistry> | null {
  const sessionClient = useEpicSessionHostClient();
  const binding = useHostBinding();
  return ({ hostId }) => {
    if (hostId === null) return null;
    const route = routeOwnerGoneWrite({
      ownerHostId: hostId,
      fleet: readSelectionFleetSnapshot(),
      preferredHostIds: () => [
        sessionClient?.getActiveHostId() ?? null,
        readLocalHostIdSnapshot(),
      ],
    });
    if (sessionClient?.getActiveHostId() === route.hostId) return sessionClient;
    return resolveNamedHostClient(binding, route.hostId);
  };
}
