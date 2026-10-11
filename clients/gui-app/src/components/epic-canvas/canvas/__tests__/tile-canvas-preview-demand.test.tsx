import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TileCanvas } from "@/components/epic-canvas/canvas/tile-canvas";
import { SnapshotLoadingProvider } from "@/components/epic-canvas/snapshots/snapshot-loading-context";
import { useInitialChatHandoffStore } from "@/stores/epics/initial-chat-handoff-store";
import {
  SurfaceDemandContext,
  type ActiveSurfaceDemand,
} from "@/stores/tabs/surface-demand";

const EPIC_ID = "epic-preview-demand";
const TAB_ID = "tab-preview-demand";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: () => undefined }),
}));

vi.mock("@/lib/epic-selectors", () => ({
  useEpicHasArtifactRecords: () => false,
}));

function renderUnloadedCanvas(demand: ActiveSurfaceDemand) {
  return render(
    <SurfaceDemandContext.Provider value={demand}>
      <SnapshotLoadingProvider
        value={{ snapshotLoaded: false, snapshotFetchError: null }}
      >
        <TileCanvas epicId={EPIC_ID} tabId={TAB_ID} />
      </SnapshotLoadingProvider>
    </SurfaceDemandContext.Provider>,
  );
}

beforeEach(() => {
  useInitialChatHandoffStore.getState().resetForTests();
});

afterEach(() => {
  cleanup();
});

describe("<TileCanvas /> before its snapshot loads, by surface demand", () => {
  it("shows the static preview shell, never the animated skeleton, while previewed", () => {
    const { container } = renderUnloadedCanvas("preview");

    expect(screen.getByTestId("surface-preview-shell")).toBeTruthy();
    expect(screen.queryByTestId("canvas-skeleton")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("shows the loading skeleton once settled", () => {
    renderUnloadedCanvas("settled");

    expect(screen.getByTestId("canvas-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("surface-preview-shell")).toBeNull();
  });
});
