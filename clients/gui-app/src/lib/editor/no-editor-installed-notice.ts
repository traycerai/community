import { toast } from "sonner";
import { NO_EDITOR_INSTALLED_MESSAGE } from "@/lib/editor/editor-menu-catalog";

/** What a no-menu open button does when it has no editor to send. */
export function showNoEditorInstalledNotice(): void {
  toast.info(NO_EDITOR_INSTALLED_MESSAGE);
}
