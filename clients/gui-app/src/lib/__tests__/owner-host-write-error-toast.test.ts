import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  // Callable as well: the unknown-outcome sentence is a plain `toast(...)`.
  toast: Object.assign(vi.fn(), {
    message: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }),
}));
vi.mock("@/lib/reportable-error-toast", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/reportable-error-toast")>();
  return {
    ...actual,
    reportableErrorToast: vi.fn(actual.reportableErrorToast),
  };
});
vi.mock("@/lib/host-error-toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/host-error-toast")>()),
  toastFromHostError: vi.fn(),
}));

import { toast } from "sonner";
import { toastFromHostError } from "@/lib/host-error-toast";
import { reportableErrorToast } from "@/lib/reportable-error-toast";
import {
  toastFromOwnerHostBatchWriteFailures,
  toastFromOwnerHostWriteError,
  type OwnerHostBatchWriteCopy,
} from "@/lib/owner-host-write-error-toast";
import {
  HostRequestAbortedError,
  HostRpcError,
  HostTransportFailureError,
  RetryableTransportError,
} from "@traycer-clients/shared/host-transport/host-messenger";

const UNREACHABLE_NOTICE =
  "Traycer can't reach that host right now, so nothing on it was changed. Try again once it is reachable.";

function notReady(): RetryableTransportError {
  return new RetryableTransportError({
    replaySafetyFromKey: false,
    code: "RPC_ERROR",
    message: "Remote session is not ready",
    requestId: "req-1",
    method: "epic.setChatArchived",
    fatalDetails: null,
  });
}

describe("toastFromOwnerHostWriteError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says Traycer cannot reach the host and nothing on it changed when the request never reached it", () => {
    toastFromOwnerHostWriteError(notReady(), "Couldn't archive agent.");

    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.message).mock.calls[0][0]).toBe(UNREACHABLE_NOTICE);
    expect(toastFromHostError).not.toHaveBeenCalled();
  });

  it("collapses repeated attempts into one notice", () => {
    toastFromOwnerHostWriteError(notReady(), "a");
    toastFromOwnerHostWriteError(notReady(), "b");

    const ids = vi.mocked(toast.message).mock.calls.map((call) => call[1]?.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeDefined();
    expect(ids[0]).toBe(ids[1]);
  });

  it("does not claim the host is unreachable when it answered with an attested no-dispatch timeout", () => {
    // The host was reached and said it never dispatched the request.
    const attested = new RetryableTransportError({
      replaySafetyFromKey: false,
      code: "RPC_ERROR",
      message: "Host timed out awaiting the request frame",
      requestId: "req-2",
      method: "epic.deleteChat",
      fatalDetails: {
        code: "RPC_REQUEST_TIMEOUT",
        reason: "Host timed out awaiting the request frame",
        incompatibleMethods: null,
        upgradeGuidance: null,
        retryable: true,
      },
    });

    toastFromOwnerHostWriteError(attested, "Couldn't delete agent.");

    expect(toast.message).not.toHaveBeenCalled();
    expect(toastFromHostError).toHaveBeenCalledWith(
      attested,
      "Couldn't delete agent.",
    );
  });

  it("does not claim nothing changed for a keyed request that was already sent", () => {
    // Retryable because a keyed request can be replayed, not because it never
    // left: the host may have run it before the answer was lost.
    const keyedPostSend = new RetryableTransportError({
      replaySafetyFromKey: true,
      code: "RPC_ERROR",
      message: "Request timed out",
      requestId: "req-6",
      method: "epic.batchDelete",
      fatalDetails: null,
    });

    toastFromOwnerHostWriteError(keyedPostSend, "Couldn't delete epics.");

    expect(toast.message).not.toHaveBeenCalled();
    expect(toastFromHostError).toHaveBeenCalledWith(
      keyedPostSend,
      "Couldn't delete epics.",
    );
  });

  it("leaves a post-send drop to the ambiguous-outcome notice, since the host may have acted", () => {
    const dropped = new HostTransportFailureError({
      code: "RPC_ERROR",
      message: "socket closed",
      requestId: "req-3",
      method: "epic.deleteChat",
      fatalDetails: null,
    });

    toastFromOwnerHostWriteError(dropped, "Couldn't delete agent.");

    expect(toast.message).not.toHaveBeenCalled();
    expect(toastFromHostError).toHaveBeenCalledWith(
      dropped,
      "Couldn't delete agent.",
    );
  });

  it("passes a refusal and an abort through to the ordinary toast", () => {
    const refusal = new HostRpcError({
      code: "FORBIDDEN",
      message: "no",
      requestId: "req-4",
      method: "epic.batchDelete",
      fatalDetails: null,
    });
    const aborted = new HostRequestAbortedError({
      message: "aborted",
      requestId: "req-5",
      method: "epic.batchDelete",
      mayHaveDispatched: false,
    });

    toastFromOwnerHostWriteError(refusal, "Couldn't delete epics.");
    toastFromOwnerHostWriteError(aborted, "Couldn't delete epics.");

    expect(toast.message).not.toHaveBeenCalled();
    expect(toastFromHostError).toHaveBeenCalledTimes(2);
  });
});

