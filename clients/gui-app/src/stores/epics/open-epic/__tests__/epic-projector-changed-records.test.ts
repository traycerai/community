/**
 * `projector.projectChanges()` over a record-plane epic (lane sources, real
 * chat record table, real transactional sink). A stable-membership record
 * change rebuilds only the changed tree rows and the branches they sort in;
 * anything that can move membership or parentage falls back to the full
 * composition. `composeEpicProjection` is the oracle for every case, and
 * `collectRawTreeRecords` inputs are the work count.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRecordSummaryV11 } from "@traycer/protocol/host/epic/chat-records";
import { createTransactionalProjectionSink } from "@traycer-clients/shared/replica-runtime";
import type {
  ArtifactsSlice,
  ChatsSlice,
  EpicProjectedSlices,
  TerminalAgentsSlice,
} from "../types";
import { EMPTY_PROJECTED_SLICES, EMPTY_TERMINAL_AGENTS_SLICE } from "../types";
import type {
  EpicRawProjectionSources,
  ProjectionInputs,
} from "../projection-helpers";
import {
  EMPTY_PENDING_OVERLAY,
  type PendingMetadataMutation,
  type PendingMetadataOverlay,
} from "../pending-metadata-overlay";
import { changedTableIds } from "../runtime/projection-table-changes";
import { epicStateSubscribeServerFrameSchemaV11 } from "@traycer/protocol/host/epic/state-subscribe";
import type { EpicStateRow } from "@traycer-clients/shared/epic-lanes";
import {
  EPIC_META_ROW_ID,
  EPIC_STATE_LANE_ID,
  ROLE_CLAIMS_ROW_ID,
  artifactRowId,
} from "@traycer-clients/shared/epic-lanes";
import type { RecordRow } from "@traycer-clients/shared/replica-runtime";
import {
  createEpicLaneStateReplica,
  laneRawProjectionSources,
} from "../runtime/epic-lane-state-replica";

/** `rows`: tree inputs collected; `composed`: full compositions run. */
const collected = vi.hoisted(() => ({ rows: 0, composed: 0 }));

vi.mock("../projection-helpers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../projection-helpers")>();
  return {
    ...original,
    collectRawTreeRecords: (
      artifacts: ArtifactsSlice,
      chats: ChatsSlice,
      tuiAgents: TerminalAgentsSlice,
    ) => {
      collected.rows +=
        artifacts.allIds.length + chats.allIds.length + tuiAgents.allIds.length;
      return original.collectRawTreeRecords(artifacts, chats, tuiAgents);
    },
    composeEpicProjection: (
      raw: EpicRawProjectionSources,
      currentUserId: string | null,
      inputs: ProjectionInputs,
    ) => {
      collected.composed += 1;
      return original.composeEpicProjection(raw, currentUserId, inputs);
    },
  };
});

// Imported after the mock so the incremental helper binds the counting wrapper.
const { composeEpicProjection, RECORD_PLANE_COVERS_BOTH } =
  await import("../projection-helpers");
const { createChatRecordTable } = await import("../runtime/chat-record-table");
const { createEpicProjector } = await import("../runtime/epic-projector");

const EPIC_ID = "epic-projector-changed";
const OWNER = "user-a";
const CHILDREN = 50;
const CHANGED_COUNTS = [1, 10, 50] as const;

function record(
  chatId: string,
  overrides: Partial<ChatRecordSummaryV11>,
): ChatRecordSummaryV11 {
  return {
    chatId,
    ownerUserId: OWNER,
    originHostId: "host-1",
    title: `Title ${chatId}`,
    isTitleEditedByUser: false,
    parentChatId: null,
    createdAt: 1,
    updatedAt: 2,
    archived: false,
    archivedAt: null,
    runSettingsSummary: "claude",
    revision: 1,
    visibility: "private",
    origin: "own",
    docResident: false,
    ...overrides,
  };
}

/** Two parents, 25 children each; a higher index is more recently updated. */
function seedRecords(): ChatRecordSummaryV11[] {
  const children = Array.from({ length: CHILDREN }, (_, i) =>
    record(`c${i}`, {
      parentChatId: i < CHILDREN / 2 ? "p1" : "p2",
      updatedAt: 100 + i,
    }),
  );
  return [
    record("p1", { updatedAt: 500 }),
    record("p2", { updatedAt: 499 }),
    ...children,
  ];
}

