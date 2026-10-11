import { MutedAgentSpinner } from "@/components/ui/agent-spinning-dots";
import { Button } from "@/components/ui/button";
import { ReportIssueAction } from "@/components/report-issue/report-issue-action";
import { createReportIssueContext } from "@/lib/report-issue-context";
import type { GuiHarnessCatalogEntry } from "@/hooks/harnesses/use-gui-harness-catalog";
import { useProvidersFocusStore } from "@/stores/settings/providers-focus-store";
import { guiHarnessIdToProviderId } from "@/lib/provider-ordering";
import {
  PickerStateRow,
  ProviderApiKeyCta,
  ProviderSetupCta,
} from "@/components/home/pickers/harness-model-picker-state-rows";
import {
  resolveProviderTerminalSetup,
  type ProviderTerminalSetup,
} from "@/lib/providers/provider-setup-guidance";
import { isProviderSignedOutCatalogError } from "@/lib/providers/provider-signed-out-catalog-error";
import type { ProviderTerminalLoginSurface } from "@/lib/providers/provider-terminal-login-surface";
import type {
  ProviderCliState,
  ProviderId,
} from "@traycer/protocol/host/provider-schemas";
import type { ReactNode } from "react";

interface ModelRowsStateProps {
  readonly catalogLoading: boolean;
  readonly catalogError: boolean;
  readonly hostUnavailableLabel: string | null;
  readonly hasQuery: boolean;
  readonly activeProvider: GuiHarnessCatalogEntry | null;
  /** The same provider's `providers.list` row - its `loginCapability` is what
   *  decides whether a terminal sign-in applies. `null` until resolved. */
  readonly activeProviderState: ProviderCliState | null;
  readonly rowsCount: number;
  readonly onOpenProviderSettings: (focusTab: string) => void;
  /** Where a provider's setup terminal lands - see the type's doc. */
  readonly terminalLoginSurface: ProviderTerminalLoginSurface | null;
  /** The picker's run-target host, which that terminal is minted on. */
  readonly runTargetHostId: string | null;
  /** Closes the picker without opening anything else. */
  readonly onClosePicker: () => void;
}

/**
 * A helper, not a component: the list calls it to learn whether there is a
 * state row at all (`null` means draw the rows). Lowercase on purpose. A
 * capitalised name makes the React Compiler compile it as a component, and
 * its memo cache then becomes a hook of whoever calls it.
 */
export function modelRowsState(props: ModelRowsStateProps): ReactNode | null {
  const {
    catalogLoading,
    catalogError,
    hostUnavailableLabel,
    hasQuery,
    activeProvider,
    activeProviderState,
    rowsCount,
    onOpenProviderSettings,
    terminalLoginSurface,
    runTargetHostId,
    onClosePicker,
  } = props;

  if (hostUnavailableLabel !== null && rowsCount === 0) {
    return (
      <PickerStateRow
        icon={undefined}
        label={hostUnavailableLabel}
        action={undefined}
      />
    );
  }

  if (catalogLoading && rowsCount === 0) {
    return (
      <PickerStateRow
        icon={<MutedAgentSpinner />}
        label="Loading models"
        action={undefined}
      />
    );
  }

  if (catalogError) {
    return (
      <PickerStateRow
        label="Couldn't load providers"
        icon={undefined}
        action={
          <ReportIssueAction
            context={createReportIssueContext({
              title: "Couldn't load providers",
              message: "The harness/provider catalog could not be loaded.",
              code: null,
              source: "Model picker",
            })}
            presentation="icon"
            className={undefined}
          />
        }
      />
    );
  }

  // A provider that can't list models (unavailable / missing API key / load
  // error) surfaces its own state or CTA even while a query is present - the
  // query is moot if the provider has nothing to search.
  if (activeProvider?.available === false) {
    return unavailableProviderState(activeProvider, onOpenProviderSettings);
  }

  if (activeProvider?.modelsLoading === true) {
    return (
      <PickerStateRow
        icon={<MutedAgentSpinner />}
        label="Loading models"
        action={undefined}
      />
    );
  }

  if (activeProvider !== null && activeProvider.modelsError !== null) {
    // A signed-out verdict for a provider whose sign-in runs in a terminal
    // gets the action that fixes it, in the space the model rows would occupy
    // - the host's "signed out, reconnect" sentence is true but names no
    // action, and the report-issue icon beside it invites a bug report for a
    // missing key.
    const setup = providerSetupCta(activeProvider, activeProviderState);
    if (setup !== null) {
      return (
        <ProviderSetupCta
          providerId={setup.providerId}
          label={activeProvider.label}
          setup={setup.setup}
          terminalLoginSurface={terminalLoginSurface}
          runTargetHostId={runTargetHostId}
          onClosePicker={onClosePicker}
        />
      );
    }
    // Surface the host's specific reason for API-key providers and packaged SDK
    // failures instead of a generic catch-all. Fall back when the message is
    // empty.
    const reason = activeProvider.modelsError.message.trim();
    return (
      <PickerStateRow
        label={reason.length > 0 ? reason : "Couldn't load models"}
        icon={undefined}
        action={
          <ReportIssueAction
            context={createReportIssueContext({
              title: "Couldn't load models",
              message: "Models for the selected provider could not be loaded.",
              code: null,
              source: "Model picker",
            })}
            presentation="icon"
            className={undefined}
          />
        }
      />
    );
  }

  if (rowsCount === 0) {
    return (
      <PickerStateRow
        label={noModelsLabel(hasQuery, activeProvider)}
        icon={undefined}
        action={undefined}
      />
    );
  }

  return null;
}

