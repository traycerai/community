import { lazySchema } from "@traycer/protocol/framework/lazy-schema";
import {
  agentReachSchema,
  type AgentReach,
} from "@traycer/protocol/host/agent/shared";
import {
  lastKnownConnectivitySchema,
  type LastKnownConnectivity,
} from "@traycer/protocol/host/last-known-connectivity";
import { z } from "zod";

/**
 * Whose host a task host is (ticket E17): the same `{ kind, id }` authn's
 * owner principal and traycer-server's task-host list carry, plus a team's
 * display name. The name is read from the person's own teams and is `null`
 * when they are not in it; the GUI then says "a team". A user carries no name
 * on the wire: the GUI reads a collaborator's name from the task's
 * collaborator list and tells the caller's own hosts by its own id.
 */
export type TaskHostPrincipal =
  | { readonly kind: "user"; readonly id: string }
  | {
      readonly kind: "team";
      readonly id: string;
      readonly name: string | null;
    };

export const taskHostPrincipalSchema: z.ZodType<TaskHostPrincipal> = lazySchema(
  () =>
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("user"), id: z.string().min(1) }),
      z.object({
        kind: z.literal("team"),
        id: z.string().min(1),
        name: z.string().min(1).nullable(),
      }),
    ]),
);

/** An agent a task host publishes to the task: its id and title only. */
export interface TaskHostAgent {
  readonly agentId: string;
  readonly title: string | null;
}

/**
 * One host a task shows in its host list (ticket E17; E19 serves the rows).
 * A foreign row is this summary and nothing else - never the owner's sandbox
 * record.
 *
 * - `label` is the host's approved display label, `null` when none is shown.
 * - `agents` is the host's own published set for the task, as the caller is
 *   authorized to see it.
 * - `state` is `unknown` unless a source the caller is authorized to read
 *   said otherwise, and never `offline` for want of one.
 */
export interface TaskHostSummary {
  readonly hostId: string;
  readonly label: string | null;
  readonly principal: TaskHostPrincipal;
  readonly reach: AgentReach;
  readonly agents: readonly TaskHostAgent[];
  readonly state: LastKnownConnectivity;
}

/** Tolerant: a field a newer server adds is stripped, never refused. */
export const taskHostSummarySchema: z.ZodType<TaskHostSummary> = lazySchema(
  () =>
    z.object({
      hostId: z.string().min(1),
      label: z.string().nullable(),
      principal: taskHostPrincipalSchema,
      reach: agentReachSchema,
      agents: z.array(
        z.object({ agentId: z.string().min(1), title: z.string().nullable() }),
      ),
      state: lastKnownConnectivitySchema,
    }),
);
