/**
 * The mirror line on the composer (ticket E17 checkpoint 5).
 *
 * A task can hold hosts of more than one principal: the viewer's laptop beside
 * a team's sandbox. Agents on one cannot work with agents on the other, and the
 * person starting a conversation should hear that ONCE per task, before they
 * expect otherwise. The line is informational (role "status", not the refusal
 * slot's "alert"), names the other side, and is not repeated for the same
 * viewer and task once seen.
 *
 * Four layers, bottom up: the pure model (which host is named, in which order),
 * the persisted "seen" store (bounded), the notice component (its role per
 * kind), and the hook that joins them to the task's hosts view.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostListItem,
  HostOwnerPrincipal,
} from "@traycer/protocol/host/host-status";
import type {
  TaskHostPrincipal,
  TaskHostRow,
} from "@traycer/protocol/host/task-host-summary";
import { TASK_HOST_UNNAMED_LABEL } from "@/components/epic-canvas/sidebar/task-host-groups-model";
import {
  composerMirrorLineText,
  mirrorLineOtherHostLabel,
} from "@/components/home/composer/composer-mirror-line-model";
import {
  ComposerHostNotice,
  type ComposerHostNoticeState,
} from "@/components/home/composer/composer-host-notice";
import { useComposerMirrorLine } from "@/hooks/composer/use-composer-mirror-line";
import type { TaskHostsView } from "@/hooks/epic/use-task-hosts-view";
import {
  COMPOSER_MIRROR_LINE_SEEN_CAP,
  composerMirrorLineSeen,
  useComposerMirrorLineSeenStore,
} from "@/stores/epics/composer-mirror-line-seen-store";

/** What the hook reads, driven per test. */
const inputs = vi.hoisted(() => ({
  view: { current: { kind: "none" } },
  viewerId: { current: "user-1" },
  registry: { current: null as { hosts: HostListItem[] } | null },
}));

vi.mock("@/hooks/epic/use-task-hosts-view", () => ({
  useTaskHostsView: (): TaskHostsView => inputs.view.current,
}));

vi.mock("@/hooks/chats/use-cloud-chat-queries", () => ({
  useCloudChatViewerId: (): string => inputs.viewerId.current,
}));

vi.mock("@/hooks/auth/use-registered-hosts-query", () => ({
  useRegisteredHosts: (): {
    readonly data: { hosts: HostListItem[] } | null;
  } => ({
    data: inputs.registry.current,
  }),
}));

const VIEWER_ID = "user-1";
const VIEWER: TaskHostPrincipal = { kind: "user", id: VIEWER_ID };
const ACME: TaskHostPrincipal = { kind: "team", id: "team-acme" };
const GLOBEX: TaskHostPrincipal = { kind: "team", id: "team-globex" };
const COLLABORATOR: TaskHostPrincipal = { kind: "user", id: "user-2" };

function row(
  hostId: string,
  label: string | null,
  principal: TaskHostPrincipal,
): TaskHostRow {
  return { hostId, label, principal, reach: "same_principal" };
}

function registryItem(
  hostId: string,
  owner: HostOwnerPrincipal | null,
): HostListItem {
  return {
    hostId,
    displayName: null,
    platform: null,
    kind: "sandbox",
    publicKey: "public-key",
    createdAt: "2026-10-01T00:00:00.000Z",
    status: {
      connectivity: "connectable",
      viewerReachability: "ok",
      clientCloud: "ok",
      updateState: "current",
      appVersion: null,
      lastSeenAt: null,
    },
    ...(owner === null ? {} : { owner }),
    updatePolicy: "manual",
  };
}

beforeEach(() => {
  useComposerMirrorLineSeenStore.setState({ seen: {} });
});

afterEach(() => {
  cleanup();
  useComposerMirrorLineSeenStore.setState({ seen: {} });
  inputs.view.current = { kind: "none" };
  inputs.viewerId.current = VIEWER_ID;
  inputs.registry.current = null;
  vi.useRealTimers();
});

describe("composerMirrorLineText", () => {
  it("names the other host in the line, verbatim", () => {
    expect(composerMirrorLineText("Acme sandbox")).toBe(
      "Agents here cannot work with the agents on Acme sandbox; the task still shares its files and chats.",
    );
  });
});

