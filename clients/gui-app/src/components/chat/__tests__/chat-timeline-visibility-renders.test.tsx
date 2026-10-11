import { act, cleanup, render } from "@testing-library/react";
import {
  createRef,
  Profiler,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegendListProps, LegendListRef } from "@legendapp/list/react";
import type {
  AgentSender,
  Message,
} from "@traycer/protocol/persistence/epic/schemas";
import type { ChatMessageActions } from "@/components/chat/chat-message";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import { ChatRowStoreContext } from "@/components/chat/chat-row-presentation";
import { ChatPrewarmContext } from "@/lib/registries/chat-prewarm";
import {
  transcriptListRows,
  type TranscriptListRow,
} from "@/stores/chats/transcript-list-rows";
import type { ChatMessage as ChatMessageModel } from "@/stores/composer/chat-store";
import type {
  ChatSessionStoreHandle,
  LiveAssistantMessage,
} from "@/stores/chats/chat-session-store";
import { createTestChatSession } from "@/stores/chats/test-support/create-test-chat-session";
import { makeMessages } from "./chat-message-fixtures";
import {
  advanceLegendListFrames,
  installLegendListTestClock,
  installLegendListViewportMetrics,
  restoreLegendListTestClock,
  settleLegendList,
} from "./legend-list-test-environment";

/**
 * What a tab switch costs a mounted chat timeline.
 *
 * Hiding and showing a timeline changes no content, so it must render no row,
 * and the list has to be handed the same items. Two things are counted at the
 * real boundaries: ChatMessage renders (the probe below, which re-runs whenever
 * `ChatTimelineRow` does) and `renderItem` calls (the list's own work, which
 * is one per `SubscribedChatTimelineRow` render). A row that DID change while
 * the timeline was hidden is the one row that may render on reveal.
 */

const VIEWPORT_HEIGHT_PX = 700;
const VIEWPORT_WIDTH_PX = 800;

/** Counted from a layout-free effect, so it follows every ChatMessage render. */
const renderCounts = new Map<string, number>();

vi.mock("@/components/chat/chat-message", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/chat/chat-message")>();

  function ChatMessageWithRenderProbe(
    props: Parameters<typeof actual.ChatMessage>[0],
  ): ReactElement {
    useEffect(() => {
      const id = props.message.id;
      renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
    });
    return <actual.ChatMessage {...props} />;
  }

  return { ...actual, ChatMessage: ChatMessageWithRenderProbe };
});

/**
 * `renderItemKeys`: one entry per `renderItem` call, the item's key.
 * `dataByCommit`: the `data` array of every committed list pass.
 */
const listProbe = vi.hoisted(() => ({
  renderItemKeys: [] as string[],
  dataByCommit: [] as unknown[],
}));

vi.mock("@legendapp/list/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@legendapp/list/react")>();
  const CapturingLegendList = (
    props: LegendListProps<TranscriptListRow> & RefAttributes<LegendListRef>,
  ) => {
    useLayoutEffect(() => {
      listProbe.dataByCommit.push(props.data);
    });
    const original = props.renderItem;
    // Memoized on the incoming callback: a wrapper that changed identity on
    // every render would itself make the list re-render every row.
    const counted = useMemo(
      () =>
        original === undefined
          ? undefined
          : (info: Parameters<NonNullable<typeof original>>[0]): ReactNode => {
              listProbe.renderItemKeys.push(info.item.key);
              return original(info);
            },
      [original],
    );
    return <actual.LegendList {...props} renderItem={counted} />;
  };
  return { ...actual, LegendList: CapturingLegendList };
});

const ASSISTANT_SENDER: AgentSender = {
  type: "agent",
  harnessId: "claude",
  agentId: "claude-sonnet-4",
  displayName: "Claude Sonnet 4",
  reply: { expectsReply: false },
  inReplyTo: null,
};

function userMessage(
  messageId: string,
  text: string,
  timestamp: number,
): Message {
  return {
    role: "user",
    messageId,
    sender: { type: "user", userId: "owner-1" },
    message: {
      kind: "user",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
      browserAnnotations: [],
    },
    timestamp,
    sessionAnchor: null,
  };
}

function assistantMessage(
  messageId: string,
  text: string,
  timestamp: number,
): Message {
  return {
    role: "assistant",
    messageId,
    sender: ASSISTANT_SENDER,
    blocks: [
      {
        type: "text",
        blockId: `${messageId}-text`,
        status: "completed",
        timestamp,
        text,
        providerNotice: null,
      },
    ],
    startedAt: timestamp,
    timestamp,
    turnId: `turn-${messageId}`,
    usage: null,
    reasoningEffort: null,
    serviceTier: null,
    envCredentialVar: null,
    imageResolutions: [],
  };
}

