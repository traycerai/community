import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type {
  AgentSender,
  Message,
} from "@traycer/protocol/persistence/epic/schemas";
import type { ChatActiveTurn } from "@traycer/protocol/host/agent/gui/subscribe";
import type {
  ChatSessionStoreHandle,
  LiveAssistantMessage,
} from "@/stores/chats/chat-session-store";
import { createTestChatSession } from "@/stores/chats/test-support/create-test-chat-session";

// Real implementations, counted: the stable-row pass is what walks every
// retained row, so how often it runs is the cost of an update to this store.
const walks = vi.hoisted(() => ({ timeline: 0, list: 0 }));
vi.mock("@/components/chat/chat-stable-rows", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/chat/chat-stable-rows")>();
  return {
    ...actual,
    computeStableChatTimelineRows: (
      ...args: Parameters<typeof actual.computeStableChatTimelineRows>
    ) => {
      walks.timeline += 1;
      return actual.computeStableChatTimelineRows(...args);
    },
    computeStableTranscriptListRows: (
      ...args: Parameters<typeof actual.computeStableTranscriptListRows>
    ) => {
      walks.list += 1;
      return actual.computeStableTranscriptListRows(...args);
    },
  };
});

const ASSISTANT_SENDER: AgentSender = {
  type: "agent",
  harnessId: "claude",
  agentId: "claude-sonnet-4",
  displayName: "Claude Sonnet 4",
  reply: { expectsReply: false },
  inReplyTo: null,
};

function activeTurn(turnId: string): ChatActiveTurn {
  return {
    agentMode: "regular",
    sameTurnSteeringSupported: false,
    turnId,
    status: "running",
    harnessId: "claude",
    model: "claude-sonnet-4-5",
    profileId: null,
    userMessageId: null,
    startedAt: 1,
    updatedAt: 2,
    reasoningEffort: null,
    serviceTier: null,
  };
}

function content(text: string): JsonContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function userMessage(
  messageId: string,
  text: string,
  timestamp: number,
): Message {
  return {
    role: "user",
    messageId,
    sender: { type: "user", userId: "owner-1" },
    message: { kind: "user", content: content(text), browserAnnotations: [] },
    timestamp,
    sessionAnchor: null,
  };
}

type AssistantMessage = Extract<Message, { role: "assistant" }>;
type ContentBlock = AssistantMessage["blocks"][number];

function settledAssistantWithTodo(turnId: string): AssistantMessage {
  const blocks: ContentBlock[] = [
    {
      blockId: `${turnId}-todo`,
      type: "tool_call",
      status: "completed",
      timestamp: 1500,
      toolName: "TaskCreate",
      inputSummary: null,
      inputDetail: null,
      taskTodoItems: [
        {
          id: null,
          text: "ship it",
          status: null,
          priority: null,
          activeForm: null,
          action: "create",
        },
      ],
      error: null,
      agentMessageSend: null,
      managedCommand: null,
      agentMessageReceipt: null,
      progress: null,
      backgroundOutput: null,
      startedAt: null,
      endedAt: null,
      backgroundTask: false,
      stopped: false,
      imageResults: [],
      page: null,
      mcpApp: null,
    },
    {
      type: "text",
      blockId: `${turnId}-text`,
      status: "completed",
      timestamp: 1600,
      text: "done",
      providerNotice: null,
    },
  ];
  return {
    role: "assistant",
    messageId: `a-${turnId}`,
    sender: ASSISTANT_SENDER,
    blocks,
    startedAt: 1500,
    timestamp: 1700,
    turnId,
    usage: null,
    reasoningEffort: null,
    serviceTier: null,
    envCredentialVar: null,
    imageResolutions: [],
  };
}

function liveAssistant(
  turnId: string,
  text: string,
  blocksVersion: number,
): LiveAssistantMessage {
  return {
    turnId,
    blocks: [
      {
        type: "text",
        blockId: "text-1",
        text,
        status: "streaming",
        timestamp: 10 + blocksVersion,
        providerNotice: null,
      },
    ],
    startedAt: 2000,
    blocksVersion,
    imageResolutions: [],
    imageResolutionsVersion: 0,
    timestamp: 2000,
    sender: ASSISTANT_SENDER,
    reasoningEffort: null,
    serviceTier: null,
  };
}

let session: ChatSessionStoreHandle | null = null;

function openSession(): ChatSessionStoreHandle {
  session = createTestChatSession();
  return session;
}

afterEach(() => {
  session?.dispose();
  session = null;
});

