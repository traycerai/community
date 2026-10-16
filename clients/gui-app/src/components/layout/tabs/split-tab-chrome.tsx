import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePublishSheetJoin } from "./sheet-join-context";
import { cn } from "@/lib/utils";
import type { SheetJoinPane } from "./side-strip/side-tab-join";
import { TabColorEdgeLine } from "./tab-chrome-background";
import { TAB_BOX_CLASS } from "./tab-chrome-tokens";
import { useWhollyInTabStrip } from "./use-wholly-in-tab-strip";

const SPLIT_ROW_PADDING_CLASS = "pr-[clamp(0.75rem,5%,1.5rem)] pl-2";
const SPLIT_CONTROL_WIDTH_CLASS = "w-11";

/**
 * Whether the members below sit in the selected pair, which draws the
 * underline, and if so whether its box runs into the sheet: a joined box
 * paints the pane's fill behind the raised member, an unjoined one (partly
 * out of the strip, the layout editor's miniature) paints none.
 */
type SplitPairSelection = "unselected" | "joined" | "unjoined";
const SplitPairSelectionContext =
  createContext<SplitPairSelection>("unselected");

function splitPairSelection(
  selected: boolean,
  pane: SheetJoinPane | null,
): SplitPairSelection {
  if (!selected) return "unselected";
  return pane === null ? "unjoined" : "joined";
}

interface SplitTabLayoutProps {
  readonly splitId: string;
  readonly selectedSide: "left" | "right" | null;
  /**
   * The pane the active pair runs into the sheet below in, as one tab, or
   * `null` unjoined (`splitPairJoinPane`): the pair owns both surfaces under
   * it, so the join is the group's box and the focused member is raised
   * inside it (`SplitMemberChrome`).
   */
  readonly joined: SheetJoinPane | null;
  readonly control: ReactNode;
  readonly left: ReactNode;
  readonly right: ReactNode;
}

/** Shared group layout keeps both member footprints equal in the strip and overlay. */
export function SplitTabLayout(props: SplitTabLayoutProps): ReactNode {
  const [node, setNode] = useState<HTMLSpanElement | null>(null);
  const inStrip = useWhollyInTabStrip(node, props.joined !== null);
  const pane = inStrip ? props.joined : null;
  usePublishSheetJoin(pane, null);
  const selected = props.selectedSide !== null;
  const selection = splitPairSelection(selected, pane);
  return (
    <SplitPairSelectionContext value={selection}>
      <div className="relative flex w-full min-w-0 items-end">
        <div
          className={cn(
            "relative flex h-9 w-full min-w-0 items-center",
            SPLIT_ROW_PADDING_CLASS,
          )}
        >
          {props.joined !== null ? (
            <span
              aria-hidden
              data-testid={`split-tab-joined-${props.splitId}`}
              ref={setNode}
              {...(pane === null
                ? {}
                : { "data-sheet-joined": "top", "data-join-pane": pane })}
              className={cn(TAB_BOX_CLASS, "border border-transparent")}
            />
          ) : null}
          <span
            className={cn(
              "relative z-20 flex shrink-0 items-center self-stretch",
              SPLIT_CONTROL_WIDTH_CLASS,
            )}
          >
            {props.control}
            {selected ? (
              <span
                aria-hidden
                data-testid={`split-underline-control-${props.splitId}`}
                className="pointer-events-none absolute inset-x-0 bottom-0.5 h-[1.5px] rounded-l-full bg-primary"
              />
            ) : null}
          </span>
          <div
            className="relative flex min-w-0 flex-1 [container-type:inline-size]"
            data-split-member="left"
          >
            {props.left}
          </div>
          {props.selectedSide === null ? (
            <span
              aria-hidden
              data-testid={`split-tab-divider-${props.splitId}`}
              className="relative z-20 my-2 w-px shrink-0 self-stretch bg-border/70"
            />
          ) : null}
          <div
            className="relative flex min-w-0 flex-1 [container-type:inline-size]"
            data-split-member="right"
          >
            {props.right}
          </div>
        </div>
      </div>
    </SplitPairSelectionContext>
  );
}

