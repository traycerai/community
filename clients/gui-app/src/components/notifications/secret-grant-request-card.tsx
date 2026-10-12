import type { ReactNode } from "react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import { SecretsDashboardLink } from "@/components/providers/secrets-dashboard-link";
import {
  useSecretRequestDecide,
  type SecretRequestDecideOutcome,
} from "@/hooks/sandboxes/use-secret-request-decide-mutation";
import {
  SECRET_GRANT_DECISIONS,
  secretGrantRequestDestination,
  secretGrantRequestReason,
  secretRequestStatusLine,
  type SecretsNotificationDetail,
} from "@/lib/notifications/secrets-notification-detail";

type GrantRequestDetail = Extract<
  SecretsNotificationDetail,
  { kind: "grant-request" }
>;

/**
 * An agent's request for a secret, on its notification row: what it asked
 * for, where it would be used, which sandbox and why, and the three answers.
 * The answer goes to the broker with the user's bearer; nothing is granted
 * without it.
 *
 * `resolved` is the row's own state (the host recorded an answer, from this
 * card or from the dashboard): the answers are then withdrawn and the row's
 * body says it was decided.
 */
export function SecretGrantRequestCard(props: {
  readonly detail: GrantRequestDetail;
  readonly resolved: boolean;
}): ReactNode {
  const { detail } = props;
  const decide = useSecretRequestDecide(detail.requestId);
  const destination = secretGrantRequestDestination(detail);
  const reason = secretGrantRequestReason(detail.reason);
  const outcome = decide.data ?? null;
  // A decision that landed, or a request that turned out closed, ends the
  // card's part; `secret-required` does not - the user can store a secret
  // and answer again.
  const answerable =
    !props.resolved && (outcome === null || outcome.kind === "secret-required");
  return (
    <div
      data-testid="secret-grant-request-card"
      className="flex flex-col gap-1.5 text-ui-xs"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted-foreground">Secret</dt>
        <dd className="break-words" data-testid="secret-grant-request-secret">
          {detail.secretName ?? "None stored for this destination yet"}
        </dd>
        {destination === null ? null : (
          <>
            <dt className="text-muted-foreground">Destination</dt>
            <dd
              className="break-words"
              data-testid="secret-grant-request-destination"
            >
              {destination}
            </dd>
          </>
        )}
        {detail.sandboxName === null ? null : (
          <>
            <dt className="text-muted-foreground">Sandbox</dt>
            <dd className="break-words">{detail.sandboxName}</dd>
          </>
        )}
        {reason === null ? null : (
          <>
            <dt className="text-muted-foreground">Why</dt>
            <dd
              className="break-words whitespace-pre-wrap"
              data-testid="secret-grant-request-reason"
            >
              {reason}
            </dd>
          </>
        )}
      </dl>
      <SecretGrantOutcomeLine outcome={outcome} />
      {answerable ? (
        <div className="flex flex-wrap gap-1.5">
          {SECRET_GRANT_DECISIONS.map(({ decision, label }) => (
            <Button
              key={decision}
              type="button"
              size="sm"
              variant={decisionVariant(decision)}
              disabled={decide.isPending}
              data-testid={`secret-grant-request-${decision}`}
              onClick={() => decide.mutate(decision)}
            >
              {decide.isPending && decide.variables === decision ? (
                <AgentSpinningDots
                  className={undefined}
                  testId={`secret-grant-request-${decision}-spinner`}
                  variant={undefined}
                />
              ) : null}
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function decisionVariant(
  decision: (typeof SECRET_GRANT_DECISIONS)[number]["decision"],
): "default" | "outline" | "ghost" {
  if (decision === "approve") return "default";
  return decision === "approve_default" ? "outline" : "ghost";
}

function SecretGrantOutcomeLine(props: {
  readonly outcome: SecretRequestDecideOutcome | null;
}): ReactNode {
  const { outcome } = props;
  if (outcome === null) return null;
  if (outcome.kind === "secret-required") {
    return (
      <div
        data-testid="secret-grant-request-outcome"
        data-outcome="secret-required"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-warning-foreground"
      >
        <p className="min-w-0">
          There is no secret stored for this destination yet, so there is
          nothing to grant. Store one, then approve.
        </p>
        <SecretsDashboardLink
          testId="secret-grant-request-open-secrets"
          className={undefined}
        />
      </div>
    );
  }
  return (
    <p
      data-testid="secret-grant-request-outcome"
      data-outcome={outcome.kind}
      className="text-muted-foreground"
    >
      {outcomeText(outcome)}
    </p>
  );
}

function outcomeText(
  outcome: Exclude<SecretRequestDecideOutcome, { kind: "secret-required" }>,
): string {
  switch (outcome.kind) {
    case "decided":
      return secretRequestStatusLine(outcome.status);
    case "already":
      return `Already answered. ${secretRequestStatusLine(outcome.status)}`;
    case "gone":
      return "This request is no longer open.";
  }
}
