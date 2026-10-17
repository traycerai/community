import type { UseQueryResult } from "@tanstack/react-query";
import type { ProvidersSettingsFileStatusResponse } from "@traycer/protocol/host/provider-settings-file/contracts";
import type { HostRpcError } from "@traycer-clients/shared/host-transport/host-messenger";
import { useHostClient } from "@/lib/host";
import { useHostQuery } from "@/hooks/host/use-host-query";

// Stable params identity so the host-scoped query key stays referentially
// constant across renders.
const SETTINGS_FILE_STATUS_PARAMS = {};

/**
 * Whether the scoped host's provider settings document is unusable AS A WHOLE
 * - the one state the Providers panel offers "Reset provider settings" for.
 *
 * Needed beside `providers.list` because that list does not fail in this
 * state: a document whose bytes do not parse is answered with every provider
 * at its default, which looks exactly like a user who switched them off. Only
 * a READ fault fails the list (see `isProviderSettingsUnreadableError`).
 *
 * An OPTIONAL capability; `enabled` is the caller's
 * `useHostSupportsMethod(hostId, "providers.settingsFile.status")`, so a host
 * that predates the reset is never asked. Read on mount and on focus, no
 * poll: the state it reports comes from a file going bad, not from anything
 * this panel does, and the reset invalidates it.
 */
export function useProvidersSettingsFileStatus(
  enabled: boolean,
): UseQueryResult<ProvidersSettingsFileStatusResponse, HostRpcError> {
  const client = useHostClient();
  return useHostQuery({
    cacheKeyIdentity: undefined,
    client,
    method: "providers.settingsFile.status",
    params: SETTINGS_FILE_STATUS_PARAMS,
    options: { enabled, refetchOnMount: "always" },
  });
}
