import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaneVisibilityContext } from "@/components/epic-tabs/pane-visibility-context";
import { TabBodySelectedContext } from "@/components/epic-canvas/canvas/tab-body-selected-context";
import {
  SurfaceDemandContext,
  setPaneDemand,
  setTopLevelDemand,
  useSurfaceDemand,
  useSurfaceDemandStore,
  type ActiveSurfaceDemand,
} from "@/stores/tabs/surface-demand";

describe("useSurfaceDemand", () => {
  function demandFor(input: {
    readonly demand: ActiveSurfaceDemand | undefined;
    readonly paneVisible: boolean;
    readonly tabSelected: boolean;
  }) {
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => {
      const tree = createElement(
        PaneVisibilityContext.Provider,
        { value: input.paneVisible },
        createElement(
          TabBodySelectedContext.Provider,
          { value: input.tabSelected },
          props.children,
        ),
      );
      return input.demand === undefined
        ? tree
        : createElement(
            SurfaceDemandContext.Provider,
            { value: input.demand },
            tree,
          );
    };
    return renderHook(() => useSurfaceDemand(), { wrapper }).result.current;
  }

  it("reports the provided demand only while the surface is both pane-visible and its tab body is selected", () => {
    for (const demand of ["preview", "settled"] as const) {
      expect(demandFor({ demand, paneVisible: true, tabSelected: true })).toBe(
        demand,
      );
      expect(
        demandFor({ demand, paneVisible: false, tabSelected: true }),
      ).toBeNull();
      expect(
        demandFor({ demand, paneVisible: true, tabSelected: false }),
      ).toBeNull();
    }
  });

  it("with no provider, a visible surface is settled: ordinary mounts never wait on a preview", () => {
    expect(
      demandFor({ demand: undefined, paneVisible: true, tabSelected: true }),
    ).toBe("settled");
  });
});

describe("surface demand writers", () => {
  function resetStore(): void {
    useSurfaceDemandStore.setState({
      topLevelActiveKeys: null,
      topLevelPreviewKeys: [],
      panePreviewTargets: {},
      settleEpoch: 0,
    });
  }

  beforeEach(resetStore);
  afterEach(resetStore);

  function countNotifications(): {
    readonly count: () => number;
    readonly stop: () => void;
  } {
    let notified = 0;
    const stop = useSurfaceDemandStore.subscribe(() => {
      notified += 1;
    });
    return { count: () => notified, stop };
  }

  it("settling a pane that is not previewing keeps the state identity and notifies nobody", () => {
    const before = useSurfaceDemandStore.getState();
    const spy = countNotifications();
    setPaneDemand("p", "x", "settled");
    spy.stop();
    expect(useSurfaceDemandStore.getState()).toBe(before);
    expect(spy.count()).toBe(0);
  });

  it("writing the same pane preview twice notifies once", () => {
    const spy = countNotifications();
    setPaneDemand("p", "x", "preview");
    const afterFirst = useSurfaceDemandStore.getState();
    setPaneDemand("p", "x", "preview");
    spy.stop();
    expect(spy.count()).toBe(1);
    expect(useSurfaceDemandStore.getState()).toBe(afterFirst);
    expect(useSurfaceDemandStore.getState().panePreviewTargets).toEqual({
      p: "x",
    });
  });

  it("writing the same settled top-level keys twice notifies once", () => {
    const spy = countNotifications();
    setTopLevelDemand(["epic:a"], "settled");
    const afterFirst = useSurfaceDemandStore.getState();
    setTopLevelDemand(["epic:a"], "settled");
    spy.stop();
    expect(spy.count()).toBe(1);
    expect(useSurfaceDemandStore.getState()).toBe(afterFirst);
  });

  it("a different preview key set is still written", () => {
    setTopLevelDemand(["epic:a"], "preview");
    setTopLevelDemand(["epic:b"], "preview");
    expect(useSurfaceDemandStore.getState().topLevelPreviewKeys).toEqual([
      "epic:b",
    ]);
  });

  it("settleEpoch bumps only when the last outstanding preview clears", () => {
    const epoch = (): number => useSurfaceDemandStore.getState().settleEpoch;
    expect(epoch()).toBe(0);

    // Starting a hold is not an edge.
    setTopLevelDemand(["epic:a"], "preview");
    expect(epoch()).toBe(0);
    setPaneDemand("p", "x", "preview");
    expect(epoch()).toBe(0);

    // One preview clearing while another is outstanding is not the last.
    setTopLevelDemand(["epic:a"], "settled");
    expect(epoch()).toBe(0);

    // The last preview clearing is.
    setPaneDemand("p", "x", "settled");
    expect(epoch()).toBe(1);

    // Settling with nothing previewing does not bump again.
    setPaneDemand("p", "x", "settled");
    setTopLevelDemand(["epic:a"], "settled");
    expect(epoch()).toBe(1);

    // A second hold settles on a second edge.
    setPaneDemand("q", "y", "preview");
    setPaneDemand("q", "y", "settled");
    expect(epoch()).toBe(2);
  });
});
