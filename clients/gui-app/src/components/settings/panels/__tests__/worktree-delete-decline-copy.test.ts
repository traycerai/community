import { describe, expect, it } from "vitest";
import type { WorktreeDeleteDeclinedKind } from "@traycer/protocol/host/worktree-delete-batch-stream";
import { worktreeDeleteDeclineMessage } from "@/components/settings/panels/worktree-delete-decline-copy";

const GENERIC_MESSAGE =
  "Couldn't remove the worktree. It may still be in use - refresh and try again.";

describe("worktreeDeleteDeclineMessage", () => {
  it("keeps the generic line when the host named no decline kind", () => {
    expect(worktreeDeleteDeclineMessage(null)).toBe(GENERIC_MESSAGE);
  });

  it("says something different for each decline kind", () => {
    const kinds: readonly WorktreeDeleteDeclinedKind[] = [
      "not_managed",
      "teardown_failed",
      "removal_failed",
    ];
    const messages = kinds.map((kind) => worktreeDeleteDeclineMessage(kind));
    expect(new Set(messages).size).toBe(kinds.length);
    for (const message of messages) {
      expect(message).not.toBe(GENERIC_MESSAGE);
    }
  });

  it("tells the person nothing to delete, since a main worktree is not_managed too", () => {
    expect(worktreeDeleteDeclineMessage("not_managed")).not.toMatch(
      /delete|try again/i,
    );
  });

  it("does not assume an open handle caused a failed removal", () => {
    expect(worktreeDeleteDeclineMessage("removal_failed")).not.toMatch(
      /close|in use|using/i,
    );
  });
});