const DELETE_COPY: OwnerHostBatchWriteCopy = {
  single: "Couldn't delete agent.",
  partial: (applied, failed) =>
    `Deleted ${applied} of ${applied + failed} selected agents. ${failed} couldn't be deleted.`,
  none: (attempted) =>
    `Couldn't delete any of the ${attempted} selected agents.`,
  unconfirmed: (attempted) =>
    `Couldn't confirm all ${attempted} selected agents were deleted. Check them and delete any that weren't.`,
};

function sentAndDropped(): HostTransportFailureError {
  return new HostTransportFailureError({
    code: "RPC_ERROR",
    message: "connection dropped after send",
    requestId: "req-6",
    method: "epic.deleteChat",
    fatalDetails: null,
  });
}

function keyedSentAndDropped(): RetryableTransportError {
  return new RetryableTransportError({
    replaySafetyFromKey: true,
    code: "RPC_ERROR",
    message: "connection dropped after send",
    requestId: "req-7",
    method: "epic.deleteChat",
    fatalDetails: null,
  });
}

const ARCHIVE_COPY: OwnerHostBatchWriteCopy = {
  single: "Couldn't archive agent.",
  partial: (applied, failed) =>
    `Archived ${applied} of ${applied + failed} selected agents. ${failed} couldn't be archived.`,
  none: (attempted) =>
    `Couldn't archive any of the ${attempted} selected agents.`,
  unconfirmed: (attempted) =>
    `Couldn't confirm all ${attempted} selected agents were archived. Check them and archive any that weren't.`,
};

function agentBusy(): HostRpcError {
  return new HostRpcError({
    code: "RPC_ERROR",
    message: "AGENT_BUSY: the agent has a turn in progress",
    requestId: "req-8",
    method: "epic.setChatArchived",
    fatalDetails: null,
  });
}

function forbidden(): HostRpcError {
  return new HostRpcError({
    code: "FORBIDDEN",
    message: "not allowed",
    requestId: "req-3",
    method: "epic.deleteChat",
    fatalDetails: null,
  });
}

function aborted(): HostRequestAbortedError {
  return new HostRequestAbortedError({
    message: "authority disposed",
    requestId: "req-4",
    method: "epic.deleteChat",
    mayHaveDispatched: false,
  });
}

