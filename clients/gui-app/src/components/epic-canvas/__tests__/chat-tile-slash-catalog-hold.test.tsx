import { TestRouterProvider } from "@/__tests__/with-test-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as Y from "yjs";
import type { JsonContent } from "@traycer/protocol/common/registry";
import type {
  ChatRunSettings,
  ChatSubscribeClientFrame,
} from "@traycer/protocol/host/agent/gui/subscribe";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { ChatStreamClientHandle } from "@/stores/chats/chat-session-store";
import type { SlashCommand } from "@/lib/composer/types";
import type { NextStepActionHandler } from "@/components/chat/segments/next-steps-action-group";
import { ChatTile } from "@/components/epic-canvas/renderers/chat-tile";
import { TabHostProvider } from "@/components/epic-canvas/tab-host-provider";
import { PaneSurfaceActivityContext } from "@/components/epic-tabs/pane-visibility-context";
import { RunnerHostProvider } from "@/providers/runner-host-provider";
import { MockRunnerHost } from "@traycer-clients/shared/host-client/mock/mock-runner-host";
import { resetComposerDraftPersistence } from "@/stores/composer/__tests__/composer-draft-rows";
import { useComposerRunSettingsStore } from "@/stores/composer/composer-run-settings-store";
import { useComposerHarnessMemoryStore } from "@/stores/composer/composer-harness-memory-store";
import { useSettingsStore } from "@/stores/settings/settings-store";
import { __getOpenEpicRegistryForTests } from "@/lib/registries/epic-session-registry";
import {
  __getChatSessionRegistryForTests,
  __setChatStreamClientFactoryForTests,
} from "@/lib/registries/chat-session-registry";
import { useAuthStore } from "@/stores/auth/auth-store";
import { installLegendListViewportMetrics } from "@/components/chat/__tests__/legend-list-test-environment";
import { TestEpicSessionWrapper } from "./test-epic-session";
import { createEpicSessionTestHarness } from "./test-epic-session-harness";
import { resetFocusedComposerControlsForTests } from "@/lib/commands/composer-controls-registry";

/**
 * The tile's slash-command catalog is gated on pane focus, so a focus flip
 * used to take it to null and back to a NEW Map, and the next-step send and
 * the transcript's `getMessageActions` (both built on it) changed identity on
 * both tiles of every tab step. These cases drive the real ChatTile through a
 * focus flip and watch what the transcript receives (a capturing stand-in for
 * `ChatMessages`), and what a `$name` next-step send turns into, which is the
 * observable of "which catalog does the tile hold right now".
 */

vi.mock(
  "@/components/home/host-workspace-selector/host-workspace-selector",
  () => ({
    HostWorkspaceSelector: () => <div data-testid="host-workspace-selector" />,
    ActiveHostWorkspaceControls: () => null,
  }),
);

const MOCK_HOST_CLIENT = {
  request: () => new Promise(() => {}),
  getActiveHostId: () => "host-test",
  getRequestContextUserId: () => "user-test",
  onChange: () => () => undefined,
};
const MOCK_HOST_ENTRY = {
  hostId: "host-test",
  label: "Test host",
  kind: "local" as const,
  websocketUrl: "ws://127.0.0.1:1/rpc",
  streamUrl: "ws://127.0.0.1:1/stream",
};
const MOCK_HOST_DIRECTORY = {
  onChange: () => ({ dispose() {} }),
  findById: (hostId: string) =>
    hostId === MOCK_HOST_ENTRY.hostId ? MOCK_HOST_ENTRY : null,
};

// Enumerated on purpose, as in the sibling tile suites: spreading the barrel
// leaks provider-coupled hooks that throw outside a HostRuntimeProvider.
vi.mock("@/lib/host", () => ({
  useHostBinding: () => null,
  useHostDirectory: () => MOCK_HOST_DIRECTORY,
  useAuthService: () => ({
    revalidateCurrentContext: () => Promise.resolve({ kind: "valid" as const }),
  }),
  useHostClient: () => MOCK_HOST_CLIENT,
  useHostRuntimeClient: () => MOCK_HOST_CLIENT,
}));

vi.mock("@/hooks/host/use-tab-host-client", () => ({
  useTabHostClient: () => MOCK_HOST_CLIENT,
}));

vi.mock("@/hooks/host/use-host-client-for-host-id", () => ({
  useHostClientForHostId: () => null,
}));

vi.mock("@/hooks/host/use-host-stream-client-for", async (importActual) => ({
  ...(await importActual<
    typeof import("@/hooks/host/use-host-stream-client-for")
  >()),
  useHostStreamClientFor: () => null,
  useHostStreamClientBindingFor: () => null,
}));