function harness(
  readRaw: () => EpicRawProjectionSources,
  overlay: PendingMetadataOverlay,
) {
  const table = createChatRecordTable({
    getCurrentUserId: () => OWNER,
    onBeforePublish: () => undefined,
    now: () => 0,
  });
  table.applyRecords(seedRecords(), null);
  const sink = createTransactionalProjectionSink<EpicProjectedSlices>(
    EMPTY_PROJECTED_SLICES,
    () => undefined,
  );
  const inputs = () => ({
    chatRecords: table.current(),
    tuiAgentRecords: EMPTY_TERMINAL_AGENTS_SLICE,
    pendingOverlay: overlay,
    reportDeadMutations: () => undefined,
    docArm: RECORD_PLANE_COVERS_BOTH,
  });
  const projector = createEpicProjector({
    getCurrentUserId: () => OWNER,
    getChatRecords: () => table.current(),
    getTuiAgentRecords: () => EMPTY_TERMINAL_AGENTS_SLICE,
    getDocArm: () => RECORD_PLANE_COVERS_BOTH,
    getPendingOverlay: () => overlay,
    onDeadMutations: () => undefined,
  });
  projector.attachLaneSources(readRaw, sink);
  // The attach above composed once; a test counts what comes after it. The
  // oracle composes too, so a test reads `collected.composed` BEFORE calling it.
  collected.composed = 0;
  const oracle = () => composeEpicProjection(readRaw(), OWNER, inputs());
  return { table, sink, projector, oracle };
}

function setupWithOverlay(overlay: PendingMetadataOverlay) {
  const raw = {
    artifacts: EMPTY_PROJECTED_SLICES.artifacts,
    deletedArtifacts: EMPTY_PROJECTED_SLICES.deletedArtifacts,
    docChats: EMPTY_PROJECTED_SLICES.docChats,
    docTuiAgents: EMPTY_PROJECTED_SLICES.docTuiAgents,
    epicHeader: EMPTY_PROJECTED_SLICES.epic,
    roleClaims: [],
  };
  return harness(() => raw, overlay);
}

function setup() {
  return setupWithOverlay(EMPTY_PENDING_OVERLAY);
}

function upsert(chatId: string, overrides: Partial<ChatRecordSummaryV11>) {
  const base = seedRecords().find((r) => r.chatId === chatId);
  return {
    kind: "upsert" as const,
    epicId: EPIC_ID,
    record: record(chatId, {
      ...(base === undefined ? {} : base),
      ...overrides,
    }),
  };
}

beforeEach(() => {
  collected.rows = 0;
  collected.composed = 0;
});

