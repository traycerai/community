/**
 * The notification path ALONE: no chat session exists here, so both icons read
 * only the host's indicator rows. A frame from the notification feed reaches
 * them as a query invalidation, and the two surfaces (a sidebar row and a
 * canvas tab) must light together, through `memo` boundaries with constant
 * props, with no commit where one waits and the other does not.
 *
 * Real `HostClient` over `MockHostMessenger`, real query client, real
 * `ChatIndicatorHostScopes`, real `ChatProgressIcon`: only the client resolver
 * and the feed-mode hooks are stubbed, as in `chat-indicator-host-scopes`.
 */
import { memo, Profiler } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostClient } from "@traycer-clients/shared/host-client/host-client";
import { mockLocalHostEntry } from "@traycer-clients/shared/host-client/mock/mock-host-directory";
import { MockHostMessenger } from "@traycer-clients/shared/host-client/mock/mock-host-messenger";
import { createRequestContextFixture } from "@traycer-clients/shared/test-fixtures/request-context";
import { hostRpcRegistry, type HostRpcRegistry } from "@traycer/protocol/host";
import type {
  HostNotificationsCloudFeedRow,
  HostNotificationsIndicatorState,
  HostNotificationsIndicatorStateRequest,
  HostNotificationsIndicatorStateResponse,
} from "@traycer/protocol/host/notifications/contracts";
import { ChatProgressIcon } from "@/components/chat/chat-progress-icon";
import { ChatIndicatorHostScopes } from "@/components/notifications/chat-indicator-host-scopes";
import { chatIndicatorHostScopes } from "@/lib/notifications/chat-indicator-scopes";
import { invalidateNotificationIndicatorsForEntities } from "@/lib/notifications/notification-indicator-cache";
import { createHostQueryInvalidator } from "@/lib/host/query-invalidator";
import { createAppQueryClient } from "@/lib/query-client";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useCloudNotificationsStore } from "@/stores/notifications/cloud-notifications-store";

const HOST_A = mockLocalHostEntry.hostId;
const EPIC_ID = "epic-1";
const CHAT_ID = "chat-a";
const ROW_APPROVAL_TEST_ID = `chat-sidebar-spinner-approval-${CHAT_ID}`;
const TAB_APPROVAL_TEST_ID = `chat-tab-spinner-approval-${CHAT_ID}`;

const clientsByHostId = vi.hoisted((): { value: Map<string, unknown> } => ({
  value: new Map(),
}));

const feedMode = vi.hoisted((): { value: "local" | "cloud" } => ({
  value: "local",
}));

vi.mock("@/hooks/host/use-host-client-for-host-id", () => ({
  useHostClientForHostId: (hostId: string | null) =>
    hostId === null ? null : (clientsByHostId.value.get(hostId) ?? null),
}));

vi.mock("@/lib/notifications/notification-feed-mode", async (importActual) => {
  // The real module's floor constants are read by production code, so the
  // factory spreads it and only answers the two mode hooks.
  const actual =
    await importActual<
      typeof import("@/lib/notifications/notification-feed-mode")
    >();
  return {
    ...actual,
    useNotificationFeedMode: () => feedMode.value,
    useNotificationFeedModeSettling: () => false,
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function lit(
  flags: Partial<HostNotificationsIndicatorState>,
): HostNotificationsIndicatorState {
  return {
    pendingApproval: false,
    pendingInterview: false,
    pendingFork: false,
    unreadFailure: false,
    unreadDone: false,
    ...flags,
  };
}

interface Harness {
  readonly queryClient: QueryClient;
  /** Every chat id set the host was ASKED about, in order. */
  readonly asked: string[][];
}

/** A host answering from `rows`, read at call time so a test can change them. */
function createHarness(
  rows: Record<string, HostNotificationsIndicatorState>,
): Harness {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
    mutations: { retry: false },
  });
  const asked: string[][] = [];
  let requestId = 0;
  const spine = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    invalidator: createHostQueryInvalidator(queryClient),
    findHostById: (hostId) =>
      hostId === mockLocalHostEntry.hostId ? mockLocalHostEntry : null,
    messenger: new MockHostMessenger<HostRpcRegistry>({
      registry: hostRpcRegistry,
      requestId: () => {
        requestId += 1;
        return `request-${String(requestId)}`;
      },
      handlers: {
        "host.notifications.indicatorState": (
          params: HostNotificationsIndicatorStateRequest,
        ): HostNotificationsIndicatorStateResponse => {
          asked.push([...params.chatIds]);
          const chats: Record<string, HostNotificationsIndicatorState> = {};
          for (const chatId of params.chatIds) {
            if (Object.hasOwn(rows, chatId)) chats[chatId] = rows[chatId];
          }
          return { epics: {}, chats };
        },
      },
    }),
  });
  spine.setRequestContext(
    createRequestContextFixture({ origin: "renderer", bearerToken: "token" }),
  );
  clientsByHostId.value = new Map([
    [HOST_A, spine.createRequester(mockLocalHostEntry)],
  ]);
  useAuthStore.setState({
    contextMetadata: { userId: "user-a", username: "user-a" },
  });
  return { queryClient, asked };
}

