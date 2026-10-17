import { createRef, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LegendListRef } from "@legendapp/list/react";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import type { ChatTimelineFollowLatch } from "@/components/chat/chat-timeline-follow-latch";
import type { TranscriptListRow } from "@/stores/chats/transcript-list-rows";
import { makeMessage } from "@/components/chat/__tests__/chat-message-fixtures";
import "@/index.css";

const listRef = createRef<LegendListRef | null>();
const followLatchRef = createRef<ChatTimelineFollowLatch | null>();
const TOTAL_ROWS = 600;
const EDITED_ROW = 584;

function rowAt(index: number, hydrated: boolean): TranscriptListRow {
  const id = `message-${index}`;
  if (hydrated) {
    const role = index % 2 === 0 ? "user" : "assistant";
    const isLongAssistant = role === "assistant" && index >= EDITED_ROW - 15;
    return {
      kind: "hydrated",
      key: id,
      ordinal: index,
      model: {
        ...makeMessage(index, role),
        content:
          role === "user"
            ? `User message ${index}. `.repeat(index % 5 === 0 ? 24 : 2)
            : "",
        segments:
          role === "assistant"
            ? [
                {
                  id: `${id}:text`,
                  kind: "text",
                  markdown: `Assistant message ${index}. `.repeat(
                    isLongAssistant ? 400 : 4,
                  ),
                  isStreaming: false,
                },
              ]
            : [],
        persistentMessageId: id,
      },
    };
  }
  return {
    kind: "placeholder",
    key: id,
    ordinal: index,
    entry: {
      rowId: id,
      role: index % 2 === 0 ? "user" : "assistant",
      createdAt: index,
      byteLength: 100,
      bodyDigest: `digest-${index}`,
    },
  };
}

function rowsFor(
  phase: "initial" | "reindexed" | "hydrated",
): TranscriptListRow[] {
  if (phase === "initial") {
    return Array.from({ length: TOTAL_ROWS }, (_unused, index) =>
      rowAt(index, index >= EDITED_ROW - 15),
    );
  }
  const rows = Array.from({ length: EDITED_ROW }, (_unused, index) =>
    phase === "reindexed" && index < EDITED_ROW - 15
      ? { ...rowAt(index, false), key: `unplaced-${index}`, entry: null }
      : rowAt(index, index >= EDITED_ROW - 15),
  );
  if (phase === "reindexed") return rows;
  rows.push({
    kind: "hydrated",
    key: "edited-message",
    ordinal: null,
    model: {
      ...makeMessage(EDITED_ROW, "user"),
      id: "edited-message",
      content: "Edited message",
      persistentMessageId: "edited-message",
    },
  });
  return rows;
}

export function Fixture() {
  const [phase, setPhase] = useState<"initial" | "reindexed" | "hydrated">(
    "initial",
  );
  useLayoutEffect(() => {
    window.__windowedEditScrollProbe = {
      setPhase,
      // The edit submit issues ChatMessages' nonanimated end request, which
      // grants the list's follow latch before the host publishes the reindex.
      submitEdit: async () => {
        followLatchRef.current?.setFollowIntent(true);
        followLatchRef.current?.beginOwnedEndNavigation();
        await listRef.current?.scrollToEnd({ animated: false });
        followLatchRef.current?.completeOwnedEndNavigation(true);
      },
      scrollToEditedRow: async () => {
        await listRef.current?.scrollToIndex({
          index: EDITED_ROW,
          animated: false,
          viewPosition: 0.5,
        });
      },
      snapshot: () => {
        const node = listRef.current?.getScrollableNode();
        return {
          phase,
          scrollTop: node?.scrollTop ?? null,
          scrollHeight: node?.scrollHeight ?? null,
          clientHeight: node?.clientHeight ?? null,
          visibleMessageIds: Array.from(
            document.querySelectorAll("[data-message-id]"),
          )
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const parent = node?.getBoundingClientRect();
              return (
                parent !== undefined &&
                rect.bottom > parent.top &&
                rect.top < parent.bottom
              );
            })
            .map((element) => element.getAttribute("data-message-id")),
        };
      },
    };
  }, [phase]);
  return (
    <div className="flex h-full w-full flex-col">
      <div>Phase: {phase}</div>
      <div className="min-h-0 flex-1">
        <ChatTimeline
          rows={rowsFor(phase)}
          taskTitle="Windowed edit scroll probe"
          backgroundToolBlockIds={new Set()}
          getMessageActions={() => null}
          nextStepActions={null}
          listRef={listRef}
          followLatchRef={followLatchRef}
          initialScrollAtEnd={false}
          data-testid="chat-messages-scroll"
        />
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __windowedEditScrollProbe: {
      setPhase: (phase: "initial" | "reindexed" | "hydrated") => void;
      submitEdit: () => Promise<void>;
      scrollToEditedRow: () => Promise<void>;
      snapshot: () => {
        phase: string;
        scrollTop: number | null;
        scrollHeight: number | null;
        clientHeight: number | null;
        visibleMessageIds: (string | null)[];
      };
    };
  }
}

const container = document.querySelector("#root");
if (container === null) throw new Error("probe root missing");
createRoot(container).render(<Fixture />);
