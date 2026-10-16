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
};

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
        { hostId: "host-a", error: null },
        { hostId: "host-b", error: notReady() },
        { hostId: "host-c", error: forbidden() },
      ],
      DELETE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Deleted 1 of 3 selected agents. 2 couldn't be deleted.",
    );
    expect(toastFromHostError).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("is not silenced by a cancelled first write when the rest failed", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { hostId: "host-a", error: aborted() },
        { hostId: "host-b", error: notReady() },
        { hostId: "host-c", error: forbidden() },
      ],
      DELETE_COPY,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      "Couldn't delete any of the 2 selected agents.",
    );
  });

  it("names the unreachable hosts when every counted write never reached its host", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { hostId: "host-a", error: aborted() },
        { hostId: "host-b", error: notReady() },
        { hostId: "host-c", error: notReady() },
      ],
      DELETE_COPY,
    );

    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.message).mock.calls[0][0]).toBe(
      "Traycer can't reach the hosts these agents run on, so nothing on them was changed. Try again once they are reachable.",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says nothing when every failure is a cancelled write", () => {
    toastFromOwnerHostBatchWriteFailures(
      [
        { hostId: "host-a", error: null },
        { hostId: "host-b", error: aborted() },
      ],
      DELETE_COPY,
    );

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
    expect(toastFromHostError).not.toHaveBeenCalled();
  });
});
