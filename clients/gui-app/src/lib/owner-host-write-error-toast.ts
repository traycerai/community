import {
  RetryableTransportError,
  type HostRpcError,
} from "@traycer-clients/shared/host-transport/host-messenger";
import { toast } from "sonner";
import {
  isHostTransportFailure,
  isSilentHostError,
  isUnknownOutcomeTransportFailure,
  toastFromHostError,
  toastFromHostRefusalsInBatch,
} from "@/lib/host-error-toast";

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

/**
 * One write of a batch: what it wrote (an agent on its owning host, or an
 * artifact on the Task's host), the host it was sent to, and its failure if
 * any.
 */
export interface OwnerHostBatchWriteOutcome {
  readonly kind: "agent" | "artifact";
  readonly hostId: string | null;
  readonly error: HostRpcError | null;
}

/** What a batch's notice says, in the words of the write it ran. */
export interface OwnerHostBatchWriteCopy {
  /** The failure of a batch with one write in it, e.g. "Couldn't archive agent." */
  readonly single: string;
  /** Some writes applied and the rest did not. */
  readonly partial: (applied: number, failed: number) => string;
  /** No write applied, for more than one reason. */
  readonly none: (attempted: number) => string;
  /** At least one write may or may not have applied. */
  readonly unconfirmed: (attempted: number) => string;
}

/** One id for every batch's result, so a retried batch replaces its line. */
const OWNER_HOST_BATCH_RESULT_TOAST_ID = "owner-host-batch-result";

/**
 * Whether a failed write may still have applied: it was sent and its answer
 * was lost, unkeyed (`isUnknownOutcomeTransportFailure`) or keyed
 * (`replaySafetyFromKey`).
 */
function writeMayHaveApplied(error: HostRpcError): boolean {
  return (
    isUnknownOutcomeTransportFailure(error) ||
    (error instanceof RetryableTransportError && error.replaySafetyFromKey)
  );
}

/**
 * The one notice for a batch of writes (archive or delete several agents, or
 * delete a selection of agents and artifacts), whose members raise none of
 * their own.
 *
 * A write the person cancelled, or one the app is quietly re-authorizing, is
 * left out of the count the way a single write would say nothing about it, so
 * it can never hide the rest. Of what remains:
 *  - a write that may have applied makes the batch's result unknown, and the
 *    notice says so rather than counting it as applied or as failed;
 *  - "nothing on it was changed" holds only for a batch of agents in which
 *    every write never reached its host;
 *  - any other mix says how many applied and how many did not, followed by
 *    the guidance of a host refusal among them (`toastFromHostRefusalsInBatch`).
 * A batch of one reads like the single write it is.
 */
export function toastFromOwnerHostBatchWriteFailures(
  outcomes: readonly OwnerHostBatchWriteOutcome[],
  copy: OwnerHostBatchWriteCopy,
): void {
  const counted = outcomes.filter(
    (outcome) => outcome.error === null || !isSilentHostError(outcome.error),
  );
  const failures = counted.flatMap((outcome) =>
    outcome.error === null ? [] : [outcome.error],
  );
  if (failures.length === 0) return;
  if (counted.length === 1) {
    toastFromOwnerHostWriteError(failures[0], copy.single);
    return;
  }
  if (failures.some(writeMayHaveApplied)) {
    toast.error(copy.unconfirmed(counted.length), {
      id: OWNER_HOST_BATCH_RESULT_TOAST_ID,
    });
    return;
  }
  const applied = counted.length - failures.length;
  if (
    applied === 0 &&
    counted.every((outcome) => outcome.kind === "agent") &&
    failures.every(isOwnerHostOfflineFailure)
  ) {
    toastOwnerHostsUnreachableForBatch(
      counted.map((outcome) => outcome.hostId),
    );
    return;
  }
  const summary =
    applied === 0
      ? copy.none(counted.length)
      : copy.partial(applied, failures.length);
  const refusals = failures.filter(
    (failure) => !isHostTransportFailure(failure),
  );
  if (refusals.length > 0) {
    toastFromHostRefusalsInBatch(
      refusals,
      copy.single,
      summary,
      OWNER_HOST_BATCH_RESULT_TOAST_ID,
    );
    return;
  }
  toast.error(summary, { id: OWNER_HOST_BATCH_RESULT_TOAST_ID });
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
