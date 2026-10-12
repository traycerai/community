import { observedBorderBox } from "@/lib/resize-observer-box";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTileBodyVisible } from "@/components/epic-canvas/hooks/use-tile-body-visible";

export interface UseMeasuredElementHeightResult {
  readonly setElement: (element: HTMLDivElement | null) => void;
  readonly element: HTMLDivElement | null;
  readonly height: number;
}

/**
 * ResizeObserver-measured height of a callback-ref'd element, rounded up to
 * the nearest pixel. A callback ref (`setElement`, not a plain `useRef`) so
 * the measuring effect re-runs precisely when the underlying DOM node
 * attaches or detaches (conditional rendering, not just a resize) - a plain
 * ref would not re-fire for that transition. A non-positive reading is
 * ignored (height keeps its last known value) rather than collapsing
 * reserved layout space to zero.
 */
export function useMeasuredElementHeight(
  measureOnAttach: boolean,
): UseMeasuredElementHeightResult {
  const [element, updateElement] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const visible = useTileBodyVisible();
  const initiallyMeasured = useRef(new WeakSet<HTMLDivElement>());
  const attached = useRef<HTMLDivElement | null>(null);
  const setElement = useCallback((next: HTMLDivElement | null): void => {
    attached.current = next;
    updateElement(next);
  }, []);
  // A layout effect, not the ref callback: a callback that closes over
  // `visible` is a new ref on every hide and show, so React detaches and
  // re-attaches it and the owner renders once more on each tab switch. The
  // node is read from the ref, which the commit that attaches it has already
  // set, so the first reading lands in the same render as the element.
  useLayoutEffect(() => {
    const node = attached.current;
    if (!measureOnAttach || !visible || node === null) return;
    if (initiallyMeasured.current.has(node)) return;
    initiallyMeasured.current.add(node);
    // The chat dock needs its inset before first paint. History has a CSS
    // fallback and stays observer-only; warm switches never re-read either.
    const nextHeight = Math.ceil(node.getBoundingClientRect().height);
    if (nextHeight > 0) setHeight(nextHeight);
  }, [measureOnAttach, visible, element]);
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((entry) => entry.target === element);
      if (!entry) return;
      // Observer-delivered border-box sizes include padding without forcing
      // layout in the commit that shows or hides a retained surface.
      const nextHeight = Math.ceil(observedBorderBox(entry).blockSize);
      if (nextHeight <= 0) return;
      setHeight((current) => (current === nextHeight ? current : nextHeight));
    });
    observer.observe(element, { box: "border-box" });
    return () => observer.disconnect();
  }, [element]);
  return { setElement, element, height };
}