vi.mock("@/lib/host/stream-runtime-context", () => ({
  useWsStreamClient: () => null,
  useStreamMethodSupport: () => null,
  useStreamMethodSchemaVersion: () => null,
}));

vi.mock("@/hooks/host/use-addressable-host-id", () => ({
  useAddressableHostId: () => "host-test",
}));

vi.mock("@/hooks/host/use-effective-host-id", () => ({
  useEffectiveHostId: () => "host-test",
}));

/**
 * What the mocked `useSlashCommands` answers. Like a TanStack query it keeps
 * answering with the SAME array until a test swaps it, and it answers with
 * cached data while the query is disabled; the tests swap it for a fresh array
 * of new-but-equal objects to model the re-enable that rebuilds the list.
 */
const slashQueryState = vi.hoisted<{
  data: ReadonlyArray<SlashCommand>;
  isLoading: boolean;
}>(() => ({ data: [], isLoading: false }));

vi.mock("@/hooks/composer/use-slash-commands", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/composer/use-slash-commands")
  >()),
  useSlashCommands: () => ({
    data: slashQueryState.data,
    isLoading: slashQueryState.isLoading,
    isFetching: false,
    error: null,
    refetch: () => Promise.resolve(undefined),
  }),
}));

interface TranscriptCapture {
  getMessageActions: unknown;
  nextStepActions: NextStepActionHandler | null;
}
const transcriptCapture: TranscriptCapture = {
  getMessageActions: null,
  nextStepActions: null,
};

vi.mock("@/components/chat/chat-messages", async (importActual) => {
  const actual =
    await importActual<typeof import("@/components/chat/chat-messages")>();
  return {
    ...actual,
    ChatMessages: (props: {
      readonly getMessageActions: unknown;
      readonly nextStepActions: NextStepActionHandler | null;
    }) => {
      transcriptCapture.getMessageActions = props.getMessageActions;
      transcriptCapture.nextStepActions = props.nextStepActions;
      return <div data-testid="transcript-stub" />;
    },
  };
});

const EPIC_ID = "epic-slash-catalog-hold";
const CHAT_ARTIFACT = {
  id: "chat-1",
  instanceId: "inst-chat-1",
  type: "chat" as const,
  name: "Chat 1",
  hostId: "host-test",
};
const SETTINGS: ChatRunSettings = {
  harnessId: "claude",
  model: "claude-sonnet",
  permissionMode: "supervised",
  reasoningEffort: "medium",
  serviceTier: null,
  agentMode: "regular",
  profileId: null,
};

function skill(name: string): SlashCommand {
  return {
    harnessId: "claude",
    name,
    description: `Run ${name}`,
    argumentHint: null,
    kind: "skill",
    metadata: { path: `/repo/.agents/skills/${name}/SKILL.md` },
    source: "provider",
    preview: {
      kind: "text",
      primary: `Run ${name}`,
      secondary: null,
      mono: false,
    },
  };
}

/** A fresh array of fresh objects: equal in content to any earlier call. */
function skills(...names: ReadonlyArray<string>): ReadonlyArray<SlashCommand> {
  return names.map((name) => skill(name));
}

function findNodeType(node: JsonContent, type: string): JsonContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findNodeType(child, type);
    if (found !== null) return found;
  }
  return null;
}

function commandNameOf(chip: JsonContent | null): string | null {
  const name = chip?.attrs?.commandName;
  return typeof name === "string" ? name : null;
}

const epicHarness = createEpicSessionTestHarness(EPIC_ID);
const chatHarness = createChatHarness();

function seedDocWithChat(doc: Y.Doc): void {
  const epic = doc.getMap("epic");
  const chats = new Y.Map<unknown>();
  const chat = new Y.Map<unknown>();
  chat.set("id", CHAT_ARTIFACT.id);
  chat.set("title", CHAT_ARTIFACT.name);
  chat.set("parentId", null);
  chat.set("createdAt", 0);
  chat.set("updatedAt", 0);
  chat.set("messages", new Y.Array<unknown>());
  chats.set(CHAT_ARTIFACT.id, chat);
  epic.set("title", "Epic Slash Catalog Hold");
  epic.set("artifacts", new Y.Map<unknown>());
  epic.set("chats", chats);
}

