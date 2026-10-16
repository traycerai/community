import { describe, expect, it } from "vitest";
import type { HostListItem } from "@traycer/protocol/host/host-status";
import type { SandboxSummary } from "@traycer/protocol/host/sandbox-control";
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import { hostListItemToDirectoryEntry } from "@traycer-clients/shared/host-client/remote-fetcher";
import {
  buildHostScopeOptions,
  type HostScopeOption,
} from "@/components/settings/host-scope/host-scope-model";
import { sandboxSummaryFixture } from "@/hooks/sandboxes/__tests__/sandbox-fixtures";

/**
 * Ticket E17, finding F15 (a sandbox with no host row is listed): a sandbox
 * whose create failed at the provider (`failed`), or whose guest has not
 * enrolled yet (`creating`), is in `GET /api/sandboxes` but has no registry
 * row and no directory entry. The host list must still show it, as a
 * management-only sandbox row, or the toast "It's listed as failed; destroy it
 * and try again." points at nothing.
 */

function registryItem(hostId: string): HostListItem {
  return {
    hostId,
    displayName: `Registered ${hostId}`,
    platform: "linux-x64",
    kind: "sandbox",
    publicKey: "pk",
    createdAt: "2026-01-01T00:00:00Z",
    updatePolicy: "manual",
    sandboxState: "awake",
    sandboxFrozen: false,
    profile: "agent",
    status: {
      connectivity: "connectable",
      viewerReachability: "unknown",
      clientCloud: "ok",
      updateState: "current",
      appVersion: "1.5.0",
      lastSeenAt: "2026-01-01T00:00:00Z",
    },
  };
}

function build(input: {
  readonly directory: readonly HostDirectoryEntry[];
  readonly registry: readonly HostListItem[];
  readonly sandboxes: readonly SandboxSummary[] | null;
  readonly activeHostId: string | null;
}): readonly HostScopeOption[] {
  return buildHostScopeOptions({
    leases: [],
    authorityAttached: false,
    directory: input.directory,
    registry: input.registry,
    localHostId: null,
    activeHostId: input.activeHostId,
    localService: undefined,
    hasLiveSession: () => false,
    localHostSettingUp: false,
    sandboxes: input.sandboxes,
    nowMs: 0,
  });
}

function optionsFor(
  options: readonly HostScopeOption[],
  hostId: string,
): readonly HostScopeOption[] {
  return options.filter((option) => option.hostId === hostId);
}