describe("mirrorLineOtherHostLabel", () => {
  const START = "h-start";

  it("names the viewer's own host first, then a team's, then another user's", () => {
    const hosts = [
      row(START, "Start box", ACME),
      row("h-user-2", "Collaborator laptop", COLLABORATOR),
      row("h-globex", "Globex sandbox", GLOBEX),
      row("h-viewer", "My laptop", VIEWER),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: ACME,
        viewerUserId: VIEWER_ID,
      }),
    ).toBe("My laptop");
  });

  it("falls to a team's host when the viewer has no differing host", () => {
    const hosts = [
      row(START, "My laptop", VIEWER),
      row("h-user-2", "Collaborator laptop", COLLABORATOR),
      row("h-globex", "Globex sandbox", GLOBEX),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: VIEWER,
        viewerUserId: VIEWER_ID,
      }),
    ).toBe("Globex sandbox");
  });

  it("falls to another user's host when only that differs", () => {
    const hosts = [
      row(START, "My laptop", VIEWER),
      row("h-user-2", "Collaborator laptop", COLLABORATOR),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: VIEWER,
        viewerUserId: VIEWER_ID,
      }),
    ).toBe("Collaborator laptop");
  });

  it("keeps wire order within a tier", () => {
    const hosts = [
      row(START, "My laptop", VIEWER),
      row("h-globex", "Globex sandbox", GLOBEX),
      row("h-acme", "Acme sandbox", ACME),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: VIEWER,
        viewerUserId: VIEWER_ID,
      }),
    ).toBe("Globex sandbox");
  });

  it("never counts the start host itself", () => {
    expect(
      mirrorLineOtherHostLabel({
        hosts: [row(START, "Start box", ACME)],
        startHostId: START,
        startPrincipalFallback: VIEWER,
        viewerUserId: VIEWER_ID,
      }),
    ).toBeNull();
  });

  it("is null when every other host has the start host's principal", () => {
    const hosts = [
      row(START, "Acme one", ACME),
      row("h-acme-2", "Acme two", ACME),
      row("h-acme-3", "Acme three", ACME),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: ACME,
        viewerUserId: VIEWER_ID,
      }),
    ).toBeNull();
  });

  it("tells two teams apart by id", () => {
    const hosts = [
      row(START, "Acme one", ACME),
      row("h-globex", "Globex", GLOBEX),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: ACME,
        viewerUserId: VIEWER_ID,
      }),
    ).toBe("Globex");
  });

  it("tells a user from a team that shares its id", () => {
    const sameId = "shared-id";
    const hosts = [
      row(START, "A user's host", { kind: "user", id: sameId }),
      row("h-team", "A team's host", { kind: "team", id: sameId }),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: { kind: "user", id: sameId },
        viewerUserId: VIEWER_ID,
      }),
    ).toBe("A team's host");
  });

  it("names a host with no label as an unnamed host", () => {
    const hosts = [
      row(START, "Acme one", ACME),
      row("h-unnamed", null, VIEWER),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: ACME,
        viewerUserId: VIEWER_ID,
      }),
    ).toBe(TASK_HOST_UNNAMED_LABEL);
    expect(TASK_HOST_UNNAMED_LABEL).toBe("Unnamed host");
  });

  it("uses the fallback principal when the start host is not a task row", () => {
    const hosts = [row("h-viewer", "My laptop", VIEWER)];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: ACME,
        viewerUserId: VIEWER_ID,
      }),
    ).toBe("My laptop");
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: VIEWER,
        viewerUserId: VIEWER_ID,
      }),
    ).toBeNull();
  });

  it("prefers the start host's own row over the fallback when the row exists", () => {
    // Were the fallback (a team) used, the second row (the viewer's) would
    // differ from it; the row's own principal is the viewer, so it does not.
    const hosts = [
      row(START, "My laptop", VIEWER),
      row("h-viewer-2", "My other laptop", VIEWER),
    ];
    expect(
      mirrorLineOtherHostLabel({
        hosts,
        startHostId: START,
        startPrincipalFallback: ACME,
        viewerUserId: VIEWER_ID,
      }),
    ).toBeNull();
  });

  it("is null for no hosts", () => {
    expect(
      mirrorLineOtherHostLabel({
        hosts: [],
        startHostId: START,
        startPrincipalFallback: VIEWER,
        viewerUserId: VIEWER_ID,
      }),
    ).toBeNull();
  });
});