function createChatHarness(): {
  readonly sent: ChatSubscribeClientFrame[];
  install(): void;
  teardown(): void;
} {
  const sent: ChatSubscribeClientFrame[] = [];
  return {
    sent,
    install: () => {
      __setChatStreamClientFactoryForTests(
        (_epicId, _chatId, nextCallbacks) => {
          setTimeout(() => {
            nextCallbacks.onConnectionStatus("open", null, null);
            emitChatSnapshot(nextCallbacks);
          }, 0);
          const client: ChatStreamClientHandle = {
            sendAction: (frame) => {
              sent.push(frame);
            },
            sameTurnSteeringProtocolSupported: () => true,
            draftBlobBridgeSupported: () => true,
            requestTranscriptRange: () => undefined,
            requestResnapshot: () => undefined,
            close: () => undefined,
          };
          return client;
        },
      );
    },
    teardown: () => {
      __setChatStreamClientFactoryForTests(null);
      __getChatSessionRegistryForTests().disposeAll();
      sent.length = 0;
      transcriptCapture.getMessageActions = null;
      transcriptCapture.nextStepActions = null;
    },
  };
}

function emitChatSnapshot(callbacks: ChatStreamCallbacks): void {
  callbacks.onSnapshot({
    kind: "snapshot",
    hasBinaryPayload: false,
    epicId: EPIC_ID,
    chatId: CHAT_ARTIFACT.id,
    snapshot: {
      chat: {
        id: CHAT_ARTIFACT.id,
        parentId: null,
        userId: "owner-1",
        hostId: "host-test",
        title: CHAT_ARTIFACT.name,
        createdAt: 0,
        updatedAt: 0,
        archivedAt: null,
        pinnedUserProviderHandle: null,
        lastDeliveredRolesDigest: null,
        isTitleEditedByUser: false,
        settings: SETTINGS,
        activeSessionChain: null,
        claudePendingWakes: [],
        messages: [
          {
            role: "user",
            messageId: "message-1",
            sender: { type: "user", userId: "owner-1" },
            message: {
              kind: "user",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Host chat content" }],
                  },
                ],
              },
              browserAnnotations: [],
            },
            timestamp: 1,
            sessionAnchor: null,
          },
        ],
        events: [],
      },
      access: { role: "owner", ownerUserId: "owner-1", canAct: true },
      queue: { status: "idle", items: [] },
      runStatus: "idle",
      activeTurn: null,
      pendingApprovals: [],
      pendingInterviews: [],
      worktreeBinding: {
        entries: [
          {
            workspacePath: "/Users/test/project",
            mode: "local",
            repoIdentifier: null,
            worktreePath: null,
            branch: "main",
            isPrimary: true,
            isImported: false,
            setupState: "not_required",
            setupTerminalSessionId: null,
            setupExitCode: null,
            setupFailedAt: null,
            createdAt: 1,
            ownedSubmodules: [],
          },
        ],
      },
      missingWorktreePaths: [],
      pendingFileEditApprovals: [],
      accumulatedFileChanges: [],
      managedCommands: [],
      heldUpdates: [],
      portForwards: [],
    },
  });
}

function renderChatTile(focused: boolean): {
  readonly setFocused: (next: boolean) => void;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const runnerHost = new MockRunnerHost({
    signInUrl: "https://example.com",
    authnBaseUrl: "https://auth.example.com",
    localHost: null,
    hosts: [],
    workspaceFolderPickerPaths: undefined,
    hasLocalHost: undefined,
    traycerCli: undefined,
  });
  // Built from stable instances so the focus value is the only input that moves.
  const tree = (paneFocused: boolean) => (
    <TestRouterProvider>
      <QueryClientProvider client={queryClient}>
        <RunnerHostProvider runnerHost={runnerHost}>
          <TooltipProvider>
            <TestEpicSessionWrapper epicId={EPIC_ID}>
              <TabHostProvider hostId={CHAT_ARTIFACT.hostId}>
                <PaneSurfaceActivityContext.Provider
                  value={{ visible: true, focused: paneFocused }}
                >
                  <ChatTile
                    node={CHAT_ARTIFACT}
                    viewTabId="tab-slash-catalog-hold"
                    tileId="pane-slash-catalog-hold"
                    isActive
                  />
                </PaneSurfaceActivityContext.Provider>
              </TabHostProvider>
            </TestEpicSessionWrapper>
          </TooltipProvider>
        </RunnerHostProvider>
      </QueryClientProvider>
    </TestRouterProvider>
  );
  const { rerender } = render(tree(focused));
  return {
    setFocused: (next) => {
      act(() => {
        rerender(tree(next));
      });
    },
  };
}

async function waitForTranscript(): Promise<void> {
  await waitFor(() => {
    expect(transcriptCapture.getMessageActions).not.toBeNull();
    expect(transcriptCapture.nextStepActions).not.toBeNull();
  });
}

function capturedNextStepActions(): NextStepActionHandler {
  const actions = transcriptCapture.nextStepActions;
  if (actions === null) throw new Error("expected next-step actions");
  return actions;
}

