import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { SandboxAutomationResponse } from "@traycer/protocol/host/sandbox-control";
import type { AuthService } from "@/lib/auth/auth-service";
import { useHostBinding } from "@/lib/host";
import { sandboxQueryKeys } from "@/lib/query-keys";
import { useAuthStore } from "@/stores/auth/auth-store";
import { sandboxFailureMessage } from "@/hooks/sandboxes/sandbox-failure-copy";
import { useSandboxControlUnavailableReason } from "@/hooks/sandboxes/use-sandbox-control-unavailable-reason";

function sandboxAutomationQueryOptions(
  auth: AuthService | null,
  userId: string | null,
  enabled: boolean,
) {
  if (auth === null) {
    return queryOptions<SandboxAutomationResponse | null>({
      queryKey: sandboxQueryKeys.automationMissing(),
      queryFn: () => Promise.resolve(null),
      enabled: false,
    });
  }
  return queryOptions<SandboxAutomationResponse | null>({
    queryKey: sandboxQueryKeys.automation(auth, userId),
    queryFn: async () => {
      const result = await auth.getSandboxAutomation();
      if (result.kind === "ok") {
        return result.automation;
      }
      throw new Error(sandboxFailureMessage(result));
    },
    enabled,
    refetchOnWindowFocus: true,
  });
}

/**
 * `GET /api/sandboxes/automation`: whether this deployment offers
 * Automations, and the user's row once it exists. Enabled exactly when
 * `useSandboxList` is. A server without the route reads as
 * `{ available: false, sandbox: null }` (see `getSandboxAutomationViaHttp`),
 * so an older server shows no entry and no error.
 */
export function useSandboxAutomation(): UseQueryResult<SandboxAutomationResponse | null> {
  const binding = useHostBinding();
  const auth = binding === null ? null : binding.auth;
  const signedIn = useAuthStore((s) => s.status === "signed-in");
  const userId = useAuthStore((s) => s.contextMetadata?.userId ?? null);
  const unavailable = useSandboxControlUnavailableReason() !== null;
  return useQuery(
    sandboxAutomationQueryOptions(auth, userId, signedIn && !unavailable),
  );
}
