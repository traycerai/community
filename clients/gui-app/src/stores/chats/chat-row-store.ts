import { createStore, type StoreApi } from "zustand/vanilla";
import { createSelector, createStructuredSelector, lruMemoize } from "reselect";
import { shallow } from "zustand/shallow";
import { replaceEqualDeep } from "@tanstack/react-query";
import { importedProvenance } from "@traycer/protocol/persistence/epic/chat-events";
import type { OpenChatQueueState } from "@traycer/protocol/host/agent/gui/subscribe";
import type { GuiHarnessId } from "@traycer/protocol/host";
import type { ChatSessionState } from "./chat-session-store";
import {
  projectQueueWithPendingCancellations,
  withdrawnMessageDeliveryId,
} from "./chat-session-store";
import { composerTurnStatus, resolvedTurnStatus } from "./chat-run-activity";
import {
  createRenderedMessagesProjector,
  transcriptShowsSetupCard,
  type RenderedMessagesDisplayContext,
  type RenderedMessagesInput,
} from "./rendered-messages";
import {
  transcriptListRows,
  type TranscriptListRow,
} from "./transcript-list-rows";
import type { ChatMessage } from "@/stores/composer/chat-store";
import { contentBlocksPreview } from "@/lib/chat/content-block-text";
import { agentProviderLabel } from "@/lib/chat/sender-display";
import {
  queuedPromptMessageIds,
  queueWithoutPersistedPrompts,
} from "@/components/chat/chat-queue-utils";
import {
  buildPinnedTodoRenderState,
  type PinnedTodoSnapshot,
} from "@/components/chat/chat-pinned-todos";
import { withholdUnpaintedRows } from "@/components/chat/chat-special-segment";
import {
  computeStableChatTimelineRows,
  computeStableTranscriptListRows,
  EMPTY_STABLE_CHAT_TIMELINE_ROWS_STATE,
  EMPTY_STABLE_TRANSCRIPT_LIST_ROWS_STATE,
} from "@/components/chat/chat-stable-rows";
import {
  accumulatedChangeRows,
  hostAccumulatedChangeRows,
  type AccumulatedChangeRow,
} from "@/lib/chat/accumulated-change-rows";
import {
  findPendingInterview,
  findUnanswerableInterviews,
} from "@/components/epic-canvas/renderers/chat-tile-session-state";
import type {
  PendingInterviewView,
  UnanswerableInterviewView,
} from "@/components/epic-canvas/renderers/chat-tile-types";

// The producer knows identities, never the viewer's catalog or tab. Row leaves
// resolve these fallbacks for their own presentation without invalidating rows.
const ROW_IDENTITY_CONTEXT: RenderedMessagesDisplayContext = {
  resolveUserSenderLabel: (sender) =>
    sender.type === "agent"
      ? (sender.displayName ?? sender.agentId)
      : sender.userId,
  resolveAgentSenderDisplay: (sender) => ({
    providerLabel: agentProviderLabel(sender.harnessId),
    modelLabel: sender.displayName ?? sender.agentId,
  }),
  resolveAgentReasoningLabel: (_sender, effort) => effort,
  contentBlocksPreview,
};
const EMPTY_SETUP_WINDOWS: RenderedMessagesInput["setupCardWindows"] = [];

export type ChatRowListEntry =
  | Extract<TranscriptListRow, { kind: "placeholder" }>
  | {
      readonly kind: "stored";
      readonly key: string;
      readonly ordinal: number | null;
      readonly role: ChatMessage["role"];
      readonly agentAuthored: boolean;
    };

export interface ChatRowSnapshot {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly rows: ReadonlyArray<TranscriptListRow>;
  readonly listEntries: ReadonlyArray<ChatRowListEntry>;
  readonly byId: ReadonlyMap<string, TranscriptListRow>;
  readonly queue: OpenChatQueueState;
  readonly todo: PinnedTodoSnapshot | null;
  readonly pendingInterview: PendingInterviewView | null;
  readonly unanswerableInterviews: ReadonlyArray<UnanswerableInterviewView>;
  readonly accumulatedFileChanges: ReadonlyArray<AccumulatedChangeRow>;
  readonly setupCardShown: boolean;
  readonly importedSourceProvider: GuiHarnessId | null;
}

