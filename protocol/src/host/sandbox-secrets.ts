/**
 * What the app reads and writes about a sandbox's secrets on the broker
 * (authn), with the signed-in user's bearer: the grants summary a sandbox's
 * card shows, and the decision on an agent's grant request.
 *
 * A client holds no secret and no control over one beyond these two calls:
 * the values, their bindings and every other change live on the dashboard.
 * Neither body carries a value, a placeholder or an id beyond a name.
 *
 * Read tolerantly, as `sandbox-control.ts` is: the broker ships on its own
 * schedule, so a field it adds is ignored, and the open strings below
 * (`kind`, `protocol`, `mode`, `source`, a request's `status`) are compared
 * against the lists here and never rejected for being new.
 */
import { z } from "zod";
import { lazySchema } from "@traycer/protocol/framework/lazy-schema";

// ─── `GET /api/v3/secrets/hosts/:hostId/grants` ─────────────────────────────

/** How a sandbox holds a secret. Anything else is shown as its own word. */
export const SANDBOX_GRANT_MODE_BROKERED = "brokered";
export const SANDBOX_GRANT_MODE_EXPOSED = "exposed";

/**
 * One destination a granted secret is brokered to. `route` is the id that
 * also names it in the sandbox host's egress events and in
 * `SandboxSummary.routes`, which is how the card puts a destination's
 * readiness and its last refusal beside it.
 */
export interface SandboxGrantRoute {
  readonly route: string;
  readonly destination: string;
  readonly port: number | null;
}

export const sandboxGrantRouteSchema: z.ZodType<SandboxGrantRoute> = lazySchema(
  () =>
    z.object({
      route: z.string().min(1),
      destination: z.string().min(1),
      port: z.number().int().positive().nullable().default(null),
    }),
);

/**
 * One secret a sandbox may use. `routes` is empty for an exposed secret: its
 * value is on the sandbox and nothing is brokered. `connectorName` is set
 * when its destinations sit behind a private connector.
 */
export interface SandboxGrant {
  readonly secretName: string;
  readonly kind: string;
  readonly protocol: string;
  readonly mode: string;
  /** `default`, `inherited` or `approved`: why this sandbox has it. */
  readonly source: string;
  readonly connectorName: string | null;
  readonly routes: readonly SandboxGrantRoute[];
}

export const sandboxGrantSchema: z.ZodType<SandboxGrant> = lazySchema(() =>
  z.object({
    secretName: z.string().min(1),
    kind: z.string(),
    protocol: z.string(),
    mode: z.string(),
    source: z.string(),
    connectorName: z.string().nullable().default(null),
    routes: z.array(sandboxGrantRouteSchema).default([]),
  }),
);

export interface SandboxGitHubInstallation {
  readonly account: string;
  /** `all` or `selected`. */
  readonly repositorySelection: string;
}

/** What git on the sandbox can reach through the Traycer GitHub App. */
export interface SandboxGitHubAccess {
  /** Whether the user's GitHub identity is linked at all. */
  readonly linked: boolean;
  readonly installations: readonly SandboxGitHubInstallation[];
}

export const sandboxGitHubAccessSchema: z.ZodType<SandboxGitHubAccess> =
  lazySchema(() =>
    z.object({
      linked: z.boolean(),
      installations: z
        .array(
          z.object({
            account: z.string(),
            repositorySelection: z.string(),
          }),
        )
        .default([]),
    }),
  );

export interface SandboxGrantsSummary {
  /** The grant set's version; moves on every grant change. */
  readonly version: number;
  readonly grants: readonly SandboxGrant[];
  /** `null` from a broker that does not report GitHub access here. */
  readonly github: SandboxGitHubAccess | null;
}

export const sandboxGrantsSummarySchema: z.ZodType<SandboxGrantsSummary> =
  lazySchema(() =>
    z.object({
      version: z.number(),
      grants: z.array(sandboxGrantSchema),
      github: sandboxGitHubAccessSchema.nullable().default(null),
    }),
  );

// ─── `POST /api/v3/secrets/requests/:id/decide` ─────────────────────────────

/**
 * The three answers to an agent's grant request:
 *
 *  - `approve`: this sandbox gets the secret for its lifetime.
 *  - `approve_default`: that, and every future sandbox gets it by default.
 *  - `decline`: nothing is granted and the agent is told.
 */
export const SECRET_REQUEST_DECISIONS = [
  "approve",
  "approve_default",
  "decline",
] as const;
export type SecretRequestDecision = (typeof SECRET_REQUEST_DECISIONS)[number];

/** A grant request's states; `pending` until decided or expired (24 h). */
export const SECRET_REQUEST_STATUSES = [
  "pending",
  "approved",
  "approved_default",
  "declined",
  "expired",
] as const;
export type SecretRequestStatus = (typeof SECRET_REQUEST_STATUSES)[number];

/** The status each decision leaves a request in. */
export const SECRET_REQUEST_STATUS_OF_DECISION: Record<
  SecretRequestDecision,
  SecretRequestStatus
> = {
  approve: "approved",
  approve_default: "approved_default",
  decline: "declined",
};

/**
 * The `409` code for a request that names only a destination: there is no
 * secret to grant until the user stores one on the dashboard.
 */
export const SECRET_REQUEST_CODE_SECRET_REQUIRED = "secret_required";

/**
 * The body of a `200` (the request now stands at `status`; repeating the same
 * decision answers the same) and of a `409` (the request stands at `status`
 * and this decision did not change it: it was decided otherwise, it expired,
 * or `code` says what is missing).
 */
export interface SecretRequestDecideBody {
  readonly status: string;
  readonly code: string | null;
}

export const secretRequestDecideBodySchema: z.ZodType<SecretRequestDecideBody> =
  lazySchema(() =>
    z.object({
      status: z.string().min(1),
      code: z.string().nullable().default(null),
    }),
  );