/** Three user and three assistant rows, all settled, no active turn. */
function settledMessages(): Message[] {
  return [
    userMessage("u-1", "user message 1", 1000),
    assistantMessage("a-1", "assistant reply 1", 1100),
    userMessage("u-2", "user message 2", 1200),
    assistantMessage("a-2", "assistant reply 2", 1300),
    userMessage("u-3", "user message 3", 1400),
    assistantMessage("a-3", "assistant reply 3", 1500),
  ];
}

// The row ids the list shows: a user row keeps its message id, an assistant
// row is keyed by its turn.
const SETTLED_IDS = [
  "u-1",
  "assistant:turn-a-1",
  "u-2",
  "assistant:turn-a-2",
  "u-3",
  "assistant:turn-a-3",
] as const;

function liveAssistant(
  text: string,
  blocksVersion: number,
): LiveAssistantMessage {
  return {
    turnId: "turn-live",
    blocks: [
      {
        type: "text",
        blockId: "live-text",
        text,
        status: "streaming",
        timestamp: 2000 + blocksVersion,
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

// Module-level and stable: a fresh Set or callback per render would wake every
// row through the row context, which is not what these tests measure.
const NO_BACKGROUND_TOOL_BLOCK_IDS = new Set<string>();
const NO_MESSAGE_ACTIONS = (_message: ChatMessageModel): null => null;

type GetMessageActions = (
  message: ChatMessageModel,
) => ChatMessageActions | null;

interface HarnessControls {
  readonly setVisible: (visible: boolean) => void;
  readonly setGetMessageActions: (next: GetMessageActions) => void;
}

let controls: HarnessControls | null = null;

function harnessControls(): HarnessControls {
  if (controls === null) throw new Error("harness controls not exposed");
  return controls;
}

/**
 * The reveal probe. Armed only by the "reveal: a new row is never blank"
 * describe below. Each
 * commit under the harness's Profiler is read three ways, in this order:
 * `layout` (synchronously, in the layout phase), `microtask` (queued from the
 * layout phase, so after the commit's whole synchronous work including any sync
 * re-render the layout effects scheduled, and before the scheduler task that
 * runs a non-sync commit's passive effects), and `passive` (the harness's own
 * no-deps passive effect). The `microtask` read is the DOM a browser may paint.
 */
interface RevealEntry {
  readonly at: "layout" | "microtask" | "passive";
  readonly commit: number;
  readonly targetPresent: boolean;
  readonly emptyContainers: number;
}

const reveal = {
  armed: false,
  commit: 0,
  target: "",
  container: null as HTMLElement | null,
  log: [] as RevealEntry[],
};

/** List item containers (LegendList positions them absolutely) that hold
 *  nothing at all: a row the list has mounted but that rendered `null`. */
function emptyListContainers(container: HTMLElement): number {
  return Array.from(container.querySelectorAll("div")).filter(
    (element) =>
      element.style.position === "absolute" &&
      element.closest("[data-message-id]") === null &&
      element.children.length === 0,
  ).length;
}

function recordReveal(at: RevealEntry["at"], commit: number): void {
  reveal.log.push({
    at,
    commit,
    targetPresent:
      reveal.container?.textContent.includes(reveal.target) ?? false,
    emptyContainers:
      reveal.container === null ? 0 : emptyListContainers(reveal.container),
  });
}

function onRevealCommit(): void {
  if (!reveal.armed) return;
  reveal.commit += 1;
  const commit = reveal.commit;
  recordReveal("layout", commit);
  queueMicrotask(() => {
    recordReveal("microtask", commit);
  });
}

function StoreBackedHarness({
  rows,
  initialVisible,
  prewarm,
}: {
  readonly rows: ChatSessionStoreHandle["rows"];
  readonly initialVisible: boolean;
  readonly prewarm: boolean;
}): ReactElement {
  const [visible, setVisible] = useState(initialVisible);
  useEffect(() => {
    if (reveal.armed) recordReveal("passive", reveal.commit);
  });
  const [getMessageActions, setGetMessageActions] = useState<GetMessageActions>(
    () => NO_MESSAGE_ACTIONS,
  );
  useEffect(() => {
    controls = {
      setVisible,
      setGetMessageActions: (next) => {
        setGetMessageActions(() => next);
      },
    };
  }, []);
  const snapshotRows = useSyncExternalStore(
    rows.subscribe,
    () => rows.getState().rows,
  );
  return (
    <div style={{ height: VIEWPORT_HEIGHT_PX, width: VIEWPORT_WIDTH_PX }}>
      <Profiler id="reveal-probe" onRender={onRevealCommit}>
        <ChatPrewarmContext.Provider value={prewarm}>
          <ChatRowStoreContext value={rows}>
            <ChatTimeline
              rows={snapshotRows}
              visible={visible}
              onVisibleRowRangeChange={undefined}
              taskTitle="Test transcript"
              backgroundToolBlockIds={NO_BACKGROUND_TOOL_BLOCK_IDS}
              getMessageActions={getMessageActions}
              nextStepActions={null}
              listRef={listRefForHarness}
              className="h-full"
              data-testid="chat-timeline"
            />
          </ChatRowStoreContext>
        </ChatPrewarmContext.Provider>
      </Profiler>
    </div>
  );
}

const listRefForHarness = createRef<LegendListRef | null>();

/** The raw rows path: no row store, rows handed in directly and held stable. */
function RawHarness({
  rows,
}: {
  readonly rows: ReadonlyArray<TranscriptListRow>;
}): ReactElement {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    controls = {
      setVisible,
      setGetMessageActions: () => undefined,
    };
  }, []);
  return (
    <div style={{ height: VIEWPORT_HEIGHT_PX, width: VIEWPORT_WIDTH_PX }}>
      <ChatTimeline
        rows={rows}
        visible={visible}
        onVisibleRowRangeChange={undefined}
        taskTitle="Test transcript"
        backgroundToolBlockIds={NO_BACKGROUND_TOOL_BLOCK_IDS}
        getMessageActions={NO_MESSAGE_ACTIONS}
        nextStepActions={null}
        listRef={listRefForHarness}
        className="h-full"
        data-testid="chat-timeline"
      />
    </div>
  );
}

function messageElements(container: HTMLElement): Map<string, Element> {
  const byId = new Map<string, Element>();
  for (const element of container.querySelectorAll("[data-message-id]")) {
    byId.set(element.getAttribute("data-message-id") ?? "", element);
  }
  return byId;
}

function rendersOf(ids: ReadonlyArray<string>): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, renderCounts.get(id) ?? 0]));
}