/**
 * The split view's icon: two panes, the focused one filled. `size` is the top
 * bar's 20px, the sidebar row's 16px, or the 12px of a caption naming a half.
 */
export function SplitFocusIcon(props: {
  readonly splitId: string;
  readonly focusedSide: "left" | "right";
  readonly size: "size-5" | "size-4" | "size-3";
}): ReactNode {
  const leftFocused = props.focusedSide === "left";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-testid={`split-focus-indicator-${props.splitId}`}
      data-focused-side={props.focusedSide}
      className={cn("shrink-0", props.size)}
    >
      <rect
        data-split-pane="left"
        data-focused={leftFocused ? "true" : "false"}
        x="3"
        y="4"
        width="8"
        height="16"
        rx="1.5"
        fill={leftFocused ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        data-split-pane="right"
        data-focused={leftFocused ? "false" : "true"}
        x="13"
        y="4"
        width="8"
        height="16"
        rx="1.5"
        fill={leftFocused ? "none" : "currentColor"}
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

/**
 * Selection treatment for one member of a split group, the pre-#2021 one.
 * In a selected pair the focused member is a raised tab, open at the bottom,
 * whose outline turns out at its feet into the group's underline; the
 * underline runs under the split control and the other member, so one
 * contour marks the pair and which half is focused. The joined box behind
 * them (`SplitTabLayout`) runs the pair into its sheet. Outside a selected
 * pair a member is an ordinary tab's hover box and colour line.
 */
export function SplitMemberChrome(props: {
  readonly focused: boolean;
  readonly color: string | null;
}) {
  const selection = useContext(SplitPairSelectionContext);
  const accent = props.color ?? "var(--color-primary)";
  if (props.focused) {
    return <SplitRaisedTab color={accent} filled={selection !== "joined"} />;
  }

  if (selection !== "unselected") {
    return (
      <>
        <span
          aria-hidden
          data-testid="tab-hover-box"
          className={cn(
            TAB_BOX_CLASS,
            "transition-colors duration-150 ease-out group-hover/tab:bg-foreground/5",
          )}
        />
        <SplitUnderlineSegment color={accent} />
      </>
    );
  }

  return (
    <>
      <span
        aria-hidden
        data-testid="tab-hover-box"
        className={cn(
          TAB_BOX_CLASS,
          "transition-colors duration-150 ease-out group-hover/tab:bg-foreground/5",
        )}
      />
      {props.color === null ? null : <TabColorEdgeLine color={props.color} />}
    </>
  );
}

/**
 * The focused member's raised tab: sides and top in `color`, open at the
 * bottom, with a concave foot at each bottom corner that lands on the
 * underline's level, so the underline on either side runs into it. `filled`
 * paints its inside in the background when no joined box paints it.
 */
function SplitRaisedTab(props: {
  readonly color: string;
  readonly filled: boolean;
}) {
  return (
    <span
      aria-hidden
      data-testid="split-member-raised-tab"
      data-filled={props.filled ? "true" : "false"}
      className="pointer-events-none absolute inset-x-0 inset-y-0.5"
      style={{ "--swatch": props.color } as CSSProperties}
    >
      {props.filled ? (
        <span className="absolute inset-x-[calc(--spacing(2)-1px)] inset-y-0 rounded-t-lg bg-background" />
      ) : null}
      {/* Inset one pixel less than a foot is wide, so its side border lies
          on the foot's. */}
      <span className="absolute inset-x-[calc(--spacing(2)-1px)] top-0 bottom-2 rounded-t-lg border border-b-0 border-(--swatch)" />
      <span className="absolute bottom-0 left-0 size-2 rounded-br-full border-r border-b border-(--swatch)" />
      <span className="absolute right-0 bottom-0 size-2 rounded-bl-full border-b border-l border-(--swatch)" />
    </span>
  );
}

/** One run of a selected pair's underline, edge to edge under its owner. */
function SplitUnderlineSegment(props: { readonly color: string }) {
  return (
    <span
      aria-hidden
      data-testid="split-underline-segment"
      className="pointer-events-none absolute inset-x-0 bottom-0.5 h-[1.5px] bg-(--swatch)"
      style={{ "--swatch": props.color } as CSSProperties}
    />
  );
}
