import { act, cleanup, render } from "@testing-library/react";
import { memo, use, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TabSurfaceActivityProvider } from "@/components/layout/tab-surface-activity";
import {
  TabSurfaceActivityContext,
  type TabSurfaceActivity,
} from "@/components/layout/tab-surface-activity-context";

interface Probe {
  renders: number;
  values: TabSurfaceActivity[];
}

const probe: Probe = { renders: 0, values: [] };

// Memoized so only a context change can re-render it.
const Consumer = memo(function Consumer(): ReactNode {
  probe.renders += 1;
  probe.values.push(use(TabSurfaceActivityContext));
  return null;
});

function Tree(props: { readonly activity: TabSurfaceActivity }): ReactNode {
  return (
    <TabSurfaceActivityProvider activity={props.activity}>
      <Consumer />
    </TabSurfaceActivityProvider>
  );
}

describe("TabSurfaceActivityProvider", () => {
  afterEach(() => {
    cleanup();
    probe.renders = 0;
    probe.values = [];
  });

  it("keeps the provided context value when re-rendered with a new activity object carrying the same flags", () => {
    const view = render(<Tree activity={{ visible: true, focused: false }} />);
    expect(probe.renders).toBe(1);
    const first = probe.values[0];

    act(() =>
      view.rerender(<Tree activity={{ visible: true, focused: false }} />),
    );
    act(() =>
      view.rerender(<Tree activity={{ visible: true, focused: false }} />),
    );

    expect(probe.renders).toBe(1);
    expect(probe.values).toHaveLength(1);
    expect(probe.values[0]).toBe(first);
  });

  it("provides a new value when a flag actually changes", () => {
    const view = render(<Tree activity={{ visible: true, focused: false }} />);

    act(() =>
      view.rerender(<Tree activity={{ visible: true, focused: true }} />),
    );

    expect(probe.renders).toBe(2);
    expect(probe.values.at(-1)).toEqual({ visible: true, focused: true });

    act(() =>
      view.rerender(<Tree activity={{ visible: false, focused: true }} />),
    );

    expect(probe.renders).toBe(3);
    expect(probe.values.at(-1)).toEqual({ visible: false, focused: true });
  });
});
