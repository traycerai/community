import { useState, type ReactNode } from "react";
import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type { EnvironmentSecret } from "@traycer/protocol/host/environment-schemas";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HostRpcRegistry } from "@/lib/host";
import {
  secretKindLabel,
  secretProtocolLabel,
} from "@/lib/sandboxes/secret-intake-copy";
import {
  secretVerifyLine,
  type SecretVerifyLine,
} from "@/lib/sandboxes/secret-verify-copy";
import {
  SECRET_PENDING_REVIEW_LABEL,
  SECRET_READABLE_WHERE,
  SECRET_REVOKED_LABEL,
} from "@/lib/sandboxes/secrets-page-copy";
import { cn } from "@/lib/utils";

const VERIFY_TONE: Readonly<Record<SecretVerifyLine["tone"], string>> = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
};

/** What a row says about its secret: kind, protocol and where it goes. */
function secretSummary(secret: EnvironmentSecret): string {
  const parts = [secretKindLabel(secret.kind)];
  if (secret.protocol !== null)
    parts.push(secretProtocolLabel(secret.protocol));
  if (secret.destinations.length > 0)
    parts.push(secret.destinations.join(", "));
  return parts.join(" · ");
}

/**
 * One secret on Settings ▸ Personal ▸ Secrets: its name, what it is and
 * where it goes, where its value is readable, and Verify. No value is ever
 * here. Verify probes the secret by id, so it works for every kind, those
 * added on the web included.
 */
export function SecretRow(props: {
  readonly secret: EnvironmentSecret;
  readonly client: HostClient<HostRpcRegistry>;
}): ReactNode {
  const { secret } = props;
  const [verifying, setVerifying] = useState(false);
  const [line, setLine] = useState<SecretVerifyLine | null>(null);

  const verify = async (): Promise<void> => {
    setVerifying(true);
    setLine(null);
    try {
      const result = await props.client.request("environment.secrets.verify", {
        target: "secret",
        secretId: secret.secretId,
      });
      setLine(secretVerifyLine(result, secret.protocol ?? "", "row"));
    } catch (error) {
      setLine({
        tone: "warning",
        text: error instanceof Error ? error.message : "Couldn't check.",
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <li
      className="flex flex-col gap-1.5 border-b border-border/60 py-3 last:border-b-0"
      data-testid="secret-row"
      data-secret-name={secret.name}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-ui-sm text-foreground">
              {secret.name}
            </span>
            {secret.revoked ? (
              <Badge variant="outline">{SECRET_REVOKED_LABEL}</Badge>
            ) : null}
            {!secret.revoked && secret.state === "pending_review" ? (
              <Badge variant="outline">{SECRET_PENDING_REVIEW_LABEL}</Badge>
            ) : null}
          </span>
          <span className="min-w-0 text-ui-xs text-muted-foreground">
            {secretSummary(secret)}
          </span>
        </div>
        {secret.revoked ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={verifying}
            onClick={() => void verify()}
            data-testid="secret-row-verify"
          >
            Verify
            {verifying ? (
              <AgentSpinningDots
                className={undefined}
                testId={undefined}
                variant={undefined}
                tone="muted"
              />
            ) : null}
          </Button>
        )}
      </div>
      {secret.revoked ? null : (
        <p className="max-w-[72ch] text-ui-xs text-muted-foreground">
          {SECRET_READABLE_WHERE}
        </p>
      )}
      {line === null ? null : (
        <p
          role="status"
          className={cn("max-w-[72ch] text-ui-xs", VERIFY_TONE[line.tone])}
          data-testid="secret-verify-line"
        >
          {line.text}
        </p>
      )}
    </li>
  );
}
