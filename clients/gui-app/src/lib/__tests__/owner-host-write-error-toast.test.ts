import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/host-error-toast", () => ({
  toastFromHostError: vi.fn(),
}));

import { toast } from "sonner";
import { toastFromHostError } from "@/lib/host-error-toast";
import { toastFromOwnerHostWriteError } from "@/lib/owner-host-write-error-toast";
import {
  HostRequestAbortedError,
  HostRpcError,
  HostTransportFailureError,
  RetryableTransportError,
} from "@traycer-clients/shared/host-transport/host-messenger";

const OFFLINE_NOTICE =
  "That host is offline, so nothing on it was changed. Try again once it is back.";

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

  it("says the host is offline and nothing on it changed when the request never reached it", () => {
    toastFromOwnerHostWriteError(notReady(), "Couldn't archive agent.");

    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.message).mock.calls[0][0]).toBe(OFFLINE_NOTICE);
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

  it("does not claim the host is offline when it answered with an attested no-dispatch timeout", () => {
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
