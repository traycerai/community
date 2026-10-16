/**
 * Task delete when the active host is down (issue #1628, design 4.6).
 *
 * `epic.batchDelete` goes to the active host while its lease can serve. When
 * it cannot, the call goes to a live host - this machine's host first, then any
 * other live host - carrying only the cloud-homed ids; the local-homed ones
 * exist on the down host alone and are refused with the offline notice.
 *
 * Real: the hook, `useHostMutation`, the `QueryClient`, the selection
 * authority store. Faked at their boundaries: the hosts (one client per host
 * id, recording what it was sent), the router, sonner, the worktree cleanup and
 * the host-error toast.
 */
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { HostLeaseSnapshot } from "@traycer-clients/shared/host-selection/selection-authority-contract";
import type { BatchDeleteResponse } from "@traycer/protocol/host/epic/unary-schemas";

const mocks = vi.hoisted(() => ({
  toastMessage: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
  toastGetToasts: vi.fn(() => []),
  toastFromHostError: vi.fn(),
  publishDeletedEpicNotification: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()),
  runWorktreeCleanup: vi.fn(() =>
    Promise.resolve({ removed: [], failed: [], uncertain: [] }),
  ),
}));

interface SentRequest {
  readonly hostId: string;
  readonly method: string;
  readonly params: { readonly ids: readonly string[] };
}

const hosts = vi.hoisted(() => {
  const state: {
    activeHostId: string;
    localHostId: string | null;
    sent: SentRequest[];
  } = { activeHostId: "active", localHostId: "this-machine", sent: [] };
  const clientFor = (hostId: string) => ({
    getActiveHostId: (): string => hostId,
    getRequestContextUserId: (): string => "user-1",
    request: (
      method: string,
      params: { readonly ids: readonly string[] },
    ): Promise<BatchDeleteResponse> => {
      state.sent.push({ hostId, method, params });
      return Promise.resolve({
        results: params.ids.map((taskId) => ({
          taskId,
          success: true,
          home: "cloud" as const,
        })),
      });
    },
  });
  return { state, clientFor };
});

vi.mock("sonner", () => ({
  toast: {
    message: mocks.toastMessage,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
    dismiss: mocks.toastDismiss,
    getToasts: mocks.toastGetToasts,
  },
}));

vi.mock("@/lib/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/host")>()),
  useHostClient: () => hosts.clientFor(hosts.state.activeHostId),
  useHostBinding: () => ({
    hostId: null,
    hostClient: { createRequesterForHostId: hosts.clientFor },
  }),
}));

vi.mock("@/lib/host/local-host-id-snapshot", () => ({
  readLocalHostIdSnapshot: () => hosts.state.localHostId,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
  useRouterState: (options: {
    readonly select: (state: {
      readonly location: { readonly pathname: string };
    }) => unknown;
  }) => options.select({ location: { pathname: "/epics" } }),
}));

vi.mock("@/lib/host/use-worktree-delete-stream-transport", () => ({
  useWorktreeDeleteStreamTransportFactory: () => () => null,
}));

vi.mock("@/lib/epics/run-worktree-cleanup", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/epics/run-worktree-cleanup")
  >()),
  runWorktreeCleanup: mocks.runWorktreeCleanup,
}));

vi.mock("@/lib/host-error-toast", () => ({
  toastFromHostError: mocks.toastFromHostError,
}));

vi.mock("@/lib/epics/deleted-epic-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/epics/deleted-epic-events")>()),
  publishDeletedEpicNotification: mocks.publishDeletedEpicNotification,
}));

import {
  OWNER_HOST_UNREACHABLE_NOTICE,
  routeEpicBatchDelete,
  useEpicBatchDelete,
  type BatchDeleteEpicVariables,
} from "@/hooks/epic/use-epic-batch-delete-mutation";
import { useSelectionAuthorityStore } from "@/stores/host/selection-authority-store";

function lease(
  hostId: string,
  status: "ready" | "connecting" | "dead",
): HostLeaseSnapshot {
  return status === "dead"
    ? { hostId, status, dead: { reason: "offline" } }
    : { hostId, status, dead: null };
}

function publishLeases(...leases: HostLeaseSnapshot[]): void {
  useSelectionAuthorityStore.setState({ attached: true, leases });
}

async function dispatch(variables: BatchDeleteEpicVariables): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => useEpicBatchDelete(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync(variables).catch(() => undefined);
  });
}

function offlineNotices(): number {
  return mocks.toastMessage.mock.calls.filter(
    (call) => call[0] === OWNER_HOST_UNREACHABLE_NOTICE,
  ).length;
}

