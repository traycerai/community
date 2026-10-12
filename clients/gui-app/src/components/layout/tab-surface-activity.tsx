import { type ReactNode, useMemo } from "react";
import {
  TabSurfaceActivityContext,
  type TabSurfaceActivity,
} from "@/components/layout/tab-surface-activity-context";

export function TabSurfaceActivityProvider(props: {
  readonly activity: TabSurfaceActivity;
  readonly children: ReactNode;
}): ReactNode {
  // Keyed on the two flags, not the object: the host rebuilds every mount's
  // activity on each render, and a fresh object here re-provided every hidden
  // surface's pane-activity context on every tab switch, waking all of its
  // consumers for a value that had not changed.
  const { visible, focused } = props.activity;
  const activity = useMemo(() => ({ visible, focused }), [visible, focused]);
  return (
    <TabSurfaceActivityContext.Provider value={activity}>
      {props.children}
    </TabSurfaceActivityContext.Provider>
  );
}