function reuseShallow<T>(previous: T | undefined, next: T): T {
  return previous !== undefined && shallow(previous, next) ? previous : next;
}

export function createChatRowStore(source: StoreApi<ChatSessionState>): {
  readonly store: StoreApi<ChatRowSnapshot>;
  readonly dispose: () => void;
} {
  const project = createRenderedMessagesProjector();
  const selectQueueIds = createSelector(
    [(s: ChatSessionState) => s.queue.items],
    queuedPromptMessageIds,
    {
      memoize: lruMemoize,
      argsMemoize: lruMemoize,
      memoizeOptions: { resultEqualityCheck: shallow },
    },
  );
  const selectInput = createSelector(
    [
      createStructuredSelector({
        messages: (s: ChatSessionState) => s.messages,
        events: (s: ChatSessionState) => s.events,
        rowContext: (s: ChatSessionState) => s.transcriptRowContext,
        setupCardWindows: (s: ChatSessionState) =>
          s.transcriptDerived?.setupCardWindows ?? EMPTY_SETUP_WINDOWS,
        pendingUserMessages: (s: ChatSessionState) => s.pendingUserMessages,
        queuedPromptMessageIds: selectQueueIds,
        withdrawnMessageId: (s: ChatSessionState) =>
          withdrawnMessageDeliveryId(s.messageDelivery),
        liveAssistantMessage: (s: ChatSessionState) => s.liveAssistantMessage,
        activeTurn: (s: ChatSessionState) => s.activeTurn,
        pendingApprovals: (s: ChatSessionState) => s.pendingApprovals,
        pendingFileEditApprovals: (s: ChatSessionState) =>
          s.pendingFileEditApprovals,
        pendingInterviews: (s: ChatSessionState) => s.pendingInterviews,
        runStatus: (s: ChatSessionState) =>
          resolvedTurnStatus(s, composerTurnStatus(s.runStatus)) ?? "idle",
        chatWorking: (s: ChatSessionState) => s.runStatus !== "idle",
        epicId: (s: ChatSessionState) => s.epicId,
        ownerId: (s: ChatSessionState) => s.chatId,
      }),
    ],
    ({
      messages,
      events,
      rowContext,
      setupCardWindows,
      pendingUserMessages,
      queuedPromptMessageIds,
      withdrawnMessageId,
      liveAssistantMessage,
      activeTurn,
      pendingApprovals,
      pendingFileEditApprovals,
      pendingInterviews,
      runStatus,
      chatWorking,
      epicId,
      ownerId,
    }): RenderedMessagesInput => ({
      messages,
      events,
      rowContext,
      setupCardWindows,
      pendingUserMessages,
      queuedPromptMessageIds,
      withdrawnMessageId,
      liveAssistantMessage,
      activeTurn,
      pendingApprovals,
      pendingFileEditApprovals,
      pendingInterviews,
      runStatus,
      chatWorking,
      epicId,
      ownerId,
      ownerKind: "chat",
      viewTabId: "",
    }),
    { memoize: lruMemoize, argsMemoize: lruMemoize },
  );
  const selectMessages = createSelector(
    [selectInput],
    (input) => project(input, ROW_IDENTITY_CONTEXT),
    { memoize: lruMemoize, argsMemoize: lruMemoize },
  );
  const selectPainted = createSelector(
    [
      selectMessages,
      (s: ChatSessionState) => s.transcriptDerived,
      (s: ChatSessionState) => s.activeTurn?.turnId ?? null,
    ],
    (messages, derived, activeTurnId) =>
      buildPinnedTodoRenderState(
        withholdUnpaintedRows(messages),
        derived === null
          ? { kind: "derive" }
          : {
              kind: "host",
              todo: derived.pinnedTodo,
              taskItems: derived.pinnedTaskTodoItems,
              activeTurnId,
            },
      ),
    { memoize: lruMemoize, argsMemoize: lruMemoize },
  );
  const selectQueue = createSelector(
    [
      (s: ChatSessionState) => s.queue,
      (s: ChatSessionState) => s.pendingActions,
      (s: ChatSessionState) => s.acceptedActions,
      (s: ChatSessionState) => s.messages,
    ],
    (queue, pending, accepted, messages) =>
      queueWithoutPersistedPrompts(
        projectQueueWithPendingCancellations(queue, pending, accepted),
        messages,
      ),
    { memoize: lruMemoize, argsMemoize: lruMemoize },
  );
  const selectHostChanges = createSelector(
    [
      (s: ChatSessionState) => s.transcriptDerived !== null,
      (s: ChatSessionState) => s.accumulatedFileChanges,
      (s: ChatSessionState) => s.accumulatedFileChangeSummaries,
    ],
    (windowed, changes, summaries) =>
      hostAccumulatedChangeRows({ windowed, changes, summaries }),
    { memoize: lruMemoize, argsMemoize: lruMemoize },
  );
  const selectActiveTurnId = (state: ChatSessionState) =>
    state.activeTurn?.turnId ?? null;
  let sharedMessages = EMPTY_STABLE_CHAT_TIMELINE_ROWS_STATE;
  let sharedRows = EMPTY_STABLE_TRANSCRIPT_LIST_ROWS_STATE;
  let previous: ChatRowSnapshot | undefined;
  const derive = createSelector(
    [
      createStructuredSelector({
        rendered: selectMessages,
        painted: selectPainted,
        queue: selectQueue,
        hostChanges: selectHostChanges,
        activeTurnId: selectActiveTurnId,
        window: (state: ChatSessionState) =>
          state.transcriptDerived === null ? null : state.transcriptWindow,
        pendingInterviews: (state: ChatSessionState) => state.pendingInterviews,
        interviewAnswerability: (state: ChatSessionState) =>
          state.transcriptDerived?.interviewAnswerability ?? null,
        events: (state: ChatSessionState) => state.events,
      }),
    ],
    ({
      rendered,
      painted,
      queue,
      hostChanges,
      activeTurnId,
      window,
      pendingInterviews,
      interviewAnswerability,
      events,
    }): ChatRowSnapshot => {
      sharedMessages = computeStableChatTimelineRows(
        painted.messages.map((row) =>
          replaceEqualDeep(sharedMessages.byId.get(row.id), row),
        ),
        sharedMessages,
      );
      sharedRows = computeStableTranscriptListRows(
        transcriptListRows({
          window,
          rendered: sharedMessages.result,
        }),
        sharedRows,
      );
      const listEntries = sharedRows.result.map(
        (row, index): ChatRowListEntry => {
          const entry: ChatRowListEntry =
            row.kind === "placeholder"
              ? row
              : {
                  kind: "stored",
                  key: row.key,
                  ordinal: row.ordinal,
                  role: row.model.role,
                  agentAuthored: row.model.agentSenderInfo !== null,
                };
          const previousEntry = previous?.listEntries[index];
          return previousEntry !== undefined && shallow(previousEntry, entry)
            ? previousEntry
            : entry;
        },
      );
      const pendingIds = new Set(
        pendingInterviews.map((interview) => interview.blockId),
      );
      const next: ChatRowSnapshot = {
        messages: sharedMessages.result,
        rows: sharedRows.result,
        listEntries: reuseShallow(previous?.listEntries, listEntries),
        byId: sharedRows.byKey,
        queue: replaceEqualDeep(previous?.queue, queue),
        todo: replaceEqualDeep(previous?.todo, painted.todo),
        pendingInterview: replaceEqualDeep(
          previous?.pendingInterview,
          findPendingInterview(rendered, (id) => pendingIds.has(id)),
        ),
        unanswerableInterviews: replaceEqualDeep(
          previous?.unanswerableInterviews,
          findUnanswerableInterviews(
            rendered,
            pendingInterviews,
            interviewAnswerability,
          ),
        ),
        accumulatedFileChanges: replaceEqualDeep(
          previous?.accumulatedFileChanges,
          accumulatedChangeRows(rendered, hostChanges, activeTurnId),
        ),
        setupCardShown: transcriptShowsSetupCard(rendered),
        importedSourceProvider:
          importedProvenance(events)?.sourceProvider ?? null,
      };
      previous = reuseShallow(previous, next);
      return previous;
    },
    { memoize: lruMemoize, argsMemoize: lruMemoize },
  );
  const store = createStore<ChatRowSnapshot>(() => derive(source.getState()));
  const dispose = source.subscribe((state) =>
    store.setState(derive(state), true),
  );
  return { store, dispose };
}
