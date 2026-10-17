/**
 * Docs: see ../SETTINGS.md
 * Update that file whenever this settings surface changes.
 */
import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Badge } from "@/components/ui/badge";
import { useHostMethodSupport } from "@/hooks/host/use-host-supports-method";
import { useEnvironmentListQuery } from "@/hooks/bots/use-environment-list-query";
import { useEnvironmentHostReadQuery } from "@/hooks/bots/use-environment-host-read-query";
import { useEnvironmentHostBindMutation } from "@/hooks/bots/use-environment-host-bind-mutation";
import type { HostScope } from "@/components/settings/host-scope/use-host-scope";
import { cn } from "@/lib/utils";

/**
 * Which environment THIS host runs (Tracy Bots). A host serves one
 * environment at a time: the personal one unless it was bound to a team.
 * The list shows every environment the person belongs to, marks the one the
 * host currently reports, and binds on a click. Nothing is pre-selected on
 * the person's behalf - the marked row is the host's own answer, and a team
 * becomes this host's environment only when the person picks it here. A
 * refusal from the host is shown in place, beside the list.
 *
 * Reads and writes go through the Settings scope's client, the host the
 * sidebar has selected, never the app-wide one.
 */
export function HostEnvironmentSection(props: {
  readonly scope: HostScope;
}): ReactNode {
  const { scope } = props;
  const headingId = useId();
  const ready = scope.status === "ready" && scope.client !== null;
  const support = useHostMethodSupport(scope.hostId, "environment.host.read");
  const enabled = ready && support === true;
  const environments = useEnvironmentListQuery(scope.client, enabled);
  const binding = useEnvironmentHostReadQuery(scope.client, enabled);
  const bind = useEnvironmentHostBindMutation(scope.client, scope.hostId);

  if (!ready || support === null) return null;

  let body: ReactNode;
  if (!support) {
    body = (
      <p
        role="status"
        className="text-ui-xs text-muted-foreground"
        data-testid="host-environment-unsupported"
      >
        {scope.hostLabel} predates environments. Update it to run a team&apos;s
        bots from this host.
      </p>
    );
  } else if (environments.isError || binding.isError) {
    body = (
      <p role="status" className="text-ui-xs text-destructive">
        Couldn&apos;t read this host&apos;s environment.
      </p>
    );
  } else if (environments.data === undefined || binding.data === undefined) {
    body = (
      <div aria-busy="true" className="flex items-center py-1 text-muted-foreground">
        <AgentSpinningDots className={undefined} testId={undefined} variant={undefined} />
      </div>
    );
  } else {
    const currentId = binding.data.environment.environmentId;
    const pendingId = bind.isPending ? bind.variables.environmentId : null;
    body = (
      <>
        <ul
          className="flex flex-wrap gap-2"
          aria-labelledby={headingId}
          data-testid="host-environment-list"
        >
          {environments.data.environments.map((environment) => {
            const current = environment.environmentId === currentId;
            return (
              <li key={environment.environmentId}>
                <button
                  type="button"
                  aria-pressed={current}
                  data-testid="host-environment-option"
                  data-environment-id={environment.environmentId}
                  disabled={current || bind.isPending}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-ui-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 disabled:cursor-default",
                    current
                      ? "border-foreground/20 bg-foreground/8 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
                  )}
                  onClick={() =>
                    bind.mutate({ environmentId: environment.environmentId })
                  }
                >
                  {current ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : null}
                  <span>{environment.label}</span>
                  <Badge variant="muted" size="xs">
                    {environment.ownerKind === "organization" ? "Team" : "Personal"}
                  </Badge>
                  {pendingId === environment.environmentId ? (
                    <AgentSpinningDots
                      className={undefined}
                      testId={undefined}
                      variant={undefined}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {bind.error === null ? null : (
          <p
            role="alert"
            className="text-ui-xs text-destructive"
            data-testid="host-environment-refusal"
          >
            {bind.error.message}
          </p>
        )}
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mb-4 flex shrink-0 flex-col gap-2 border-b border-border/60 pb-4"
      data-testid="host-environment-section"
    >
      <div className="min-w-0">
        <h2 id={headingId} className="text-ui-md font-semibold text-foreground">
          Environment
        </h2>
        <p className="mt-1 text-ui-xs text-muted-foreground">
          The bots {scope.hostLabel} runs belong to this environment, and so do
          the agent instructions below.
        </p>
      </div>
      {body}
    </section>
  );
}
