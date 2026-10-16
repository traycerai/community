/**
 * Archive and delete of an agent whose host is gone (issue #1628).
 *
 * The record names its owner; when the selection authority's lease says that
 * owner cannot serve, the same RPC goes to a live host instead, and the copy is
 * driven by the RECEIVING host's `outcome` - never by where the call was
 * routed. The host side is simulated by the handlers below: a host enacts a
 * write on a record it owns (`applied`) and writes the cloud row for one it
 * does not (`requested`).
 *
 * Real: the hooks, `useHostMutation`, a `HostClient` over `MockHostMessenger`,
 * the `QueryClient`, the selection-authority store. Faked: sonner and the
 * binding seam (`useHostBinding`), as the neighbouring routing suites do.
 */
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HostClient } from "@traycer-clients/shared/host-client/host-client";
import { MockHostMessenger } from "@traycer-clients/shared/host-client/mock/mock-host-messenger";
import {
  mockInProcessHostEntry,
  mockLocalHostEntry,
  mockRemoteHostEntry,
} from "@traycer-clients/shared/host-client/mock/mock-host-directory";
import { createRequestContextFixture } from "@traycer-clients/shared/test-fixtures/request-context";
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import type { HostLeaseSnapshot } from "@traycer-clients/shared/host-selection/selection-authority-contract";
import {
  hostRpcRegistry,
  type HostRpcRegistry,
} from "@traycer/protocol/host/index";
import {
  useEpicArchiveChat,
  useEpicDeleteChat,
} from "@/hooks/epic/use-epic-chat-mutations";
import { useEpicDeleteTuiAgent } from "@/hooks/epic/use-epic-tui-agent-mutations";
import { EpicSessionHostClientContext } from "@/lib/registries/epic-session-registry";
import { createHostQueryInvalidator } from "@/lib/host/query-invalidator";
import { useSelectionAuthorityStore } from "@/stores/host/selection-authority-store";
import { useAuthStore } from "@/stores/auth/auth-store";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { toast } from "sonner";

const SESSION = mockLocalHostEntry;
const OWNER = mockRemoteHostEntry;
const OTHER = mockInProcessHostEntry;
const DIRECTORY: readonly HostDirectoryEntry[] = [SESSION, OWNER, OTHER];
const EPIC_ID = "epic-owner-gone";
const VIEWER_ID = "viewer-owner-gone";
const CHAT_ID = "chat-on-owner";
const TUI_ID = "tui-on-owner";

const spineRef = vi.hoisted<{
  value: HostClient<HostRpcRegistry> | null;
}>(() => ({ value: null }));

vi.mock("@/lib/host/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/host/runtime")>()),
  useHostBinding: () =>
    spineRef.value === null
      ? null
      : { hostClient: spineRef.value, hostId: null },
}));

vi.mock("@/lib/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/host")>()),
  useHostBinding: () =>
    spineRef.value === null
      ? null
      : { hostClient: spineRef.value, hostId: null },
}));

interface Call {
  readonly method: string;
  readonly hostId: string;
}

interface Fixture {
  readonly calls: Call[];
  /** The host that runs both records, as the HOSTS see it. */
  ownerAsHostsSeeIt: string;
  readonly wrapper: (props: { readonly children: ReactNode }) => ReactNode;
  readonly dispose: () => void;
}

function lastCallHost(messenger: MockHostMessenger<HostRpcRegistry>): string {
  const last = messenger.calls.at(-1);
  if (last === undefined) throw new Error("expected a host messenger call");
  return last.authority.endpoint.hostId;
}

