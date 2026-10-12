/**
 * Ticket 21 slice 4: pins the environment-to-context bridge for a hosted
 * chat. Scope note - `renderTile` is swapped for a test probe that reads the
 * bridged contexts and surfaces the `isActive` argument the bridge body
 * computed. The full real-`renderTile` path is exercised transitively by the
 * switch-ON ActiveTabBody routing tests; this file's job is narrowly "are
 * the contexts wired right + isActive mirrors ActiveTabBody".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { use } from "react";
import type { ReactNode } from "react";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import {
  pane,
  TEST_HOST_ID,
} from "@/stores/epics/canvas/__tests__/canvas-test-fixtures";
import { buildSyntheticTileSurfaceEnvironment } from "@/components/epic-canvas/surface-host/__tests__/synthetic-tile-surface-fixture";
import type { ReadyTileSurfaceEnvironment } from "@/components/epic-canvas/surface-host/tile-surface-environment-registry";
import type { HostResourceScope } from "@traycer/protocol/host/resource-scope";
import type { OpenEpicStoreHandle } from "@/stores/epics/open-epic/store";
import { EpicViewTabContext } from "@/components/epic-canvas/view-tab-context";
import { useOpenEpicHandle } from "@/providers/use-open-epic-handle";
import { BrowserSessionsContext } from "@/components/epic-canvas/renderers/browser-sessions-context";
import { handleHostIds } from "@/lib/registries/epic-session-registry";
import {
  PaneSurfaceActivityContext,
  usePanePortalContainer,
  type PaneSurfaceActivity,
} from "@/components/epic-tabs/pane-visibility-context";
import {
  SurfaceDemandContext,
  setPaneDemand,
  setTopLevelDemand,
  useSurfaceDemandStore,
  type ActiveSurfaceDemand,
} from "@/stores/tabs/surface-demand";
import {
  usePaneActivationFocusIntent,
  type PaneActivationFocusIntent,
} from "@/components/epic-canvas/pane-activation";

const INSTANCE_ID = "chat-bridge-1";
const VIEW_TAB_ID = "view-tab-bridge";
const PANE_ID = "pane-bridge";
const EPIC_ID = "epic-bridge";

const CHAT_NODE = {
  id: INSTANCE_ID,
  instanceId: INSTANCE_ID,
  type: "chat" as const,
  name: "Bridge chat",
  hostId: TEST_HOST_ID,
};

const OPEN_EPIC_HANDLE =
  {} as ReadyTileSurfaceEnvironment["services"]["openEpicHandle"];
const HOST_CLIENT = {} as NonNullable<
  ReadyTileSurfaceEnvironment["services"]["hostClient"]
>;

interface CaptureState {
  lastIsActive: boolean | null;
  lastBrowserSessionsEpicId: string | null;
  lastBrowserSessionsHostClient: ReadyTileSurfaceEnvironment["services"]["hostClient"];
  lastBrowserSessionsHostId: string | null;
  lastViewTabId: string | null;
  lastOpenEpicHandle: OpenEpicStoreHandle | null;
  lastPanePortalContainer: HTMLElement | null;
  lastPaneActivationFocusIntent: PaneActivationFocusIntent | null;
  lastSurfaceDemand: ActiveSurfaceDemand | null;
  lastPaneSurfaceActivity: PaneSurfaceActivity | null;
  paneSurfaceActivities: PaneSurfaceActivity[];
}

const capture = vi.hoisted((): CaptureState => ({
  lastIsActive: null,
  lastBrowserSessionsEpicId: null,
  lastBrowserSessionsHostClient: null,
  lastBrowserSessionsHostId: null,
  lastViewTabId: null,
  lastOpenEpicHandle: null,
  lastPanePortalContainer: null,
  lastPaneActivationFocusIntent: null,
  lastSurfaceDemand: null,
  lastPaneSurfaceActivity: null,
  paneSurfaceActivities: [],
}));

interface PermissionRoleState {
  role: string | null;
}

const permissionRole = vi.hoisted((): PermissionRoleState => ({
  role: "owner",
}));

vi.mock("@/lib/epic-selectors", () => ({
  useEpicPermissionRole: () => permissionRole.role,
}));

vi.mock(
  "@/components/epic-canvas/renderers/browser-sessions-provider",
  async () => {
    const { createElement } = await import("react");
    const { BrowserSessionsContext: Context } =
      await import("@/components/epic-canvas/renderers/browser-sessions-context");
    return {
      BrowserSessionsHostProvider: (props: {
        readonly scope: HostResourceScope;
        readonly hostClient: ReadyTileSurfaceEnvironment["services"]["hostClient"];
        readonly hostId: string | null;
        readonly children: ReactNode;
      }) => {
        capture.lastBrowserSessionsEpicId =
          props.scope.kind === "epic" ? props.scope.epicId : null;
        capture.lastBrowserSessionsHostClient = props.hostClient;
        return createElement(
          Context.Provider,
          {
            value: {
              hostId: props.hostId,
              lifecycle: "live",
              inventoryReady: true,
              canMaterializeElectron: false,
              connectionGeneration: 0,
              items: [],
              viewports: {},
              setViewport: () => Promise.reject(new Error("not used")),
              reportViewport: () => undefined,
              errorMessage: null,
              retry: () => undefined,
              openTab: () => Promise.reject(new Error("not used")),
              prepareOpenTab: () => {
                throw new Error("not used");
              },
              closeTab: () => Promise.resolve(),
              attachTab: () => Promise.reject(new Error("not used")),
              moveTab: () => Promise.reject(new Error("not used")),
            },
          },
          props.children,
        );
      },
    };
  },
);

vi.mock("@/components/epic-canvas/renderers/tile-render", () => ({
  renderTile: (args: {
    readonly isActive: boolean;
    readonly viewTabId: string;
  }): ReactNode => {
    capture.lastIsActive = args.isActive;
    // Probe lives under every context the bridge re-provides; reading them
    // here proves the provider wiring without mounting ChatTile.
    function Probe(): ReactNode {
      capture.lastBrowserSessionsHostId =
        use(BrowserSessionsContext)?.hostId ?? null;
      capture.lastViewTabId = use(EpicViewTabContext);
      capture.lastOpenEpicHandle = useOpenEpicHandle();
      capture.lastPanePortalContainer = usePanePortalContainer();
      capture.lastPaneActivationFocusIntent = usePaneActivationFocusIntent();
      capture.lastSurfaceDemand = use(SurfaceDemandContext);
      capture.lastPaneSurfaceActivity = use(PaneSurfaceActivityContext);
      capture.paneSurfaceActivities.push(capture.lastPaneSurfaceActivity);
      return (
        <div
          data-testid="hosted-bridge-probe"
          data-is-active={args.isActive ? "true" : "false"}
          data-view-tab-id={args.viewTabId}
        />
      );
    }
    return <Probe />;
  },
}));

// Import AFTER the mocks so HostedChatSurfaceContextBridge picks them up.
import { HostedChatSurfaceContextBridge } from "@/components/epic-canvas/surface-host/hosted-chat-surface-context-bridge";

function seedChatTile(): void {
  useEpicCanvasStore.setState({
    tabsById: {
      [VIEW_TAB_ID]: {
        tabId: VIEW_TAB_ID,
        epicId: EPIC_ID,
        name: "Epic",
      },
    },
    canvasByTabId: {
      [VIEW_TAB_ID]: {
        root: pane(PANE_ID, [INSTANCE_ID]),
        activePaneId: PANE_ID,
        tilesByInstanceId: { [INSTANCE_ID]: CHAT_NODE },
        sizesByGroupId: {},
      },
    },
    openTabOrder: [VIEW_TAB_ID],
    activeTabId: VIEW_TAB_ID,
  });
}

function buildEnvironment(
  overrides: Partial<ReadyTileSurfaceEnvironment>,
): ReadyTileSurfaceEnvironment {
  return buildSyntheticTileSurfaceEnvironment(INSTANCE_ID, {
    identity: {
      instanceId: INSTANCE_ID,
      tileKind: "chat",
      contentId: INSTANCE_ID,
      epicId: EPIC_ID,
      hostId: TEST_HOST_ID,
    },
    placement: {
      epicId: EPIC_ID,
      viewTabId: VIEW_TAB_ID,
      paneId: PANE_ID,
      hostId: TEST_HOST_ID,
    },
    services: {
      openEpicHandle: OPEN_EPIC_HANDLE,
      hostClient: HOST_CLIENT,
      geometryAnchorElement: document.createElement("div"),
      panePortalContainer: null,
      isPaneFocusedNow: () => false,
    },
    ...overrides,
  });
}

function resetCapture(): void {
  capture.lastIsActive = null;
  capture.lastBrowserSessionsEpicId = null;
  capture.lastBrowserSessionsHostClient = null;
  capture.lastBrowserSessionsHostId = null;
  capture.lastViewTabId = null;
  capture.lastOpenEpicHandle = null;
  capture.lastPanePortalContainer = null;
  capture.lastPaneActivationFocusIntent = null;
  capture.lastSurfaceDemand = null;
  capture.lastPaneSurfaceActivity = null;
  capture.paneSurfaceActivities = [];
  permissionRole.role = "owner";
}

describe("HostedChatSurfaceContextBridge", () => {
  beforeEach(() => {
    resetCapture();
    handleHostIds.set(OPEN_EPIC_HANDLE, TEST_HOST_ID);
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    seedChatTile();
    useSurfaceDemandStore.setState(
      useSurfaceDemandStore.getInitialState(),
      true,
    );
  });
  afterEach(() => {
    cleanup();
    useSurfaceDemandStore.setState(
      useSurfaceDemandStore.getInitialState(),
      true,
    );
    useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
    handleHostIds.delete(OPEN_EPIC_HANDLE);
    resetCapture();
  });

  it("re-provides EpicViewTabContext from environment.placement.viewTabId", () => {
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(screen.getByTestId("hosted-bridge-probe")).not.toBeNull();
    expect(capture.lastViewTabId).toBe(VIEW_TAB_ID);
    expect(
      screen
        .getByTestId("hosted-bridge-probe")
        .getAttribute("data-view-tab-id"),
    ).toBe(VIEW_TAB_ID);
  });

  it("provides browser sessions to the hosted chat render root", () => {
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(capture.lastBrowserSessionsEpicId).toBe(EPIC_ID);
    expect(capture.lastBrowserSessionsHostClient).toBe(HOST_CLIENT);
    expect(capture.lastBrowserSessionsHostId).toBe(TEST_HOST_ID);
  });

  it("re-provides the SAME openEpicHandle object reference (no second EpicSessionProvider)", () => {
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(capture.lastOpenEpicHandle).toBe(OPEN_EPIC_HANDLE);
    expect(capture.lastOpenEpicHandle).toBe(
      environment.services.openEpicHandle,
    );
  });

  it("re-provides the exact pane activation focus intent from its environment", () => {
    const focusIntent: PaneActivationFocusIntent = {
      mark: vi.fn(),
      shouldYieldAutoFocus: () => true,
    };
    const environment = {
      ...buildEnvironment({
        canvasActivity: { tabSelected: true, canvasPaneActive: true },
      }),
      paneActivation: { focusIntent },
    };
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(capture.lastPaneActivationFocusIntent).toBe(focusIntent);
    expect(capture.lastPaneActivationFocusIntent?.shouldYieldAutoFocus()).toBe(
      true,
    );
  });

  it("computes isActive = role!==null && tabSelected && canvasPaneActive (true case)", () => {
    permissionRole.role = "owner";
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(capture.lastIsActive).toBe(true);
    expect(
      screen.getByTestId("hosted-bridge-probe").getAttribute("data-is-active"),
    ).toBe("true");
  });

  it("computes isActive = false when canvasPaneActive is false", () => {
    permissionRole.role = "owner";
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: false },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(capture.lastIsActive).toBe(false);
    expect(
      screen.getByTestId("hosted-bridge-probe").getAttribute("data-is-active"),
    ).toBe("false");
  });

  it("computes isActive = false when role is null", () => {
    permissionRole.role = null;
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(capture.lastIsActive).toBe(false);
  });

  it("design-review F5: re-provides the REAL panePortalContainer value, not the slot's own geometry anchor", () => {
    const realPortalHost = document.createElement("div");
    const geometryAnchor = document.createElement("div");
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
      services: {
        openEpicHandle: OPEN_EPIC_HANDLE,
        hostClient: null,
        geometryAnchorElement: geometryAnchor,
        panePortalContainer: realPortalHost,
        isPaneFocusedNow: () => false,
      },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(capture.lastPanePortalContainer).toBe(realPortalHost);
    expect(capture.lastPanePortalContainer).not.toBe(geometryAnchor);
  });

  it("reads settled demand while no top-level selection is published, or while this surface is the active one", () => {
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    const { unmount } = render(
      <HostedChatSurfaceContextBridge environment={environment} />,
    );
    expect(capture.lastSurfaceDemand).toBe("settled");
    unmount();

    act(() => setTopLevelDemand([`epic:${VIEW_TAB_ID}`], "settled"));
    render(<HostedChatSurfaceContextBridge environment={environment} />);
    expect(capture.lastSurfaceDemand).toBe("settled");
  });

  it("reads preview demand for a visible surface the demand store no longer names active", () => {
    // `topLevelVisible` lags the activation by a commit, so the surface a held
    // tab cycle just left is still visible here while the demand keys have
    // already moved on to another surface.
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
      presentation: { topLevelVisible: true, topLevelFocused: false },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);
    expect(capture.lastSurfaceDemand).toBe("settled");

    act(() => setTopLevelDemand(["epic:other"], "preview"));
    expect(capture.lastSurfaceDemand).toBe("preview");

    // A settled activation of another surface releases the previews but still
    // leaves this surface outside the active keys.
    act(() => setTopLevelDemand(["epic:other"], "settled"));
    expect(capture.lastSurfaceDemand).toBe("preview");

    act(() => setTopLevelDemand([`epic:${VIEW_TAB_ID}`], "settled"));
    expect(capture.lastSurfaceDemand).toBe("settled");

    act(() => setTopLevelDemand([`epic:${VIEW_TAB_ID}`], "preview"));
    expect(capture.lastSurfaceDemand).toBe("preview");
  });

  it("reads preview demand while its pane has a preview target", () => {
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);
    expect(capture.lastSurfaceDemand).toBe("settled");

    act(() => setPaneDemand(PANE_ID, INSTANCE_ID, "preview"));
    expect(capture.lastSurfaceDemand).toBe("preview");
  });

  it("re-provides the pane surface activity from the environment's presentation flags", () => {
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
      presentation: { topLevelVisible: true, topLevelFocused: false },
    });
    const view = render(
      <HostedChatSurfaceContextBridge environment={environment} />,
    );
    expect(capture.lastPaneSurfaceActivity).toEqual({
      visible: true,
      focused: false,
    });

    view.rerender(
      <HostedChatSurfaceContextBridge
        environment={{
          ...environment,
          presentation: { topLevelVisible: true, topLevelFocused: true },
        }}
      />,
    );
    expect(capture.lastPaneSurfaceActivity).toEqual({
      visible: true,
      focused: true,
    });
  });

  it("keeps the pane surface activity identity across a new environment object with the same presentation flags", () => {
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
      presentation: { topLevelVisible: true, topLevelFocused: false },
    });
    const view = render(
      <HostedChatSurfaceContextBridge environment={environment} />,
    );
    const first = capture.lastPaneSurfaceActivity;
    expect(first).not.toBeNull();

    // The slot publishes a new environment object for any change to it (a
    // geometry or service update); the presentation flags are what the
    // activity context carries, and they did not move.
    view.rerender(
      <HostedChatSurfaceContextBridge
        environment={{
          ...environment,
          presentation: { topLevelVisible: true, topLevelFocused: false },
        }}
      />,
    );
    view.rerender(
      <HostedChatSurfaceContextBridge
        environment={{
          ...environment,
          presentation: { topLevelVisible: true, topLevelFocused: false },
        }}
      />,
    );

    expect(capture.lastPaneSurfaceActivity).toBe(first);
    expect(new Set(capture.paneSurfaceActivities).size).toBe(1);
  });

  it("renders nothing when the canvas tile is missing from the store", () => {
    useEpicCanvasStore.setState({
      tabsById: {},
      canvasByTabId: {},
      openTabOrder: [],
      activeTabId: null,
    });
    const environment = buildEnvironment({
      canvasActivity: { tabSelected: true, canvasPaneActive: true },
    });
    render(<HostedChatSurfaceContextBridge environment={environment} />);

    expect(screen.queryByTestId("hosted-bridge-probe")).toBeNull();
    expect(capture.lastIsActive).toBeNull();
  });
});
