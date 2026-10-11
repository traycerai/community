import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PlainTerminalProjection } from "@traycer/protocol/host/terminal/plain-schemas";
import { TabBodySelectedContext } from "@/components/epic-canvas/canvas/tab-body-selected-context";
import { TabHostProvider } from "@/components/epic-canvas/tab-host-provider";
import { PaneVisibilityContext } from "@/components/epic-tabs/pane-visibility-context";
import { MEASURE_GRID_TIMEOUT_MS } from "@/hooks/agent/use-terminal-tile-bootstrap";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import {
  SurfaceDemandContext,
  type ActiveSurfaceDemand,
} from "@/stores/tabs/surface-demand";
import { collectPanes } from "@/stores/epics/canvas/tile-tree";
import type { EpicTerminalRef } from "@/stores/epics/canvas/types";

// A host restart leaves every durable plain terminal `dormant`: the record
// survives, the PTY does not, and the tile must ask the host to start it
// again (`terminal.plain.ensureRunning`). That wake is gated on the tile being
// ON SCREEN, not on its pane having focus. The reported failure: a terminal
// shown in the right pane of a split, focus in the left pane's chat composer,
// host restarted - the tile sat on "Starting terminal session…" for good, and
// a window reload changed nothing, because nothing ever asked the host.

const EPIC_ID = "epic-1";
const HOST_ID = "host-1";
const TERMINAL_ID = "terminal-1";

const dormantProjection: PlainTerminalProjection = {
  record: {
    terminalId: TERMINAL_ID,
    hostId: HOST_ID,
    scope: { kind: "epic", epicId: EPIC_ID },
    launch: { cwd: "/work/repo", shellCommand: "/bin/zsh", shellArgs: [] },
    manualTitle: "shell",
    revision: 1,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
  },
  runtime: { status: "dormant" },
};

