import { createContext, use } from "react";
import { create } from "zustand";
import { usePaneVisible } from "@/components/epic-tabs/pane-visibility-context";
import { useTabBodySelected } from "@/components/epic-canvas/canvas/tab-body-selected-context";

export type ActiveSurfaceDemand = "preview" | "settled";
export type SurfaceDemand = ActiveSurfaceDemand | null;

interface SurfaceDemandState {
  readonly topLevelActiveKeys: ReadonlyArray<string> | null;
  readonly topLevelPreviewKeys: ReadonlyArray<string>;
  readonly panePreviewTargets: Readonly<Record<string, string | undefined>>;
  /**
   * Bumps each time the last outstanding preview settles: the one edge a
   * hidden surface needs to hear about (to requeue work a hold deferred),
   * without re-running on the edge a hold starts.
   */
  readonly settleEpoch: number;
}

type PreviewState = Pick<
  SurfaceDemandState,
  "topLevelPreviewKeys" | "panePreviewTargets"
>;

// Activation owns these transient selections. They are never persisted or
// inferred from input devices; an ordinary activation settles its surface.
export const useSurfaceDemandStore = create<SurfaceDemandState>(() => ({
  topLevelActiveKeys: null,
  topLevelPreviewKeys: [],
  panePreviewTargets: {},
  settleEpoch: 0,
}));

function previewing(state: PreviewState): boolean {
  return (
    state.topLevelPreviewKeys.length > 0 ||
    Object.keys(state.panePreviewTargets).length > 0
  );
}

function nextSettleEpoch(
  state: SurfaceDemandState,
  next: PreviewState,
): number {
  return previewing(state) && !previewing(next)
    ? state.settleEpoch + 1
    : state.settleEpoch;
}

function sameKeys(
  left: ReadonlyArray<string> | null,
  right: ReadonlyArray<string>,
): boolean {
  return (
    left !== null &&
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

// Both writers return the SAME state when nothing changed. Every pane-tab
// click writes settled demand, and a fresh object would wake each subscriber
// (membership recompute, a reconcile of every epic session, the prewarm
// timer restart) for no change at all.
export function setTopLevelDemand(
  keys: ReadonlyArray<string>,
  demand: ActiveSurfaceDemand,
): void {
  useSurfaceDemandStore.setState((state) => {
    const topLevelPreviewKeys = demand === "preview" ? keys : [];
    if (
      sameKeys(state.topLevelActiveKeys, keys) &&
      sameKeys(state.topLevelPreviewKeys, topLevelPreviewKeys)
    )
      return state;
    return {
      topLevelActiveKeys: keys,
      topLevelPreviewKeys,
      settleEpoch: nextSettleEpoch(state, {
        topLevelPreviewKeys,
        panePreviewTargets: state.panePreviewTargets,
      }),
    };
  });
}

export function setPaneDemand(
  paneId: string,
  instanceId: string,
  demand: ActiveSurfaceDemand,
): void {
  useSurfaceDemandStore.setState((state) => {
    const current = state.panePreviewTargets[paneId];
    if (demand === "preview" ? current === instanceId : current === undefined)
      return state;
    const panePreviewTargets = { ...state.panePreviewTargets };
    if (demand === "preview") panePreviewTargets[paneId] = instanceId;
    else delete panePreviewTargets[paneId];
    return {
      panePreviewTargets,
      settleEpoch: nextSettleEpoch(state, {
        topLevelPreviewKeys: state.topLevelPreviewKeys,
        panePreviewTargets,
      }),
    };
  });
}

export function topLevelDemand(key: string): SurfaceDemand {
  const state = useSurfaceDemandStore.getState();
  if (
    state.topLevelActiveKeys !== null &&
    !state.topLevelActiveKeys.includes(key)
  )
    return null;
  return state.topLevelPreviewKeys.includes(key) ? "preview" : "settled";
}

export function paneDemand(paneId: string): ActiveSurfaceDemand {
  return useSurfaceDemandStore.getState().panePreviewTargets[paneId] !==
    undefined
    ? "preview"
    : "settled";
}

export function hasPreviewDemand(): boolean {
  return previewing(useSurfaceDemandStore.getState());
}

export const SurfaceDemandContext =
  createContext<ActiveSurfaceDemand>("settled");

export function useSurfaceDemand(): SurfaceDemand {
  const demand = use(SurfaceDemandContext);
  const visible = usePaneVisible();
  const selected = useTabBodySelected();
  return visible && selected ? demand : null;
}

export function cancelPanePreview(paneId: string, instanceId: string): void {
  if (
    useSurfaceDemandStore.getState().panePreviewTargets[paneId] === instanceId
  ) {
    setPaneDemand(paneId, instanceId, "settled");
  }
}