function createFixture(): Fixture {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const calls: Call[] = [];
  const state = { ownerAsHostsSeeIt: OWNER.hostId };
  const messengerRef: { current: MockHostMessenger<HostRpcRegistry> | null } = {
    current: null,
  };
  const outcomeOn = (hostId: string): "applied" | "requested" =>
    hostId === state.ownerAsHostsSeeIt ? "applied" : "requested";
  let seq = 0;
  const messenger = new MockHostMessenger<HostRpcRegistry>({
    registry: hostRpcRegistry,
    requestId: () => {
      seq += 1;
      return `owner-gone-${String(seq)}`;
    },
    handlers: {
      "epic.listChatRecords": () => {
        const hostId = lastCallHost(messengerRef.current ?? messenger);
        calls.push({ method: "epic.listChatRecords", hostId });
        return { kind: "snapshot" as const, listStamp: null, chats: [] };
      },
      "epic.setChatArchived": () => {
        const hostId = lastCallHost(messengerRef.current ?? messenger);
        calls.push({ method: "epic.setChatArchived", hostId });
        return { updated: true, outcome: outcomeOn(hostId) };
      },
      "epic.deleteChat": () => {
        const hostId = lastCallHost(messengerRef.current ?? messenger);
        calls.push({ method: "epic.deleteChat", hostId });
        return {
          deleted: true,
          publicationChatId: CHAT_ID,
          outcome: outcomeOn(hostId),
        };
      },
      "epic.deleteTuiAgent": () => {
        const hostId = lastCallHost(messengerRef.current ?? messenger);
        calls.push({ method: "epic.deleteTuiAgent", hostId });
        return { deleted: true, outcome: outcomeOn(hostId) };
      },
    },
  });
  messengerRef.current = messenger;
  const spine = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    invalidator: createHostQueryInvalidator(queryClient),
    findHostById: (hostId) =>
      DIRECTORY.find((entry) => entry.hostId === hostId) ?? null,
    messenger,
  });
  spine.setRequestContext(
    createRequestContextFixture({
      origin: "renderer",
      bearerToken: "owner-gone-token",
    }),
  );
  spineRef.value = spine;
  const sessionClient = spine.createRequester(SESSION);
  const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
    <QueryClientProvider client={queryClient}>
      <EpicSessionHostClientContext.Provider value={sessionClient}>
        {props.children}
      </EpicSessionHostClientContext.Provider>
    </QueryClientProvider>
  );
  return {
    calls,
    get ownerAsHostsSeeIt() {
      return state.ownerAsHostsSeeIt;
    },
    set ownerAsHostsSeeIt(value: string) {
      state.ownerAsHostsSeeIt = value;
    },
    wrapper,
    dispose: () => {
      spine.dispose();
      spineRef.value = null;
    },
  };
}

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

function writeCalls(): Call[] {
  return fixture.calls.filter((call) => call.method !== "epic.listChatRecords");
}

let fixture: Fixture;

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  useAuthStore.getState().setSignedIn(
    {
      userId: VIEWER_ID,
      userName: VIEWER_ID,
      email: `${VIEWER_ID}@example.com`,
    },
    { userId: VIEWER_ID, username: VIEWER_ID },
    [],
  );
  fixture = createFixture();
});

afterEach(() => {
  cleanup();
  fixture.dispose();
  useSelectionAuthorityStore.getState().reset();
  useAuthStore.getState().setSignedOut();
});

async function archive(archived: boolean): Promise<void> {
  const { result } = renderHook(() => useEpicArchiveChat(), {
    wrapper: fixture.wrapper,
  });
  await act(async () => {
    await result.current.mutateAsync({
      epicId: EPIC_ID,
      chatId: CHAT_ID,
      hostId: OWNER.hostId,
      archived,
    });
  });
}

async function deleteChat(): Promise<void> {
  const { result } = renderHook(() => useEpicDeleteChat(), {
    wrapper: fixture.wrapper,
  });
  await act(async () => {
    await result.current.mutateAsync({
      epicId: EPIC_ID,
      chatId: CHAT_ID,
      hostId: OWNER.hostId,
    });
  });
}

