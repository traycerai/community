import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "@/routeTree.gen";
import type { AppRouter } from "@/router";
import { useAuthStore } from "@/stores/auth/auth-store";
import type { EpicCanvasTileRef } from "@/stores/epics/canvas/types";
import {
  __resetSupportContextRegistryForTests,
  getSupportContextSnapshot,
} from "@/lib/support-context-registry";
import { SupportContextRegistryBridge } from "../support-context-registry-bridge";

/**
 * The bridge sits above every tab, so its `hostId` is the app-wide effective
 * host. A report from a chat tab bound to another host used to name the
 * default host and nothing else, which made "which machine was this chat on"
 * unanswerable from the report. `tabHostId` is the tab's own binding.
 */

const mocks = vi.hoisted(() => ({
  addressableHostId: "host-app-default" as string | null,
  activeRef: null as EpicCanvasTileRef | null,
}));

vi.mock("@/hooks/host/use-addressable-host-id", () => ({
  useAddressableHostId: () => mocks.addressableHostId,
}));

vi.mock("@/hooks/providers/use-providers-list-query", () => ({
  useProvidersList: () => ({ data: undefined, isError: false }),
}));

vi.mock("@/stores/epics/canvas/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/epics/canvas/store")>()),
  useActiveEpicId: () => "epic-1",
  useActiveTabId: () => "tab-1",
  useActiveEpicArtifactRef: () => mocks.activeRef,
}));

vi.mock("@/lib/registries/epic-session-registry", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/registries/epic-session-registry")
  >()),
  getOpenEpicRegistry: () => ({
    peek: () => null,
    subscribe: () => () => undefined,
  }),
}));

// A real router, never loaded: the bridge only reads `state`/`subscribe`, and
// the route template is not what these tests are about.
const ROUTER: AppRouter = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
  context: {
    queryClient: new QueryClient(),
    getAuthSnapshot: () => useAuthStore.getState(),
    getHostClient: () => null,
  },
});

function recordRef(
  type: "chat" | "terminal-agent" | "spec" | "ticket",
  hostId: string,
): EpicCanvasTileRef {
  return {
    id: `${type}-1`,
    instanceId: `instance-${type}`,
    type,
    name: type,
    hostId,
  };
}

afterEach(() => {
  cleanup();
  __resetSupportContextRegistryForTests();
  mocks.addressableHostId = "host-app-default";
  mocks.activeRef = null;
});

describe("SupportContextRegistryBridge tab host", () => {
  it("records the chat tab's own host beside the app-wide host", () => {
    mocks.activeRef = recordRef("chat", "host-tab-bound");

    render(<SupportContextRegistryBridge router={ROUTER} />);

    const snapshot = getSupportContextSnapshot();
    expect(snapshot.hostId).toEqual({
      status: "known",
      value: "host-app-default",
    });
    expect(snapshot.tabHostId).toEqual({
      status: "known",
      value: "host-tab-bound",
    });
  });

  it("records a terminal-agent tab's host the same way", () => {
    mocks.activeRef = recordRef("terminal-agent", "host-agent-bound");

    render(<SupportContextRegistryBridge router={ROUTER} />);

    expect(getSupportContextSnapshot().tabHostId).toEqual({
      status: "known",
      value: "host-agent-bound",
    });
  });

  it.each(["spec", "ticket"] as const)(
    "leaves the tab host unavailable for a %s tile, which carries a host but is not bound for life",
    (type) => {
      mocks.activeRef = recordRef(type, "host-doc");

      render(<SupportContextRegistryBridge router={ROUTER} />);

      expect(getSupportContextSnapshot().tabHostId).toEqual({
        status: "unavailable",
      });
    },
  );

  it("leaves the tab host unavailable when there is no active tile", () => {
    mocks.activeRef = null;

    render(<SupportContextRegistryBridge router={ROUTER} />);

    const snapshot = getSupportContextSnapshot();
    expect(snapshot.hostId).toEqual({
      status: "known",
      value: "host-app-default",
    });
    expect(snapshot.tabHostId).toEqual({ status: "unavailable" });
  });
});
