import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi, type Mock } from "vitest";

// Upstream @xterm/addon-canvas@0.7.0 `TextureAtlas` page `clear()` forgot to
// reset the page's glyph list, so every atlas clear followed by a redraw
// appended every visible glyph again (an unbounded heap leak, ~125 entries per
// terminal reveal). patches/@xterm%2Faddon-canvas@0.7.0.patch fixes it; this
// test executes the SHIPPED method body so a lost or drifted patch fails.

const require = createRequire(import.meta.url);
const bundlePath = require.resolve("@xterm/addon-canvas");

interface FakeRow {
  readonly id: number;
}

interface FakeGlyph {
  readonly code: number;
}

interface FakePage {
  ctx: {
    clearRect: Mock<(x: number, y: number, w: number, h: number) => void>;
  };
  canvas: { width: number; height: number };
  currentRow: { x: number; y: number; height: number };
  fixedRows: FakeRow[];
  _glyphs: FakeGlyph[];
  _usedPixels: number;
  version: number;
}

// The atlas page class is not exported from the minified UMD bundle, so its
// method can only be reached by slicing the source text and rebuilding it with
// `vm.runInNewContext` (the same as `new Function`, minus the implied-eval lint). The body of `clear()` has no nested braces, so a simple
// pattern isolates it.
function findPageClearBodies(source: string): string[] {
  const bodies: string[] = [];
  const pattern = /clear\(\)\{(this\.ctx\.clearRect\([^{}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const body = match[1];
    if (body.includes("this.fixedRows.length=0")) {
      bodies.push(body);
    }
  }
  return bodies;
}

function callWithThis(source: string, thisArg: FakePage): void {
  const value: unknown = runInNewContext(source);
  if (typeof value !== "function") {
    throw new Error("atlas page clear() did not evaluate to a function");
  }
  Reflect.apply(value, thisArg, []);
}

describe("xterm canvas atlas page clear() drops its glyph list (patched upstream leak)", () => {
  it("resets glyphs, used pixels, rows and bumps the version", () => {
    const bodies = findPageClearBodies(readFileSync(bundlePath, "utf8"));
    expect(bodies).toHaveLength(1);
    const body = bodies[0];

    const page: FakePage = {
      ctx: { clearRect: vi.fn() },
      canvas: { width: 512, height: 512 },
      currentRow: { x: 7, y: 9, height: 3 },
      fixedRows: [{ id: 1 }, { id: 2 }],
      _glyphs: [{ code: 65 }, { code: 66 }, { code: 67 }],
      _usedPixels: 1234,
      version: 1,
    };

    callWithThis(`(function(){${body}})`, page);

    expect(page.ctx.clearRect).toHaveBeenCalledWith(0, 0, 512, 512);
    expect(page._glyphs).toEqual([]);
    expect(page._usedPixels).toBe(0);
    expect(page.currentRow).toEqual({ x: 0, y: 0, height: 0 });
    expect(page.fixedRows).toHaveLength(0);
    expect(page.version).toBe(2);
  });
});