async function deleteTuiAgent(): Promise<void> {
  const { result } = renderHook(() => useEpicDeleteTuiAgent(), {
    wrapper: fixture.wrapper,
  });
  await act(async () => {
    await result.current.mutateAsync({
      epicId: EPIC_ID,
      tuiAgentId: TUI_ID,
      hostId: OWNER.hostId,
    });
  });
}

function successToasts(): unknown[] {
  return vi.mocked(toast.success).mock.calls.map((call) => call[0]);
}

describe("owner session down -> a live host takes the write", () => {
  beforeEach(() => {
    publishLeases(
      lease(SESSION.hostId, "ready"),
      lease(OWNER.hostId, "dead"),
      lease(OTHER.hostId, "ready"),
    );
  });

  it("archives through the session host and says the owner will finish", async () => {
    await archive(true);

    expect(writeCalls()).toEqual([
      { method: "epic.setChatArchived", hostId: SESSION.hostId },
    ]);
    expect(successToasts()).toEqual([
      "Archived. Mock Remote Host will finish when it is back",
    ]);
  });

  it("says the same for a requested unarchive", async () => {
    await archive(false);

    expect(successToasts()).toEqual([
      "Unarchived. Mock Remote Host will finish when it is back",
    ]);
  });

  it("deletes a chat through the session host and says the owner's files are untouched", async () => {
    await deleteChat();

    expect(writeCalls()).toEqual([
      { method: "epic.deleteChat", hostId: SESSION.hostId },
    ]);
    expect(successToasts()).toEqual([
      "Removed. Files on Mock Remote Host are untouched",
    ]);
  });

  it("deletes a terminal agent through the session host and says the owner's files are untouched", async () => {
    await deleteTuiAgent();

    expect(writeCalls()).toEqual([
      { method: "epic.deleteTuiAgent", hostId: SESSION.hostId },
    ]);
    expect(successToasts()).toEqual([
      "Removed. Files on Mock Remote Host are untouched",
    ]);
  });

  it("uses another live host when the session host is down too", async () => {
    publishLeases(
      lease(SESSION.hostId, "dead"),
      lease(OWNER.hostId, "dead"),
      lease(OTHER.hostId, "ready"),
    );

    await deleteChat();

    expect(writeCalls()).toEqual([
      { method: "epic.deleteChat", hostId: OTHER.hostId },
    ]);
  });

  it("reads the host's answer, not its own routing: an `applied` reply says nothing extra", async () => {
    // Authority moved to the session host after the GUI last saw the record:
    // the GUI routed away from a "down owner", but the receiving host found
    // the record was its own and enacted it.
    fixture.ownerAsHostsSeeIt = SESSION.hostId;

    await archive(true);
    await deleteChat();

    expect(writeCalls().map((call) => call.hostId)).toEqual([
      SESSION.hostId,
      SESSION.hostId,
    ]);
    expect(successToasts()).toEqual([]);
  });
});

describe("unchanged paths", () => {
  it("an owner whose lease can serve still takes the write, and `applied` says nothing extra", async () => {
    publishLeases(lease(SESSION.hostId, "ready"), lease(OWNER.hostId, "ready"));

    await archive(true);
    await deleteChat();
    await deleteTuiAgent();

    expect(writeCalls().map((call) => call.hostId)).toEqual([
      OWNER.hostId,
      OWNER.hostId,
      OWNER.hostId,
    ]);
    expect(successToasts()).toEqual([]);
  });

  it("with no live host the write still goes to the owner", async () => {
    publishLeases(
      lease(SESSION.hostId, "connecting"),
      lease(OWNER.hostId, "dead"),
      lease(OTHER.hostId, "dead"),
    );

    await deleteChat();

    expect(writeCalls()).toEqual([
      { method: "epic.deleteChat", hostId: OWNER.hostId },
    ]);
  });

  it("before the selection authority attaches the write goes to the owner", async () => {
    await archive(true);

    expect(writeCalls()).toEqual([
      { method: "epic.setChatArchived", hostId: OWNER.hostId },
    ]);
  });
});
