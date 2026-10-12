import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  NotificationIndicatorsContext,
  NotificationIndicatorStoreContext,
  type ReadonlyIndicatorsStore,
} from "@/components/notifications/notification-indicator-context";
import type { SurfaceNotificationIndicators } from "@/stores/notifications/notification-indicator-state";

interface NotificationIndicatorsProviderProps {
  readonly indicators: SurfaceNotificationIndicators;
  readonly children: ReactNode;
}

interface IndicatorsStore extends ReadonlyIndicatorsStore {
  readonly publish: (next: SurfaceNotificationIndicators) => void;
}

function createIndicatorsStore(
  initial: SurfaceNotificationIndicators,
): IndicatorsStore {
  let state = initial;
  const listeners = new Set<
    (
      state: SurfaceNotificationIndicators,
      previous: SurfaceNotificationIndicators,
    ) => void
  >();
  return {
    getState: () => state,
    getInitialState: () => initial,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (next) => {
      if (state === next) return;
      const previous = state;
      state = next;
      for (const listener of listeners) listener(state, previous);
    },
  };
}

export function NotificationIndicatorsProvider(
  props: NotificationIndicatorsProviderProps,
): ReactNode {
  const [store] = useState(() => createIndicatorsStore(props.indicators));
  useLayoutEffect(() => {
    store.publish(props.indicators);
  }, [store, props.indicators]);
  return (
    <NotificationIndicatorStoreContext.Provider value={store}>
      <NotificationIndicatorsContext.Provider value={props.indicators}>
        {props.children}
      </NotificationIndicatorsContext.Provider>
    </NotificationIndicatorStoreContext.Provider>
  );
}
