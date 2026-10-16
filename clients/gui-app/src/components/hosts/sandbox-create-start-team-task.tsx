import type { ReactNode } from "react";

/**
 * A4: the team sandbox create's success state for someone with no task owned
 * by the team yet, offering "Start a <team> task".
 */
export function SandboxCreateStartTeamTask(_props: {
  readonly teamSlug: string;
  readonly onStart: () => void;
  readonly onDone: () => void;
}): ReactNode {
  return null;
}