/**
 * Sends `$<name> go` as a next step and returns the chip name the tile built
 * from its catalog (null when the catalog left the `$` as prose).
 */
function chipSentFor(name: string): string | null {
  const before = chatHarness.sent.length;
  let accepted = false;
  act(() => {
    accepted = capturedNextStepActions().onSend({
      id: `next-${name}`,
      prompt: `$${name} go`,
    });
  });
  expect(accepted).toBe(true);
  const frame = chatHarness.sent.slice(before).find((f) => f.kind === "send");
  if (frame === undefined) {
    throw new Error("expected a send frame");
  }
  return commandNameOf(findNodeType(frame.content, "slashCommand"));
}

beforeEach(async () => {
  installLegendListViewportMetrics();
  window.localStorage.clear();
  useAuthStore.setState({
    status: "signed-in",
    profile: {
      userId: "owner-1",
      userName: "Owner",
      email: "owner@example.com",
    },
    contextMetadata: { userId: "owner-1", username: "Owner" },
  });
  await resetComposerDraftPersistence();
  useComposerRunSettingsStore.getState().resetForTests();
  useComposerHarnessMemoryStore.getState().resetForTests();
  useSettingsStore.setState({
    defaultSelection: {
      harnessId: "claude",
      modelSlug: "claude-sonnet",
      profileId: null,
    },
  });
  resetFocusedComposerControlsForTests();
  slashQueryState.data = skills("alpha");
  slashQueryState.isLoading = false;
  epicHarness.install(seedDocWithChat, "editor");
  chatHarness.install();
});

afterEach(() => {
  cleanup();
  chatHarness.teardown();
  epicHarness.teardown();
  __getOpenEpicRegistryForTests().disposeAll();
  resetFocusedComposerControlsForTests();
});

describe("chat-tile slash catalog across a focus flip", () => {
  it("keeps the same catalog identity across a focus flip", async () => {
    const { setFocused } = renderChatTile(true);
    await waitForTranscript();
    const getMessageActionsBefore = transcriptCapture.getMessageActions;
    const nextStepActionsBefore = capturedNextStepActions();
    const onSendBefore = nextStepActionsBefore.onSend;

    setFocused(false);
    // TanStack hands back new-but-equal objects when the query is re-enabled.
    slashQueryState.data = skills("alpha");
    setFocused(true);

    expect(transcriptCapture.getMessageActions).toBe(getMessageActionsBefore);
    expect(capturedNextStepActions().onSend).toBe(onSendBefore);
    expect(capturedNextStepActions()).toBe(nextStepActionsBefore);
  });

  it("keeps resolving the held catalog while the tile is unfocused", async () => {
    const { setFocused } = renderChatTile(true);
    await waitForTranscript();
    expect(chipSentFor("alpha")).toBe("alpha");

    setFocused(false);

    expect(chipSentFor("alpha")).toBe("alpha");
  });

  it("uses the new catalog as soon as the tile is refocused after the commands changed", async () => {
    const { setFocused } = renderChatTile(true);
    await waitForTranscript();
    const onSendBefore = capturedNextStepActions().onSend;
    expect(chipSentFor("beta")).toBeNull();

    setFocused(false);
    slashQueryState.data = skills("alpha", "beta");
    setFocused(true);

    expect(capturedNextStepActions().onSend).not.toBe(onSendBefore);
    expect(chipSentFor("beta")).toBe("beta");
    expect(chipSentFor("alpha")).toBe("alpha");
  });

  it("returns no catalog while loading when focused", async () => {
    const { setFocused } = renderChatTile(true);
    await waitForTranscript();
    expect(chipSentFor("alpha")).toBe("alpha");

    setFocused(false);
    slashQueryState.isLoading = true;
    setFocused(true);

    // The held catalog must not leak into a focused, unresolved query.
    expect(chipSentFor("alpha")).toBeNull();
  });

  it("drops the held catalog when the query scope changes while unfocused", async () => {
    const { setFocused } = renderChatTile(true);
    await waitForTranscript();
    expect(chipSentFor("alpha")).toBe("alpha");

    setFocused(false);
    const handle = __getChatSessionRegistryForTests().peek(
      EPIC_ID,
      CHAT_ARTIFACT.id,
      CHAT_ARTIFACT.hostId,
    );
    if (handle === null) {
      throw new Error("expected chat session handle");
    }
    // The composer harness is part of the catalog query's scope. The mocked
    // query keeps answering with the old list, as a cache would for the old key.
    act(() => {
      handle.store
        .getState()
        .setCurrentComposerSettings({ ...SETTINGS, harnessId: "codex" });
    });

    // The old scope's catalog must not chip a send made under the new scope.
    expect(chipSentFor("alpha")).toBeNull();
  });
});
