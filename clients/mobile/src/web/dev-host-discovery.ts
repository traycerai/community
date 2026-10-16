import type {
  HostListFetchResult,
  RemoteHostFetcher,
  RemoteHostFetchOutcome,
} from "@traycer-clients/shared/host-client/remote-fetcher";

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

/** One selection-fleet row, as `MobileRunnerHost` publishes it. */
export interface DevFleetRow {
  readonly hostId: string;
  readonly sandbox: boolean;
}

export function buildDevHostDiscovery(
  devHostFetch: () => Promise<RemoteHostFetchOutcome>,
  _registry: DevHostRegistrySource,
): RemoteHostFetcher {
  return () => devHostFetch();
}

export function fleetRowsOf(
  outcome: RemoteHostFetchOutcome,
): readonly DevFleetRow[] | null {
  return outcome.kind === "hosts"
    ? outcome.entries.map((entry) => ({
        hostId: entry.hostId,
        sandbox: false,
      }))
    : null;
}