const RowIcon = memo(function RowIcon() {
  return (
    <ChatProgressIcon
      epicId={EPIC_ID}
      chatId={CHAT_ID}
      hostId={HOST_A}
      className={undefined}
      mutedClassName="text-muted-foreground/70"
      testId="chat-sidebar-spinner"
      defaultIcon={undefined}
    />
  );
});

const TabIcon = memo(function TabIcon() {
  return (
    <ChatProgressIcon
      epicId={EPIC_ID}
      chatId={CHAT_ID}
      hostId={HOST_A}
      className={undefined}
      mutedClassName="text-muted-foreground"
      testId="chat-tab-spinner"
      defaultIcon={undefined}
    />
  );
});

/**
 * An unread, unresolved approval the cloud snapshot attributes to
 * `originHostId`: the row a cloud-mode icon lights `pendingApproval` from.
 */
function cloudApprovalRow(input: {
  readonly entryId: string;
  readonly originHostId: string;
  readonly chatId: string;
  /** When the approval was answered; `null` while it is still pending. */
  readonly resolvedAt: number | null;
}): HostNotificationsCloudFeedRow {
  return {
    entryId: input.entryId,
    originHostId: input.originHostId,
    coalesceKey: `approval.requested:${input.chatId}`,
    entry: {
      id: input.entryId,
      updatedAt: 1_100,
      readAt: input.resolvedAt,
      kind: "approval.requested",
      sourceRef: input.entryId,
      severity: "needs_action",
      outcome: null,
      resolvedAt: input.resolvedAt,
      epicId: EPIC_ID,
      chatId: input.chatId,
      payload: {
        kind: "approval",
        epicId: EPIC_ID,
        chatId: input.chatId,
        approvalId: input.entryId,
      },
    },
    presentation: { epicTitle: "Epic", chatTitle: "Chat" },
  };
}

afterEach(() => {
  cleanup();
  feedMode.value = "local";
  clientsByHostId.value = new Map();
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useCloudNotificationsStore.setState(
    useCloudNotificationsStore.getInitialState(),
    true,
  );
});