describe("toastFromOwnerHostBatchWriteFailures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says how many applied when one write applied, one never reached its host and one was refused", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: null },
        { kind: "agent", hostId: "host-b", selectedRows: 1, error: notReady() },
        {
          kind: "agent",
          hostId: "host-c",
          selectedRows: 1,
          error: forbidden(),
        },
      ],
      DELETE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Deleted 1 of 3 selected agents. 2 couldn't be deleted. You don't have permission to do that.",
    );
    expect(toastFromHostError).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("is not silenced by a cancelled first write when the rest failed", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: aborted() },
        { kind: "agent", hostId: "host-b", selectedRows: 1, error: notReady() },
        {
          kind: "agent",
          hostId: "host-c",
          selectedRows: 1,
          error: forbidden(),
        },
      ],
      DELETE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Couldn't delete any of the 2 selected agents. You don't have permission to do that.",
    );
  });

  it("names the unreachable hosts when every counted write never reached its host", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: aborted() },
        { kind: "agent", hostId: "host-b", selectedRows: 1, error: notReady() },
        { kind: "agent", hostId: "host-c", selectedRows: 1, error: notReady() },
      ],
      DELETE_COPY,
    );

    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.message).mock.calls[0][0]).toBe(
      "Traycer can't reach the hosts these agents run on, so nothing on them was changed. Try again once they are reachable.",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not count a write whose answer was lost as failed when another applied", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: null },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: sentAndDropped(),
        },
      ],
      DELETE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Couldn't confirm all 2 selected agents were deleted. Check them and delete any that weren't.",
    );
  });

  it("does not say none applied when every answer was lost", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "agent",
          hostId: "host-a",
          selectedRows: 1,
          error: keyedSentAndDropped(),
        },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: sentAndDropped(),
        },
        { kind: "agent", hostId: "host-c", selectedRows: 1, error: notReady() },
      ],
      DELETE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Couldn't confirm all 3 selected agents were deleted. Check them and delete any that weren't.",
    );
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("does not say nothing changed on a host when an artifact applied there", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "artifact", hostId: "host-a", selectedRows: 1, error: null },
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: notReady() },
      ],
      DELETE_COPY,
    );

    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Deleted 1 of 2 selected agents. 1 couldn't be deleted.",
    );
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("does not say nothing changed when an artifact and an agent both failed", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "artifact",
          hostId: "host-a",
          selectedRows: 1,
          error: forbidden(),
        },
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: notReady() },
      ],
      DELETE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Couldn't delete any of the 2 selected agents. You don't have permission to do that.",
    );
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("keeps the wait-or-stop guidance when every archive in the batch was refused as busy", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "agent",
          hostId: "host-a",
          selectedRows: 1,
          error: agentBusy(),
        },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: agentBusy(),
        },
      ],
      ARCHIVE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Couldn't archive any of the 2 selected agents. 2 are still working: wait for them to go idle, or stop them, then archive. Stopping ends a turn, not a running subagent or a scheduled wake.",
    );
  });

  it("keeps the wait-or-stop guidance when one archive applied and one was refused as busy", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: null },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: agentBusy(),
        },
      ],
      ARCHIVE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Archived 1 of 2 selected agents. 1 couldn't be archived. 1 is still working: wait for it to go idle, or stop it, then archive. Stopping ends a turn, not a running subagent or a scheduled wake.",
    );
  });

  it("reads one counted write among cancelled ones as that single write", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: aborted() },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: forbidden(),
        },
      ],
      DELETE_COPY,
    );

    expect(toastFromHostError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toastFromHostError).mock.calls[0][1]).toBe(
      "Couldn't delete agent.",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says nothing when every failure is a cancelled write", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: null },
        { kind: "agent", hostId: "host-b", selectedRows: 1, error: aborted() },
      ],
      DELETE_COPY,
    );

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
    expect(toastFromHostError).not.toHaveBeenCalled();
  });
});

function agentBusyInBackground(): HostRpcError {
  return new HostRpcError({
    code: "RPC_ERROR",
    message: "AGENT_BUSY: the agent has work still running in the background",
    requestId: "req-9",
    method: "epic.setChatArchived",
    fatalDetails: null,
  });
}

function abortedAfterSend(): HostRequestAbortedError {
  return new HostRequestAbortedError({
    message: "authority disposed while the WebSocket was open",
    requestId: "req-10",
    method: "epic.setChatArchived",
    mayHaveDispatched: true,
  });
}

const STILL_WORKING_ONE =
  "1 is still working: wait for it to go idle, or stop it, then archive. Stopping ends a turn, not a running subagent or a scheduled wake.";
const BACKGROUND_ONE =
  "1 has background items still running, which archiving won't stop: wait for them to finish, or stop them from its chat.";

const ARTIFACT_DELETE_COPY: OwnerHostBatchWriteCopy = {
  single: "Couldn't delete artifact.",
  partial: (applied, failed) =>
    `Deleted ${applied} of ${applied + failed} selected artifacts. ${failed} couldn't be deleted.`,
  none: (attempted) =>
    `Couldn't delete any of the ${attempted} selected artifacts.`,
  unconfirmed: (attempted) =>
    `Couldn't confirm all ${attempted} selected artifacts were deleted. Check them and delete any that weren't.`,
};

/** Every notice text the batch raised, in order, of any severity. */
function noticesRaised(): string[] {
  return [
    ...vi.mocked(toast.error).mock.calls.map((call) => noticeText(call[0])),
    ...vi.mocked(toast.message).mock.calls.map((call) => noticeText(call[0])),
    ...vi.mocked(toast).mock.calls.map((call) => noticeText(call[0])),
  ];
}

function noticeText(title: unknown): string {
  return typeof title === "string" ? title : JSON.stringify(title);
}

