/**
 * A tab that nothing changed for must not re-render when its strip does.
 *
 * The strip re-renders on every tab step (drop indicator, offsets) and
 * whenever its parent does. `TabItem` is behind `memo`, which only helps if
 * every prop is stable: the strip hands each tab the SHARED `menuHandlers`
 * object plus a `canCloseRight` boolean and the item builds its own menu props
 * (an object literal built in the strip's map was new on every strip render).
 *
 * Renders are counted at `useTabActivation`, which `TabItemBody` calls exactly
 * once per render, keyed by the tab's instance id. That hook and the
 * title/archive selectors are replaced with counting stand-ins that return
 * realistic values; everything else on the tab (drag, drop, context menu,
 * inline rename) is the real component.
 */
import { useState, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TabStrip,
  type TabStripProps,
} from "@/components/epic-canvas/canvas/tab-strip";
import type { EpicArtifactRef } from "@/stores/epics/canvas/types";

const counters = vi.hoisted(() => ({
  /** Renders of each tab body, by tab instance id. */
  renders: new Map<string, number>(),
}));

vi.mock("@/stores/epics/canvas/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/epics/canvas/store")>();
  return {
    ...actual,
    useTabActivation: (
      _viewTabId: string,
      _groupId: string,
      instanceId: string,
    ) => {
      counters.renders.set(
        instanceId,
        (counters.renders.get(instanceId) ?? 0) + 1,
      );
      return { isActive: false, isPreview: false, isGloballyActive: false };
    },
    useIsActivePane: () => false,
  };
});

vi.mock("@/lib/epic-selectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/epic-selectors")>();
  return {
    ...actual,
    useEpicTabDisplayTitle: (node: { readonly name: string }) => node.name,
    useRegisteredEpicNodeArchived: () => false,
    useEpicLiveArtifactTitleGenerating: () => false,
  };
});

vi.mock("@/hooks/host/use-host-client-for-host-id", () => ({
  useHostClientForHostId: () => null,
}));

vi.mock("@/hooks/terminal/use-terminal-rename-for-mutation", () => ({
  useTerminalRenameFor: () => ({ mutate: () => undefined }),
}));

vi.mock("@/hooks/agent/use-host-reachability", () => ({
  useHostReachability: (hostId: string) => ({
    status: "reachable",
    hostLabel: hostId,
    unavailability: null,
    basis: "directory",
    hostKind: "unknown",
  }),
}));

vi.mock("@/stores/managed-commands/managed-commands-for-chat", () => ({
  useManagedCommandOnHost: () => null,
}));

const EPIC_ID = "epic-1";
const VIEW_TAB_ID = "view-tab-1";
const GROUP_ID = "group-1";

function specTab(n: number): EpicArtifactRef {
  return {
    id: `artifact-${n}`,
    instanceId: `inst-${n}`,
    type: "spec",
    name: `Spec ${n}`,
    hostId: "host-1",
  };
}

function rendersOf(n: number): number {
  return counters.renders.get(`inst-${n}`) ?? 0;
}

/** Stable handler props, the way `TabGroupView` supplies them. */
function makeProps(): Omit<TabStripProps, "tabs"> {
  return {
    epicId: EPIC_ID,
    tabId: VIEW_TAB_ID,
    groupId: GROUP_ID,
    activeTabId: null,
    onSelectTab: () => undefined,
    onCloseTab: () => undefined,
    onPromotePreview: () => undefined,
    onSplit: () => undefined,
    onCloseGroup: () => undefined,
    onOpenBlankTab: () => undefined,
    canRenameTabs: true,
    menuHandlers: {
      onClose: () => undefined,
      onCloseOthers: () => undefined,
      onCloseRight: () => undefined,
      onCloseAll: () => undefined,
      onSplit: () => undefined,
      onRevealInSidebar: () => undefined,
      onRename: () => undefined,
    },
  };
}

interface HarnessProps {
  readonly stripProps: Omit<TabStripProps, "tabs">;
  readonly tabs: ReadonlyArray<EpicArtifactRef>;
}

/** A parent with unrelated state: bumping it re-renders the strip with the
 * very same props objects. */
function Harness(props: HarnessProps): ReactElement {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button
        type="button"
        data-testid="bump"
        onClick={() => setTick((t) => t + 1)}
      >
        {tick}
      </button>
      <TabStrip {...props.stripProps} tabs={props.tabs} />
    </div>
  );
}

describe("TabStrip item memoisation", () => {
  beforeEach(() => {
    counters.renders.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not re-render any tab when the strip re-renders with unchanged props", () => {
    const tabs = [specTab(1), specTab(2), specTab(3)];
    const stripProps = makeProps();
    render(<Harness stripProps={stripProps} tabs={tabs} />);

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const before = [rendersOf(1), rendersOf(2), rendersOf(3)];
    // Every tab rendered at least once, so the counter is wired to the body.
    expect(before.every((count) => count >= 1)).toBe(true);

    fireEvent.click(screen.getByTestId("bump"));
    fireEvent.click(screen.getByTestId("bump"));

    expect(screen.getByTestId("bump").textContent).toBe("2");
    expect([rendersOf(1), rendersOf(2), rendersOf(3)]).toEqual(before);
  });

  it("re-renders only the tab whose canCloseRight flipped, plus the new one, when a tab is appended", () => {
    const initial = [specTab(1), specTab(2), specTab(3)];
    const stripProps = makeProps();
    const { rerender } = render(
      <Harness stripProps={stripProps} tabs={initial} />,
    );
    const before = [rendersOf(1), rendersOf(2), rendersOf(3)];

    rerender(
      <Harness stripProps={stripProps} tabs={[...initial, specTab(4)]} />,
    );

    // Tabs 1 and 2 already had a tab to their right; tab 3 was last and now
    // is not, so its flag flipped. Tab 4 is new.
    expect(rendersOf(1)).toBe(before[0]);
    expect(rendersOf(2)).toBe(before[1]);
    expect(rendersOf(3)).toBeGreaterThan(before[2]);
    expect(rendersOf(4)).toBeGreaterThanOrEqual(1);
  });
});
