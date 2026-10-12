import { resolvePlatformBaseUrl } from "@/lib/auth/platform-base-url";

/**
 * Where the account's secrets live: the dashboard page that stores them, binds
 * them to destinations, connects coding CLIs for sandboxes and installs the
 * GitHub App. The app holds no control over any of it - a sandbox never takes
 * a credential from a client - so every surface that would have offered one
 * links here instead.
 *
 * Navigation only (`resolvePlatformBaseUrl`): a shell with no usable platform
 * origin lands on production's page, which the user can see and leave.
 */
export const SECRETS_DASHBOARD_LABEL = "Secrets and GitHub";

export function secretsDashboardUrl(signInUrl: string): string {
  return `${resolvePlatformBaseUrl(signInUrl)}/secrets`;
}
