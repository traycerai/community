import type { WorktreeDeleteDeclinedKind } from "@traycer/protocol/host/worktree-delete-batch-stream";

const GENERIC_DECLINE_MESSAGE =
  "Couldn't remove the worktree. It may still be in use - refresh and try again.";

/**
 * What the delete modal says when the host answered `deleted: false`.
 *
 * `null` is a host that did not say why (older than `worktree.deleteBatchByPath@1.3`,
 * or the per-path fallback), and keeps the one generic line.
 */
export function worktreeDeleteDeclineMessage(
  declined: WorktreeDeleteDeclinedKind | null,
): string {
  switch (declined) {
    case null:
      return GENERIC_DECLINE_MESSAGE;
    case "not_managed":
      return "This folder isn't a worktree Traycer manages, so it was left in place - delete it yourself if you no longer need it.";
    case "teardown_failed":
      return "The teardown script didn't finish successfully, so the worktree was left in place - check the script and try again.";
    case "removal_failed":
      return "The worktree couldn't be fully removed and part of it is still on disk - close anything using it, then refresh and try again.";
  }
}
