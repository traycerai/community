import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAgentActivityStoreForTests,
  __setAgentActivityPlaneAnsweringForTests,
  __setAgentActivityStateForTests,
} from "@/stores/agent-activity-store";
import type { MergedNotificationRow } from "@/stores/notifications/merged-notifications";
import { useFocusModel } from "@/hooks/home-focus/use-focus-model";
import type { BuildFocusModelInput } from "@/lib/home-focus/build-focus-model";
import type { FocusModel } from "@/lib/home-focus/focus-model";

/**
 * How many times `useFocusModel` builds a model per input change.
 *
 * Its own file because the count is only meaningful when every collaborator
 * hands back the SAME object on every render. `use-focus-model.test.tsx` mocks
 * several of them to return a fresh object per call (the model reconciles that
 * away, which is what that suite relies on), and under such mocks the input
 * changes on every render and nothing here could be told apart from a rebuild.
 * Every mock below is built once, so the only thing that moves an input is what
 * a case changes.
 */
const { buildCountMock } = vi.hoisted(() => ({ buildCountMock: { calls: 0 } }));

vi.mock("@/lib/home-focus/build-focus-model", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/home-focus/build-focus-model")>();
  return {
    ...original,
    buildFocusModel: (input: BuildFocusModelInput, previous: FocusModel) => {
      buildCountMock.calls += 1;
      return original.buildFocusModel(input, previous);
    },
  };
});

const EMPTY_ROWS: ReadonlyArray<MergedNotificationRow> = [];

const { feedMock } = vi.hoisted(() => ({
  feedMock: { rows: [] as ReadonlyArray<MergedNotificationRow> },
}));

vi.mock("@/stores/notifications/merged-notifications", () => ({
  useMergedNotificationRows: () => feedMock.rows,
}));

vi.mock("@/lib/notifications/notification-feed-mode", () => ({
  useNotificationFeedMode: () => "local",
}));

const { stableMocks } = vi.hoisted(() => ({
  stableMocks: {
    taskContexts: {
      tasksById: new Map<string, { chatHostIds: ReadonlyArray<string> }>(),
      isFetching: false,
      error: null,
      refetch: () => Promise.resolve(),
      refetchBatches: [] as ReadonlyArray<unknown>,
    },
    indicators: { epics: {}, chats: {} },
    warmChats: [] as ReadonlyArray<unknown>,
    projection: {
      mountedEpicIds: new Set<string>(),
      liveTitles: new Map<string, string>(),
      agentIdentities: new Map<string, unknown>(),
    },
    connectableHosts: { hostIds: [] as readonly string[], resolved: true },
  },
}));

vi.mock("@/hooks/epic/use-epic-get-task-contexts-query", () => ({
  useEpicGetTaskContexts: () => stableMocks.taskContexts,
}));

vi.mock("@/hooks/notifications/use-notification-indicators-query", () => ({
  useNotificationIndicators: () => stableMocks.indicators,
}));

vi.mock("@/hooks/home-focus/use-warm-chat-background", () => ({
  useWarmChatBackground: () => stableMocks.warmChats,
}));

vi.mock("@/hooks/home-focus/use-mounted-epic-projection", () => ({
  useMountedEpicProjection: () => stableMocks.projection,
}));

vi.mock("@/hooks/host/use-effective-host-id", () => ({
  useEffectiveHostId: () => null,
}));

vi.mock("@/hooks/host/use-connectable-host-ids", () => ({
  useConnectableHostIds: () => stableMocks.connectableHosts,
}));

vi.mock("@/stores/auth/auth-store", () => ({
  useAuthStore: function useAuthStoreMock<T>(
    selector: (state: {
      contextMetadata: { userId: string; username: string } | null;
      status: string;
    }) => T,
  ): T {
    return selector({
      contextMetadata: { userId: "user-1", username: "user" },
      status: "signed-in",
    });
  },
  authorizesCloudCapability: (status: string): boolean =>
    status === "signed-in",
}));

beforeEach(() => {
  feedMock.rows = EMPTY_ROWS;
  __resetAgentActivityStoreForTests();
});

afterEach(() => {
  cleanup();
  __resetAgentActivityStoreForTests();
});

describe("useFocusModel - one build per input change", () => {
  it("builds exactly once for an input change that changes the model", () => {
    const { result } = renderHook(() => useFocusModel());
    const first = result.current;
    buildCountMock.calls = 0;

    act(() => {
      __setAgentActivityPlaneAnsweringForTests();
      __setAgentActivityStateForTests(
        { "epic-1": { working: ["agent-1"], turn: [] } },
        "local",
        "connected",
      );
    });

    // Storing the new model renders again, and that second render has to read
    // the model back rather than build it a second time to confirm it.
    expect(buildCountMock.calls).toBe(1);
    expect(result.current).not.toBe(first);
    expect(result.current.tasks[0]?.epicId).toBe("epic-1");
  });

  it("builds once for an input whose identity changes but whose content does not, and keeps the model", () => {
    const { result, rerender } = renderHook(() => useFocusModel());
    const first = result.current;
    buildCountMock.calls = 0;

    // A new, equal feed array: the input is rebuilt, the model is not.
    feedMock.rows = [...EMPTY_ROWS];
    rerender();

    expect(buildCountMock.calls).toBe(1);
    expect(result.current).toBe(first);
  });

  it("builds nothing for a re-render that changes no input", () => {
    const { rerender } = renderHook(() => useFocusModel());
    buildCountMock.calls = 0;

    rerender();

    expect(buildCountMock.calls).toBe(0);
  });
});
