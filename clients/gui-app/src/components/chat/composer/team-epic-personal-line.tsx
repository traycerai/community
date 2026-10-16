import type { ReactNode } from "react";

/**
 * B1: above a chat's composer in a team's task, when the chat runs on a host
 * no team owns: "Running on your Personal settings." with "Continue on a
 * <team> host", which opens the fork dialog on that team's hosts only. The
 * first use per person per team asks first.
 */
export function TeamEpicPersonalLine(_props: {
  readonly epicId: string;
  readonly tabHostId: string;
  readonly onContinue: (teamHostIds: ReadonlySet<string>) => void;
}): ReactNode {
  return null;
}