function noRenders(ids: ReadonlyArray<string>): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, 0]));
}

/** Zeroes the counters, so a case reads only what its action caused. */
function resetCounters(): { readonly commitsBefore: number } {
  renderCounts.clear();
  listProbe.renderItemKeys.length = 0;
  return { commitsBefore: listProbe.dataByCommit.length };
}

function dataCommittedSince(commitsBefore: number): ReadonlyArray<unknown> {
  return listProbe.dataByCommit.slice(commitsBefore);
}

async function flip(visible: boolean): Promise<void> {
  act(() => {
    harnessControls().setVisible(visible);
  });
  await advanceLegendListFrames(2);
}

async function mountSettled(options: {
  readonly initialVisible: boolean;
  readonly prewarm: boolean;
}): Promise<{
  readonly session: ChatSessionStoreHandle;
  readonly container: HTMLElement;
  readonly unmount: () => void;
}> {
  const session = createTestChatSession();
  session.store.setState({ messages: settledMessages() });
  const { container, unmount } = render(
    <StoreBackedHarness rows={session.rows} {...options} />,
  );
  await settleLegendList();
  return { session, container, unmount };
}

describe("ChatTimeline - what a visibility flip renders", () => {
  beforeEach(() => {
    renderCounts.clear();
    listProbe.renderItemKeys.length = 0;
    listProbe.dataByCommit.length = 0;
    controls = null;
    installLegendListViewportMetrics();
    installLegendListTestClock();
  });

  afterEach(() => {
    cleanup();
    restoreLegendListTestClock();
    vi.restoreAllMocks();
  });

  it("a hide and a show with equal content render no row and hand the list the same items", async () => {
    const { session, container } = await mountSettled({
      initialVisible: true,
      prewarm: false,
    });
    try {
      const nodes = messageElements(container);
      expect([...nodes.keys()].sort()).toEqual([...SETTLED_IDS].sort());

      for (const visible of [false, true, false, true]) {
        const { commitsBefore } = resetCounters();
        const dataBefore = listProbe.dataByCommit.at(-1);

        await flip(visible);

        expect(listProbe.renderItemKeys).toEqual([]);
        expect(rendersOf(SETTLED_IDS)).toEqual(noRenders(SETTLED_IDS));
        for (const data of dataCommittedSince(commitsBefore)) {
          expect(data).toBe(dataBefore);
        }
        const after = messageElements(container);
        for (const [id, node] of nodes) expect(after.get(id)).toBe(node);
      }
    } finally {
      session.dispose();
    }
  });

  it("a row corrected while hidden is the only row rendered on reveal", async () => {
    const { session, container } = await mountSettled({
      initialVisible: true,
      prewarm: false,
    });
    try {
      await flip(false);
      const hiddenRow = container.querySelector('[data-message-id="u-1"]');
      expect(hiddenRow?.textContent).toContain("user message 1");
      resetCounters();

      const corrected = settledMessages();
      corrected[0] = userMessage("u-1", "user message 1 corrected", 1000);
      act(() => {
        session.store.setState({ messages: corrected });
      });
      await advanceLegendListFrames(2);

      expect(container.textContent).not.toContain("corrected");
      expect(rendersOf(SETTLED_IDS)).toEqual(noRenders(SETTLED_IDS));

      await flip(true);

      expect(container.textContent).toContain("user message 1 corrected");
      const rendered = rendersOf(SETTLED_IDS);
      expect(rendered["u-1"]).toBeGreaterThanOrEqual(1);
      expect(rendered["u-1"]).toBeLessThanOrEqual(2);
      const others = SETTLED_IDS.filter((id) => id !== "u-1");
      expect(
        Object.fromEntries(others.map((id) => [id, rendered[id]])),
      ).toEqual(noRenders(others));
    } finally {
      session.dispose();
    }
  });

  it("a row appended while hidden appears on reveal without re-rendering the others", async () => {
    const { session, container } = await mountSettled({
      initialVisible: true,
      prewarm: false,
    });
    try {
      await flip(false);
      resetCounters();

      act(() => {
        session.store.setState({
          messages: [
            ...settledMessages(),
            userMessage("u-new", "a message that arrived while hidden", 1600),
          ],
        });
      });
      await advanceLegendListFrames(2);
      expect(container.querySelector('[data-message-id="u-new"]')).toBeNull();

      await flip(true);

      expect(
        container.querySelector('[data-message-id="u-new"]'),
      ).not.toBeNull();
      expect(rendersOf(SETTLED_IDS)).toEqual(noRenders(SETTLED_IDS));
    } finally {
      session.dispose();
    }
  });

  it("a live row streams, freezes while hidden and catches up on reveal", async () => {
    const session = createTestChatSession();
    const { store, rows } = session;
    try {
      store.setState({
        messages: settledMessages(),
        activeTurn: {
          agentMode: "regular",
          sameTurnSteeringSupported: false,
          turnId: "turn-live",
          status: "running",
          harnessId: "claude",
          model: "claude-sonnet-4-5",
          profileId: null,
          userMessageId: null,
          startedAt: 1,
          updatedAt: 2,
          reasoningEffort: null,
          serviceTier: null,
        },
        runStatus: "running",
        liveAssistantMessage: liveAssistant("alpha", 1),
      });
      const { container } = render(
        <StoreBackedHarness rows={rows} initialVisible prewarm={false} />,
      );
      await settleLegendList();
      expect(container.textContent).toContain("alpha");
      resetCounters();

      act(() => {
        store.setState({
          liveAssistantMessage: liveAssistant("alpha beta", 2),
        });
      });
      await advanceLegendListFrames(2);
      expect(container.textContent).toContain("alpha beta");
      expect(rendersOf(SETTLED_IDS)).toEqual(noRenders(SETTLED_IDS));

      await flip(false);
      resetCounters();
      act(() => {
        store.setState({
          liveAssistantMessage: liveAssistant("alpha beta gamma", 3),
        });
      });
      await advanceLegendListFrames(2);
      expect(container.textContent).not.toContain("gamma");
      expect(listProbe.renderItemKeys).toEqual([]);
      // Nothing at all rendered, the live row included.
      expect(renderCounts.size).toBe(0);

      await flip(true);
      expect(container.textContent).toContain("gamma");
      expect(rendersOf(SETTLED_IDS)).toEqual(noRenders(SETTLED_IDS));
    } finally {
      session.dispose();
    }
  });

  it("prewarm keeps a hidden timeline live", async () => {
    const { session, container } = await mountSettled({
      initialVisible: false,
      prewarm: true,
    });
    try {
      expect([...messageElements(container).keys()].sort()).toEqual(
        [...SETTLED_IDS].sort(),
      );

      act(() => {
        session.store.setState({
          messages: [
            ...settledMessages(),
            userMessage("u-new", "arrived while prewarmed", 1600),
          ],
        });
      });
      await advanceLegendListFrames(2);

      expect(
        container.querySelector('[data-message-id="u-new"]'),
      ).not.toBeNull();
    } finally {
      session.dispose();
    }
  });

  it("hidden at mount shows nothing, then the rows on reveal", async () => {
    const { session, container } = await mountSettled({
      initialVisible: false,
      prewarm: false,
    });
    try {
      // What the timeline draws while it has never been shown.
      expect(messageElements(container).size).toBe(0);
      expect(container.textContent).toContain("Start the conversation");

      await flip(true);

      expect([...messageElements(container).keys()].sort()).toEqual(
        [...SETTLED_IDS].sort(),
      );
    } finally {
      session.dispose();
    }
  });

  it("a hide and a show re-render no raw row", async () => {
    const rows = transcriptListRows({
      window: null,
      rendered: makeMessages(6),
    });
    const { container } = render(<RawHarness rows={rows} />);
    await settleLegendList();
    const ids = Array.from(
      { length: 6 },
      (_unused, index) => `message-${String(index)}`,
    );
    expect(messageElements(container).size).toBe(6);

    for (const visible of [false, true]) {
      resetCounters();
      await flip(visible);

      expect(listProbe.renderItemKeys).toEqual([]);
      expect(rendersOf(ids)).toEqual(noRenders(ids));
    }
  });

  it("a new message-actions function re-renders every row once, a visibility flip none", async () => {
    const { session } = await mountSettled({
      initialVisible: true,
      prewarm: false,
    });
    try {
      resetCounters();
      await flip(false);
      await flip(true);
      expect(rendersOf(SETTLED_IDS)).toEqual(noRenders(SETTLED_IDS));

      resetCounters();
      // A new function that also answers differently: the compiled row keeps
      // its ChatMessage element for an answer equal to the last one (null
      // again renders no ChatMessage), so only a changed answer is observable.
      act(() => {
        harnessControls().setGetMessageActions((message): ChatMessageActions =>
          message.role === "user"
            ? {
                type: "user",
                deliveryPhase: null,
                enabled: true,
                confirmingDelete: false,
                editing: null,
                onEdit: () => undefined,
                onDeleteRequest: () => undefined,
                onDeleteConfirm: () => undefined,
                onDeleteCancel: () => undefined,
              }
            : { type: "assistant", fork: null },
        );
      });
      await advanceLegendListFrames(2);

      expect(rendersOf(SETTLED_IDS)).toEqual(
        Object.fromEntries(SETTLED_IDS.map((id) => [id, 1])),
      );
    } finally {
      session.dispose();
    }
  });

  /** Live subscriptions on `rows`: subscribes minus unsubscribes. Install it
   *  BEFORE mounting, since `useSyncExternalStore` reads `rows.subscribe` at
   *  render time. */
  function countRowSubscriptions(rows: ChatSessionStoreHandle["rows"]): {
    readonly live: () => number;
  } {
    const subscribe = rows.subscribe;
    let live = 0;
    vi.spyOn(rows, "subscribe").mockImplementation((listener) => {
      live += 1;
      const stop = subscribe(listener);
      return () => {
        live -= 1;
        stop();
      };
    });
    return { live: () => live };
  }

  it("holds one subscription on the row store however many rows are mounted", async () => {
    const session = createTestChatSession();
    session.store.setState({ messages: settledMessages() });
    const subscriptions = countRowSubscriptions(session.rows);
    try {
      expect(subscriptions.live()).toBe(0);
      const { container } = render(
        <StoreBackedHarness
          rows={session.rows}
          initialVisible
          prewarm={false}
        />,
      );
      await settleLegendList();
      expect(messageElements(container).size).toBe(6);
      // The harness's own `useSyncExternalStore` holds one; the timeline fans
      // every row (and its list entries) out from one more.
      expect(subscriptions.live()).toBe(2);

      act(() => {
        session.store.setState({
          messages: [
            ...settledMessages(),
            userMessage("u-4", "user message 4", 1600),
            userMessage("u-5", "user message 5", 1700),
            userMessage("u-6", "user message 6", 1800),
            userMessage("u-7", "user message 7", 1900),
          ],
        });
      });
      await advanceLegendListFrames(2);
      expect(messageElements(container).size).toBe(10);
      expect(subscriptions.live()).toBe(2);
    } finally {
      session.dispose();
    }
  });

  it("releases its subscription on the row store when it unmounts", async () => {
    const session = createTestChatSession();
    session.store.setState({ messages: settledMessages() });
    const subscriptions = countRowSubscriptions(session.rows);
    const before = subscriptions.live();
    try {
      const { unmount } = render(
        <StoreBackedHarness
          rows={session.rows}
          initialVisible
          prewarm={false}
        />,
      );
      await settleLegendList();
      // Only lifetime is claimed here; the exact count is the fan-out test's.
      expect(subscriptions.live()).toBeGreaterThan(before);

      unmount();

      expect(subscriptions.live()).toBe(before);
    } finally {
      session.dispose();
    }
  });
});

