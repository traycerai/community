/**
 * A tab being PREVIEWED (a transient hover/keyboard glance, see
 * `stores/tabs/surface-demand`) occupies its box with `SurfacePreviewShell` and
 * mounts none of the surface's resource owners. The shared loading states are
 * those owners' placeholders: a spinner is a running animation clock, and a
 * bounded host load is a lease subscription plus a deadline timer. Previewing
 * a dozen cold tabs must not start a dozen of either.
 *
 * Settled demand is the contract's other half: the words and the placeholder
 * stay exactly as they were.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SurfaceDemandContext } from "@/stores/tabs/surface-demand";
import { TerminalLoadingSkeleton } from "../terminal-loading-skeleton";
import { BoundedTileLoad, TileHostLoadState } from "../tile-host-load-state";

// The lease and the deadline are the host runtime's: a null lease is the
// authority not having spoken yet, which is the in-budget "connecting" state.
vi.mock("@/hooks/host/use-host-lease", () => ({
  useHostLease: () => null,
}));
vi.mock("@/hooks/host/use-load-deadline", () => ({
  useLoadDeadline: () => false,
}));
vi.mock("@/hooks/agent/use-host-reachability", () => ({
  useHostReachability: () => ({ status: "reachable", hostLabel: "Host A" }),
  resolvedHostLabel: (reachability: { readonly hostLabel: string | null }) =>
    reachability.hostLabel,
}));

afterEach(cleanup);

function inDemand(demand: "preview" | "settled", node: ReactNode): ReactNode {
  return (
    <SurfaceDemandContext.Provider value={demand}>
      {node}
    </SurfaceDemandContext.Provider>
  );
}

describe("TerminalLoadingSkeleton", () => {
  it("shows its words and spinner when settled", () => {
    render(inDemand("settled", <TerminalLoadingSkeleton />));

    expect(screen.getByText("Starting terminal")).toBeTruthy();
  });

  it("shows nothing at all while previewed", () => {
    const { container } = render(
      inDemand("preview", <TerminalLoadingSkeleton />),
    );

    expect(screen.queryByText("Starting terminal")).toBeNull();
    // The spinner is text (braille frames): an empty box has neither it nor
    // the words.
    expect(container.textContent).toBe("");
  });
});

describe("TileHostLoadState pending arms", () => {
  const PENDING = [
    { kind: "loading", hostLabel: "Host A" },
    { kind: "connecting", hostLabel: "Host A" },
  ] as const;

  it.each(PENDING)(
    "says what it is waiting on, with a spinner, when settled ($kind)",
    (load) => {
      const { container } = render(
        inDemand(
          "settled",
          <TileHostLoadState
            load={load}
            subject="terminal"
            onRetry={null}
            testId="tile-load"
          />,
        ),
      );

      const status = screen.getByRole("status");
      expect(status.getAttribute("data-load-kind")).toBe(load.kind);
      expect(status.textContent).toContain("Host A");
      // The spinner is part of the settled state (its glyph is aria-hidden).
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    },
  );

  it.each(PENDING)(
    "renders no message and no spinner while previewed ($kind)",
    (load) => {
      const { container } = render(
        inDemand(
          "preview",
          <TileHostLoadState
            load={load}
            subject="terminal"
            onRetry={null}
            testId="tile-load"
          />,
        ),
      );

      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByTestId("tile-load")).toBeNull();
      expect(container.textContent).toBe("");
    },
  );
});

describe("BoundedTileLoad", () => {
  function renderBounded(demand: "preview" | "settled"): void {
    render(
      inDemand(
        demand,
        <BoundedTileLoad
          hostId="host-a"
          subject="diff"
          onRetry={null}
          testId="bounded-load"
          fallback={<div data-testid="in-budget-fallback" />}
        />,
      ),
    );
  }

  it("keeps the surface's own in-budget placeholder when settled", () => {
    renderBounded("settled");

    expect(screen.getByTestId("in-budget-fallback")).toBeTruthy();
  });

  it("does not mount the surface's placeholder while previewed", () => {
    renderBounded("preview");

    expect(screen.queryByTestId("in-budget-fallback")).toBeNull();
  });
});
