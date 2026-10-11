import {
  createContext,
  use,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import type { StoreApi } from "zustand/vanilla";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/shallow";
import type { HostNotificationsEntityRef } from "@traycer/protocol/host/notifications/contracts";
import {
  selectHostIndicatorState,
  useHostNotificationIndicatorState,
  type NotificationIndicatorState,
  type SurfaceNotificationIndicators,
} from "@/stores/notifications/notification-indicator-state";

const EMPTY_INDICATORS: SurfaceNotificationIndicators = {
  epics: {},
  chats: {},
};

/** What a consumer needs of the provider's store: to read it and to hear of a change. */
export type ReadonlyIndicatorsStore = Pick<
  StoreApi<SurfaceNotificationIndicators>,
  "getState" | "getInitialState" | "subscribe"
>;

export const NotificationIndicatorsContext =
  createContext<SurfaceNotificationIndicators>(EMPTY_INDICATORS);

export const NotificationIndicatorStoreContext =
  createContext<ReadonlyIndicatorsStore | null>(null);

const emptySubscribe = () => () => undefined;

export function useSurfaceNotificationIndicatorState(
  entity: HostNotificationsEntityRef,
  originHostId: string | null,
): NotificationIndicatorState {
  const store = useContext(NotificationIndicatorStoreContext);
  const [committed, setCommitted] = useState(false);
  useLayoutEffect(() => {
    setCommitted(true);
  }, []);
  // A newly mounted row reads this render's context so its initial waiting
  // pulse sees the current flags. After commit it subscribes only to its
  // entity in the store; speculative provider renders cannot mutate that store.
  const readInherited = store === null || !committed;
  const inherited = readInherited
    ? use(NotificationIndicatorsContext)
    : EMPTY_INDICATORS;
  const hostState = useStoreWithEqualityFn(
    store ?? {
      getState: () => inherited,
      getInitialState: () => inherited,
      subscribe: emptySubscribe,
    },
    (indicators) => selectHostIndicatorState(indicators, entity, originHostId),
    shallow,
  );
  return useHostNotificationIndicatorState(
    entity,
    originHostId,
    readInherited
      ? selectHostIndicatorState(inherited, entity, originHostId)
      : hostState,
  );
}
