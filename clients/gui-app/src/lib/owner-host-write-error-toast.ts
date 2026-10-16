import {
  RetryableTransportError,
  type HostRpcError,
} from "@traycer-clients/shared/host-transport/host-messenger";
import { toast } from "sonner";
import { toastFromHostError } from "@/lib/host-error-toast";

/**
 * One id for every attempt, so a person who retries a few times against a host
 * that cannot be reached reads a single line rather than a stack of them.
 */
const OWNER_HOST_OFFLINE_TOAST_ID = "owner-host-offline-notice";

const OWNER_HOST_UNREACHABLE_NOTICE =
  "Traycer can't reach that host right now, so nothing on it was changed. Try again once it is reachable.";

const OWNER_HOST_UNREACHABLE_BATCH_ONE_HOST_NOTICE =
  "Traycer can't reach the host these agents run on, so nothing on it was changed. Try again once it is reachable.";

const OWNER_HOST_UNREACHABLE_BATCH_HOSTS_NOTICE =
  "Traycer can't reach the hosts these agents run on, so nothing on them was changed. Try again once they are reachable.";

/**
 * Whether this failure proves the request never reached the host.
 *
 * A `RetryableTransportError` with no `fatalDetails` and
 * `replaySafetyFromKey: false` is the pre-send class - the session was not
 * ready, the host was detached from the relay, the dial failed - which is the
 * guarantee that makes "nothing on it was changed" true. It says nothing about
 * WHY the host could not be reached (it may be off, or this machine's network
 * or the relay may be what is down), so the notice names only the symptom. It
 * is deliberately not the broader transport class: a post-send drop may have
 * been executed (the ordinary notice says so), a retryable error carrying
 * `fatalDetails` is the host's own attestation that it WAS reached, and one
 * with `replaySafetyFromKey: true` is the timeout or drop of a keyed request
 * that was already sent, which the host may have run.
 */
export function isOwnerHostOfflineFailure(error: HostRpcError): boolean {
  return (
    error instanceof RetryableTransportError &&
    error.fatalDetails === null &&
    !error.replaySafetyFromKey
  );
}

/**
 * The error toast for a write that has to run on the host that owns the record
 * (archive or delete an agent, delete a Task): when the request never reached
 * that host, say so and say nothing on it changed.
 *
 * Every other failure keeps the ordinary toast. This changes the wording only;
 * where the write is sent is unchanged.
 */
export function toastFromOwnerHostWriteError(
  error: HostRpcError,
  fallback: string,
): void {
  if (isOwnerHostOfflineFailure(error)) {
    toast.message(OWNER_HOST_UNREACHABLE_NOTICE, {
      id: OWNER_HOST_OFFLINE_TOAST_ID,
    });
    return;
  }
  toastFromHostError(error, fallback);
}

/** One write of a batch: the host it was sent to, and its failure if any. */
export interface OwnerHostBatchWriteOutcome {
  readonly hostId: string | null;
  readonly error: HostRpcError | null;
}

/**
 * The one error toast for a batch of owner-host archives, whose members raise
 * none of their own.
 *
 * "Nothing on it was changed" holds for the batch only when every write never
 * reached its host; a partly applied batch, or one with any other failure,
 * keeps the ordinary toast for its first failure, as before. A batch of one
 * reads like the single write it is.
 */
export function toastFromOwnerHostBatchWriteFailures(
  outcomes: readonly OwnerHostBatchWriteOutcome[],
  fallback: string,
): void {
  const failures = outcomes.flatMap((outcome) =>
    outcome.error === null ? [] : [outcome.error],
  );
  if (failures.length === 0) return;
  if (toastOwnerHostOnlyOrUnreachableBatch(outcomes, fallback)) return;
  toastFromHostError(failures[0], fallback);
}

/** One delete of a bulk delete, with the toast its own hook would raise. */
export interface OwnerHostBulkDeleteOutcome extends OwnerHostBatchWriteOutcome {
  readonly fallback: string;
}

/**
 * The error toasts for the agents of a bulk delete, whose delete hooks raise
 * none of their own: the batch of one and the all-unreachable batch as for
 * {@link toastFromOwnerHostBatchWriteFailures}, and otherwise each failure's
 * ordinary toast, as each delete raised it before.
 */
export function toastFromOwnerHostBulkDeleteFailures(
  outcomes: readonly OwnerHostBulkDeleteOutcome[],
): void {
  if (outcomes.every((outcome) => outcome.error === null)) return;
  const single = outcomes.length === 1 ? outcomes[0].fallback : "";
  if (toastOwnerHostOnlyOrUnreachableBatch(outcomes, single)) return;
  for (const outcome of outcomes) {
    if (outcome.error !== null) {
      toastFromHostError(outcome.error, outcome.fallback);
    }
  }
}

/**
 * The two batches this notice changes: one write, which reads like the single
 * write it is; and a batch in which every write never reached its host.
 * Answers whether it raised the toast.
 */
function toastOwnerHostOnlyOrUnreachableBatch(
  outcomes: readonly OwnerHostBatchWriteOutcome[],
  singleFallback: string,
): boolean {
  const failures = outcomes.flatMap((outcome) =>
    outcome.error === null ? [] : [outcome.error],
  );
  if (outcomes.length === 1 && failures.length === 1) {
    toastFromOwnerHostWriteError(failures[0], singleFallback);
    return true;
  }
  if (
    failures.length === outcomes.length &&
    failures.every(isOwnerHostOfflineFailure)
  ) {
    toastOwnerHostsUnreachableForBatch(
      outcomes.map((outcome) => outcome.hostId),
    );
    return true;
  }
  return false;
}

/**
 * The notice for a batch write in which every request failed with
 * `isOwnerHostOfflineFailure`. A batch can span agents on several hosts, so
 * the copy is singular only when one host owns them all.
 */
function toastOwnerHostsUnreachableForBatch(
  ownerHostIds: readonly (string | null)[],
): void {
  const notice =
    new Set(ownerHostIds).size === 1
      ? OWNER_HOST_UNREACHABLE_BATCH_ONE_HOST_NOTICE
      : OWNER_HOST_UNREACHABLE_BATCH_HOSTS_NOTICE;
  toast.message(notice, { id: OWNER_HOST_OFFLINE_TOAST_ID });
}