// Scope-aware empty copy. A query that matches nothing names the harness it
// searched ("No Claude models match"); an empty harness with no query keeps the
// generic "No models available".
function noModelsLabel(
  hasQuery: boolean,
  activeProvider: GuiHarnessCatalogEntry | null,
): string {
  if (!hasQuery) return "No models available";
  if (activeProvider === null) return "No models match";
  return `No ${activeProvider.label} models match`;
}

// Availability can fail on a credential OR a binary, even for the same
// provider. Only the host's typed reason identifies the remedy. Older hosts
// without that field keep their existing API-key affordance.
function unavailableProviderState(
  provider: GuiHarnessCatalogEntry,
  onOpenProviderSettings: (focusTab: string) => void,
): ReactNode {
  if (
    provider.enabled &&
    provider.availabilityPending &&
    provider.error === null
  ) {
    return (
      <PickerStateRow
        icon={<MutedAgentSpinner />}
        label="Loading models"
        action={undefined}
      />
    );
  }

  const reason = provider.unavailableReason ?? null;
  if (reason === "missing-binary") {
    return (
      <PickerStateRow
        label={`${provider.label} CLI not found`}
        icon={undefined}
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              useProvidersFocusStore.getState().setFocusHarnessId(provider.id);
              // CLI candidates live on General; Account is the default for
              // providers that accept a key, including shared-binary aliases.
              // The tab goes THROUGH the callback rather than into the store
              // here: the callback ends by setting the focus tab itself, so a
              // write made before calling it is overwritten and lost.
              onOpenProviderSettings("general");
            }}
          >
            Set up CLI
          </Button>
        }
      />
    );
  }
  if (reason === "external-cli-required" || reason === "other") {
    // Amp's SDK ignores Traycer's CLI selection. Its error already names the
    // install command and AMP_CLI_PATH; preserve it without a Settings CTA.
    // Unclassified failures likewise get their actual reason, not a guess.
    return (
      <PickerStateRow
        label={provider.error?.trim() || `${provider.label} unavailable`}
        icon={undefined}
        action={undefined}
      />
    );
  }
  // Every other reason has returned above, so `reason` is now
  // `"missing-credential"` or `null`, and `null` means an OLD HOST that sends
  // no reason at all. Its fallback is the pre-reason behaviour: the key CTA for
  // any provider that takes a key. This used to spell that as
  // `reason === null && provider.requiresApiKey`, which narrowing makes
  // redundant - the comment is where that intent lives now.
  if (reason === "missing-credential" || provider.requiresApiKey) {
    return (
      <ProviderApiKeyCta
        harnessId={provider.id}
        label={provider.label}
        onOpenProviderSettings={onOpenProviderSettings}
      />
    );
  }
  return (
    <PickerStateRow
      label={`${provider.label} unavailable`}
      icon={undefined}
      action={undefined}
    />
  );
}

// The setup guidance to show in place of the model list, when the list failed
// with the host's signed-out verdict AND the host says this provider signs in
// from a terminal (Copilot's device code; Reasonix's credential wizard). Any
// other failure keeps the host's own reason below. The `providers.list` row
// may lag the catalog error by a fetch; until it lands this is `null` and the
// generic reason row shows, then re-resolves.
function providerSetupCta(
  provider: GuiHarnessCatalogEntry,
  state: ProviderCliState | null,
): {
  readonly providerId: ProviderId;
  readonly setup: ProviderTerminalSetup;
} | null {
  const providerId = guiHarnessIdToProviderId(provider.id);
  if (providerId === null) return null;
  const setup = resolveProviderTerminalSetup(providerId, state);
  if (setup === null) return null;
  return isProviderSignedOutCatalogError(providerId, provider.modelsError)
    ? { providerId, setup }
    : null;
}
