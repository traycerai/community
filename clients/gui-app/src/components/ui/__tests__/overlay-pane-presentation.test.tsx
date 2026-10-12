/**
 * What a pane losing focus, and a region being concealed, do to the app's
 * overlay primitives (`components/ui/{context-menu,dropdown-menu,popover,
 * dialog,hover-card,tooltip}.tsx`).
 *
 * Two contracts, both driven through the real primitives under the real
 * `SurfacePresentationBoundary` and `PortalConcealmentProvider`:
 *
 * - A CLOSED overlay is inert: its content component does not re-render when
 *   the pane's focus or the region's concealment flips. A split pane keeps
 *   dozens of closed menus, popovers and hover cards mounted, and every one of
 *   them used to be re-rendered by each focus change because the guard was
 *   read in the content wrapper rather than inside the portal's presence.
 * - An OPEN overlay still un-presents with the pane and with the region, and
 *   re-presents intact when they return.
 *
 * Children and roots are the same element objects across every rerender, so a
 * Profiler update commit can only come from the overlay subscribing to the
 * pane or concealment context itself.
 */
import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurfacePresentationBoundary } from "@/components/layout/surface-presentation-boundary";
import { PortalConcealmentProvider } from "@/components/ui/portal-concealment-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { HoverCard } from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const motion = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/animation/use-motion-enabled", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/animation/use-motion-enabled")>();
  return { ...actual, useMotionEnabled: () => motion.enabled };
});

beforeEach(() => {
  motion.enabled = false;
});

afterEach(cleanup);

/** Wraps the part of an overlay whose renders the test counts. */
type Wrap = (node: ReactNode) => ReactNode;

interface OverlayCase {
  readonly name: string;
  /**
   * Selectors for every part the overlay presents, found in `document.body`.
   * A dialog and a sheet present a backdrop beside the content, and each is
   * un-presented on its own, so both are named.
   */
  readonly slots: readonly string[];
  /**
   * Whether an unfocused pane un-presents the open overlay. The modal-family
   * wrappers do, to drop `hideOthers` and the scroll lock; labels and the
   * sheet answer to concealment alone.
   */
  readonly leavesWithPane: boolean;
  readonly build: (open: boolean, wrap: Wrap) => ReactNode;
  /** Opens an overlay that has no controlled `open` (a context menu). */
  readonly present: () => void;
}

const noPresent = (): void => undefined;

const CASES: readonly OverlayCase[] = [
  {
    name: "ContextMenuContent",
    slots: ['[data-slot="context-menu-content"]'],
    leavesWithPane: true,
    present: () => {
      fireEvent.contextMenu(screen.getByTestId("anchor"));
    },
    build: (_open, wrap) => (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button type="button" data-testid="anchor">
            Anchor
          </button>
        </ContextMenuTrigger>
        {wrap(
          <ContextMenuContent>
            <ContextMenuItem>Item</ContextMenuItem>
          </ContextMenuContent>,
        )}
      </ContextMenu>
    ),
  },
  {
    name: "DropdownMenuContent",
    slots: ['[data-slot="dropdown-menu-content"]'],
    leavesWithPane: true,
    present: noPresent,
    build: (open, wrap) => (
      <DropdownMenu open={open}>
        <DropdownMenuTrigger asChild>
          <button type="button">Anchor</button>
        </DropdownMenuTrigger>
        {wrap(
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>,
        )}
      </DropdownMenu>
    ),
  },
  {
    name: "PopoverContent",
    slots: ['[data-slot="popover-content"]'],
    leavesWithPane: true,
    present: noPresent,
    build: (open, wrap) => (
      <Popover open={open}>
        <PopoverTrigger asChild>
          <button type="button">Anchor</button>
        </PopoverTrigger>
        {wrap(<PopoverContent>Body</PopoverContent>)}
      </Popover>
    ),
  },
  {
    name: "DialogContent",
    slots: ['[data-slot="dialog-content"]', '[data-slot="dialog-overlay"]'],
    leavesWithPane: true,
    present: noPresent,
    build: (open, wrap) => (
      <Dialog open={open}>
        {wrap(
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            Body
          </DialogContent>,
        )}
      </Dialog>
    ),
  },
  {
    name: "SheetContent",
    slots: ['[data-slot="sheet-content"]', '[data-slot="sheet-overlay"]'],
    leavesWithPane: false,
    present: noPresent,
    build: (open, wrap) => (
      <Sheet open={open}>
        {wrap(
          <SheetContent>
            <SheetTitle>Title</SheetTitle>
            Body
          </SheetContent>,
        )}
      </Sheet>
    ),
  },
  {
    name: "TooltipContent",
    slots: ['[data-slot="tooltip-content"]'],
    leavesWithPane: false,
    present: noPresent,
    build: (open, wrap) => (
      <Tooltip open={open}>
        <TooltipTrigger asChild>
          <button type="button">Anchor</button>
        </TooltipTrigger>
        {wrap(<TooltipContent>Label</TooltipContent>)}
      </Tooltip>
    ),
  },
  {
    name: "HoverCard",
    slots: ['[data-slot="hover-card-content"]'],
    leavesWithPane: false,
    present: noPresent,
    build: (open, wrap) =>
      wrap(
        <HoverCard
          trigger={<button type="button">Anchor</button>}
          content={<span>Body</span>}
          appearance="preview"
          semantics={{ role: "dialog", label: "Preview" }}
          side="right"
          align="start"
          sideOffset={8}
          enabled
          open={open}
          onOpenChange={null}
          testId={null}
          className={null}
        />,
      ),
  },
];