describe("the composer mirror line seen store", () => {
  it("starts empty and has seen nothing", () => {
    const { seen } = useComposerMirrorLineSeenStore.getState();
    expect(Object.keys(seen)).toHaveLength(0);
    expect(composerMirrorLineSeen(seen, "user-1", "epic-1")).toBe(false);
  });

  it("records a viewer and task pair, and no other", () => {
    useComposerMirrorLineSeenStore.getState().markSeen("user-1", "epic-1");
    const { seen } = useComposerMirrorLineSeenStore.getState();

    expect(composerMirrorLineSeen(seen, "user-1", "epic-1")).toBe(true);
    expect(composerMirrorLineSeen(seen, "user-1", "epic-2")).toBe(false);
    expect(composerMirrorLineSeen(seen, "user-2", "epic-1")).toBe(false);
  });

  it("evicts the oldest entry when a new pair is marked at the cap", () => {
    expect(COMPOSER_MIRROR_LINE_SEEN_CAP).toBe(500);
    // Fake only the clock, one tick per mark: eviction by age is then
    // unambiguous whether the store stamps a time or a sequence.
    vi.useFakeTimers({ toFake: ["Date"] });
    const { markSeen } = useComposerMirrorLineSeenStore.getState();
    for (let index = 0; index < COMPOSER_MIRROR_LINE_SEEN_CAP; index += 1) {
      vi.setSystemTime(1_000_000 + index);
      markSeen("user-1", `epic-${index}`);
    }
    const full = useComposerMirrorLineSeenStore.getState().seen;
    expect(Object.keys(full)).toHaveLength(COMPOSER_MIRROR_LINE_SEEN_CAP);
    expect(composerMirrorLineSeen(full, "user-1", "epic-0")).toBe(true);

    vi.setSystemTime(1_000_000 + COMPOSER_MIRROR_LINE_SEEN_CAP);
    markSeen("user-1", "epic-new");

    const after = useComposerMirrorLineSeenStore.getState().seen;
    expect(Object.keys(after)).toHaveLength(COMPOSER_MIRROR_LINE_SEEN_CAP);
    expect(composerMirrorLineSeen(after, "user-1", "epic-new")).toBe(true);
    expect(composerMirrorLineSeen(after, "user-1", "epic-0")).toBe(false);
    expect(composerMirrorLineSeen(after, "user-1", "epic-1")).toBe(true);
  });

  it("marking a pair that is already recorded evicts nothing at the cap", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { markSeen } = useComposerMirrorLineSeenStore.getState();
    for (let index = 0; index < COMPOSER_MIRROR_LINE_SEEN_CAP; index += 1) {
      vi.setSystemTime(2_000_000 + index);
      markSeen("user-1", `epic-${index}`);
    }

    vi.setSystemTime(2_000_000 + COMPOSER_MIRROR_LINE_SEEN_CAP);
    markSeen("user-1", "epic-5");

    const after = useComposerMirrorLineSeenStore.getState().seen;
    expect(Object.keys(after)).toHaveLength(COMPOSER_MIRROR_LINE_SEEN_CAP);
    expect(composerMirrorLineSeen(after, "user-1", "epic-0")).toBe(true);
    expect(composerMirrorLineSeen(after, "user-1", "epic-5")).toBe(true);
  });
});