const IS_REACT_ACT_ENVIRONMENT_KEY = "IS_REACT_ACT_ENVIRONMENT";

/**
 * A row appended while hidden is never a blank container on reveal. The
 * reveal render already lists the live entries, but LegendList gives a new
 * item no container in that commit: it mounts the container in a later sync
 * commit, after the timeline's layout effect has made the shown store live. So
 * the row reads the live store on its first render and carries its content,
 * and no empty container is in the DOM for the list to measure. The
 * reveal is driven as a plain update with the act environment off (`act()`
 * would flush the passive effects), and the DOM is read in each commit's layout
 * phase and again in a microtask queued from it.
 */
describe("ChatTimeline - reveal: a new row is never blank", () => {
  beforeEach(() => {
    renderCounts.clear();
    listProbe.renderItemKeys.length = 0;
    listProbe.dataByCommit.length = 0;
    controls = null;
    installLegendListViewportMetrics();
    installLegendListTestClock();
  });

  afterEach(() => {
    reveal.armed = false;
    reveal.container = null;
    cleanup();
    restoreLegendListTestClock();
    vi.restoreAllMocks();
  });

  /** Runs `startReveal` with the act environment off, then lets React's
   *  scheduler run one macrotask at a time, returning the ordered log. */
  async function observeReveal(
    container: HTMLElement,
    target: string,
    startReveal: () => void,
  ): Promise<ReadonlyArray<RevealEntry>> {
    const flags = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previous = flags[IS_REACT_ACT_ENVIRONMENT_KEY];
    flags[IS_REACT_ACT_ENVIRONMENT_KEY] = false;
    reveal.log.length = 0;
    reveal.commit = 0;
    reveal.target = target;
    reveal.container = container;
    reveal.armed = true;
    try {
      startReveal();
      for (let task = 0; task < 6; task += 1) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
      }
    } finally {
      reveal.armed = false;
      flags[IS_REACT_ACT_ENVIRONMENT_KEY] = previous;
    }
    return [...reveal.log];
  }

  /** The first log entry of one kind: the layout-phase read of the first
   *  commit after the reveal, or the read at the end of its synchronous work. */
  function firstRead(
    log: ReadonlyArray<RevealEntry>,
    at: RevealEntry["at"],
  ): RevealEntry {
    const entry = log.find((candidate) => candidate.at === at);
    if (entry === undefined) {
      throw new Error(`the reveal never committed: ${JSON.stringify(log)}`);
    }
    return entry;
  }

  async function hideSettled(): Promise<{
    readonly session: ChatSessionStoreHandle;
    readonly container: HTMLElement;
  }> {
    const { session, container } = await mountSettled({
      initialVisible: true,
      prewarm: false,
    });
    await flip(false);
    return { session, container };
  }

  it("a row appended while hidden is never a blank container on reveal", async () => {
    const { session, container } = await hideSettled();
    try {
      const text = "a message that arrived while hidden";
      act(() => {
        session.store.setState({
          messages: [...settledMessages(), userMessage("u-new", text, 1600)],
        });
      });
      await advanceLegendListFrames(2);
      expect(container.textContent).not.toContain(text);

      const log = await observeReveal(container, text, () => {
        harnessControls().setVisible(true);
      });

      // Never an empty container, in any commit or any read of it...
      for (const entry of log) {
        expect(entry.emptyContainers, `log: ${JSON.stringify(log)}`).toBe(0);
      }
      // ...and the content is there by the end of the first commit's
      // synchronous work, which is the DOM a browser may paint.
      expect(
        firstRead(log, "microtask").targetPresent,
        `log: ${JSON.stringify(log)}`,
      ).toBe(true);
    } finally {
      session.dispose();
    }
  });
});
