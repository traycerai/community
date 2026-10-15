/**
 * What a surface with no menu sends. The install probe only narrows this when
 * it found NO editor at all: then no editor id is worth sending (the host's
 * launcher would answer "<editor> isn't installed"), so the surface gets `null`
 * and says which editors Traycer can open instead. A partial probe result keeps
 * the stored default, as before - these surfaces open whatever is stored.
 */
import { describe, expect, it } from "vitest";
import { EDITORS } from "@traycer/protocol/host";
import {
  NO_EDITOR_INSTALLED_MESSAGE,
  resolveNoMenuOpenTarget,
  withFinderTarget,
} from "../editor-menu-catalog";

const EDITOR_CATALOG = withFinderTarget(EDITORS, false);
const EDITOR_AND_FINDER_CATALOG = withFinderTarget(EDITORS, true);

describe("resolveNoMenuOpenTarget", () => {
  it("returns the stored default while the probe is still in flight", () => {
    expect(
      resolveNoMenuOpenTarget({
        catalog: EDITOR_CATALOG,
        installedEditorIds: null,
        defaultTarget: "cursor",
      }),
    ).toBe("cursor");
  });

  it("falls back to the first catalog editor, as before, with no stored default", () => {
    expect(
      resolveNoMenuOpenTarget({
        catalog: EDITOR_CATALOG,
        installedEditorIds: null,
        defaultTarget: null,
      }),
    ).toBe("vscode");
  });

  it("keeps the stored default when the probe found some other editor", () => {
    expect(
      resolveNoMenuOpenTarget({
        catalog: EDITOR_CATALOG,
        installedEditorIds: ["zed"],
        defaultTarget: "vscode",
      }),
    ).toBe("vscode");
  });

  it("sends no editor when the probe found none, even for a stored default", () => {
    expect(
      resolveNoMenuOpenTarget({
        catalog: EDITOR_CATALOG,
        installedEditorIds: [],
        defaultTarget: "vscode",
      }),
    ).toBeNull();
    expect(
      resolveNoMenuOpenTarget({
        catalog: EDITOR_CATALOG,
        installedEditorIds: [],
        defaultTarget: null,
      }),
    ).toBeNull();
  });

  it("falls to Finder, which needs no install, when the probe found no editor", () => {
    expect(
      resolveNoMenuOpenTarget({
        catalog: EDITOR_AND_FINDER_CATALOG,
        installedEditorIds: [],
        defaultTarget: "vscode",
      }),
    ).toBe("finder");
  });
});

describe("NO_EDITOR_INSTALLED_MESSAGE", () => {
  it("is one sentence naming every editor in the registry", () => {
    for (const editor of EDITORS) {
      expect(NO_EDITOR_INSTALLED_MESSAGE).toContain(editor.label);
    }
    expect(NO_EDITOR_INSTALLED_MESSAGE.match(/[.!?]/g)).toHaveLength(1);
    expect(NO_EDITOR_INSTALLED_MESSAGE.endsWith(".")).toBe(true);
  });
});