const testState = vi.hoisted(() => ({
  // Never settles: the tile stays on its starting state, which is all these
  // tests observe - whether the host was asked at all.
  ensureRunning: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock("@/hooks/epic/use-epic-nested-focus-navigation", () => ({
  useEpicNestedFocusNavigation: () => vi.fn(),
}));

vi.mock("@/hooks/agent/use-host-reachability", () => ({
  useHostReachability: () => ({
    status: "reachable",
    hostLabel: "Host A",
    basis: "directory",
    unavailability: null,
  }),
  resolvedHostLabel: (r: { hostLabel: string | null }) => r.hostLabel,
}));

vi.mock("@/hooks/host/use-bounded-host-load", () => ({
  useBoundedHostLoad: () => ({ kind: "ready" as const }),
}));

vi.mock("@/lib/epic-selectors", () => ({
  useOpenEpicId: () => "epic-1",
}));

vi.mock("@/hooks/agent/use-terminal-tile-bootstrap", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/hooks/agent/use-terminal-tile-bootstrap")
    >();
  return { ...actual, TerminalXtermHost: () => null };
});

vi.mock(
  "@/lib/registries/terminal-session-registry",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/registries/terminal-session-registry")
      >();
    // A dormant terminal has no PTY to attach to, so no handle ever resolves.
    return { ...actual, useTerminalSessionHandle: () => null };
  },
);

vi.mock("@/hooks/terminal/use-epic-terminal-authority", () => ({
  useEpicTerminalAuthority: () => ({
    capability: "capable",
    projection: dormantProjection,
    viewModel: null,
    canMutate: true,
    migrationPending: false,
    migrationError: null,
    retryMigration: () => undefined,
    create: { mutateAsync: vi.fn(), isPending: false },
    ensureRunning: { mutateAsync: testState.ensureRunning, isPending: false },
    rename: { mutate: vi.fn(), isPending: false },
    close: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock("@/hooks/terminal/use-epic-terminal-durable-create", () => ({
  useEpicTerminalDurableCreate: () => null,
}));

vi.mock("@/lib/perf/terminal-load-perf", () => ({
  beginTerminalLoad: vi.fn(),
}));

import { TerminalTile } from "../terminal-tile";

function openHostTerminalFixture(): {
  readonly viewTabId: string;
  readonly paneId: string;
  readonly node: EpicTerminalRef;
} {
  const store = useEpicCanvasStore.getState();
  const viewTabId = store.openEpicTab(EPIC_ID, "Epic");
  const node: EpicTerminalRef = {
    id: TERMINAL_ID,
    instanceId: "inst-terminal-1",
    type: "terminal",
    name: "shell",
    hostId: HOST_ID,
    authority: "host",
    legacyFallback: { name: "shell", titleSource: "manual", cwd: "/work/repo" },
  };
  store.openTileInTab(viewTabId, node);
  const canvas = useEpicCanvasStore.getState().canvasByTabId[viewTabId];
  if (canvas === undefined) throw new Error("expected view tab canvas");
  return { viewTabId, paneId: collectPanes(canvas.root)[0].id, node };
}

/**
 * Mounts the tile in an UNFOCUSED pane (`isActive={false}`) and lets the grid
 * gate lapse. `rerenderWithDemand` swaps the surface demand the same tile sees,
 * the way a held tab cycle's keyup does.
 */
function renderUnfocusedDormantTile(placement: {
  readonly paneVisible: boolean;
  readonly tabSelected: boolean;
  readonly demand: ActiveSurfaceDemand;
}): { readonly rerenderWithDemand: (demand: ActiveSurfaceDemand) => void } {
  const fixture = openHostTerminalFixture();
  const tile: ReactNode = (
    <TerminalTile
      viewTabId={fixture.viewTabId}
      node={fixture.node}
      tileId={fixture.paneId}
      isActive={false}
    />
  );
  const queryClient = new QueryClient();
  const tree = (demand: ActiveSurfaceDemand): ReactNode => (
    <QueryClientProvider client={queryClient}>
      <TabHostProvider hostId={HOST_ID}>
        <PaneVisibilityContext value={placement.paneVisible}>
          <TabBodySelectedContext value={placement.tabSelected}>
            <SurfaceDemandContext value={demand}>{tile}</SurfaceDemandContext>
          </TabBodySelectedContext>
        </PaneVisibilityContext>
      </TabHostProvider>
    </QueryClientProvider>
  );
  const view = render(tree(placement.demand));
  act(() => {
    vi.advanceTimersByTime(MEASURE_GRID_TIMEOUT_MS);
  });
  return {
    rerenderWithDemand: (demand) => {
      view.rerender(tree(demand));
    },
  };
}

describe("<TerminalTile /> waking a dormant terminal", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    testState.ensureRunning.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("asks the host to start a dormant terminal that is on screen in an unfocused pane", () => {
    renderUnfocusedDormantTile({
      paneVisible: true,
      tabSelected: true,
      demand: "settled",
    });

    expect(screen.getByText("Starting terminal session…")).toBeDefined();
    expect(testState.ensureRunning).toHaveBeenCalledTimes(1);
    expect(testState.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: HOST_ID, terminalId: TERMINAL_ID }),
    );
  });

  it.each([
    {
      name: "a background tab of its pane",
      paneVisible: true,
      tabSelected: false,
    },
    { name: "a hidden epic tab", paneVisible: false, tabSelected: true },
  ])(
    "leaves a dormant terminal in $name asleep",
    ({ paneVisible, tabSelected }) => {
      renderUnfocusedDormantTile({
        paneVisible,
        tabSelected,
        demand: "settled",
      });

      expect(testState.ensureRunning).not.toHaveBeenCalled();
    },
  );
  it("does not wake a dormant terminal a held tab cycle is only previewing, and wakes it once, when the hold settles", () => {
    const view = renderUnfocusedDormantTile({
      paneVisible: true,
      tabSelected: true,
      demand: "preview",
    });

    // On screen and selected, yet only passed through: a wake per pass would
    // start every dormant terminal the cursor crosses after a host restart.
    expect(screen.getByText("Starting terminal session…")).toBeDefined();
    expect(testState.ensureRunning).not.toHaveBeenCalled();

    act(() => {
      view.rerenderWithDemand("settled");
    });
    expect(testState.ensureRunning).toHaveBeenCalledTimes(1);
    expect(testState.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: HOST_ID, terminalId: TERMINAL_ID }),
    );

    // A later preview of the same tile does not ask again.
    act(() => {
      view.rerenderWithDemand("preview");
    });
    act(() => {
      view.rerenderWithDemand("settled");
    });
    expect(testState.ensureRunning).toHaveBeenCalledTimes(1);
  });
});
