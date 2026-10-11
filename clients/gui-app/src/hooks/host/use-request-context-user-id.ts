import { useCallback, useSyncExternalStore } from "react";
import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type { VersionedRpcRegistry } from "@traycer/protocol/framework/index";

const NOT_SUBSCRIBED = (): void => undefined;

/**
 * The user a client may talk as, as a SUBSCRIBED value: null with no request
 * context, or with one whose credential was released.
 *
 * A render must not read this off the client and keep what it derives from
 * it. The client is one object for the app's life, so the React Compiler
 * caches anything computed from `client.getRequestContext...()` on the
 * client's identity, and a sign-out is never seen: a stream key stayed
 * non-null and its session was not released. `setRequestContext` announces
 * itself through `onChange`, which is what this subscribes to.
 */
export function useRequestContextUserId<Registry extends VersionedRpcRegistry>(
  client: HostClient<Registry> | null,
): string | null {
  const subscribe = useCallback(
    (listener: () => void) =>
      client === null ? NOT_SUBSCRIBED : client.onChange(listener),
    [client],
  );
  const getSnapshot = useCallback(
    () => client?.getRequestContextUserId() ?? null,
    [client],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