function Scene(props: {
  readonly tree: ReactNode;
  readonly focused: boolean;
  readonly concealed: boolean;
}): ReactNode {
  return (
    <PortalConcealmentProvider value={props.concealed}>
      <SurfacePresentationBoundary visible focused={props.focused}>
        {props.tree}
      </SurfacePresentationBoundary>
    </PortalConcealmentProvider>
  );
}

describe("a closed overlay under a pane that loses focus or a concealed region", () => {
  it.each(CASES)(
    "$name commits no update when focus or concealment flips",
    ({ build }) => {
      const phases: string[] = [];
      const onRender: ProfilerOnRenderCallback = (_id, phase) => {
        phases.push(phase);
      };
      // One tree object for every render below: only the providers above it
      // change, so a React Profiler commit under it is a context subscription.
      const tree = build(false, (node) => (
        <Profiler id="overlay" onRender={onRender}>
          {node}
        </Profiler>
      ));
      const { rerender } = render(
        <Scene tree={tree} focused concealed={false} />,
      );
      phases.length = 0;

      const updatesAfter = (focused: boolean, concealed: boolean): number => {
        phases.length = 0;
        rerender(<Scene tree={tree} focused={focused} concealed={concealed} />);
        return phases.length;
      };

      expect({
        paneBlurred: updatesAfter(false, false),
        paneFocused: updatesAfter(true, false),
        regionConcealed: updatesAfter(true, true),
        regionRevealed: updatesAfter(true, false),
      }).toEqual({
        paneBlurred: 0,
        paneFocused: 0,
        regionConcealed: 0,
        regionRevealed: 0,
      });
    },
  );
});

describe("an open overlay under a pane that loses focus or a concealed region", () => {
  /** The named slots currently in the document, in the order they are named. */
  function presented(slots: readonly string[]): string[] {
    return slots.filter(
      (selector) => document.body.querySelector(selector) !== null,
    );
  }

  it.each(CASES)(
    "$name follows the pane's focus",
    ({ build, slots, leavesWithPane, present }) => {
      const tree = build(true, (node) => node);
      const { rerender } = render(
        <Scene tree={tree} focused concealed={false} />,
      );
      present();
      expect(presented(slots)).toEqual(slots);

      rerender(<Scene tree={tree} focused={false} concealed={false} />);
      expect(presented(slots)).toEqual(leavesWithPane ? [] : slots);

      rerender(<Scene tree={tree} focused concealed={false} />);
      expect(presented(slots)).toEqual(slots);
    },
  );

  it.each(CASES)(
    "$name un-presents with its concealed region and re-presents when it returns",
    ({ build, slots, present }) => {
      const tree = build(true, (node) => node);
      const { rerender } = render(
        <Scene tree={tree} focused concealed={false} />,
      );
      present();
      expect(presented(slots)).toEqual(slots);

      rerender(<Scene tree={tree} focused concealed />);
      expect(presented(slots)).toEqual([]);

      rerender(<Scene tree={tree} focused concealed={false} />);
      expect(presented(slots)).toEqual(slots);
    },
  );
});
