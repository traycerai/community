import type { ComponentType } from "react";
import {
  EDITORS,
  type EditorEntry,
  type EditorId,
} from "@traycer/protocol/host";
import {
  CursorIcon,
  FinderIcon,
  VisualStudioCodeIcon,
  VSCodiumIcon,
  WindsurfIcon,
  ZedIcon,
  type EditorIconProps,
} from "@/components/icons/editor-icons";

export type EditorIconComponent = ComponentType<EditorIconProps>;

/**
 * What a surface may open a path WITH, and remember as the user's default.
 *
 * Finder sits alongside the editors here and nowhere else: it is not an
 * `EDITORS` entry (no URL scheme, no install probe) and not `OpenPathsTarget`
 * either, which also carries `"system"` - a PDF-only routing decision no user
 * picks. This union is exactly the set a person can choose from a menu.
 */
export const FINDER_TARGET = "finder" as const;
export type DefaultOpenTarget = EditorId | typeof FINDER_TARGET;

/** Keyed by target, so a target without an icon fails to compile. */
export const OPEN_TARGET_ICONS: Readonly<
  Record<DefaultOpenTarget, EditorIconComponent>
> = {
  vscode: VisualStudioCodeIcon,
  cursor: CursorIcon,
  windsurf: WindsurfIcon,
  zed: ZedIcon,
  vscodium: VSCodiumIcon,
  // Code - OSS is the open-source build VS Code is made from, with no logo of
  // its own, so it wears VS Code's.
  "code-oss": VisualStudioCodeIcon,
  finder: FinderIcon,
};

export interface OpenTargetEntry {
  readonly id: DefaultOpenTarget;
  readonly label: string;
}

const FINDER_ENTRY: OpenTargetEntry = { id: FINDER_TARGET, label: "Finder" };

/**
 * How a surface with no menu names the action it performs. Generic for an
 * editor because the id is not worth spelling out on a one-line button, and
 * specific for Finder because "Open in editor" would name the wrong app.
 */
export function openTargetActionLabel(target: DefaultOpenTarget): string {
  return target === FINDER_TARGET ? "Reveal in Finder" : "Open in editor";
}

/** Appends Finder to an editor catalog when that host may be offered it. */
export function withFinderTarget(
  editors: ReadonlyArray<EditorEntry>,
  finderAvailable: boolean,
): ReadonlyArray<OpenTargetEntry> {
  const targets: OpenTargetEntry[] = editors.map((editor) => ({
    id: editor.id,
    label: editor.label,
  }));
  if (finderAvailable) targets.push(FINDER_ENTRY);
  return targets;
}

/**
 * The target a surface with no menu sends - one that simply opens "the user's
 * choice". `catalog` is what this host may be offered: a stored target missing
 * from it falls back to the first one that is, which is how a Finder default
 * behaves on a non-Mac and how an editor default behaves on a host too old for
 * its id.
 *
 * Deliberately NOT intersected with the installed-editor probe; these surfaces
 * open whatever is stored, installed or not.
 */
export function resolveEffectiveDefaultEditor(
  catalog: ReadonlyArray<OpenTargetEntry>,
  defaultTarget: DefaultOpenTarget | null,
): DefaultOpenTarget {
  if (
    defaultTarget !== null &&
    catalog.some((target) => target.id === defaultTarget)
  ) {
    return defaultTarget;
  }
  return catalog[0]?.id ?? "vscode";
}

function joinWithOr(labels: ReadonlyArray<string>): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/**
 * What a surface with no menu says instead of sending an editor nobody has.
 * Built from `EDITORS`, so it names an editor the day one is added.
 */
export const NO_EDITOR_INSTALLED_MESSAGE = `None of ${joinWithOr(
  EDITORS.map((editor) => editor.label),
)} is installed on this machine; install one to open files from Traycer.`;

/**
 * The target a surface with no menu sends, or `null` when it has nothing it may
 * honestly send.
 *
 * Same as {@link resolveEffectiveDefaultEditor} - a stored editor is sent
 * whether or not it is installed - except when `installedEditorIds` says the
 * probe found NO editor at all. Then every editor id would only come back as
 * "<editor> isn't installed", so editors leave the catalog: Finder (which ships
 * with the OS) still resolves where this host is offered it, and otherwise the
 * answer is `null`, which the surface turns into
 * {@link NO_EDITOR_INSTALLED_MESSAGE}. `null` for `installedEditorIds` is a
 * probe still in flight or failed, and changes nothing.
 */
export function resolveNoMenuOpenTarget(args: {
  readonly catalog: ReadonlyArray<OpenTargetEntry>;
  readonly installedEditorIds: ReadonlyArray<EditorId> | null;
  readonly defaultTarget: DefaultOpenTarget | null;
}): DefaultOpenTarget | null {
  if (
    args.installedEditorIds !== null &&
    args.installedEditorIds.length === 0
  ) {
    const finderOnly = args.catalog.filter(
      (target) => target.id === FINDER_TARGET,
    );
    if (finderOnly.length === 0) return null;
    return resolveEffectiveDefaultEditor(finderOnly, args.defaultTarget);
  }
  return resolveEffectiveDefaultEditor(args.catalog, args.defaultTarget);
}

export interface OpenMenuState {
  /** Menu rows in order: the available editors, then Finder. */
  readonly targets: ReadonlyArray<OpenTargetEntry>;
  readonly noTargetsAvailable: boolean;
  readonly primaryTargetId: DefaultOpenTarget | null;
}

/**
 * Which rows a menu lists and which one its primary half opens, from three
 * narrowings: `catalog` is what the HOST accepts, `availableEditorIds` what is
 * INSTALLED here (`null` while that probe is in flight), and `finderAvailable`
 * the Finder gate. Finder is exempt from the install probe - it ships with the
 * OS - so it is appended after the surviving editors.
 */
export function resolveOpenMenuState(args: {
  readonly catalog: ReadonlyArray<EditorEntry>;
  readonly availableEditorIds: ReadonlyArray<EditorId> | null;
  readonly finderAvailable: boolean;
  readonly defaultTarget: DefaultOpenTarget | null;
}): OpenMenuState {
  const { availableEditorIds } = args;
  const availableEditors =
    availableEditorIds === null
      ? args.catalog
      : args.catalog.filter((editor) => availableEditorIds.includes(editor.id));
  const targets = withFinderTarget(availableEditors, args.finderAvailable);
  const noTargetsAvailable =
    availableEditorIds !== null && targets.length === 0;
  return {
    targets,
    noTargetsAvailable,
    // Resolved against the LISTED rows, so a stored target this host cannot be
    // offered never becomes the primary and fails at parse.
    primaryTargetId:
      targets.length > 0
        ? resolveEffectiveDefaultEditor(targets, args.defaultTarget)
        : null,
  };
}
