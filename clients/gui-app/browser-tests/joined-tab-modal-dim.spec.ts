import { expect, test, type Page } from "@playwright/test";

import {
  canvasLoad,
  configureCanvas,
  probe,
  setThemeAndWait,
  type ThemeName,
} from "./support/layout-editor/canvas.ts";
import { layoutEditorUse, sharedPage } from "./support/layout-editor/pages.ts";
import {
  rgbText,
  samplePixelAt,
  sameRgb,
  type Rgb,
} from "./support/layout-editor/pixels.ts";
import { SURFACE_FRAME } from "./support/layout-editor/shell.ts";
import {
  waitForFiniteAnimations,
  waitUntil,
} from "./support/layout-editor/waits.ts";

// A MODAL'S DIM REACHES THE JOINED TAB.
//
// In the desktop window (`.wco` on <html>) a modal's backdrop starts below the
// 40px title band (`window-chrome.css`), and the active top tab, which is
// joined to its task's sheet, sits in that band. Before `JoinedTabDim` the tab
// stayed bright over a dimmed page, so the join read as a lit cut-out. The
// claim: with a modal open, the joined tab's pixels match the dimmed sheet
// under it, exactly as they match with no modal. The tab takes the colour of
// the backdrop beside it: the shared dialog's `bg-black/10`, or the modal
// frame's `bg-black/30` (`data-backdrop="frame"`).
//
// What decides this is paint: the dim is an element anchored to the tab with
// CSS anchor positioning and composited over a tab whose fill is a theme
// token, so it is read off a screenshot. Which backdrop a surface opens is
// jsdom's.
//
// The modals are the production `Dialog` and `PromotableModalFrame`, opened
// through the fixture's `openBackdrop`, so the backdrop measured is the one
// the product draws.

test.use(layoutEditorUse());

const getPage = sharedPage(
  canvasLoad(
    { tabs: "top", header: "app", surface: "epic", wco: "mac" },
    "document.querySelector('[data-testid=\"tab-chrome-box\"]') !== null",
  ),
);

/** A joined tab and its sheet are one fill, so they read alike to rounding. */
const SAME_FILL_TOLERANCE = 1;
/** The dimmest backdrop (`bg-black/10`) darkens the darkest theme by at least this, summed over the channels. */
const MIN_DARKENING = 3;
/** The sheet sample's height above the panel's bottom edge, below its rail and task header. */
const PANEL_FLOOR_OFFSET = 40;
/** The sample beside the tab's left edge, clear of its corner and its title. */
const TAB_INSET = 10;

const JOINED_TAB = '[data-testid="tab-chrome-box"][data-sheet-joined]';
const OVERLAY = {
  dialog: '[data-slot="dialog-overlay"]:not([data-backdrop])',
  frame: '[data-slot="dialog-overlay"][data-backdrop="frame"]',
} as const;

type Kind = keyof typeof OVERLAY;

const KIND_NAME: Readonly<Record<Kind, string>> = {
  dialog: "a dialog",
  frame: "the modal frame",
};

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Samples {
  readonly tab: Rgb;
  readonly sheet: Rgb;
}

interface SamplePoints {
  readonly tab: Point;
  readonly sheet: Point;
}

/**
 * Where to read the joined tab and the sheet it joins. The sheet's own fill is
 * the surface pane's `--background`, which is what the tab takes
 * (`data-join-pane="surface"`); the fixture's content pane holds a tinted
 * stand-in for the hosted chat, so the sheet sample is the sidebar panel's
 * empty floor, which paints `--background` and nothing else. Read with no
 * modal open, because that the point IS the bare panel (it is the hit target
 * there) and lies inside the task's surface frame is what keeps the sample
 * from drifting onto content.
 */
async function locateSamplePoints(page: Page): Promise<SamplePoints> {
  const located = await page.evaluate(
    ({ joinedTab, surfaceFrame, inset, floor }) => {
      const box = document.querySelector(joinedTab)?.getBoundingClientRect();
      const frame = document
        .querySelector(surfaceFrame)
        ?.getBoundingClientRect();
      const panel = document.querySelector("[data-epic-sidebar-panel]");
      if (box === undefined || frame === undefined || panel === null) {
        return null;
      }
      const panelBox = panel.getBoundingClientRect();
      const sheet = {
        x: Math.round(panelBox.left + panelBox.width / 2),
        y: Math.round(panelBox.bottom - floor),
      };
      return {
        tab: {
          x: Math.round(box.left + inset),
          y: Math.round(box.top + box.height / 2),
        },
        sheet,
        sheetIsBarePanel: document.elementFromPoint(sheet.x, sheet.y) === panel,
        sheetInFrame:
          sheet.y >= frame.top &&
          sheet.y < frame.bottom &&
          sheet.x >= frame.left &&
          sheet.x < frame.right,
      };
    },
    {
      joinedTab: JOINED_TAB,
      surfaceFrame: SURFACE_FRAME,
      inset: TAB_INSET,
      floor: PANEL_FLOOR_OFFSET,
    },
  );
  if (located === null) {
    throw new Error(
      "the joined tab, the sidebar panel or the surface frame is missing",
    );
  }
  expect(
    located.sheetIsBarePanel,
    "the sheet sample is the sidebar panel's bare floor",
  ).toBe(true);
  expect(
    located.sheetInFrame,
    "the sheet sample lies inside the surface frame",
  ).toBe(true);
  return { tab: located.tab, sheet: located.sheet };
}

