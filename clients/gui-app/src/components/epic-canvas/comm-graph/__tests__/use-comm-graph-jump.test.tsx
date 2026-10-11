/**
 * The jump affordance follows the host directory.
 *
 * `isOriginAvailable` asks the directory at CALL time, so the hook's own
 * callbacks keep one identity while a host goes offline; what moves is the
 * directory snapshot the hook subscribes to. A row that renders
 * `canJump(event)` must still lose its affordance when that happens, with the
 * graph (and so the hook) staying mounted throughout.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import type { CommGraphEvent } from "@/lib/comm-graph/comm-graph-events";
import type { CommGraphAgentNode } from "@/lib/comm-graph/comm-graph-model";
import { useCommGraphJump } from "@/components/epic-canvas/comm-graph/use-comm-graph-jump";

interface DirectoryFake {
  readonly entries: Map<string, HostDirectoryEntry>;
  findById(hostId: string): HostDirectoryEntry | null;
  onChange(listener: () => void): { readonly dispose: () => void };
  set(entry: HostDirectoryEntry): void;
}

const directoryFake = vi.hoisted((): DirectoryFake => {
  const listeners = new Set<() => void>();
  const fake: DirectoryFake = {
    entries: new Map(),
    findById: (hostId) => fake.entries.get(hostId) ?? null,
    onChange: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    set: (entry) => {
      fake.entries.set(entry.hostId, entry);
      listeners.forEach((listener) => listener());
    },
  };
  return fake;
});

vi.mock("@/lib/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/host")>();
  return { ...actual, useHostDirectory: () => directoryFake };
});

const tileNavigation = vi.hoisted(() => ({ openTile: () => undefined }));
vi.mock("@/hooks/epic/use-epic-tile-navigation", () => ({
  useEpicTileNavigation: () => tileNavigation,
}));

// A stable lookup: the real hook's identity only moves on a readiness flip,
// which is not what this suite is about.
const noReadySession = vi.hoisted(
  () =>
    (_hostId: string): boolean =>
      false,
);
vi.mock("@/hooks/host/use-remote-sessions-poll-readiness", () => ({
  useRemoteSessionsPollReadiness: () => noReadySession,
}));

const HOST_ID = "host-a";

function hostEntry(websocketUrl: string | null): HostDirectoryEntry {
  return {
    hostId: HOST_ID,
    label: "Host A",
    kind: "local",
    websocketUrl,
    version: "0.0.0-test",
    transportDialability: "dialable",
  };
}

const AGENTS: ReadonlyArray<CommGraphAgentNode> = [
  {
    id: "agent-1",
    kind: "chat",
    name: "Orchestrator",
    hostId: HOST_ID,
    parentId: null,
    harnessId: null,
    model: null,
    archived: false,
    archivedAt: null,
    createdAt: 1,
  },
];

const EVENTS: ReadonlyArray<CommGraphEvent> = [
  {
    hostId: HOST_ID,
    id: 1,
    timestamp: 1_000,
    kind: "a2a_message",
    senderAgentId: null,
    receiverAgentId: "agent-1",
    responseId: "r1",
    inReplyTo: null,
    expectReply: false,
    messageText: "hello",
    noticeReason: null,
    originKind: null,
    originChatId: null,
    originRefId: null,
    peerEpicId: null,
  },
];

/** What a timeline row does: ask `canJump` while it renders. */
function JumpRows() {
  const jump = useCommGraphJump("epic-1", AGENTS, EVENTS);
  return (
    <ul>
      {EVENTS.map((event) => (
        <li key={event.id}>
          {jump.canJump(event) ? "jump available" : "jump unavailable"}
        </li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  directoryFake.entries.clear();
});
afterEach(cleanup);

describe("useCommGraphJump", () => {
  it("takes the jump affordance away when the origin host goes offline, and gives it back", () => {
    directoryFake.entries.set(HOST_ID, hostEntry("ws://127.0.0.1:4917/rpc"));
    render(<JumpRows />);
    expect(screen.getByText("jump available")).not.toBeNull();

    act(() => {
      directoryFake.set(hostEntry(null));
    });
    expect(screen.getByText("jump unavailable")).not.toBeNull();

    act(() => {
      directoryFake.set(hostEntry("ws://127.0.0.1:4917/rpc"));
    });
    expect(screen.getByText("jump available")).not.toBeNull();
  });
});