describe("batch notice spec (traycerai/traycer#2546, round 10): one test per row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("row 1: says nothing when nothing failed", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: null },
        { kind: "agent", hostId: "host-b", selectedRows: 1, error: null },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([]);
    expect(toastFromHostError).not.toHaveBeenCalled();
  });

  it("row 2: one counted write that failed reads as that single write's notice", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: aborted() },
        { kind: "agent", hostId: "host-b", selectedRows: 1, error: notReady() },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([UNREACHABLE_NOTICE]);
  });

  it("row 3: one counted write aborted after its send says its answer never came back", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "agent",
          hostId: "host-a",
          selectedRows: 1,
          error: abortedAfterSend(),
        },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([
      "No reply came back from the Traycer host, so this may or may not have gone through.",
    ]);
  });

  it("row 4 (finding 4): an abort after send keeps the batch unconfirmed instead of 'nothing changed'", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "agent",
          hostId: "host-a",
          selectedRows: 1,
          error: abortedAfterSend(),
        },
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: notReady() },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([
      "Couldn't confirm all 2 selected agents were archived. Check them and archive any that weren't.",
    ]);
  });

  it("row 5 (finding 3): a lost answer plus a busy refusal keeps the check-them sentence, the advice and the report context", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "agent",
          hostId: "host-a",
          selectedRows: 1,
          error: sentAndDropped(),
        },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: agentBusy(),
        },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([
      `Couldn't confirm all 2 selected agents were archived. Check them and archive any that weren't. ${STILL_WORKING_ONE}`,
    ]);
    // The ordinary Report Issue context rides the notice, from the refusal.
    expect(reportableErrorToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportableErrorToast).mock.calls[0][2]).toMatchObject({
      title: "Host operation failed",
      code: "RPC_ERROR",
    });
  });

  it("row 6: every agent write never reached its one host says nothing on it changed", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: notReady() },
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: notReady() },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([
      "Traycer can't reach the host these agents run on, so nothing on it was changed. Try again once it is reachable.",
    ]);
  });

  it("row 7 (finding 1): differing busy refusals keep both pieces of advice", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "agent",
          hostId: "host-a",
          selectedRows: 1,
          error: agentBusy(),
        },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: agentBusyInBackground(),
        },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([
      `Couldn't archive any of the 2 selected agents. ${STILL_WORKING_ONE} ${BACKGROUND_ONE}`,
    ]);
  });

  it("row 7 (finding 1): a permission refusal before a busy one does not hide the wait-or-stop advice", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        {
          kind: "agent",
          hostId: "host-a",
          selectedRows: 1,
          error: forbidden(),
        },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: agentBusy(),
        },
      ],
      ARCHIVE_COPY,
    );

    expect(noticesRaised()).toEqual([
      `Couldn't archive any of the 2 selected agents. You don't have permission to do that. ${STILL_WORKING_ONE}`,
    ]);
  });

  it("row 8 (finding 2): several agents with the same cause are counted, never 'This agent'", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", selectedRows: 1, error: null },
        {
          kind: "agent",
          hostId: "host-b",
          selectedRows: 1,
          error: agentBusy(),
        },
        {
          kind: "agent",
          hostId: "host-c",
          selectedRows: 1,
          error: agentBusy(),
        },
        {
          kind: "agent",
          hostId: "host-c",
          selectedRows: 1,
          error: agentBusyInBackground(),
        },
        {
          kind: "agent",
          hostId: "host-c",
          selectedRows: 1,
          error: agentBusyInBackground(),
        },
      ],
      ARCHIVE_COPY,
    );

    const [message] = noticesRaised();
    expect(message).toBe(
      "Archived 1 of 5 selected agents. 4 couldn't be archived. 2 are still working: wait for them to go idle, or stop them, then archive. Stopping ends a turn, not a running subagent or a scheduled wake. 2 have background items still running, which archiving won't stop: wait for them to finish, or stop them from their chats.",
    );
    expect(message).not.toContain("This agent");
  });

  it("row 9 (finding 5): counts selected rows, so a cascaded child is counted with its root", () => {
    // Selected: artifact A, its child B, and a separate artifact C. One
    // delete for A covers A and B; C's delete is refused.
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "artifact", hostId: "host-a", selectedRows: 2, error: null },
        {
          kind: "artifact",
          hostId: "host-a",
          selectedRows: 1,
          error: forbidden(),
        },
      ],
      ARTIFACT_DELETE_COPY,
    );

    expect(noticesRaised()).toEqual([
      "Deleted 2 of 3 selected artifacts. 1 couldn't be deleted. You don't have permission to do that.",
    ]);
  });

  it("finding 6: two batch actions keep two notices, one id each", () => {
    const batch = [
      {
        kind: "agent" as const,
        hostId: "host-a",
        selectedRows: 1,
        error: null,
      },
      {
        kind: "agent" as const,
        hostId: "host-b",
        selectedRows: 1,
        error: forbidden(),
      },
    ];
    toastFromOwnerHostBatchWriteFailures(batch, DELETE_COPY);
    toastFromOwnerHostBatchWriteFailures(batch, DELETE_COPY);

    const ids = vi.mocked(toast.error).mock.calls.map((call) => call[1]?.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeDefined();
    expect(ids[0]).not.toBe(ids[1]);
  });
});
