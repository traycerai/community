import { act, cleanup, render } from "@testing-library/react";
import { use, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TileFindContext,
  type TileFindContextValue,
  useRegisterTileFindAdapter,
} from "@/components/epic-canvas/tile-find/tile-find-adapter-context";
import { TileFindScope } from "@/components/epic-canvas/tile-find/tile-find-scope";
import {
  PaneSurfaceActivityContext,
  PaneVisibilityContext,
} from "@/components/epic-tabs/pane-visibility-context";
import { TILE_KIND_BLANK } from "@/stores/epics/canvas/tile-kinds";
import type { BlankTileRef } from "@/stores/epics/canvas/types";
import {
  createUnavailableTileFindAdapter,
  useTileFindStore,
} from "@/stores/tile-find";

function makeBlankNode(instanceId: string): BlankTileRef {
  return {
    id: `${instanceId}-content`,
    instanceId,
    type: TILE_KIND_BLANK,
    name: "New tab",
    hostId: "host-1",
  };
}

describe("<TileFindScope />", () => {
  afterEach(() => {
    cleanup();
    useTileFindStore.getState().resetForTests();
  });

  it("excludes a hidden pane's active tile from find ownership, and transfers ownership when its pane becomes visible", () => {
    // The visible epic tab's active tile registers first.
    render(
      <PaneVisibilityContext.Provider value>
        <TileFindScope
          node={makeBlankNode("visible-tile")}
          viewTabId="view-visible"
          tileId="pane-visible"
          epicId="epic-1"
          isActive
        >
          <div />
        </TileFindScope>
      </PaneVisibilityContext.Provider>,
    );

    // A previously selected epic tab stays mounted (keep-alive) with its pane
    // hidden. It re-registers its active tile after the visible tab, so its
    // `registeredAt` outranks the visible tile's - the bug's exact trigger.
    const hidden = render(
      <PaneVisibilityContext.Provider value={false}>
        <TileFindScope
          node={makeBlankNode("hidden-tile")}
          viewTabId="view-hidden"
          tileId="pane-hidden"
          epicId="epic-1"
          isActive
        >
          <div />
        </TileFindScope>
      </PaneVisibilityContext.Provider>,
    );

    expect(useTileFindStore.getState().activeOwner?.tileInstanceId).toBe(
      "visible-tile",
    );

    // Switching tabs flips the hidden pane's visibility to true.
    act(() => {
      hidden.rerender(
        <PaneVisibilityContext.Provider value>
          <TileFindScope
            node={makeBlankNode("hidden-tile")}
            viewTabId="view-hidden"
            tileId="pane-hidden"
            epicId="epic-1"
            isActive
          >
            <div />
          </TileFindScope>
        </PaneVisibilityContext.Provider>,
      );
    });

    expect(useTileFindStore.getState().activeOwner?.tileInstanceId).toBe(
      "hidden-tile",
    );
  });
});

describe("<TileFindScope /> eligibility changes", () => {
  const originalRegisterTarget = useTileFindStore.getState().registerTarget;

  afterEach(() => {
    cleanup();
    useTileFindStore.setState({ registerTarget: originalRegisterTarget });
    useTileFindStore.getState().resetForTests();
  });

  const NODE = makeBlankNode("eligibility-tile");
  const ADAPTER = createUnavailableTileFindAdapter({
    tileInstanceId: NODE.instanceId,
    tileKind: NODE.type,
    message: null,
  });

  function countRegistrations(): { readonly count: () => number } {
    let registrations = 0;
    useTileFindStore.setState({
      registerTarget: (registration) => {
        registrations += 1;
        return originalRegisterTarget(registration);
      },
    });
    return { count: () => registrations };
  }

  const contextValues: TileFindContextValue[] = [];

  function ContextProbe(): ReactNode {
    const value = use(TileFindContext);
    if (value !== null) contextValues.push(value);
    useRegisterTileFindAdapter(ADAPTER);
    return null;
  }

  function Tree(props: {
    readonly isActive: boolean;
    readonly focused: boolean;
  }): ReactNode {
    return (
      <PaneSurfaceActivityContext.Provider
        value={{ visible: true, focused: props.focused }}
      >
        <TileFindScope
          node={NODE}
          viewTabId="view-1"
          tileId="pane-1"
          epicId="epic-1"
          isActive={props.isActive}
        >
          <ContextProbe />
        </TileFindScope>
      </PaneSurfaceActivityContext.Provider>
    );
  }

  it("flips eligibility on isActive and pane focus without re-registering the target or changing the context value", () => {
    contextValues.length = 0;
    const registrations = countRegistrations();
    const view = render(<Tree isActive focused />);

    const registeredAfterMount = registrations.count();
    const targetAfterMount =
      useTileFindStore.getState().targetsByTileInstanceId[NODE.instanceId];
    expect(targetAfterMount?.adapter).toBe(ADAPTER);
    expect(targetAfterMount?.isEligible).toBe(true);
    const contextAfterMount = contextValues.at(-1);

    act(() => view.rerender(<Tree isActive={false} focused />));
    expect(
      useTileFindStore.getState().targetsByTileInstanceId[NODE.instanceId]
        ?.isEligible,
    ).toBe(false);
    expect(useTileFindStore.getState().activeOwner).toBeNull();

    act(() => view.rerender(<Tree isActive focused={false} />));
    expect(
      useTileFindStore.getState().targetsByTileInstanceId[NODE.instanceId]
        ?.isEligible,
    ).toBe(false);

    act(() => view.rerender(<Tree isActive focused />));
    expect(
      useTileFindStore.getState().targetsByTileInstanceId[NODE.instanceId]
        ?.isEligible,
    ).toBe(true);
    expect(useTileFindStore.getState().activeOwner?.tileInstanceId).toBe(
      NODE.instanceId,
    );

    expect(registrations.count()).toBe(registeredAfterMount);
    expect(
      useTileFindStore.getState().targetsByTileInstanceId[NODE.instanceId]
        ?.registeredAt,
    ).toBe(targetAfterMount?.registeredAt);
    expect(contextValues.at(-1)).toBe(contextAfterMount);
    expect(new Set(contextValues).size).toBe(1);
  });

  it("registers an inactive tile as ineligible and becomes eligible when it activates", () => {
    contextValues.length = 0;
    const view = render(<Tree isActive={false} focused />);
    expect(
      useTileFindStore.getState().targetsByTileInstanceId[NODE.instanceId]
        ?.isEligible,
    ).toBe(false);

    act(() => view.rerender(<Tree isActive focused />));
    expect(
      useTileFindStore.getState().targetsByTileInstanceId[NODE.instanceId]
        ?.isEligible,
    ).toBe(true);
  });
});
