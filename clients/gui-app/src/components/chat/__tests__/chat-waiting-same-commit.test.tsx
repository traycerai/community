/**
 * The task tab (header), the sidebar row and the chat's canvas tab all say
 * "waiting for approval" in the SAME React commit when the chat session hits
 * the gate - with no notification involved at all.
 *
 * Real registries and real hooks throughout: the header probe is what the
 * header tab computes (`useEpicWaitingReason` through `withWaitingIndicator`),
 * and the two icons are the real `ChatProgressIcon` behind `memo` boundaries
 * with constant props, so each one hears the session only through its own
 * subscription. A frame where the header waits and a sibling does not is the
 * visible tear this pins against.
 */
import { memo, Profiler } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatProgressIcon } from "@/components/chat/chat-progress-icon";
import { withWaitingIndicator } from "@/components/layout/tabs/tab-waiting";
import { useEpicWaitingReason } from "@/hooks/epic/use-epic-activity-status";
import {
  __getChatSessionRegistryForTests,
  disposeAllChatSessions,
} from "@/lib/registries/chat-session-registry";
import { __getOpenEpicRegistryForTests } from "@/lib/registries/epic-session-registry";
import {
  createChatSessionStore,
  type ChatSessionState,
} from "@/stores/chats/chat-session-store";
import { IMMEDIATE_STREAM_FLUSH_COORDINATOR } from "@/stores/chats/stream-flush-coordinator";
import { CHAT_STORE_TEST_ENVIRONMENT } from "@/stores/chats/test-support/chat-store-test-environment";
import { type EpicStreamClientFactory } from "@/stores/epics/open-epic/store";
import { openStoreForTest } from "@/stores/epics/open-epic/test-support/open-store-for-test";
import { EMPTY_NOTIFICATION_INDICATOR_STATE } from "@/stores/notifications/notification-indicator-state";

const EPIC_ID = "epic-same-commit";
const CHAT_ID = "chat-1";
const HOST_ID = "host-1";
const ROW_APPROVAL_TEST_ID = `chat-sidebar-spinner-approval-${CHAT_ID}`;
const TAB_APPROVAL_TEST_ID = `chat-tab-spinner-approval-${CHAT_ID}`;

const COMMAND_APPROVAL: ChatSessionState["pendingApprovals"][number] = {
  kind: "tool",
  approvalId: "approval-1",
  toolName: "bash",
  description: "Run a command",
  input: null,
  planId: null,
  actions: [],
  requestedAt: 1,
  reason: null,
  reviewing: null,
};

const noopStreamClientFactory: EpicStreamClientFactory = () => ({
  applyUpdate: () => undefined,
  awareness: () => undefined,
  applyArtifactRoomUpdate: () => undefined,
  artifactRoomAwareness: () => undefined,
  retryMigration: () => undefined,
  close: () => undefined,
});

/** A live epic projection that holds the chat, as the header's filter needs. */
function registerEpicHoldingChat(): void {
  const handle = __getOpenEpicRegistryForTests().acquire(EPIC_ID, () =>
    openStoreForTest({
      epicId: EPIC_ID,
      userId: null,
      factories: {
        streamClientFactory: noopStreamClientFactory,
        laneSelection: null,
      },
      writeCommand: null,
    }),
  );
  handle.store.setState({ chats: { allIds: [CHAT_ID], byId: {} } });
}

/** The chat's open session: an owner who can act, mid-turn. */
function registerRunningOwnerSession(): void {
  const handle = __getChatSessionRegistryForTests().acquire(
    {
      epicId: EPIC_ID,
      chatId: CHAT_ID,
      hostId: HOST_ID,
      scopeKey: "same-commit-scope",
    },
    () =>
      createChatSessionStore({
        environment: CHAT_STORE_TEST_ENVIRONMENT,
        hostId: HOST_ID,
        epicId: EPIC_ID,
        chatId: CHAT_ID,
        userId: null,
        onAuthError: null,
        onProviderAuthError: null,
        wakeTransport: null,
        streamFlushCoordinator: IMMEDIATE_STREAM_FLUSH_COORDINATOR,
        streamClientFactory: () => ({
          sendAction: () => undefined,
          sameTurnSteeringProtocolSupported: () => true,
          draftBlobBridgeSupported: () => true,
          requestTranscriptRange: () => undefined,
          requestResnapshot: () => undefined,
          close: () => undefined,
        }),
      }),
  );
  handle.store.setState({
    runStatus: "running",
    access: { role: "owner", ownerUserId: "chat-owner", canAct: true },
  });
}

function setApprovals(
  pendingApprovals: ChatSessionState["pendingApprovals"],
): void {
  const handle = __getChatSessionRegistryForTests().peek(
    EPIC_ID,
    CHAT_ID,
    HOST_ID,
  );
  if (handle === null) throw new Error("expected the chat session");
  handle.store.setState({ pendingApprovals });
}

/** What the header task tab computes from the same hook. */
function HeaderProbe() {
  const reason = useEpicWaitingReason(EPIC_ID);
  const waiting = withWaitingIndicator(
    EMPTY_NOTIFICATION_INDICATOR_STATE,
    reason,
  ).pendingApproval;
  return <span data-testid="header">{waiting ? "approval" : "none"}</span>;
}

const RowIcon = memo(function RowIcon() {
  return (
    <ChatProgressIcon
      epicId={EPIC_ID}
      chatId={CHAT_ID}
      hostId={HOST_ID}
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
      hostId={HOST_ID}
      className={undefined}
      mutedClassName="text-muted-foreground"
      testId="chat-tab-spinner"
      defaultIcon={undefined}
    />
  );
});

interface Snapshot {
  readonly header: boolean;
  readonly row: boolean;
  readonly tab: boolean;
}

afterEach(() => {
  cleanup();
  __getOpenEpicRegistryForTests().disposeAll();
  disposeAllChatSessions();
});

describe("a chat session that hits its approval gate", () => {
  it("flips the header, the row and the canvas tab to waiting in one commit, with no notification", () => {
    registerEpicHoldingChat();
    registerRunningOwnerSession();
    const snapshots: Snapshot[] = [];
    // Read after every commit, off the DOM the user would see.
    const record = (): void => {
      snapshots.push({
        header: screen.getByTestId("header").textContent === "approval",
        row: screen.queryByTestId(ROW_APPROVAL_TEST_ID) !== null,
        tab: screen.queryByTestId(TAB_APPROVAL_TEST_ID) !== null,
      });
    };
    render(
      <Profiler id="waiting" onRender={record}>
        <HeaderProbe />
        <RowIcon />
        <TabIcon />
      </Profiler>,
    );
    // The turn spinner is what both icons show before the gate.
    expect(
      screen.queryByTestId(`chat-sidebar-spinner-activity-${CHAT_ID}`),
    ).not.toBeNull();
    expect(
      screen.queryByTestId(`chat-tab-spinner-activity-${CHAT_ID}`),
    ).not.toBeNull();
    expect(screen.getByTestId("header").textContent).toBe("none");
    const beforeUpdate = snapshots.length;

    act(() => {
      setApprovals([COMMAND_APPROVAL]);
    });

    // Not vacuous: the update produced at least one commit we read.
    expect(snapshots.length).toBeGreaterThan(beforeUpdate);
    expect(snapshots.at(-1)).toEqual({ header: true, row: true, tab: true });
    for (const snapshot of snapshots) {
      if (snapshot.header) {
        expect(snapshot).toEqual({ header: true, row: true, tab: true });
      }
    }
  });
});