describe("buildHostScopeOptions a listed sandbox with no host row", () => {
  it("lists a failed sandbox no directory entry or registry row stands for as one management-only sandbox row", () => {
    const summary = sandboxSummaryFixture({
      id: "sbx_failed",
      hostId: "sbx-never-enrolled",
      displayName: "Broken box",
      state: "failed",
      failureCode: "PROVIDER_CREATE_FAILED",
    });
    const rows = optionsFor(
      build({
        directory: [],
        registry: [],
        sandboxes: [summary],
        activeHostId: null,
      }),
      "sbx-never-enrolled",
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe("sandbox");
    expect(row.name).toBe("Broken box");
    expect(row.entry).toBeNull();
    expect(row.item).toBeNull();
    expect(row.registered).toBe(false);
    expect(row.connectable).toBe(false);
    expect(row.isActive).toBe(false);
    expect(row.sandbox).toEqual({
      state: "failed",
      frozen: false,
      summary,
      teamOwned: false,
    });
  });

  it("lists a creating sandbox whose guest has not enrolled yet the same way", () => {
    const summary = sandboxSummaryFixture({
      id: "sbx_creating",
      hostId: "sbx-still-creating",
      displayName: "New box",
      state: "creating",
    });
    const rows = optionsFor(
      build({
        directory: [],
        registry: [],
        sandboxes: [summary],
        activeHostId: null,
      }),
      "sbx-still-creating",
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe("sandbox");
    expect(row.name).toBe("New box");
    expect(row.entry).toBeNull();
    expect(row.item).toBeNull();
    expect(row.registered).toBe(false);
    expect(row.connectable).toBe(false);
    expect(row.sandbox).toEqual({
      state: "creating",
      frozen: false,
      summary,
      teamOwned: false,
    });
  });

  it("marks the row active when the app's active host id is the sandbox's, like any other row", () => {
    const rows = optionsFor(
      build({
        directory: [],
        registry: [],
        sandboxes: [
          sandboxSummaryFixture({
            id: "sbx_failed",
            hostId: "sbx-never-enrolled",
            state: "failed",
            failureCode: "PROVIDER_CREATE_FAILED",
          }),
        ],
        activeHostId: "sbx-never-enrolled",
      }),
      "sbx-never-enrolled",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(true);
  });

  it("reads a team sandbox (one with an environment) as team owned", () => {
    const rows = optionsFor(
      build({
        directory: [],
        registry: [],
        sandboxes: [
          sandboxSummaryFixture({
            id: "sbx_team",
            hostId: "sbx-team-failed",
            state: "failed",
            failureCode: "PROVIDER_CREATE_FAILED",
            environmentId: "env_team_1",
          }),
        ],
        activeHostId: null,
      }),
      "sbx-team-failed",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sandbox?.teamOwned).toBe(true);
  });

  it("reads a sandbox with no environment as not team owned", () => {
    const rows = optionsFor(
      build({
        directory: [],
        registry: [],
        sandboxes: [
          sandboxSummaryFixture({
            id: "sbx_mine",
            hostId: "sbx-mine-failed",
            state: "failed",
            failureCode: "PROVIDER_CREATE_FAILED",
            environmentId: null,
          }),
        ],
        activeHostId: null,
      }),
      "sbx-mine-failed",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sandbox?.teamOwned).toBe(false);
  });

  it("adds one row per listed sandbox without a host row and leaves the rows that have one alone", () => {
    const enrolled = registryItem("sbx-enrolled");
    const rows = build({
      directory: [
        hostListItemToDirectoryEntry(enrolled, "wss://relay.example.test"),
      ],
      registry: [enrolled],
      sandboxes: [
        sandboxSummaryFixture({
          id: "sbx_a",
          hostId: "sbx-enrolled",
          displayName: "Enrolled box",
          state: "awake",
        }),
        sandboxSummaryFixture({
          id: "sbx_b",
          hostId: "sbx-orphan-b",
          displayName: "Orphan B",
          state: "failed",
          failureCode: "PROVIDER_CREATE_FAILED",
        }),
        sandboxSummaryFixture({
          id: "sbx_c",
          hostId: "sbx-orphan-c",
          displayName: "Orphan C",
          state: "creating",
        }),
      ],
      activeHostId: null,
    });

    expect(rows.map((row) => row.hostId).sort()).toEqual([
      "sbx-enrolled",
      "sbx-orphan-b",
      "sbx-orphan-c",
    ]);
  });
});

describe("buildHostScopeOptions a listed sandbox that already has a host row", () => {
  it("yields exactly one row for a sandbox the registry lists, and it is the joined registry row", () => {
    const enrolled = registryItem("sbx-enrolled");
    const summary = sandboxSummaryFixture({
      id: "sbx_1",
      hostId: "sbx-enrolled",
      displayName: "Control plane name",
    });
    const rows = optionsFor(
      build({
        directory: [],
        registry: [enrolled],
        sandboxes: [summary],
        activeHostId: null,
      }),
      "sbx-enrolled",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].item).toBe(enrolled);
    expect(rows[0].registered).toBe(true);
    expect(rows[0].name).toBe("Registered sbx-enrolled");
    expect(rows[0].sandbox?.summary).toBe(summary);
  });

  it("yields exactly one row for a sandbox only the directory lists", () => {
    const enrolled = registryItem("sbx-directory-only");
    const entry = hostListItemToDirectoryEntry(
      enrolled,
      "wss://relay.example.test",
    );
    const rows = optionsFor(
      build({
        directory: [entry],
        registry: [],
        sandboxes: [
          sandboxSummaryFixture({
            id: "sbx_1",
            hostId: "sbx-directory-only",
          }),
        ],
        activeHostId: null,
      }),
      "sbx-directory-only",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].entry).toBe(entry);
    expect(rows[0].item).toBeNull();
  });
});

describe("buildHostScopeOptions before the sandbox list has answered", () => {
  it("adds no row when the list has not answered", () => {
    const rows = build({
      directory: [],
      registry: [registryItem("sbx-enrolled")],
      sandboxes: null,
      activeHostId: null,
    });
    expect(rows.map((row) => row.hostId)).toEqual(["sbx-enrolled"]);
  });

  it("adds no row for an empty list", () => {
    expect(
      build({
        directory: [],
        registry: [],
        sandboxes: [],
        activeHostId: null,
      }),
    ).toEqual([]);
  });
});
