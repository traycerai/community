import { Button } from "@/components/ui/button";
import type { GuiHarnessCatalogEntry } from "@/hooks/harnesses/use-gui-harness-catalog";
import { useProvidersFocusStore } from "@/stores/settings/providers-focus-store";
import { ProviderSetupManualCommand } from "@/components/home/pickers/harness-model-picker-auth-line";
import { ProviderSetupTerminalAction } from "@/components/home/pickers/provider-setup-terminal-action";
import { useProviderTerminalLoginScopeSupported } from "@/hooks/providers/use-provider-terminal-login-scope-support";
import {
  providerSetupActionPlacement,
  providerSetupPreparingLabel,
  providerSetupSteps,
  type ProviderTerminalSetup,
} from "@/lib/providers/provider-setup-guidance";
import type { ProviderTerminalLoginSurface } from "@/lib/providers/provider-terminal-login-surface";
import type { ProviderId } from "@traycer/protocol/host/provider-schemas";
import { KeyRound, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The rows `modelRowsState` (`harness-model-picker-empty.tsx`) answers with.
 * Their own file because that one exports a helper, not a component, and a
 * file keeps Fast Refresh only while every export it has is a component.
 */

interface PickerStateRowProps {
  readonly label: string;
  readonly icon: ReactNode | undefined;
  readonly action: ReactNode | undefined;
}
export function PickerStateRow(props: PickerStateRowProps) {
  const { label, icon, action } = props;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg p-2 text-ui-sm text-muted-foreground">
      {/* The action (when present) must stay OUTSIDE the option element: an
          `option` role's descendants are flattened/treated as disabled by
          assistive tech, which would make a nested Report issue button
          unreachable. Keeping the row's flex layout on the outer div and the
          option semantics on this inner span preserves the visual row while
          leaving the action independently focusable/announced. */}
      <span
        role="option"
        aria-selected="false"
        aria-disabled="true"
        className="flex min-w-0 items-center gap-2"
      >
        {icon}
        {label}
      </span>
      {action}
    </div>
  );
}

// Shown in place of the model list when a provider that signs in from a
// terminal is signed out. Same shape as the API-key CTA below, but the action
// is the provider's terminal flow: Traycer cannot complete it itself. The
// button asks the host to open that flow in a terminal on the surface this
// picker is drawn on (an epic's canvas, or the landing terminal panel); on a
// surface with neither (a fork dialog) the steps say where the button lives.
// No Settings button, deliberately - Settings has no terminal sign-in for
// such a provider, so it would be a dead end.
export function ProviderSetupCta(props: {
  readonly providerId: ProviderId;
  readonly label: string;
  readonly setup: ProviderTerminalSetup;
  readonly terminalLoginSurface: ProviderTerminalLoginSurface | null;
  readonly runTargetHostId: string | null;
  readonly onClosePicker: () => void;
}): ReactNode {
  const { setup, terminalLoginSurface } = props;
  const { guidance } = setup;
  const scopeSupport = useProviderTerminalLoginScopeSupported(
    terminalLoginSurface,
    props.runTargetHostId,
  );
  // Same single decision as the auth line: the surface is handed over only
  // where the placement draws a button, so button and steps cannot disagree.
  const placement = providerSetupActionPlacement(
    setup,
    terminalLoginSurface !== null,
    scopeSupport,
  );
  const preparingLabel = providerSetupPreparingLabel(setup, props.providerId);
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        <SquareTerminal className="size-4" />
      </span>
      <span className="text-ui-sm font-medium text-foreground">
        Set up {props.label}
      </span>
      <p className="max-w-[min(90vw,18rem)] text-balance text-ui-xs text-muted-foreground">
        {guidance.summary}
      </p>
      {placement === "preparing" && preparingLabel !== null ? (
        <p
          role="status"
          className="max-w-[min(90vw,18rem)] text-ui-xs text-muted-foreground"
        >
          {preparingLabel}
        </p>
      ) : null}
      <div className="max-w-[min(90vw,18rem)]">
        <ProviderSetupTerminalAction
          providerId={props.providerId}
          guidance={guidance}
          surface={placement === "here" ? terminalLoginSurface : null}
          runTargetHostId={props.runTargetHostId}
          onBeforeStart={props.onClosePicker}
        />
      </div>
      <ol className="max-w-[min(90vw,18rem)] list-decimal space-y-0.5 pl-4 text-left text-ui-xs text-muted-foreground">
        {providerSetupSteps(guidance, placement).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guidance.manualCommand === null ? null : (
        <p className="max-w-[min(90vw,18rem)] text-left text-ui-xs text-muted-foreground">
          <ProviderSetupManualCommand command={guidance.manualCommand} />
        </p>
      )}
    </div>
  );
}

// Shown in place of the model list when an API-key provider has no key
// configured. A friendly prompt + a one-click path to Settings → Providers where
// the key is entered.
export function ProviderApiKeyCta(props: {
  readonly harnessId: GuiHarnessCatalogEntry["id"];
  readonly label: string;
  readonly onOpenProviderSettings: (focusTab: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        <KeyRound className="size-4" />
      </span>
      <span className="text-ui-sm font-medium text-foreground">
        Connect {props.label}
      </span>
      <p className="max-w-[min(90vw,16rem)] text-balance text-ui-xs text-muted-foreground">
        {props.label} needs an API key to list models and start chats. Add yours
        in Provider settings to get started.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="mt-1"
        onClick={() => {
          // Pre-select this provider in the settings panel so the user lands on
          // its API-key field, not the first provider in the rail.
          useProvidersFocusStore.getState().setFocusHarnessId(props.harnessId);
          // Unchanged destination - this CTA has always landed on the tab the
          // callback chose. Named here only because the tab is now explicit.
          props.onOpenProviderSettings("usage");
        }}
      >
        Add API key
      </Button>
    </div>
  );
}
