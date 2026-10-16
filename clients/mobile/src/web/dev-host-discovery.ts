import {
  hostListItemToDirectoryEntry,
  isRemoteHostDirectoryEntry,
  type HostListFetchResult,
  type RemoteHostFetcher,
  type RemoteHostFetchOutcome,
} from "@traycer-clients/shared/host-client/remote-fetcher";
import type { FleetHostRow } from "../mobile-runner-host";

// The baked dev host captures the port as of Vite startup, which goes stale
// whenever the dev host restarts; the dev-server endpoint re-reads the host's
// pid.json per request, so each directory refresh gets the live port.
// BROWSER-TESTING SCAFFOLDING (dev entry only): a shipped build carries no
// `devHost` and uses real remote-host discovery instead (see below).
export function buildDevHostFetcher(
  devHost: TraycerMobileDevHost,
): () => Promise<RemoteHostFetchOutcome> {
  // The baked config predates the directory's dialability field; the dev
  // host is a loopback WebSocket, which is the definition of dialable.
  const bakedHost: RemoteHostFetchOutcome = {
    kind: "hosts",
    entries: [{ ...devHost.host, transportDialability: "dialable" }],
  };
  return async () => {
    try {
      const response = await fetch(devHost.devHostPath);
      if (!response.ok) return bakedHost;
      const parsed: unknown = await response.json();
      if (parsed === null || typeof parsed !== "object") return bakedHost;
      const record = parsed as Record<string, unknown>;
      const { hostId, version, websocketUrl } = record;
      if (
        typeof hostId !== "string" ||
        typeof version !== "string" ||
        typeof websocketUrl !== "string"
      ) {
        return bakedHost;
      }
      return {
        kind: "hosts",
        entries: [
          {
            ...devHost.host,
            hostId,
            version,
            websocketUrl,
            transportDialability: "dialable",
          },
        ],
      };
    } catch {
      // The baked entry, not `failed`: this scaffolding's whole point is that
      // the dev host is reachable at a known port even when the pid re-read
      // misses.
      return bakedHost;
    }
  };
}

/** Where the dev entry's discovery reads the account's host registry. */
export interface DevHostRegistrySource {
  /** The stored sign-in's bearer, or `null` while signed out. */
  readonly bearerToken: () => Promise<string | null>;
  /** `GET /api/v3/hosts?include=sandboxState,owner` under that bearer. */
  readonly listRegisteredHosts: (
    bearerToken: string,
  ) => Promise<HostListFetchResult>;
  /** The relay every remote entry is dialed through. */
  readonly relayBaseUrl: string;
}

/**
 * The dev entry's directory discovery: the loopback dev host ADDED to the
 * account's registry hosts, never in place of them (finding F25). Replacing
 * them left every account host - a connectable sandbox included - without a
 * directory entry, so no picker could select it.
 *
 * Signed out (or no stored bearer) it is the dev host alone, as before. A
 * failed registry read is `failed`, so the directory keeps its last-known
 * list rather than dropping every remote host on a blip. The dev host's own
 * registry twin is dropped: the loopback entry is the one the browser dials.
 */
export function buildDevHostDiscovery(
  devHostFetch: () => Promise<RemoteHostFetchOutcome>,
  registry: DevHostRegistrySource,
): RemoteHostFetcher {
  return async (era) => {
    if (era.identity === null) return devHostFetch();
    return readDevHostDiscovery(devHostFetch, registry);
  };
}

/**
 * One discovery read, for the directory (behind its era check above) and for
 * the selection fleet (whose caller fences the account itself).
 */
export async function readDevHostDiscovery(
  devHostFetch: () => Promise<RemoteHostFetchOutcome>,
  registry: DevHostRegistrySource,
): Promise<RemoteHostFetchOutcome> {
  const dev = await devHostFetch();
  const bearerToken = await registry.bearerToken();
  if (bearerToken === null) return dev;
  const listed = await registry.listRegisteredHosts(bearerToken);
  if (listed.kind !== "ok") return { kind: "failed" };
  const devEntries = dev.kind === "hosts" ? dev.entries : [];
  const devHostIds = new Set(devEntries.map((entry) => entry.hostId));
  return {
    kind: "hosts",
    entries: [
      ...devEntries,
      ...listed.response.hosts
        .filter((item) => !devHostIds.has(item.hostId))
        .map((item) =>
          hostListItemToDirectoryEntry(item, registry.relayBaseUrl),
        ),
    ],
  };
}

/**
 * The selection fleet for the same discovery, so Activate accepts every host
 * the directory lists (F14 refuses one outside the fleet). A remote entry
 * carrying sandbox facts is a sandbox; the loopback dev host is not.
 */
export function fleetRowsOf(
  outcome: RemoteHostFetchOutcome,
): readonly FleetHostRow[] | null {
  return outcome.kind === "hosts"
    ? outcome.entries.map((entry) => ({
        hostId: entry.hostId,
        sandbox: isRemoteHostDirectoryEntry(entry) && entry.sandbox !== null,
      }))
    : null;
}