/** The joined tab's pixel and the sheet's, as painted. */
async function sampleTabAndSheet(
  page: Page,
  points: SamplePoints,
): Promise<Samples> {
  return {
    tab: await samplePixelAt(page, points.tab.x, points.tab.y),
    sheet: await samplePixelAt(page, points.sheet.x, points.sheet.y),
  };
}

/** Opens `kind` and resolves once its backdrop is fully faded in. */
async function openAndSettle(page: Page, kind: Kind): Promise<void> {
  await probe(page, `openBackdrop(${JSON.stringify(kind)})`);
  await waitUntil(
    page,
    `(() => {
      const overlay = document.querySelector(${JSON.stringify(OVERLAY[kind])});
      return overlay !== null
        && overlay.getAttribute("data-state") === "open"
        && getComputedStyle(overlay).opacity === "1";
    })()`,
  );
  await waitForFiniteAnimations(page);
}

/** Closes the modal and resolves once no backdrop is left in the document. */
async function closeAndSettle(page: Page): Promise<void> {
  await probe(page, "openBackdrop(null)");
  await waitUntil(
    page,
    `document.querySelector('[data-slot="dialog-overlay"]') === null`,
  );
  await waitForFiniteAnimations(page);
}

function darkening(before: Rgb, after: Rgb): number {
  return before.reduce(
    (sum, channel, index) => sum + channel - after[index],
    0,
  );
}

const THEMES: readonly ThemeName[] = ["dark", "light"];
const KINDS: readonly Kind[] = ["dialog", "frame"];

for (const theme of THEMES) {
  test.describe(`in the ${theme} theme`, () => {
    test.beforeEach(async () => {
      const page = getPage();
      await configureCanvas(page, {
        tabs: "top",
        collapsed: false,
        dock: "right",
        session: false,
      });
      await setThemeAndWait(page, theme);
      await probe(page, "activateEpicTab('fixture-epsilon')");
      await waitUntil(
        page,
        `document.querySelector(${JSON.stringify(JOINED_TAB)}) !== null
          && document.querySelector('[data-sheet-join-bridge="top"][data-join-active]') !== null`,
      );
      await waitForFiniteAnimations(page);
    });

    for (const kind of KINDS) {
      test(`${KIND_NAME[kind]} dims the joined tab like the sheet under it`, async () => {
        const page = getPage();

        // The premise: with no modal the tab is the sheet's fill, so a
        // difference under a modal can only be the modal's dim.
        const points = await locateSamplePoints(page);
        const bare = await sampleTabAndSheet(page, points);
        expect(
          sameRgb(bare.tab, bare.sheet, SAME_FILL_TOLERANCE),
          `no modal: tab ${rgbText(bare.tab)} is the sheet's ${rgbText(bare.sheet)}`,
        ).toBe(true);

        await openAndSettle(page, kind);
        const dimmed = await sampleTabAndSheet(page, points);
        expect(
          darkening(bare.sheet, dimmed.sheet),
          `the ${kind} backdrop darkens the sheet (${rgbText(bare.sheet)} to ${rgbText(dimmed.sheet)})`,
        ).toBeGreaterThanOrEqual(MIN_DARKENING);
        expect(
          sameRgb(dimmed.tab, dimmed.sheet, SAME_FILL_TOLERANCE),
          `${kind} modal open: tab ${rgbText(dimmed.tab)} is the dimmed sheet's ${rgbText(dimmed.sheet)}`,
        ).toBe(true);
        expect(
          darkening(bare.tab, dimmed.tab),
          `the ${kind} backdrop darkens the joined tab (${rgbText(bare.tab)} to ${rgbText(dimmed.tab)})`,
        ).toBeGreaterThanOrEqual(MIN_DARKENING);

        await closeAndSettle(page);
        const closed = await sampleTabAndSheet(page, points);
        expect(
          sameRgb(closed.tab, bare.tab, SAME_FILL_TOLERANCE),
          `modal closed: tab ${rgbText(closed.tab)} is back to ${rgbText(bare.tab)}`,
        ).toBe(true);
      });
    }
  });
}
