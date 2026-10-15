import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type {
  EnvironmentLocalOverridesResponse,
  EnvironmentNoticesResponse,
  EnvironmentReviewResponse,
  EnvironmentStatusResponse,
} from "@traycer/protocol/host/environment-schemas";
import { useHostMethodSupport } from "@/hooks/host/use-host-supports-method";
import { useHostQuery } from "@/hooks/host/use-host-query";
import type { HostRpcRegistry } from "@/lib/host";

/*
 * A host's own environment reads, through the client the caller names: the
 * picked host on its Overview, the window's host on a Personal page. Each
 * answers `supported` from the host's handshake (`null` until it is known,
 * `false` for a version without the method) and the read's data, `null`
 * until it arrives. A read mounts only on a supported host.
 */

export interface EnvironmentRead<Data> {
  readonly supported: boolean | null;
  readonly data: Data | null;
  readonly isError: boolean;
}

/** `environment.status`, re-read while mounted at the cadence its policy declares. */
export function useEnvironmentStatusRead(
  client: HostClient<HostRpcRegistry> | null,
  hostId: string | null,
  enabled: boolean,
): EnvironmentRead<EnvironmentStatusResponse> {
  const supported = useHostMethodSupport(hostId, "environment.status");
  const query = useHostQuery<HostRpcRegistry, "environment.status">({
    cacheKeyIdentity: undefined,
    client,
    method: "environment.status",
    params: {},
    options: { enabled: enabled && supported === true, poll: true },
  });
  return { supported, data: query.data ?? null, isError: query.isError };
}

export function useEnvironmentNoticesRead(
  client: HostClient<HostRpcRegistry> | null,
  hostId: string | null,
  enabled: boolean,
): EnvironmentRead<EnvironmentNoticesResponse> {
  const supported = useHostMethodSupport(hostId, "environment.notices");
  const query = useHostQuery<HostRpcRegistry, "environment.notices">({
    cacheKeyIdentity: undefined,
    client,
    method: "environment.notices",
    params: {},
    options: { enabled: enabled && supported === true },
  });
  return { supported, data: query.data ?? null, isError: query.isError };
}

export function useEnvironmentReviewRead(
  client: HostClient<HostRpcRegistry> | null,
  hostId: string | null,
  enabled: boolean,
): EnvironmentRead<EnvironmentReviewResponse> {
  const supported = useHostMethodSupport(hostId, "environment.review");
  const query = useHostQuery<HostRpcRegistry, "environment.review">({
    cacheKeyIdentity: undefined,
    client,
    method: "environment.review",
    params: {},
    options: { enabled: enabled && supported === true },
  });
  return { supported, data: query.data ?? null, isError: query.isError };
}

export function useEnvironmentLocalOverridesRead(
  client: HostClient<HostRpcRegistry> | null,
  hostId: string | null,
  enabled: boolean,
): EnvironmentRead<EnvironmentLocalOverridesResponse> {
  const supported = useHostMethodSupport(hostId, "environment.localOverrides");
  const query = useHostQuery<HostRpcRegistry, "environment.localOverrides">({
    cacheKeyIdentity: undefined,
    client,
    method: "environment.localOverrides",
    params: {},
    options: { enabled: enabled && supported === true },
  });
  return { supported, data: query.data ?? null, isError: query.isError };
}