describe("projector.projectChanges - record-plane changes rebuild only what changed", () => {
  it("starts from a projection that equals the oracle", () => {
    const { sink, oracle } = setup();
    expect(sink.read()).toEqual(oracle());
  });

  it.each(CHANGED_COUNTS)(
    "a title edit on %i chats touches %i tree rows, no branch, and equals the full projection",
    (count) => {
      const { table, sink, projector, oracle } = setup();
      const before = sink.read();
      collected.rows = 0;

      for (let i = 0; i < count; i += 1) {
        table.applyDelta(
          upsert(`c${i}`, { title: `Renamed ${i}`, revision: 2 }),
        );
      }
      const after = projector.projectChanges();

      expect(collected.rows).toBe(count);
      expect(
        changedTableIds(before.tree.nodeById, after.tree.nodeById),
      ).toEqual(new Set(Array.from({ length: count }, (_, i) => `c${i}`)));
      // Recency sort: a title edit reorders nothing, so every branch is kept.
      expect(after.tree.childrenByParent).toBe(before.tree.childrenByParent);
      expect(after.tree.rootIds).toBe(before.tree.rootIds);
      for (let i = count; i < CHILDREN; i += 1) {
        expect(after.tree.nodeById[`c${i}`]).toBe(
          before.tree.nodeById[`c${i}`],
        );
        expect(after.chats.byId[`c${i}`]).toBe(before.chats.byId[`c${i}`]);
      }
      expect(after.tree.nodeById.p1).toBe(before.tree.nodeById.p1);
      expect(after).toEqual(oracle());
    },
  );

  it("moving one child to the front rebuilds its branch only", () => {
    const { table, sink, projector, oracle } = setup();
    const before = sink.read();
    collected.rows = 0;

    // c0 is the least recently updated child of p1.
    table.applyDelta(upsert("c0", { updatedAt: 1000, revision: 2 }));
    const after = projector.projectChanges();

    expect(collected.rows).toBe(1);
    expect(after.tree.childrenByParent.p1[0]).toBe("c0");
    expect(
      changedTableIds(
        before.tree.childrenByParent,
        after.tree.childrenByParent,
      ),
    ).toEqual(new Set(["p1"]));
    expect(after.tree.childrenByParent.p2).toBe(
      before.tree.childrenByParent.p2,
    );
    expect(after.tree.rootIds).toBe(before.tree.rootIds);
    expect(after).toEqual(oracle());
  });

  it.each([
    ["a parent move", () => upsert("c0", { parentChatId: "p2", revision: 2 })],
    ["a new chat", () => upsert("c-new", { parentChatId: "p1", updatedAt: 7 })],
  ])("%s takes the full composition and equals it", (_name, delta) => {
    const { table, projector, oracle } = setup();
    collected.rows = 0;

    table.applyDelta(delta());
    const after = projector.projectChanges();

    // The incremental helper was never consulted for the tree.
    expect(collected.rows).toBe(0);
    expect(after).toEqual(oracle());
  });

  it("a removal takes the full composition and equals it", () => {
    const { table, projector, oracle } = setup();
    collected.rows = 0;

    table.applyDelta({
      kind: "remove",
      epicId: EPIC_ID,
      chatId: "c0",
      reason: "deleted",
    });
    const after = projector.projectChanges();

    expect(collected.rows).toBe(0);
    expect(after.tree.nodeById.c0).toBeUndefined();
    expect(after).toEqual(oracle());
  });
});

const LANE_EPOCH = "epoch-lane";

/** A live artifact lane row, built through the real wire schema. */
function artifactLaneRow(
  id: string,
  title: string,
  revision: number,
): RecordRow<EpicStateRow> {
  const frame = epicStateSubscribeServerFrameSchemaV11.parse({
    kind: "snapshot",
    hasBinaryPayload: false,
    authorityEpoch: LANE_EPOCH,
    basis: "cold",
    position: 0,
    reconciledWithCloud: true,
    artifactRecords: [
      {
        kind: "spec",
        id,
        folderName: `${id}-folder`,
        title,
        createdAt: 1,
        updatedAt: 2,
        createdManually: true,
        parentId: null,
        revision,
      },
    ],
    deletedArtifacts: [],
    commentThreads: [],
    roleClaims: { revision: 1, claims: [] },
    epicMeta: { revision: 1, meta: { title: "Epic", updatedAt: 10 } },
  });
  if (frame.kind !== "snapshot") throw new Error("expected a snapshot frame");
  const record = frame.artifactRecords[0];
  return {
    rowId: artifactRowId(id),
    revision,
    row: { kind: "artifact", record },
  };
}

function laneMetaRow(
  title: string,
  updatedAt: number,
  revision: number,
): RecordRow<EpicStateRow> {
  return {
    rowId: EPIC_META_ROW_ID,
    revision,
    row: { kind: "epic-meta", meta: { title, updatedAt } },
  };
}

/** The projector fed by a REAL lane replica, seeded and fully projected once. */
function setupLane() {
  const replica = createEpicLaneStateReplica({
    getCurrentUserId: () => OWNER,
    isDisposed: () => false,
    onChanged: () => undefined,
  });
  const lane = harness(
    () => laneRawProjectionSources(replica.slices()),
    EMPTY_PENDING_OVERLAY,
  );
  replica.apply({
    kind: "record-snapshot",
    watermark: {
      authorityEpoch: LANE_EPOCH,
      lane: EPIC_STATE_LANE_ID,
      position: 1,
    },
    rows: [
      artifactLaneRow("lane-a", "Lane A", 1),
      artifactLaneRow("lane-b", "Lane B", 1),
      artifactLaneRow("lane-c", "Lane C", 1),
      {
        rowId: ROLE_CLAIMS_ROW_ID,
        revision: 1,
        row: { kind: "role-claims", claims: [] },
      },
      laneMetaRow("Lane epic", 10, 1),
    ],
    trust: "reconciled-with-cloud",
    cause: "initial",
  });
  lane.projector.projectFull();
  collected.composed = 0;
  collected.rows = 0;
  const before = lane.sink.read();
  const send = (position: number, row: RecordRow<EpicStateRow>) =>
    replica.apply({
      kind: "record-transaction",
      cursor: {
        authorityEpoch: LANE_EPOCH,
        lane: EPIC_STATE_LANE_ID,
        position,
      },
      changes: [{ kind: "upsert", row }],
      barrier: null,
    });
  return { ...lane, before, send };
}

