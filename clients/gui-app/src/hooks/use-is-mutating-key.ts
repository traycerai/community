import { useCallback, useSyncExternalStore } from "react";
import {
  notifyManager,
  useQueryClient,
  type MutationKey,
} from "@tanstack/react-query";

/**
 * Whether a mutation under `mutationKey` is in flight, for a key that can
 * CHANGE while the caller is mounted.
 *
 * TanStack's `useIsMutating` keeps its last count and recounts only when the
 * mutation cache emits. A changed key is therefore answered with the PREVIOUS
 * key's count until some mutation starts or settles, so a control goes dead,
 * or stays live, for the wrong chat, host or profile. It went unseen while
 * every render handed `useMutation` a new options object, which made the
 * cache emit on each render; a compiled caller keeps that object.
 *
 * This reads the cache for the CURRENT key on every render and on every cache
 * event. `exact` is TanStack's own: `false` matches the key as a prefix.
 */
export function useIsMutatingKey(
  mutationKey: MutationKey,
  exact: boolean,
): boolean {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) =>
      queryClient
        .getMutationCache()
        .subscribe(notifyManager.batchCalls(listener)),
    [queryClient],
  );
  const getSnapshot = useCallback(
    () => queryClient.isMutating({ mutationKey, exact }) > 0,
    [queryClient, mutationKey, exact],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