beforeEach(() => {
  hosts.state.activeHostId = "active";
  hosts.state.localHostId = "this-machine";
  hosts.state.sent.length = 0;
  for (const mock of Object.values(mocks)) mock.mockClear();
});

afterEach(() => {
  cleanup();
  useSelectionAuthorityStore.getState().reset();
});

describe("Task delete while the active host is down", () => {
  it("goes to this machine's host first, with only the cloud-homed ids", async () => {
    publishLeases(
      lease("active", "dead"),
      lease("elsewhere", "ready"),
      lease("this-machine", "ready"),
    );

    await dispatch({
      ids: ["cloud-a", "local-b", "cloud-c"],
      localHomeIds: ["local-b"],
      worktreeCleanup: null,
    });

    expect(hosts.state.sent).toEqual([
      {
        hostId: "this-machine",
        method: "epic.batchDelete",
        params: { ids: ["cloud-a", "cloud-c"] },
      },
    ]);
    expect(offlineNotices()).toBe(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("2 epics deleted");
  });

  it("goes to another live host when this machine's host is not live", async () => {
    publishLeases(
      lease("active", "dead"),
      lease("this-machine", "connecting"),
      lease("elsewhere", "ready"),
    );

    await dispatch({
      ids: ["cloud-a"],
      localHomeIds: [],
      worktreeCleanup: null,
    });

    expect(hosts.state.sent.map((request) => request.hostId)).toEqual([
      "elsewhere",
    ]);
    expect(offlineNotices()).toBe(0);
  });

  it("sends nothing when every id is local-homed, and says why", async () => {
    publishLeases(lease("active", "dead"), lease("this-machine", "ready"));

    await dispatch({
      ids: ["local-a", "local-b"],
      localHomeIds: ["local-a", "local-b"],
      worktreeCleanup: null,
    });

    expect(hosts.state.sent).toEqual([]);
    expect(offlineNotices()).toBe(1);
    expect(mocks.toastFromHostError).not.toHaveBeenCalled();
    // The progress toast is taken down, never left spinning.
    expect(mocks.toastDismiss).toHaveBeenCalled();
  });

  it("does not try to remove the down host's worktrees", async () => {
    publishLeases(lease("active", "dead"), lease("this-machine", "ready"));

    await dispatch({
      ids: ["cloud-a"],
      localHomeIds: [],
      worktreeCleanup: {
        candidates: [{ worktreePath: "/wt/a", ownerEpicIds: ["cloud-a"] }],
      },
    });

    expect(hosts.state.sent.map((request) => request.hostId)).toEqual([
      "this-machine",
    ]);
    expect(mocks.runWorktreeCleanup).not.toHaveBeenCalled();
  });
});

describe("unchanged paths", () => {
  it("an active host that can serve takes every id, local-homed included", async () => {
    publishLeases(lease("active", "ready"), lease("this-machine", "ready"));

    await dispatch({
      ids: ["cloud-a", "local-b"],
      localHomeIds: ["local-b"],
      worktreeCleanup: null,
    });

    expect(hosts.state.sent).toEqual([
      {
        hostId: "active",
        method: "epic.batchDelete",
        params: { ids: ["cloud-a", "local-b"] },
      },
    ]);
    expect(offlineNotices()).toBe(0);
  });

  it("with no live host the call still goes to the active host", async () => {
    publishLeases(
      lease("active", "dead"),
      lease("this-machine", "dead"),
      lease("elsewhere", "connecting"),
    );

    await dispatch({
      ids: ["cloud-a", "local-b"],
      localHomeIds: ["local-b"],
      worktreeCleanup: null,
    });

    expect(hosts.state.sent.map((request) => request.hostId)).toEqual([
      "active",
    ]);
    expect(hosts.state.sent[0]?.params.ids).toEqual(["cloud-a", "local-b"]);
  });
});

describe("routeEpicBatchDelete", () => {
  const fleet = {
    authorityAttached: true,
    leases: [lease("active", "dead"), lease("elsewhere", "ready")],
  };

  it("splits on the row's home only when it falls back", () => {
    expect(
      routeEpicBatchDelete({
        activeHostId: "active",
        ids: ["a", "b"],
        localHomeIds: ["b"],
        fleet,
        localHostId: () => null,
      }),
    ).toEqual({
      kind: "fallback",
      hostId: "elsewhere",
      sentIds: ["a"],
      refusedIds: ["b"],
    });
  });

  it("is direct with no active host", () => {
    expect(
      routeEpicBatchDelete({
        activeHostId: null,
        ids: ["a"],
        localHomeIds: [],
        fleet,
        localHostId: () => null,
      }),
    ).toEqual({ kind: "direct", hostId: null, sentIds: ["a"], refusedIds: [] });
  });
});
