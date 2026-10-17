import type { ReactNode } from "react";
import { useStore } from "zustand";
import { HarnessModelPicker } from "@/components/home/pickers/harness-model-picker";
import { buildChatRunSettings } from "@/lib/composer/chat-run-settings";
import type { ComposerToolbarItemsProps } from "@/components/home/toolbar/composer-toolbar-item";

export function ComposerModelPicker(
  props: ComposerToolbarItemsProps,
): ReactNode {
  const toolbar = useStore(props.store);
  const settings = buildChatRunSettings({
    selection: toolbar.selection,
    permission: toolbar.permission,
    reasoning: toolbar.reasoning,
    serviceTier: toolbar.serviceTier,
  });
  return (
    <HarnessModelPicker
      labelDisplay="responsive"
      store={props.store}
      maxModeContext={{ kind: "chat", tuple: settings }}
      withServiceTier
      withReasoning
      tuiOnly={false}
      lockedHarnessId={null}
      disabled={props.settingsLocked}
      registerActivation={!props.presentation}
      presentation={props.presentation}
      createProfileHostId={props.createProfileHostId}
      runTargetHostId={props.runTargetHostId}
      terminalLoginSurface={props.terminalLoginSurface}
      profileAdmission={null}
      embedding={null}
    />
  );
}
