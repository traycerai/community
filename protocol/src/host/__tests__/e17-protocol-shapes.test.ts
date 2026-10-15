import { describe, expect, it } from "vitest";
import {
  downgradeResponseAcrossMajors,
  isRpcErrorCode,
  RPC_ERROR_CODES,
} from "@traycer/protocol/framework/index";
import {
  agentListDowngradeV10ToV9,
  agentListUpgradeV100ToV101,
  agentListV100,
  agentListV101,
} from "@traycer/protocol/host/agent/contracts";
import {
  agentSummarySchema,
  listAgentsResponseSchema,
  listAgentsResponseSchemaV100,
} from "@traycer/protocol/host/agent/shared";
import { hostRpcRegistry } from "@traycer/protocol/host/registry";
import {
  credentialUpdatePayloadSchema,
  SESSION_CAPABILITY_CREDENTIAL_UPDATE,
  SESSION_CAPABILITY_MEMBER_CREDENTIAL,
} from "../../host-transport/mux";
import { HOST_LIST_ITEM_GOLDEN_FIXTURE } from "../__fixtures__/host-status-golden-fixture";
import { hostListItemSchema, hostListItemSchemaV10 } from "../host-status";
import {
  UNKNOWN_CONNECTIVITY,
  lastKnownConnectivitySchema,
} from "../last-known-connectivity";
import { sandboxSummarySchema } from "../sandbox-control";
import {
  taskHostPrincipalSchema,
  taskHostSummarySchema,
} from "../task-host-summary";

/**
 * Wire shapes ticket E17 checkpoint 1 adds: the `principal_mismatch` error
 * code, `agent.list@10.1`, the host list `owner`, the sandbox card's member
 * names, the task host summary, and the member-credential handoff on the
 * `CREDENTIAL_UPDATE` frame. Each case reads the shape through the schema a
 * peer would, so a missing key, a loosened arm or a wrong default fails here
 * rather than on a released client.
 */

describe("principal_mismatch error code", () => {
  it("is an RPC error code a client narrows to instead of folding into RPC_ERROR", () => {
    expect(isRpcErrorCode("principal_mismatch")).toBe(true);
    expect(RPC_ERROR_CODES).toContain("principal_mismatch");
  });

  it("does not widen the narrowing to a neighbouring spelling", () => {
    expect(isRpcErrorCode("PRINCIPAL_MISMATCH")).toBe(false);
    expect(isRpcErrorCode("principal-mismatch")).toBe(false);
  });
});

