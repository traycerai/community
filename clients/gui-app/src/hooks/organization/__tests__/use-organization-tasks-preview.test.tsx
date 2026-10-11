import { QueryClient } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostClient } from "@traycer-clients/shared/host-client/host-client";
import { MockHostMessenger } from "@traycer-clients/shared/host-client/mock/mock-host-messenger";
import {
  hostRpcRegistry,
  type HostRpcRegistry,
} from "@traycer/protocol/host/registry";
import { PaneVisibilityContext } from "@/components/epic-tabs/pane-visibility-context";
import {
  OrganizationContext,
  useOrganizationTasks,
  type OrganizationContextValue,
} from "@/hooks/organization/organization-context";
import { createHostQueryInvalidator } from "@/lib/host/query-invalidator";
import {
  SurfaceDemandContext,
  type ActiveSurfaceDemand,
} from "@/stores/tabs/surface-demand";

interface Surface {
  readonly visible: boolean;
  readonly demand: ActiveSurfaceDemand;
}

// The sequence a held header cycle gives a surface: it is hidden between the
// steps, and visible under preview demand for the one step that passes it.
const SETTLED: Surface = { visible: true, demand: "settled" };
const HIDDEN: Surface = { visible: false, demand: "settled" };
const PREVIEW: Surface = { visible: true, demand: "preview" };

function fixture() {
  const unregister = vi.fn();
  const register = vi.fn(
    (_key: string, _taskIds: readonly string[]) => unregister,
  );
  const client = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    invalidator: createHostQueryInvalidator(new QueryClient()),
    messenger: new MockHostMessenger<HostRpcRegistry>({
      registry: hostRpcRegistry,
      requestId: () => "request-1",
      handlers: {},
    }),
    findHostById: () => null,
  });
  const value: OrganizationContextValue = {
    client,
    supported: true,
    userId: "user-1",
    view: undefined,
    register,
    openDialog: () => undefined,
    command: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
  };

  function Consumer(props: { readonly taskIds: readonly string[] }) {
    useOrganizationTasks(props.taskIds);
    return null;
  }

  function tree(surface: Surface, taskIds: readonly string[]) {
    return (
      <OrganizationContext.Provider value={value}>
        <PaneVisibilityContext.Provider value={surface.visible}>
          <SurfaceDemandContext.Provider value={surface.demand}>
            <Consumer taskIds={taskIds} />
          </SurfaceDemandContext.Provider>
        </PaneVisibilityContext.Provider>
      </OrganizationContext.Provider>
    );
  }

  return { register, unregister, tree };
}

describe("useOrganizationTasks across a held preview cycle", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps one registration through hidden and previewed passes of a registered surface", () => {
    const { register, unregister, tree } = fixture();
    const { rerender } = render(tree(SETTLED, ["t1"]));
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][1]).toEqual(["t1"]);

    for (let round = 0; round < 3; round += 1) {
      rerender(tree(HIDDEN, ["t1"]));
      rerender(tree(PREVIEW, ["t1"]));
      rerender(tree(HIDDEN, ["t1"]));
    }
    rerender(tree(SETTLED, ["t1"]));

    expect(unregister).toHaveBeenCalledTimes(0);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("registers nothing for a first render under preview, then holds the registration once made", () => {
    const { register, unregister, tree } = fixture();
    const { rerender } = render(tree(PREVIEW, ["t1"]));
    expect(register).not.toHaveBeenCalled();

    rerender(tree(HIDDEN, ["t1"]));
    expect(register).toHaveBeenCalledTimes(1);

    rerender(tree(PREVIEW, ["t1"]));
    expect(unregister).toHaveBeenCalledTimes(0);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("releases its registration once, on unmount", () => {
    const { register, unregister, tree } = fixture();
    const { unmount } = render(tree(SETTLED, ["t1"]));
    expect(register).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(0);

    unmount();

    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("replaces the registration when the task ids change outside preview", () => {
    const { register, unregister, tree } = fixture();
    const { rerender } = render(tree(SETTLED, ["t1"]));

    rerender(tree(SETTLED, ["t1", "t2"]));

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[1][1]).toEqual(["t1", "t2"]);
  });
});