describe("ComposerHostNotice", () => {
  const MIRROR: ComposerHostNoticeState = {
    kind: "mirror",
    message: composerMirrorLineText("Acme sandbox"),
  };
  const REFUSED: ComposerHostNoticeState = {
    kind: "refused",
    message: "Could not start on that host.",
  };

  it("renders a mirror notice as a status, not an alert", () => {
    const onDismiss = vi.fn();
    render(<ComposerHostNotice notice={MIRROR} onDismiss={onDismiss} />);

    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-notice-kind")).toBe("mirror");
    expect(notice.textContent).toContain(MIRROR.message);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByTestId("composer-host-notice-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps a refusal an alert", () => {
    render(<ComposerHostNotice notice={REFUSED} onDismiss={vi.fn()} />);

    const notice = screen.getByRole("alert");
    expect(notice.getAttribute("data-notice-kind")).toBe("refused");
    expect(notice.textContent).toContain(REFUSED.message);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("useComposerMirrorLine", () => {
  const LAPTOP = row("h-laptop", "My laptop", VIEWER);
  const SANDBOX = row("h-sandbox", "Acme sandbox", ACME);

  function hostsView(hosts: readonly TaskHostRow[]): TaskHostsView {
    return { kind: "hosts", hosts };
  }

  it("names the team sandbox for a conversation starting on the viewer's laptop", () => {
    inputs.view.current = hostsView([LAPTOP, SANDBOX]);
    const { result } = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-laptop"),
    );

    expect(result.current.notice).toEqual({
      kind: "mirror",
      message: composerMirrorLineText("Acme sandbox"),
    });
  });

  it("names the laptop for a conversation starting on a task row of the team sandbox", () => {
    inputs.view.current = hostsView([LAPTOP, SANDBOX]);
    const { result } = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-sandbox"),
    );

    expect(result.current.notice).toEqual({
      kind: "mirror",
      message: composerMirrorLineText("My laptop"),
    });
  });

  it("takes the start host's principal from the registry owner when the sandbox is not yet a task row", () => {
    inputs.view.current = hostsView([LAPTOP]);
    inputs.registry.current = {
      hosts: [
        registryItem("h-sandbox", {
          kind: "team",
          id: ACME.id,
          name: "Acme",
        }),
      ],
    };
    const { result } = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-sandbox"),
    );

    expect(result.current.notice).toEqual({
      kind: "mirror",
      message: composerMirrorLineText("My laptop"),
    });
  });

  it("falls back to the viewer for a start host the task and the registry both lack", () => {
    inputs.view.current = hostsView([LAPTOP, SANDBOX]);
    const { result } = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-unlisted"),
    );

    // The viewer's own principal differs from the team sandbox only, and the
    // laptop (also the viewer's) is the same principal as the fallback.
    expect(result.current.notice).toEqual({
      kind: "mirror",
      message: composerMirrorLineText("Acme sandbox"),
    });
  });

  it("shows nothing when every host in the task is the start host's principal", () => {
    inputs.view.current = hostsView([
      LAPTOP,
      row("h-laptop-2", "My other laptop", VIEWER),
    ]);
    const { result } = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-laptop"),
    );

    expect(result.current.notice).toBeNull();
  });

  it("shows nothing for an unlisted start host when the task holds only the viewer's hosts", () => {
    inputs.view.current = hostsView([LAPTOP]);
    const { result } = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-unlisted"),
    );

    expect(result.current.notice).toBeNull();
  });

  it("shows nothing when the hosts view is none or an error", () => {
    inputs.view.current = { kind: "none" };
    const none = renderHook(() => useComposerMirrorLine("epic-1", "h-laptop"));
    expect(none.result.current.notice).toBeNull();

    inputs.view.current = { kind: "error", retry: () => undefined };
    const failed = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-laptop"),
    );
    expect(failed.result.current.notice).toBeNull();
  });

  it("shows nothing while the composer has resolved no host", () => {
    inputs.view.current = hostsView([LAPTOP, SANDBOX]);
    const { result } = renderHook(() => useComposerMirrorLine("epic-1", null));

    expect(result.current.notice).toBeNull();
  });

  it("stops showing the line for this viewer and task once marked seen, and only for them", () => {
    inputs.view.current = hostsView([LAPTOP, SANDBOX]);
    const first = renderHook(() => useComposerMirrorLine("epic-1", "h-laptop"));
    expect(first.result.current.notice).not.toBeNull();

    act(() => {
      first.result.current.markSeen();
    });

    expect(first.result.current.notice).toBeNull();

    // The same viewer in another task still hears it.
    const otherEpic = renderHook(() =>
      useComposerMirrorLine("epic-2", "h-laptop"),
    );
    expect(otherEpic.result.current.notice).not.toBeNull();

    // Another viewer in the same task still hears it.
    inputs.viewerId.current = "user-9";
    const otherViewer = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-laptop"),
    );
    expect(otherViewer.result.current.notice).not.toBeNull();

    // And the first viewer's mark is what the store holds.
    const { seen } = useComposerMirrorLineSeenStore.getState();
    expect(composerMirrorLineSeen(seen, VIEWER_ID, "epic-1")).toBe(true);
    expect(composerMirrorLineSeen(seen, "user-9", "epic-1")).toBe(false);
  });

  it("does not show the line for a pair already seen before the composer mounted", () => {
    useComposerMirrorLineSeenStore.getState().markSeen(VIEWER_ID, "epic-1");
    inputs.view.current = hostsView([LAPTOP, SANDBOX]);
    const { result } = renderHook(() =>
      useComposerMirrorLine("epic-1", "h-laptop"),
    );

    expect(result.current.notice).toBeNull();
  });
});