describe("projector.projectChanges - lane rows and pending creations", () => {
  it("a header change composes nothing and keeps the tree and artifacts by reference", () => {
    const { projector, oracle, before, send } = setupLane();
    expect(before.tree.nodeById["lane-a"]).toBeDefined();

    send(2, laneMetaRow("Renamed lane epic", 30, 2));
    const after = projector.projectChanges();

    expect(collected.composed).toBe(0);
    expect(after.epic).toEqual({ title: "Renamed lane epic", updatedAt: 30 });
    expect(after.tree).toBe(before.tree);
    expect(after.artifacts).toBe(before.artifacts);
    expect(after).toEqual(oracle());
  });

  it("an artifact rename composes nothing and touches that one tree row", () => {
    const { projector, oracle, before, send } = setupLane();

    send(2, artifactLaneRow("lane-b", "Lane B renamed", 2));
    const after = projector.projectChanges();

    expect(collected.composed).toBe(0);
    expect(after.artifacts.byId["lane-b"].title).toBe("Lane B renamed");
    expect(changedTableIds(before.tree.nodeById, after.tree.nodeById)).toEqual(
      new Set(["lane-b"]),
    );
    expect(after.tree.nodeById["lane-a"]).toBe(before.tree.nodeById["lane-a"]);
    expect(after).toEqual(oracle());
  });

  it("a role-claim change takes the full composition once and equals it", () => {
    const { projector, oracle, send } = setupLane();

    send(2, {
      rowId: ROLE_CLAIMS_ROW_ID,
      revision: 2,
      row: {
        kind: "role-claims",
        claims: [
          {
            claimId: "6f1c7a52-62f1-4d0e-9a53-0b2e5f1c9d11",
            agentId: "c1",
            userId: OWNER,
            role: "Planner",
            scope: "Auth",
            claimedAt: 5,
          },
        ],
      },
    });
    const after = projector.projectChanges();

    expect(collected.composed).toBe(1);
    expect(after).toEqual(oracle());
  });

  it("a shadowed pending creation does not send a title edit to the full composition", () => {
    const { table, projector, oracle } = setup();
    // `c3` is already held, so its stand-in sits behind the real row.
    table.beginPendingCreation({
      chatId: "c3",
      hostId: "host-1",
      parentChatId: "p1",
      title: "",
      ownerUserId: OWNER,
    });
    projector.projectChanges();
    collected.rows = 0;
    collected.composed = 0;

    table.applyDelta(upsert("c0", { title: "Renamed 0", revision: 2 }));
    const after = projector.projectChanges();

    expect(collected.composed).toBe(0);
    expect(collected.rows).toBe(1);
    expect(after).toEqual(oracle());
  });

  it("a pending metadata overlay forces the full composition, and shows the overlay", () => {
    const overlay: PendingMetadataOverlay = new Map<
      string,
      PendingMetadataMutation
    >([
      [
        "req-1",
        {
          kind: "rename",
          requestId: "req-1",
          nodeId: "c5",
          title: "Optimistic",
          baseline: "Title c5",
          landed: false,
        },
      ],
    ]);
    const { table, projector, oracle } = setupWithOverlay(overlay);

    table.applyDelta(upsert("c0", { title: "Renamed 0", revision: 2 }));
    const after = projector.projectChanges();

    expect(collected.composed).toBe(1);
    expect(after.chats.byId.c5.title).toBe("Optimistic");
    expect(after.chats.byId.c0.title).toBe("Renamed 0");
    expect(after).toEqual(oracle());
  });
});
