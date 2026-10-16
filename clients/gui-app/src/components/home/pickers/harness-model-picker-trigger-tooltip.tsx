import type { ReactNode } from "react";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";

interface HarnessModelPickerTriggerTooltipProps {
  readonly children: ReactNode;
  readonly label: ReactNode;
  readonly pickerOpen: boolean;
}

/** Keep the model hint out of the picker and reset it before focus returns. */
export function HarnessModelPickerTriggerTooltip(
  props: HarnessModelPickerTriggerTooltipProps,
) {
  const { children, label, pickerOpen, ...triggerProps } = props;
  return (
    <TooltipWrapper
      {...triggerProps}
      label={pickerOpen ? null : label}
      side="top"
      sideOffset={undefined}
      align={undefined}
    >
      {children}
    </TooltipWrapper>
  );
}
