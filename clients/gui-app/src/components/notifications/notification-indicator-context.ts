import { createContext, use, useContext, useCallback } from "react";
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
  // The provider publishes at commit. A newly mounted consumer corrects a
  // changed snapshot synchronously before paint, without a mount-only update.
  const inherited =
    store === null ? use(NotificationIndicatorsContext) : EMPTY_INDICATORS;
  const hostState = useStoreWithEqualityFn(
    store ?? {
      getState: () => inherited,
      getInitialState: () => inherited,
      subscribe: emptySubscribe,
    },
    (indicators) => selectHostIndicatorState(indicators, entity, originHostId),
    shallow,
  );
  return useHostNotificationIndicatorState(entity, originHostId, hostState);
}

/** Seed a row's entry-pulse baseline after the provider's commit publication. */
export function useSurfaceNotificationWaitingProbe(
  entity: HostNotificationsEntityRef,
  originHostId: string | null,
): (() => boolean) | null {
  const store = useContext(NotificationIndicatorStoreContext);
  const { epicId, chatId } = entity;
  const readWaiting = useCallback(() => {
    if (store === null) return false;
    const state = selectHostIndicatorState(
      store.getState(),
      { epicId, chatId },
      originHostId,
    );
    return state.pendingApproval || state.pendingInterview;
  }, [store, epicId, chatId, originHostId]);
  return store === null ? null : readWaiting;
}
