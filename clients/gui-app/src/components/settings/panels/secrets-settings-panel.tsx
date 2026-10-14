import type { ReactNode } from "react";
import { SecretsDashboardLink } from "@/components/providers/secrets-dashboard-link";
import { SECRETS } from "@/components/settings/panels/secrets.definitions";
import { SettingsGroup } from "@/components/settings/settings-group";
import { SettingsPanelShell } from "@/components/settings/settings-panel-shell";
import { SettingsRow } from "@/components/settings/settings-row";

/**
 * Settings > Personal > Secrets: where the person's secrets are managed. The
 * page that stores them lives on the dashboard, so this section is the way to
 * it from Settings; the same link stays beside "New sandbox" under the host
 * picker.
 */
export function SecretsSettingsPanel(): ReactNode {
  return (
    <SettingsPanelShell
      title={SECRETS.page.label}
      description={SECRETS.page.description}
      bodyClassName="overflow-visible rounded-none border-none bg-transparent"
    >
      <SettingsGroup
        group={SECRETS.definitions.dashboard}
        showTitle={false}
        tone="default"
        dataTestId="settings-secrets"
        fill={false}
      >
        <SettingsRow
          row={SECRETS.definitions.manageSecrets}
          control={
            <SecretsDashboardLink
              testId="settings-secrets-dashboard-link"
              className={undefined}
            />
          }
        />
      </SettingsGroup>
    </SettingsPanelShell>
  );
}