describe("ChatProgressIcon on the notification path alone", () => {
  it("lights the row and the canvas tab in the same commit when the host's feed reports an approval", async () => {
    // The host's own record for the chat, changed after mount below.
    const rows: Record<string, HostNotificationsIndicatorState> = {};
    const harness = createHarness(rows);
    const snapshots: Array<{ readonly row: boolean; readonly tab: boolean }> =
      [];
    const record = (): void => {
      snapshots.push({
        row: screen.queryByTestId(ROW_APPROVAL_TEST_ID) !== null,
        tab: screen.queryByTestId(TAB_APPROVAL_TEST_ID) !== null,
      });
    };
    render(
      <QueryClientProvider client={harness.queryClient}>
        <ChatIndicatorHostScopes
          scopes={chatIndicatorHostScopes([
            { hostId: HOST_A, chatId: CHAT_ID },
          ])}
        >
          <Profiler id="icons" onRender={record}>
            <RowIcon />
            <TabIcon />
          </Profiler>
        </ChatIndicatorHostScopes>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(harness.asked).toEqual([[CHAT_ID]]);
    });
    expect(screen.queryByTestId(ROW_APPROVAL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(TAB_APPROVAL_TEST_ID)).toBeNull();
    const beforeFrame = snapshots.length;

    // What a notification feed frame does in the app: the host now has the
    // row, and the frame invalidates this chat's indicator read.
    rows[CHAT_ID] = lit({ pendingApproval: true });
    invalidateNotificationIndicatorsForEntities(
      harness.queryClient,
      HOST_A,
      [{ epicId: EPIC_ID, chatId: CHAT_ID }],
      null,
    );

    await waitFor(() => {
      expect(screen.queryByTestId(ROW_APPROVAL_TEST_ID)).not.toBeNull();
      expect(screen.queryByTestId(TAB_APPROVAL_TEST_ID)).not.toBeNull();
    });
    // Not vacuous: commits after the frame were read, and in none of them did
    // one surface wait while the other did not.
    expect(snapshots.length).toBeGreaterThan(beforeFrame);
    expect(snapshots.at(-1)).toEqual({ row: true, tab: true });
    for (const snapshot of snapshots) {
      expect(snapshot.row).toBe(snapshot.tab);
    }
  });

  it("lights, then clears, the row and the canvas tab together from a cloud snapshot that arrives after mount", async () => {
    // Cloud mode: the approval bit comes from the cloud snapshot store, not
    // from the host RPC, which here answers nothing at all.
    feedMode.value = "cloud";
    const harness = createHarness({});
    const snapshots: Array<{ readonly row: boolean; readonly tab: boolean }> =
      [];
    const record = (): void => {
      snapshots.push({
        row: screen.queryByTestId(ROW_APPROVAL_TEST_ID) !== null,
        tab: screen.queryByTestId(TAB_APPROVAL_TEST_ID) !== null,
      });
    };
    render(
      <QueryClientProvider client={harness.queryClient}>
        <ChatIndicatorHostScopes
          scopes={chatIndicatorHostScopes([
            { hostId: HOST_A, chatId: CHAT_ID },
          ])}
        >
          <Profiler id="icons" onRender={record}>
            <RowIcon />
            <TabIcon />
          </Profiler>
        </ChatIndicatorHostScopes>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(harness.asked).toEqual([[CHAT_ID]]);
    });
    expect(screen.queryByTestId(ROW_APPROVAL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(TAB_APPROVAL_TEST_ID)).toBeNull();
    const beforeApply = snapshots.length;

    const pending = cloudApprovalRow({
      entryId: "entry-1",
      originHostId: HOST_A,
      chatId: CHAT_ID,
      resolvedAt: null,
    });
    act(() => {
      useCloudNotificationsStore.getState().applySnapshot({
        rows: [pending],
        summary: { totalCount: 1, unreadCount: 1, attentionCount: 1 },
        version: 1,
      });
    });

    expect(screen.queryByTestId(ROW_APPROVAL_TEST_ID)).not.toBeNull();
    expect(screen.queryByTestId(TAB_APPROVAL_TEST_ID)).not.toBeNull();
    expect(snapshots.length).toBeGreaterThan(beforeApply);
    expect(snapshots.at(-1)).toEqual({ row: true, tab: true });
    const beforeResolve = snapshots.length;

    // The same row, resolved: the approval was answered.
    act(() => {
      useCloudNotificationsStore.getState().applySnapshot({
        rows: [
          cloudApprovalRow({
            entryId: "entry-1",
            originHostId: HOST_A,
            chatId: CHAT_ID,
            resolvedAt: 2_000,
          }),
        ],
        summary: { totalCount: 1, unreadCount: 0, attentionCount: 0 },
        version: 2,
      });
    });

    expect(screen.queryByTestId(ROW_APPROVAL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(TAB_APPROVAL_TEST_ID)).toBeNull();
    expect(snapshots.length).toBeGreaterThan(beforeResolve);
    expect(snapshots.at(-1)).toEqual({ row: false, tab: false });
    for (const snapshot of snapshots) {
      expect(snapshot.row).toBe(snapshot.tab);
    }
  });
});