describe("agent.list@10.1", () => {
  const BASE_ROW = {
    id: "agent-1",
    parentId: null,
    hostId: "host-1",
    isLocal: true,
    surface: "gui" as const,
    harnessId: "codex" as const,
    title: "Existing chat",
    isSelf: true,
    capabilities: { readTranscript: true, sendMessage: true },
    active: false,
    folderPaths: ["/repo"],
    isWorktree: false,
    runConfig: null,
    sessionState: null,
    lastExit: null,
    archived: false,
  };
  const CALLER = { agentId: "agent-1", canSendMessages: true };

  const V101_RESPONSE = listAgentsResponseSchema.parse({
    caller: CALLER,
    scope: "user",
    agents: [
      {
        ...BASE_ROW,
        reach: "same_principal",
        hostConnectivity: UNKNOWN_CONNECTIVITY,
      },
      {
        ...BASE_ROW,
        id: "agent-2",
        isSelf: false,
        reach: "other_principal",
        hostConnectivity: {
          kind: "known",
          connectivity: "offline",
          observedAt: 1_791_000_000_000,
        },
      },
      {
        ...BASE_ROW,
        id: "agent-3",
        isSelf: false,
        reach: null,
        hostConnectivity: { kind: "unknown" },
      },
    ],
  });

  const V100_RESPONSE = listAgentsResponseSchemaV100.parse({
    caller: CALLER,
    scope: "user",
    agents: [BASE_ROW, { ...BASE_ROW, id: "agent-2", isSelf: false }],
  });

  it("keeps reach and hostConnectivity on the head schema", () => {
    expect(V101_RESPONSE.agents.map((row) => row.reach)).toEqual([
      "same_principal",
      "other_principal",
      null,
    ]);
    expect(V101_RESPONSE.agents[1].hostConnectivity).toEqual({
      kind: "known",
      connectivity: "offline",
      observedAt: 1_791_000_000_000,
    });
  });

  it("requires both keys on the head row, so a 10.0 row cannot ride as a 10.1 one", () => {
    expect(agentSummarySchema.safeParse(BASE_ROW).success).toBe(false);
    expect(
      agentSummarySchema.safeParse({ ...BASE_ROW, reach: null }).success,
    ).toBe(false);
    expect(
      agentSummarySchema.safeParse({
        ...BASE_ROW,
        hostConnectivity: UNKNOWN_CONNECTIVITY,
      }).success,
    ).toBe(false);
    expect(
      agentSummarySchema.safeParse({
        ...BASE_ROW,
        reach: "other_principal",
        hostConnectivity: UNKNOWN_CONNECTIVITY,
      }).success,
    ).toBe(true);
  });

  it("refuses a reach value outside same_principal, other_principal and null", () => {
    expect(
      agentSummarySchema.safeParse({
        ...BASE_ROW,
        reach: "someone_else",
        hostConnectivity: UNKNOWN_CONNECTIVITY,
      }).success,
    ).toBe(false);
  });

  it("strips both keys from every row when a 10.0 caller's contract parses a 10.1 answer", () => {
    const asTenZero = listAgentsResponseSchemaV100.parse(V101_RESPONSE);

    expect(asTenZero.agents).toHaveLength(3);
    for (const row of asTenZero.agents) {
      expect(Object.hasOwn(row, "reach")).toBe(false);
      expect(Object.hasOwn(row, "hostConnectivity")).toBe(false);
    }
    // Nothing else about the row moved.
    expect(asTenZero.agents[1]).toMatchObject({
      id: "agent-2",
      archived: false,
      harnessId: "codex",
    });
  });

  it("names the frozen 10.0 schema on the @10.0 contract and the canonical one on the head", () => {
    expect(agentListV100.responseSchema).toBe(listAgentsResponseSchemaV100);
    expect(agentListV101.responseSchema).toBe(listAgentsResponseSchema);
    expect(agentListV101.schemaVersion).toEqual({ major: 10, minor: 1 });
  });

  it("upgrades a 10.0 response by stamping reach: null and hostConnectivity: unknown on every row", () => {
    const upgraded = agentListUpgradeV100ToV101.upgradeResponse(V100_RESPONSE);

    expect(upgraded.agents).toHaveLength(2);
    for (const row of upgraded.agents) {
      expect(row.reach).toBeNull();
      expect(row.hostConnectivity).toEqual({ kind: "unknown" });
      // `unknown`, never `offline`: an older host was never asked.
      expect(row.hostConnectivity.kind).not.toBe("known");
    }
    expect(upgraded.caller).toEqual(V100_RESPONSE.caller);
    expect(upgraded.scope).toBe(V100_RESPONSE.scope);
    expect(upgraded.agents.map((row) => row.id)).toEqual([
      "agent-1",
      "agent-2",
    ]);
    expect(() => listAgentsResponseSchema.parse(upgraded)).not.toThrow();
  });

  it("leaves the request untouched on the 10.0 -> 10.1 upgrade", () => {
    const request = {
      epicId: "epic-1",
      senderAgentId: "agent-1",
      scope: "all" as const,
    };
    expect(agentListUpgradeV100ToV101.from).toEqual({ major: 10, minor: 0 });
    expect(agentListUpgradeV100ToV101.to).toEqual({ major: 10, minor: 1 });
    expect(agentListUpgradeV100ToV101.upgradeRequest(request)).toEqual(request);
  });

  it("registers 10.1 as the latest minor of major 10, over the 10.0 contract", () => {
    const line = hostRpcRegistry["agent.list"][10];

    expect(line.latestMinor).toBe(1);
    expect(line.versions[0].contract).toBe(agentListV100);
    expect(line.versions[1].contract).toBe(agentListV101);
  });

  it("starts the 10 -> 9 bridge at 10.1 and drops both keys on the way out", () => {
    expect(agentListDowngradeV10ToV9.from).toEqual({ major: 10, minor: 1 });
    expect(agentListDowngradeV10ToV9.to).toEqual({ major: 9, minor: 2 });

    const downgraded =
      agentListDowngradeV10ToV9.downgradeResponse(V101_RESPONSE);

    expect(downgraded.ok).toBe(true);
    if (!downgraded.ok) throw new Error("expected the downgrade to succeed");
    expect(downgraded.value.agents).toHaveLength(3);
    for (const row of downgraded.value.agents) {
      expect(Object.hasOwn(row, "reach")).toBe(false);
      expect(Object.hasOwn(row, "hostConnectivity")).toBe(false);
      expect(row.archived).toBe(false);
    }
  });

  it("carries a 10.1 answer down to a major-9 caller through the registry without either key", () => {
    const result = downgradeResponseAcrossMajors(
      hostRpcRegistry["agent.list"],
      10,
      9,
      V101_RESPONSE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the downgrade to succeed");
    for (const row of result.value.agents) {
      expect(Object.hasOwn(row, "reach")).toBe(false);
      expect(Object.hasOwn(row, "hostConnectivity")).toBe(false);
    }
  });
});

describe("host list owner (?include=owner)", () => {
  it("accepts a user owner", () => {
    const row = {
      ...HOST_LIST_ITEM_GOLDEN_FIXTURE,
      owner: { kind: "user" as const, id: "user-1" },
    };

    expect(hostListItemSchema.parse(row).owner).toEqual({
      kind: "user",
      id: "user-1",
    });
  });

  it("accepts a team owner with its display name", () => {
    const row = {
      ...HOST_LIST_ITEM_GOLDEN_FIXTURE,
      owner: { kind: "team" as const, id: "team-1", name: "Platform" },
    };

    expect(hostListItemSchema.parse(row).owner).toEqual({
      kind: "team",
      id: "team-1",
      name: "Platform",
    });
  });

  it("still parses a row that carries no owner, the row a client that does not ask gets", () => {
    const parsed = hostListItemSchema.parse(HOST_LIST_ITEM_GOLDEN_FIXTURE);

    expect(Object.hasOwn(parsed, "owner")).toBe(false);
  });

  it("refuses a team owner without a name, an empty name, and an unknown kind", () => {
    for (const owner of [
      { kind: "team", id: "team-1" },
      { kind: "team", id: "team-1", name: "" },
      { kind: "org", id: "org-1" },
      { kind: "user", id: "" },
    ]) {
      expect(
        hostListItemSchema.safeParse({
          ...HOST_LIST_ITEM_GOLDEN_FIXTURE,
          owner,
        }).success,
        JSON.stringify(owner),
      ).toBe(false);
    }
  });

  it("refuses a name on the user arm and a stray key on the team arm (both arms are strict)", () => {
    expect(
      hostListItemSchema.safeParse({
        ...HOST_LIST_ITEM_GOLDEN_FIXTURE,
        owner: { kind: "user", id: "user-1", name: "Ada" },
      }).success,
    ).toBe(false);
    expect(
      hostListItemSchema.safeParse({
        ...HOST_LIST_ITEM_GOLDEN_FIXTURE,
        owner: { kind: "team", id: "team-1", name: "Platform", role: "admin" },
      }).success,
    ).toBe(false);
  });

  it("is not carried by the frozen @1.0 row, which is strict and so refuses it", () => {
    expect(
      hostListItemSchemaV10.safeParse(HOST_LIST_ITEM_GOLDEN_FIXTURE).success,
    ).toBe(true);
    expect(
      hostListItemSchemaV10.safeParse({
        ...HOST_LIST_ITEM_GOLDEN_FIXTURE,
        owner: { kind: "user", id: "user-1" },
      }).success,
    ).toBe(false);
    expect(
      hostListItemSchemaV10.safeParse({
        ...HOST_LIST_ITEM_GOLDEN_FIXTURE,
        owner: { kind: "team", id: "team-1", name: "Platform" },
      }).success,
    ).toBe(false);
  });
});

describe("SandboxSummary createdBy and wakePayer", () => {
  const SANDBOX_ROW = {
    id: "sbx_1",
    hostId: "8f6f2d7e-1f43-4c1e-9d63-1e3a7d2c9b10",
    kind: "agent",
    provider: "tensorlake",
    region: "us-east",
    os: "linux",
    cpus: 2,
    memoryMb: 4096,
    diskMb: 20480,
    displayName: "build-box",
    state: "awake",
    frozen: false,
    failureCode: null,
    idleMinutes: null,
    burst: false,
    createdByHostId: null,
    createdByAgentId: null,
    createdAt: 1_791_000_000_000,
    lastTransitionAt: 1_791_000_010_000,
    lastActivityAt: null,
    destroyedAt: null,
    priceMcPerHour: { awakeMc: 120, suspendedMc: 4, stoppedMc: 2 },
  };

  it("reads both as null from a server that predates them", () => {
    const parsed = sandboxSummarySchema.parse(SANDBOX_ROW);

    expect(parsed.createdBy).toBeNull();
    expect(parsed.wakePayer).toBeNull();
  });

  it("parses a member with a display name and one without", () => {
    const parsed = sandboxSummarySchema.parse({
      ...SANDBOX_ROW,
      createdBy: { userId: "user-1", displayName: "Ada" },
      wakePayer: { userId: "user-2", displayName: null },
    });

    expect(parsed.createdBy).toEqual({ userId: "user-1", displayName: "Ada" });
    expect(parsed.wakePayer).toEqual({ userId: "user-2", displayName: null });
  });

  it("keeps explicit nulls as nulls", () => {
    const parsed = sandboxSummarySchema.parse({
      ...SANDBOX_ROW,
      createdBy: null,
      wakePayer: null,
    });

    expect(parsed.createdBy).toBeNull();
    expect(parsed.wakePayer).toBeNull();
  });

  it("refuses a member with no user id, so the card never names an anonymous payer", () => {
    expect(
      sandboxSummarySchema.safeParse({
        ...SANDBOX_ROW,
        createdBy: { userId: "", displayName: "Ada" },
      }).success,
    ).toBe(false);
    expect(
      sandboxSummarySchema.safeParse({
        ...SANDBOX_ROW,
        wakePayer: { displayName: "Ada" },
      }).success,
    ).toBe(false);
  });
});

describe("last known connectivity", () => {
  it("parses a known observation of either connectivity", () => {
    for (const connectivity of ["connectable", "offline"] as const) {
      expect(
        lastKnownConnectivitySchema.parse({
          kind: "known",
          connectivity,
          observedAt: 1_791_000_000_000,
        }),
      ).toEqual({ kind: "known", connectivity, observedAt: 1_791_000_000_000 });
    }
  });

  it("rejects a known observation whose connectivity is unknown", () => {
    expect(
      lastKnownConnectivitySchema.safeParse({
        kind: "known",
        connectivity: "unknown",
        observedAt: 1_791_000_000_000,
      }).success,
    ).toBe(false);
  });

  it("rejects an offline kind: unknown is its own arm and is never offline", () => {
    expect(
      lastKnownConnectivitySchema.safeParse({ kind: "offline" }).success,
    ).toBe(false);
    expect(lastKnownConnectivitySchema.parse({ kind: "unknown" })).toEqual({
      kind: "unknown",
    });
    expect(UNKNOWN_CONNECTIVITY).toEqual({ kind: "unknown" });
  });

  it("rejects a known observation with no usable time", () => {
    for (const observedAt of [-1, 1.5, "yesterday"]) {
      expect(
        lastKnownConnectivitySchema.safeParse({
          kind: "known",
          connectivity: "connectable",
          observedAt,
        }).success,
        String(observedAt),
      ).toBe(false);
    }
  });
});

describe("TaskHostSummary", () => {
  const SUMMARY = {
    hostId: "host-9",
    label: "Ada's laptop",
    principal: { kind: "user" as const, id: "user-9" },
    reach: "other_principal" as const,
    agents: [{ agentId: "agent-1", title: "Plan" }],
    state: { kind: "unknown" as const },
  };

  it("keeps an unknown state unknown, never offline", () => {
    const parsed = taskHostSummarySchema.parse(SUMMARY);

    expect(parsed.state).toEqual({ kind: "unknown" });
    expect(parsed.state.kind).toBe("unknown");
  });

  it("parses a known state beside it", () => {
    const parsed = taskHostSummarySchema.parse({
      ...SUMMARY,
      state: {
        kind: "known",
        connectivity: "connectable",
        observedAt: 1_791_000_000_000,
      },
    });

    expect(parsed.state).toEqual({
      kind: "known",
      connectivity: "connectable",
      observedAt: 1_791_000_000_000,
    });
  });

  it("parses a team principal whose name is null (the caller is not in that team)", () => {
    const parsed = taskHostSummarySchema.parse({
      ...SUMMARY,
      principal: { kind: "team", id: "team-1", name: null },
    });

    expect(parsed.principal).toEqual({
      kind: "team",
      id: "team-1",
      name: null,
    });
    expect(
      taskHostPrincipalSchema.parse({
        kind: "team",
        id: "team-1",
        name: "Platform",
      }),
    ).toEqual({ kind: "team", id: "team-1", name: "Platform" });
  });

  it("requires the team principal to say whether it has a name", () => {
    expect(
      taskHostSummarySchema.safeParse({
        ...SUMMARY,
        principal: { kind: "team", id: "team-1" },
      }).success,
    ).toBe(false);
  });

  it("takes a null label and an empty agent list, and refuses a reach outside the two arms", () => {
    expect(
      taskHostSummarySchema.safeParse({ ...SUMMARY, label: null, agents: [] })
        .success,
    ).toBe(true);
    expect(
      taskHostSummarySchema.safeParse({ ...SUMMARY, reach: null }).success,
    ).toBe(false);
    expect(
      taskHostSummarySchema.safeParse({ ...SUMMARY, reach: "someone_else" })
        .success,
    ).toBe(false);
  });

  it("is tolerant of a field a newer server adds, and strips it", () => {
    const parsed = taskHostSummarySchema.parse({
      ...SUMMARY,
      sandboxId: "sbx_1",
    });

    expect(Object.hasOwn(parsed, "sandboxId")).toBe(false);
  });
});

describe("credentialUpdatePayloadSchema", () => {
  const HANDOFF = {
    token: "member-access",
    refreshToken: "member-refresh",
    familyId: "family-1",
    provisionedAt: "2026-10-16T12:00:00.000Z",
  };

  it("pins the wire value of the member-credential capability tag, apart from credentialUpdate", () => {
    expect(SESSION_CAPABILITY_MEMBER_CREDENTIAL).toBe("memberCredential");
    expect(SESSION_CAPABILITY_MEMBER_CREDENTIAL).not.toBe(
      SESSION_CAPABILITY_CREDENTIAL_UPDATE,
    );
  });

  it("reads a released-shape bearer frame with memberCredential: null", () => {
    expect(credentialUpdatePayloadSchema.parse({ bearer: "x" })).toEqual({
      bearer: "x",
      memberCredential: null,
    });
  });

  it("rejects a frame with a null bearer and no member credential, absent or null", () => {
    expect(
      credentialUpdatePayloadSchema.safeParse({ bearer: null }).success,
    ).toBe(false);
    expect(
      credentialUpdatePayloadSchema.safeParse({
        bearer: null,
        memberCredential: null,
      }).success,
    ).toBe(false);
  });

  it("accepts a member credential beside a null bearer, and beside a bearer", () => {
    expect(
      credentialUpdatePayloadSchema.parse({
        bearer: null,
        memberCredential: HANDOFF,
      }),
    ).toEqual({ bearer: null, memberCredential: HANDOFF });
    expect(
      credentialUpdatePayloadSchema.parse({
        bearer: "x",
        memberCredential: HANDOFF,
      }),
    ).toEqual({ bearer: "x", memberCredential: HANDOFF });
  });

  it("rejects a provisionedAt that is not an ISO millisecond timestamp", () => {
    for (const provisionedAt of [
      "yesterday",
      "2026-10-16",
      "2026-10-16T12:00:00Z",
      "2026-10-16T12:00:00.5Z",
      "",
    ]) {
      expect(
        credentialUpdatePayloadSchema.safeParse({
          bearer: null,
          memberCredential: { ...HANDOFF, provisionedAt },
        }).success,
        provisionedAt,
      ).toBe(false);
    }
  });

  it("rejects an extra key inside memberCredential (the handoff is strict)", () => {
    expect(
      credentialUpdatePayloadSchema.safeParse({
        bearer: null,
        memberCredential: { ...HANDOFF, scope: "admin" },
      }).success,
    ).toBe(false);
  });

  it("rejects a handoff missing a field or carrying an empty one", () => {
    for (const field of [
      "token",
      "refreshToken",
      "familyId",
      "provisionedAt",
    ] as const) {
      const { [field]: _omitted, ...without } = HANDOFF;
      expect(
        credentialUpdatePayloadSchema.safeParse({
          bearer: null,
          memberCredential: without,
        }).success,
        `missing ${field}`,
      ).toBe(false);
    }
    expect(
      credentialUpdatePayloadSchema.safeParse({
        bearer: null,
        memberCredential: { ...HANDOFF, token: "" },
      }).success,
    ).toBe(false);
  });
});
