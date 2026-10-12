import type { ReactNode } from "react";
import { DelayedRoutePendingScreen } from "@/components/loading/route-pending-screen";
import { useTabSurfaceActivity } from "@/components/layout/tab-surface-activity-hooks";
import {
  usePreloadedModule,
  type PreloadedModule,
} from "@/lib/preloaded-module";

/**
 * A top-level tab's surface, drawn from its on-demand module
 * (`stores/tabs/kinds/surface-modules.ts`).
 *
 * Loaded: `render` draws it, in this render. Not loaded: the pending screen a
 * cold surface always had, until the import lands.
 */
export function PreloadedTabSurface<T>(props: {
  readonly module: PreloadedModule<T>;
  readonly render: (loaded: T) => ReactNode;
}): ReactNode {
  const loaded = usePreloadedModule(props.module);
  if (loaded === null) return <TabSurfacePending />;
  return props.render(loaded);
}

/**
 * What a surface shows while its module loads: nothing for the first
 * `ROUTE_PENDING_MS`, then the neutral loading screen. A hidden surface shows
 * nothing at all, so a retained tab starts that delay only when it is opened.
 */
function TabSurfacePending(): ReactNode {
  const { visible } = useTabSurfaceActivity();
  return visible ? <DelayedRoutePendingScreen /> : null;
}
