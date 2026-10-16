import {
  RetryableTransportError,
  type HostRpcError,
} from "@traycer-clients/shared/host-transport/host-messenger";
import { toast } from "sonner";
import { toastFromHostError } from "@/lib/host-error-toast";

/**
 * One id for every attempt, so a person who retries a few times against a host
 * that is gone reads a single line rather than a stack of them.
 */
const OWNER_HOST_OFFLINE_TOAST_ID = "owner-host-offline-notice";

const OWNER_HOST_OFFLINE_NOTICE =
  "That host is offline, so nothing on it was changed. Try again once it is back.";

/**
 * The error toast for a write that has to run on the host that owns the record
 * (archive or delete an agent, delete a Task): when the request never left for
 * that host, say so and say nothing on it changed.
 *
 * A `RetryableTransportError` with no `fatalDetails` and
 * `replaySafetyFromKey: false` is the pre-send class - the session was not
 * ready, the host was detached from the relay, the dial failed - which is the
 * guarantee that makes "nothing on it was changed" true. It is deliberately
 * not the broader transport class: a post-send drop may have been executed
 * (the ordinary notice says so), a retryable error carrying `fatalDetails` is
 * the host's own attestation that it WAS reached, and one with
 * `replaySafetyFromKey: true` is the timeout or drop of a keyed request that
 * was already sent, which the host may have run.
 *
 * Every other failure keeps the ordinary toast. This changes the wording only;
 * where the write is sent is unchanged.
 */
export function isOwnerHostOfflineFailure(error: HostRpcError): boolean {
  return (
    error instanceof RetryableTransportError &&
    error.fatalDetails === null &&
    !error.replaySafetyFromKey
  );
}

export function toastFromOwnerHostWriteError(
  error: HostRpcError,
  fallback: string,
): void {
  if (isOwnerHostOfflineFailure(error)) {
    toast.message(OWNER_HOST_OFFLINE_NOTICE, {
      id: OWNER_HOST_OFFLINE_TOAST_ID,
    });
    return;
  }
  toastFromHostError(error, fallback);
}
