import { describe, expect, it } from "vitest";
import {
  groupHostOptions,
  hostOptionCanActivate,
  hostOptionPickerGroup,
  pickableHostOptions,
} from "@/components/settings/host-scope/host-option-model";
import {
  buildHostScopeOptions,
  type HostScopeOption,
} from "@/components/settings/host-scope/host-scope-model";
import { hostScopeOptionFixture } from "@/components/settings/host-scope/host-scope-fixture";
import { sandboxSummaryFixture } from "@/hooks/sandboxes/__tests__/sandbox-fixtures";

/**
 * Ticket E17, finding F15 (a sandbox with no host row is listed): a sandbox row
 * with neither a directory entry nor a registry row is management-only. The
 * host list shows it, so the person can destroy it; no picker offers it and
 * Activate is never offered for it, because there is no host to start work on.
 */

const UNENROLLED_HOST_ID = "sbx-never-enrolled";

function unenrolledRow(state: "failed" | "creating"): HostScopeOption {
  const rows = buildHostScopeOptions({
    leases: [],
    authorityAttached: false,
    directory: [],
    registry: [],
    localHostId: null,
    activeHostId: null,
    localService: undefined,
    hasLiveSession: () => false,
    localHostSettingUp: false,
    sandboxes: [
      sandboxSummaryFixture({
        id: "sbx_unenrolled",
        hostId: UNENROLLED_HOST_ID,
        displayName: "Broken box",
        state,
        failureCode: state === "failed" ? "PROVIDER_CREATE_FAILED" : null,
      }),
    ],
    nowMs: 0,
  });
  const row = rows.find((option) => option.hostId === UNENROLLED_HOST_ID);
  if (row === undefined) {
    throw new Error("the sandbox list's row was not built");
  }
  return row;
}

describe("hostOptionPickerGroup for a sandbox no host row stands for", () => {
  it("puts it in the host list's sandbox group, whatever its state", () => {
    expect(hostOptionPickerGroup(unenrolledRow("failed"), true, false)).toBe(
      "sandbox",
    );
    expect(hostOptionPickerGroup(unenrolledRow("creating"), true, false)).toBe(
      "sandbox",
    );
  });

  it("hides it from every picker, even one that offers automations", () => {
    for (const state of ["failed", "creating"] as const) {
      const row = unenrolledRow(state);
      expect(hostOptionPickerGroup(row, false, false)).toBe("hidden");
      expect(hostOptionPickerGroup(row, false, true)).toBe("hidden");
    }
  });

  it("never offers Activate for it", () => {
    expect(hostOptionCanActivate(unenrolledRow("failed"))).toBe(false);
    expect(hostOptionCanActivate(unenrolledRow("creating"))).toBe(false);
  });

  it("hides a literal row with no entry, no registry row and an unanswered control-plane row, from a picker", () => {
    const row = hostScopeOptionFixture({
      hostId: "sbx-literal",
      isLocalMachine: false,
      isActive: false,
      connectable: false,
      registered: false,
      entry: null,
      item: null,
      kind: "sandbox",
      sandbox: {
        state: "failed",
        frozen: false,
        summary: sandboxSummaryFixture({
          hostId: "sbx-literal",
          state: "failed",
          failureCode: "PROVIDER_CREATE_FAILED",
        }),
        teamOwned: false,
      },
    });
    expect(hostOptionPickerGroup(row, false, false)).toBe("hidden");
    expect(hostOptionPickerGroup(row, true, false)).toBe("sandbox");
  });
});

describe("groupHostOptions for a sandbox no host row stands for", () => {
  it("lists it in the host list's top-level sandboxes and in no team group", () => {
    for (const state of ["failed", "creating"] as const) {
      const row = unenrolledRow(state);
      const groups = groupHostOptions([row], true, false, null);

      expect(groups.sandboxes).toEqual([row]);
      expect(groups.teams).toEqual([]);
      expect(groups.personal).toEqual([]);
      expect(groups.agentSandboxes).toEqual([]);
    }
  });

  it("drops it from a picker's groups", () => {
    for (const state of ["failed", "creating"] as const) {
      const groups = groupHostOptions(
        [unenrolledRow(state)],
        false,
        false,
        null,
      );

      expect(groups.sandboxes).toEqual([]);
      expect(groups.teams).toEqual([]);
      expect(groups.personal).toEqual([]);
      expect(groups.agentSandboxes).toEqual([]);
    }
  });

  it("keeps it out of a flat picker list", () => {
    expect(pickableHostOptions([unenrolledRow("failed")], null)).toEqual([]);
  });
});
