import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/host-error-toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/host-error-toast")>()),
  toastFromHostError: vi.fn(),
}));

import { toast } from "sonner";
import { toastFromHostError } from "@/lib/host-error-toast";
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

const AGENT_BUSY_GUIDANCE =
  "This agent is still working. Stopping it ends a turn, but not a running subagent or a scheduled wake. Wait for it to go idle, or stop it, then archive.";

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
  });
}

describe("toastFromOwnerHostBatchWriteFailures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says how many applied when one write applied, one never reached its host and one was refused", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", error: null },
        { kind: "agent", hostId: "host-b", error: notReady() },
        { kind: "agent", hostId: "host-c", error: forbidden() },
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
        { kind: "agent", hostId: "host-a", error: aborted() },
        { kind: "agent", hostId: "host-b", error: notReady() },
        { kind: "agent", hostId: "host-c", error: forbidden() },
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
        { kind: "agent", hostId: "host-a", error: aborted() },
        { kind: "agent", hostId: "host-b", error: notReady() },
        { kind: "agent", hostId: "host-c", error: notReady() },
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
        { kind: "agent", hostId: "host-a", error: null },
        { kind: "agent", hostId: "host-b", error: sentAndDropped() },
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
        { kind: "agent", hostId: "host-a", error: keyedSentAndDropped() },
        { kind: "agent", hostId: "host-b", error: sentAndDropped() },
        { kind: "agent", hostId: "host-c", error: notReady() },
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
        { kind: "artifact", hostId: "host-a", error: null },
        { kind: "agent", hostId: "host-a", error: notReady() },
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
        { kind: "artifact", hostId: "host-a", error: forbidden() },
        { kind: "agent", hostId: "host-a", error: notReady() },
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
        { kind: "agent", hostId: "host-a", error: agentBusy() },
        { kind: "agent", hostId: "host-b", error: agentBusy() },
      ],
      ARCHIVE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      `Couldn't archive any of the 2 selected agents. ${AGENT_BUSY_GUIDANCE}`,
    );
  });

  it("keeps the wait-or-stop guidance when one archive applied and one was refused as busy", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", error: null },
        { kind: "agent", hostId: "host-b", error: agentBusy() },
      ],
      ARCHIVE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      `Archived 1 of 2 selected agents. 1 couldn't be archived. ${AGENT_BUSY_GUIDANCE}`,
    );
  });

  it("reads one counted write among cancelled ones as that single write", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { kind: "agent", hostId: "host-a", error: aborted() },
        { kind: "agent", hostId: "host-b", error: forbidden() },
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
        { kind: "agent", hostId: "host-a", error: null },
        { kind: "agent", hostId: "host-b", error: aborted() },
      ],
      DELETE_COPY,
    );

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
    expect(toastFromHostError).not.toHaveBeenCalled();
  });
});
