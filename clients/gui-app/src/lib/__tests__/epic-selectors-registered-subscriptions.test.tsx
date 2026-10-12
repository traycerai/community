/**
 * The registered-epic hooks (`useRegistered*` in `epic-selectors.ts`) read an
 * open epic's live title, role and home through `useSyncExternalStore`, with a
 * `subscribe` written inline. React re-subscribes whenever that function's
 * identity changes, so an unstable one would tear down and re-attach the
 * registry and store listeners on every render of every consumer.
 *
 * This counts subscriptions across re-renders with the same epic id and
 * compares them with a control that subscribes through a stable function: each
 * hook must subscribe exactly as often as the control does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSyncExternalStore } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  useRegisteredEpicLocalHome,
  useRegisteredEpicPermissionRole,
  useRegisteredEpicTitle,
  useRegisteredEpicTitleGenerating,
} from "@/lib/epic-selectors";
import { getOpenEpicRegistry } from "@/lib/registries/epic-session-registry";
import { type EpicStreamClientFactory } from "@/stores/epics/open-epic/store";
import {
  openStoreForTest,
  type OpenedStoreForTest,
} from "@/stores/epics/open-epic/test-support/open-store-for-test";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";

const EPIC_ID = "epic-registered-subscriptions";
const RE_RENDERS = 5;

const noopStreamClientFactory: EpicStreamClientFactory = () => ({
  applyUpdate: () => undefined,
  awareness: () => undefined,
  applyArtifactRoomUpdate: () => undefined,
  artifactRoomAwareness: () => undefined,
  retryMigration: () => undefined,
  close: () => undefined,
});

function registerEpic(): OpenedStoreForTest {
  const handle = openStoreForTest({
    epicId: EPIC_ID,
    userId: null,
    factories: {
      streamClientFactory: noopStreamClientFactory,
      laneSelection: null,
    },
    writeCommand: null,
  });
  act(() => {
    getOpenEpicRegistry().acquireMounted(EPIC_ID, () => handle);
  });
  return handle;
}

interface Subscriptions {
  readonly registry: number;
  readonly store: number;
}

/** Mounts `useHook`, re-renders it with the same props, and counts. */
function countSubscriptions(
  handle: OpenedStoreForTest,
  useHook: (epicId: string) => unknown,
): Subscriptions {
  const registrySubscribe = vi.spyOn(getOpenEpicRegistry(), "subscribe");
  const storeSubscribe = vi.spyOn(handle.store, "subscribe");
  const view = renderHook(({ epicId }) => useHook(epicId), {
    initialProps: { epicId: EPIC_ID },
  });
  for (let render = 0; render < RE_RENDERS; render += 1) {
    view.rerender({ epicId: EPIC_ID });
  }
  const counts = {
    registry: registrySubscribe.mock.calls.length,
    store: storeSubscribe.mock.calls.length,
  };
  view.unmount();
  return counts;
}

/**
 * `useSyncExternalStore` readers whose `subscribe` never changes identity: one
 * on the registry plus one or two on the epic's store, the shapes of the hooks
 * under test.
 */
function makeControlHooks(handle: OpenedStoreForTest): {
  readonly oneStoreReader: (epicId: string) => unknown;
  readonly twoStoreReaders: (epicId: string) => unknown;
} {
  const registry = getOpenEpicRegistry();
  const subscribeRegistry = (listener: () => void): (() => void) =>
    registry.subscribe(listener);
  const subscribeStore = (listener: () => void): (() => void) =>
    handle.store.subscribe(listener);
  const read = (): number => 0;
  function useOneStoreReader(): null {
    useSyncExternalStore(subscribeRegistry, read, read);
    useSyncExternalStore(subscribeStore, read, read);
    return null;
  }
  function useTwoStoreReaders(): null {
    useSyncExternalStore(subscribeRegistry, read, read);
    useSyncExternalStore(subscribeStore, read, read);
    useSyncExternalStore(subscribeStore, read, read);
    return null;
  }
  return {
    oneStoreReader: useOneStoreReader,
    twoStoreReaders: useTwoStoreReaders,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  getOpenEpicRegistry().disposeAll();
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
});

describe("registered-epic hooks subscribe once per mount, not once per render", () => {
  it.each([
    {
      name: "useRegisteredEpicTitle",
      useHook: useRegisteredEpicTitle,
      storeReaders: 1,
    },
    {
      name: "useRegisteredEpicPermissionRole",
      useHook: useRegisteredEpicPermissionRole,
      storeReaders: 1,
    },
    {
      name: "useRegisteredEpicLocalHome",
      useHook: useRegisteredEpicLocalHome,
      storeReaders: 1,
    },
    {
      name: "useRegisteredEpicTitleGenerating",
      useHook: useRegisteredEpicTitleGenerating,
      storeReaders: 2,
    },
  ])("$name", ({ useHook, storeReaders }) => {
    const handle = registerEpic();
    const controls = makeControlHooks(handle);
    const control = countSubscriptions(
      handle,
      storeReaders === 1 ? controls.oneStoreReader : controls.twoStoreReaders,
    );
    // The control is React's own cost of mounting readers and re-rendering
    // them: one subscription per reader, however many renders follow.
    expect(control).toEqual({ registry: 1, store: storeReaders });
    vi.restoreAllMocks();

    expect(countSubscriptions(handle, useHook)).toEqual(control);
  });
});