describe("session row store", () => {
  it("keeps settled rows and list entries by identity while the live row streams", () => {
    const { store: source, rows } = openSession();
    source.setState({
      messages: [userMessage("u-1", "hello", 1000)],
      activeTurn: activeTurn("turn-1"),
      runStatus: "running",
      liveAssistantMessage: liveAssistant("turn-1", "a", 1),
    });
    const before = rows.getState();
    expect(before.rows.map((row) => row.key)).toEqual([
      "u-1",
      "assistant:turn-1",
    ]);
    expect(before.messages.map((row) => row.id)).toEqual([
      "u-1",
      "assistant:turn-1",
    ]);

    source.setState({ liveAssistantMessage: liveAssistant("turn-1", "ab", 2) });

    const after = rows.getState();
    expect(after.listEntries).toBe(before.listEntries);
    expect(after.byId.get("u-1")).toBe(before.byId.get("u-1"));
    expect(after.messages[0]).toBe(before.messages[0]);
    expect(after.byId.get("assistant:turn-1")).not.toBe(
      before.byId.get("assistant:turn-1"),
    );
    expect(after.messages[1]).not.toBe(before.messages[1]);
  });

  it("does not walk the retained rows again for a session update none of the store's operands read", () => {
    const { store: source, rows } = openSession();
    source.setState({
      messages: [
        userMessage("u-1", "one", 1000),
        userMessage("u-2", "two", 1001),
        userMessage("u-3", "three", 1002),
      ],
    });
    const before = rows.getState();
    let notified = 0;
    const stop = rows.subscribe(() => {
      notified += 1;
    });
    const walked = { ...walks };

    source.setState({ suggestedPrompt: "try this next" });

    expect(rows.getState()).toBe(before);
    expect(notified).toBe(0);
    expect(walks).toEqual(walked);

    // Positive control: the counter does move when an operand it reads does.
    source.setState({
      messages: [
        userMessage("u-1", "one", 1000),
        userMessage("u-2", "two", 1001),
        userMessage("u-3", "three", 1002),
        userMessage("u-4", "four", 1003),
      ],
    });
    expect(walks.timeline).toBeGreaterThan(walked.timeline);
    expect(walks.list).toBeGreaterThan(walked.list);
    expect(rows.getState().rows.map((row) => row.key)).toContain("u-4");
    stop();
  });

  it("keeps a settled row that carries a pinned todo by identity while the next turn streams", () => {
    // The pinned todo strips the TaskCreate segment out of its turn's row. That
    // stripped copy used to be rebuilt on every token, cloning a settled row.
    const { store: source, rows } = openSession();
    source.setState({
      messages: [
        userMessage("u-1", "hello", 1000),
        settledAssistantWithTodo("turn-1"),
      ],
      activeTurn: activeTurn("turn-2"),
      runStatus: "running",
      liveAssistantMessage: liveAssistant("turn-2", "a", 1),
    });
    const before = rows.getState();
    expect(before.todo?.items.map((item) => item.text)).toEqual(["ship it"]);
    expect(before.messages.map((row) => row.id)).toContain("assistant:turn-1");

    source.setState({ liveAssistantMessage: liveAssistant("turn-2", "ab", 2) });

    const after = rows.getState();
    expect(after.messages[0]).toBe(before.messages[0]);
    expect(after.messages[1]).toBe(before.messages[1]);
    expect(after.todo).toBe(before.todo);
    expect(after.byId.get("assistant:turn-1")).toBe(
      before.byId.get("assistant:turn-1"),
    );
  });

  it("publishes new settled rows when a persisted message is corrected", () => {
    const { store: source, rows } = openSession();
    source.setState({ messages: [userMessage("u-1", "hello", 1000)] });
    const before = rows.getState();

    source.setState({
      messages: [userMessage("u-1", "hello, corrected", 1000)],
    });

    const after = rows.getState();
    expect(after.messages).not.toBe(before.messages);
    expect(after.byId.get("u-1")).not.toBe(before.byId.get("u-1"));
    expect(after.listEntries).toBe(before.listEntries);
  });

  it("builds the changes panel's own row only for the host's active turn: a live row lingering after the turn ended adds none", () => {
    const { store: source, rows } = openSession();
    const editing = (blocksVersion: number): LiveAssistantMessage => ({
      ...liveAssistant("turn-1", "editing", blocksVersion),
      blocks: [
        {
          type: "file_change",
          blockId: "edit-1",
          filePath: "/repo/src/app.ts",
          operation: "edit",
          diffSource: "snapshot",
          beforeHash: "a".repeat(64),
          afterHash: "b".repeat(64),
          additions: 1,
          deletions: 1,
          reason: "snapshot",
          status: "completed",
          timestamp: 20,
        },
      ],
    });
    source.setState({
      messages: [userMessage("u-1", "edit it", 1000)],
      activeTurn: activeTurn("turn-1"),
      runStatus: "running",
      liveAssistantMessage: editing(1),
    });
    // While the host's turn runs, the file the turn just edited is listed
    // from the client's own row.
    expect(
      rows.getState().accumulatedFileChanges.map((row) => row.filePath),
    ).toEqual(["/repo/src/app.ts"]);

    // The host ends the turn; the live row lingers for a frame. It is no
    // longer the active turn, and the host's accumulated set takes over.
    source.setState({ activeTurn: null, runStatus: "idle" });

    expect(rows.getState().messages.map((row) => row.id)).toContain(
      "assistant:turn-1",
    );
    expect(rows.getState().accumulatedFileChanges).toEqual([]);
  });

  it("stops following the session store once the handle is disposed", () => {
    const handle = openSession();
    handle.dispose();
    const before = handle.rows.getState();

    handle.store.setState({ messages: [userMessage("u-1", "late", 1000)] });

    expect(handle.rows.getState()).toBe(before);
  });
});
