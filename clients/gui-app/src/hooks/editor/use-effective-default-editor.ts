import { useEditorAvailability } from "@/hooks/editor/use-editor-availability-query";
import { useOfferableOpenTargets } from "@/hooks/editor/use-offerable-open-targets";
import {
  resolveNoMenuOpenTarget,
  type DefaultOpenTarget,
} from "@/lib/editor/editor-menu-catalog";
import { useSettingsStore } from "@/stores/settings/settings-store";

/**
 * The target a surface with no menu may send to `hostId`, or `null` when this
 * machine has no editor to send it to (the surface then says which editors
 * Traycer can open - `NO_EDITOR_INSTALLED_MESSAGE`).
 *
 * `defaultEditor` is one app-wide preference while `editor.openPaths` is
 * host-scoped, so the stored value is a preference and not a legal wire value
 * until a specific host has been asked. That applies to Finder as much as to an
 * editor: a stored `"finder"` is effective only where the Finder gate holds,
 * and falls back to the first offerable target on a remote, non-Mac, or too-old
 * host exactly as an unofferable editor does.
 *
 * The install probe narrows this only in the one case where sending anything
 * would fail: it answered and found no editor. A probe still in flight, or one
 * that found some other editor, leaves the stored default in place.
 *
 * `hostId` is the host the request is SENT to - a tile's own bound host, never
 * the app-wide one, since that is the machine whose minor decides the parse.
 */
export function useEffectiveDefaultEditor(
  hostId: string | null,
): DefaultOpenTarget | null {
  const defaultEditor = useSettingsStore((s) => s.defaultEditor);
  const offerableTargets = useOfferableOpenTargets(hostId);
  const availability = useEditorAvailability();
  return resolveNoMenuOpenTarget({
    catalog: offerableTargets,
    installedEditorIds: availability.data ?? null,
    defaultTarget: defaultEditor,
  });
}
