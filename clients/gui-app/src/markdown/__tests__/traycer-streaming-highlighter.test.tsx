import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  StreamingMarkdown,
  useThrottledHighlight,
  type StreamingHighlighter,
} from "@tailmark/react";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import { TabBodySelectedContext } from "@/components/epic-canvas/canvas/tab-body-selected-context";
import { PaneVisibilityContext } from "@/components/epic-tabs/pane-visibility-context";
import { CodeBlock, PreBlock } from "@/markdown/components/code-block";
import * as shikiHighlighter from "@/markdown/shiki-highlighter";
import {
  getOrCreateHighlighter,
  MAX_HIGHLIGHT_CHARS,
} from "@/markdown/shiki-highlighter";
import {
  highlightCacheSizeForTests,
  resetHighlightCacheForTests,
} from "@/markdown/shiki-highlight-cache";
import {
  createTraycerBlockHighlighter,
  getTraycerStreamingHighlighter,
  resetTraycerStreamingHighlighterForTests,
} from "@/markdown/traycer-streaming-highlighter";

// The real curated-core highlighter doubles as a smoke test of the
// `shiki/core` + explicit-grammar setup (no full-bundle registry).
beforeAll(async () => {
  await getOrCreateHighlighter();
});

beforeEach(() => {
  resetHighlightCacheForTests();
});

// React reports an invalid DOM property once per process, at the first render
// that has it, so a test that renders late would find the warning already
// spent. Every message this file's renders print is therefore kept from the
// start, and passed through unchanged. (Not `vi.spyOn`: the suite's
// `restoreAllMocks` would drop it after the first test.)
const consoleErrors: string[] = [];
const printConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]): void => {
    consoleErrors.push(args.map(String).join(" "));
    printConsoleError(...args);
  };
});
afterAll(() => {
  console.error = printConsoleError;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function highlighter(): StreamingHighlighter {
  return getTraycerStreamingHighlighter();
}

// Wait until the adapter has a ready core + active theme so highlight() works.
async function waitForReady(): Promise<void> {
  const hl = highlighter();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsub();
      reject(new Error("streaming highlighter readiness timed out"));
    }, 10_000);
    const unsub = hl.subscribe(() => {
      const sample = hl.highlight("const x = 1;", "ts");
      if (sample !== null) {
        window.clearTimeout(timeout);
        unsub();
        resolve();
      }
    });
    // Synchronous path if already ready.
    if (hl.highlight("const x = 1;", "ts") !== null) {
      window.clearTimeout(timeout);
      unsub();
      resolve();
    }
  });
}

describe("curated core highlighter (smoke)", () => {
  it("loads only the active preset's theme pair and the curated grammars", async () => {
    const core = await getOrCreateHighlighter();
    const themes = core.getLoadedThemes();
    expect(themes).toHaveLength(2);
    expect(themes).toContain("github-dark");
    expect(themes).toContain("github-light");

    const langs = core.getLoadedLanguages();
    expect(langs).toContain("typescript");
    expect(langs).toContain("make");
    // Registered aliases resolve for free.
    expect(langs).toContain("ts");
    expect(langs).toContain("sh");
    expect(langs).toContain("c#");
    expect(langs).toContain("yml");
    // Out-of-set grammars are NOT registered.
    expect(langs).not.toContain("haskell");
  });
});

describe("Traycer StreamingHighlighter adapter", () => {
  it("highlights settled blocks and writes the theme-aware cache once", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const hl = highlighter();

    const first = hl.highlight("const a = 1;", "ts");
    expect(first).not.toBeNull();
    if (first === null) return;
    hl.setCached("const a = 1;", "ts", first);
    expect(highlightCacheSizeForTests()).toBe(1);
    const firstCalls = codeToHtml.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);

    // Cache hit - no extra codeToHtml.
    expect(hl.getCached("const a = 1;", "ts")).toBe(first.node);
    expect(codeToHtml.mock.calls.length).toBe(firstCalls);
  });

  it("renders out-of-set languages as plain (null) without caching", async () => {
    await waitForReady();
    const hl = highlighter();
    expect(hl.highlight("main = putStrLn", "haskell")).toBeNull();
    expect(highlightCacheSizeForTests()).toBe(0);
  });

  it("skips highlighting past the char cap", async () => {
    await waitForReady();
    const hl = highlighter();
    expect(hl.highlight("x".repeat(MAX_HIGHLIGHT_CHARS + 1), "ts")).toBeNull();
    expect(highlightCacheSizeForTests()).toBe(0);
  });
});

/** A fresh, code-content-unique >=4096-char fixture per test, so block keys never collide. */
function bigCodeFixture(tag: string): string {
  return `const streamingHighlighterDeferredFixture_${tag} = 1;\n`.repeat(120);
}

describe("Traycer StreamingHighlighter adapter - deferred large blocks (block-owned)", () => {
  it("defers a >=4096-char cold miss for a subscribed block, settles the transient result exactly once, and never writes it into the settled cache on its own", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const bigCode = bigCodeFixture("settle");
    expect(bigCode.length).toBeGreaterThanOrEqual(4096);
    const block = createTraycerBlockHighlighter(bigCode, "ts", false, {
      node: null,
    });

    const onReadyChange = vi.fn();
    const unsubscribe = block.subscribe(onReadyChange);
    // Subscribing commits ownership but does not itself schedule work - only
    // Tailmark's own highlight() call (here, ours standing in for it) does,
    // so a subscribed-but-unqueried block never pays for work nobody asked for.
    const callsAtSubscribe = onReadyChange.mock.calls.length;

    const miss = block.highlight(bigCode, "ts");
    expect(miss).toBeNull();
    // The highlight pipeline must not run inside the caller's own task -
    // only the idle/timeout deferral is allowed to invoke it.
    expect(codeToHtml).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(codeToHtml).toHaveBeenCalledTimes(1);
    });
    // Completion notifies subscribers (a SEPARATE notify from the eager one
    // subscribeBlock may have already fired) so Tailmark re-renders and re-asks.
    await waitFor(() => {
      expect(onReadyChange.mock.calls.length).toBeGreaterThan(callsAtSubscribe);
    });

    const settled = block.highlight(bigCode, "ts");
    expect(settled).not.toBeNull();
    // Handed back from the transient slot, not recomputed.
    expect(codeToHtml).toHaveBeenCalledTimes(1);
    expect(block.highlight(bigCode, "ts")).toBe(settled);

    // A streaming intermediate never lands in the settled cache on its own -
    // only Tailmark's own setCached() call (on genuine settle) does that.
    expect(block.getCached(bigCode, "ts")).toBeNull();
    expect(highlightCacheSizeForTests()).toBe(0);

    if (settled === null) return;
    block.setCached(bigCode, "ts", settled);
    expect(block.getCached(bigCode, "ts")).toBe(settled.node);
    expect(highlightCacheSizeForTests()).toBe(1);

    unsubscribe();
  });

  it("returns null without scheduling any work when nothing has subscribed for the block yet", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const bigCode = bigCodeFixture("unowned");
    const block = createTraycerBlockHighlighter(bigCode, "ts", false, {
      node: null,
    });

    expect(block.highlight(bigCode, "ts")).toBeNull();
    // Give a not-actually-scheduled idle/timeout callback a chance to prove
    // itself wrong before trusting the call count.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(codeToHtml).not.toHaveBeenCalled();
  });

  it("cancels a large block's queued job when its only owner unsubscribes before idle", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const bigCode = bigCodeFixture("solo-cancel");
    const block = createTraycerBlockHighlighter(bigCode, "ts", false, {
      node: null,
    });

    const unsubscribe = block.subscribe(vi.fn());
    expect(block.highlight(bigCode, "ts")).toBeNull();
    unsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(codeToHtml).not.toHaveBeenCalled();
  });

  it("keeps a shared block job alive when one of several owners leaves early, and the survivor still gets the completed result", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const bigCode = bigCodeFixture("shared-survive");
    // Two independently-mounted adapters for the SAME source+lang - the
    // realistic shape of two CodeBlock instances rendering identical code.
    const blockA = createTraycerBlockHighlighter(bigCode, "ts", false, {
      node: null,
    });
    const blockB = createTraycerBlockHighlighter(bigCode, "ts", false, {
      node: null,
    });

    const unsubA = blockA.subscribe(vi.fn());
    const unsubB = blockB.subscribe(vi.fn());
    expect(blockA.highlight(bigCode, "ts")).toBeNull();

    unsubA();
    await waitFor(() => {
      expect(codeToHtml).toHaveBeenCalledTimes(1);
    });
    expect(blockB.highlight(bigCode, "ts")).not.toBeNull();

    unsubB();
  });

  it("notifies only the owners of the block whose queued job ran, not every mounted block", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    // Hand-driven idle queue: the test decides which block's job runs.
    const idleQueue: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idleQueue.push(callback);
      return idleQueue.length;
    });
    vi.stubGlobal("cancelIdleCallback", () => undefined);
    try {
      const codeA = bigCodeFixture("fanout-a");
      const codeB = bigCodeFixture("fanout-b");
      const blockA = createTraycerBlockHighlighter(codeA, "ts", false, {
        node: null,
      });
      const blockB = createTraycerBlockHighlighter(codeB, "ts", false, {
        node: null,
      });
      const onReadyA = vi.fn();
      const onReadyB = vi.fn();
      const unsubA = blockA.subscribe(onReadyA);
      const unsubB = blockB.subscribe(onReadyB);
      expect(blockA.highlight(codeA, "ts")).toBeNull();
      expect(blockB.highlight(codeB, "ts")).toBeNull();
      expect(idleQueue).toHaveLength(2);
      // Subscribing a cold block fires its own eager retry, and a boot may
      // still be settling: clear both before the one job under test runs.
      onReadyA.mockClear();
      onReadyB.mockClear();
      codeToHtml.mockClear();

      const runNextIdleJob = (): void => {
        const job = idleQueue.shift();
        if (job === undefined) throw new Error("no queued idle job");
        job({ didTimeout: false, timeRemaining: () => 0 });
      };
      runNextIdleJob();

      expect(codeToHtml).toHaveBeenCalledTimes(1);
      expect(onReadyA).toHaveBeenCalled();
      expect(onReadyB).not.toHaveBeenCalled();
      const settledA = blockA.highlight(codeA, "ts");
      expect(settledA).not.toBeNull();

      runNextIdleJob();
      expect(codeToHtml).toHaveBeenCalledTimes(2);
      expect(onReadyB).toHaveBeenCalled();
      const settledB = blockB.highlight(codeB, "ts");
      expect(settledB).not.toBeNull();

      // Tailmark settles both: that retires each transient slot, whose
      // cancel handle would otherwise outlive the stubbed idle API.
      if (settledA !== null) blockA.setCached(codeA, "ts", settledA);
      if (settledB !== null) blockB.setCached(codeB, "ts", settledB);
      unsubA();
      unsubB();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("useThrottledHighlight + Traycer adapter", () => {
  it("highlights settled blocks synchronously through the adapter cache", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const hl = highlighter();

    const { result, rerender } = renderHook(
      ({ code }: { code: string }) => useThrottledHighlight(code, "ts", hl),
      { initialProps: { code: "const a = 1;" } },
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    // Effect-time cache write for settled renders.
    await waitFor(() => {
      expect(highlightCacheSizeForTests()).toBe(1);
    });
    const firstCalls = codeToHtml.mock.calls.length;

    rerender({ code: "const a = 1;" });
    expect(result.current).not.toBeNull();
    expect(codeToHtml.mock.calls.length).toBe(firstCalls);
  });
});

describe("real StreamingMarkdown + CodeBlock (streaming throttle integration)", () => {
  function fence(code: string): string {
    return "```ts\n" + code + "\n```";
  }

  // `CodeBlockProps` carries its own `[key: string]: unknown` index
  // signature (for pass-through markdown-node props), which react-markdown's
  // own `Components["code"]` shape does not - so the plain function isn't
  // structurally assignable. Cast once, same as production's
  // `DEFAULT_COMPONENTS` in traycer-markdown.tsx.
  const streamingMarkdownComponents = {
    code: CodeBlock as Components["code"],
    pre: PreBlock as Components["pre"],
  };

  it("never lets an abandoned mid-stream >=4096-char source reach codeToHtml, and throttles the surviving one until its own trailing-edge timer fires", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    // Distinct marker lines, not just distinct lengths: react-markdown's fence
    // extraction can add/normalize a trailing newline, so an exact-string
    // comparison against the source is fragile - a content marker is not.
    const midMarker = "const streamingHighlighterIntegrationFixtureMID = 1;\n";
    const finalMarker =
      "const streamingHighlighterIntegrationFixtureFINAL = 1;\n";
    // Both snapshots cross the 4096 ownership-gated threshold, matching a
    // real streamed diagram/code fence rather than the small synchronous path.
    const midCode = midMarker.repeat(90);
    const finalCode = finalMarker.repeat(150);
    expect(midCode.length).toBeGreaterThanOrEqual(4096);
    expect(finalCode.length).toBeGreaterThanOrEqual(4096);

    vi.useFakeTimers();
    try {
      const { rerender, unmount } = render(
        <StreamingMarkdown isStreaming components={streamingMarkdownComponents}>
          {fence(midCode)}
        </StreamingMarkdown>,
      );

      // Still inside the throttle window right after mount - nothing highlighted.
      expect(codeToHtml).not.toHaveBeenCalled();

      // A second source change lands before the first throttle window elapses -
      // this is the exact shape of the regression this suite protects: ownership
      // must move to the new source without ever paying for the abandoned one.
      rerender(
        <StreamingMarkdown isStreaming components={streamingMarkdownComponents}>
          {fence(finalCode)}
        </StreamingMarkdown>,
      );
      expect(codeToHtml).not.toHaveBeenCalled();

      // Well short of the 150ms trailing-edge throttle - a regressed "eager
      // subscribe" path (calling highlight() the moment ownership commits,
      // instead of waiting on Tailmark's own throttled retry) would already
      // have scheduled and completed a deferred job by here; the correct
      // path has not even asked the highlighter yet.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(codeToHtml).not.toHaveBeenCalled();

      // Past the throttle delay plus the idle/timeout fallback.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(codeToHtml).toHaveBeenCalled();
      expect(codeToHtml.mock.calls.some(([c]) => c.includes(finalMarker))).toBe(
        true,
      );
      expect(codeToHtml.mock.calls.some(([c]) => c.includes(midMarker))).toBe(
        false,
      );

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

// A fence's highlighted body is the only element carrying this class; the
// plain fallback is a bare <pre>.
const HIGHLIGHTED_BODY = ".traycer-md-shiki";

const markdownComponents = {
  code: CodeBlock as Components["code"],
  pre: PreBlock as Components["pre"],
};

function tsFence(code: string): string {
  return "```ts\n" + code + "\n```";
}

describe("CodeBlock under a streaming message that grows past the large-block threshold", () => {
  it("stays highlighted on every Tailmark throttle tick, and ends on the final text", async () => {
    await waitForReady();
    const row = (tag: string): string =>
      `const streamedTickFixture_${tag} = 1;\n`;
    const small = row("SMALL").repeat(40);
    const medium = row("MEDIUM").repeat(130);
    const finalMarker = "streamedTickFixture_FINAL";
    const large = row("FINAL").repeat(220);
    expect(small.length).toBeLessThan(4096);
    expect(medium.length).toBeGreaterThanOrEqual(4096);

    vi.useFakeTimers();
    try {
      const streaming = (code: string): ReactNode => (
        <StreamingMarkdown isStreaming components={markdownComponents}>
          {tsFence(code)}
        </StreamingMarkdown>
      );
      const { container, rerender, unmount } = render(streaming(small));
      const highlighted = (): Element | null =>
        container.querySelector(HIGHLIGHTED_BODY);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(highlighted()).not.toBeNull();

      for (const code of [medium, large]) {
        rerender(streaming(code));
        // One tick: long enough for Tailmark's throttle to run on this
        // source, short of the extra retry a deferred completion would earn.
        // A block that goes plain at the tick and only recovers at that retry
        // flickers on every token.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
        expect(highlighted()).not.toBeNull();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(400);
        });
      }

      expect(highlighted()?.textContent).toContain(finalMarker);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

function TileBody(props: {
  readonly visible: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <PaneVisibilityContext.Provider value={props.visible}>
      <TabBodySelectedContext.Provider value>
        {props.children}
      </TabBodySelectedContext.Provider>
    </PaneVisibilityContext.Provider>
  );
}

describe("CodeBlock while its tile body is hidden", () => {
  function settled(code: string, visible: boolean): ReactNode {
    return (
      <TileBody visible={visible}>
        <StreamingMarkdown isStreaming={false} components={markdownComponents}>
          {tsFence(code)}
        </StreamingMarkdown>
      </TileBody>
    );
  }

  it("keeps an already highlighted block's DOM through a hide, and tokenizes nothing when it is shown again", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const code = "const hideShowFixture = 1;\nconst second = 2;";
    const { container, rerender } = render(settled(code, true));
    await waitFor(() => {
      expect(container.querySelector(HIGHLIGHTED_BODY)).not.toBeNull();
    });
    const body = container.querySelector(HIGHLIGHTED_BODY);
    const codeToHtml = vi.spyOn(core, "codeToHtml");

    rerender(settled(code, false));
    // Hidden is not "plain": the block a reader left is the block still there.
    expect(container.querySelector(HIGHLIGHTED_BODY)).toBe(body);

    rerender(settled(code, true));
    expect(container.querySelector(HIGHLIGHTED_BODY)).toBe(body);
    expect(codeToHtml).not.toHaveBeenCalled();
  });

  it("does no tokenization for a large cold block that mounts hidden, and highlights it once shown", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const bigCode = bigCodeFixture("hidden-cold");

    vi.useFakeTimers();
    try {
      const { container, rerender, unmount } = render(settled(bigCode, false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(codeToHtml).not.toHaveBeenCalled();
      expect(container.querySelector(HIGHLIGHTED_BODY)).toBeNull();

      rerender(settled(bigCode, true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(codeToHtml).toHaveBeenCalled();
      expect(container.querySelector(HIGHLIGHTED_BODY)).not.toBeNull();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a large block's queued tokenization when its tile is hidden before the work runs", async () => {
    await waitForReady();
    const core = await getOrCreateHighlighter();
    const codeToHtml = vi.spyOn(core, "codeToHtml");
    const bigCode = bigCodeFixture("hide-before-idle");

    vi.useFakeTimers();
    try {
      // Visible: the block's work is queued for idle time, not yet run.
      const { rerender, unmount } = render(settled(bigCode, true));
      rerender(settled(bigCode, false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(codeToHtml).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CodeBlock hidden and shown again while its message streams", () => {
  // A highlighted block is never swapped for its plain form while a newer
  // highlight is on its way: the reader sees the highlighted prefix on every
  // frame, hidden or not, until the latest text's own highlight lands. The
  // case that broke it: the tile is hidden, the text keeps growing (so the
  // block's highlighter is rebuilt for every new text), a throttle tick runs
  // against the hidden stand-in and finds nothing, and the block goes plain.
  const row = (index: number): string =>
    `const hiddenGrowthFixture_${index} = ${index};\n`;
  const rowsOf = (count: number): string =>
    Array.from({ length: count }, (_, index) => row(index)).join("");

  it.each([
    { name: "below the large-block threshold", startRows: 20 },
    { name: "above the large-block threshold", startRows: 120 },
  ])(
    "keeps the highlighted prefix on every frame of a streamed block $name",
    async ({ startRows }) => {
      await waitForReady();
      expect(rowsOf(startRows).length < 4096).toBe(startRows < 100);

      vi.useFakeTimers();
      try {
        const streaming = (rows: number, visible: boolean): ReactNode => (
          <TileBody visible={visible}>
            <StreamingMarkdown isStreaming components={markdownComponents}>
              {tsFence(rowsOf(rows))}
            </StreamingMarkdown>
          </TileBody>
        );
        const { container, rerender, unmount } = render(
          streaming(startRows, true),
        );
        const highlighted = (): Element | null =>
          container.querySelector(HIGHLIGHTED_BODY);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        expect(highlighted()).not.toBeNull();

        // Hidden for ~1.2s while the text grows in bursts: each burst is
        // followed by silence long enough for the throttle to tick.
        let rows = startRows;
        for (let burst = 0; burst < 3; burst += 1) {
          rows += 2;
          rerender(streaming(rows, false));
          expect(highlighted()).not.toBeNull();
          await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
          });
          expect(highlighted()).not.toBeNull();
        }

        // Shown again with yet more text, before any throttle tick: every
        // frame from here until the latest text's highlight arrives still
        // shows highlighted code, never the plain form.
        rows += 2;
        rerender(streaming(rows, true));
        expect(highlighted()).not.toBeNull();
        for (let frame = 0; frame < 40; frame += 1) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(16);
          });
          expect(highlighted()).not.toBeNull();
        }
        expect(highlighted()?.textContent).toContain(
          `hiddenGrowthFixture_${rows - 1}`,
        );
        unmount();
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("CodeBlock when its streamed message completes", () => {
  // Once a mounted block has shown highlighted code it never goes back to the
  // plain form while its settled highlight (deferred for a large block) is
  // still on its way: the reader keeps the highlighted prefix, then sees the
  // final text highlighted. The plain form is a frame with no highlighted span.
  const row = (index: number): string =>
    `const completionFixture_${index} = ${index};\n`;
  const rowsOf = (count: number): string =>
    Array.from({ length: count }, (_, index) => row(index)).join("");
  const STREAMED_ROWS = 140;
  // Final source carries extra characters the streamed prefix did not have.
  const FINAL_ROWS = 150;

  it.each([
    { name: "while its tile is visible", hideAtCompletion: false },
    { name: "while its tile is hidden, then shown", hideAtCompletion: true },
  ])(
    "never renders the block plain between the streamed prefix and the final highlight $name",
    async ({ hideAtCompletion }) => {
      await waitForReady();
      expect(rowsOf(STREAMED_ROWS).length).toBeGreaterThanOrEqual(4096);

      vi.useFakeTimers();
      try {
        const message = (
          rows: number,
          streaming: boolean,
          visible: boolean,
        ): ReactNode => (
          <TileBody visible={visible}>
            <StreamingMarkdown
              isStreaming={streaming}
              components={markdownComponents}
            >
              {tsFence(rowsOf(rows))}
            </StreamingMarkdown>
          </TileBody>
        );
        const { container, rerender, unmount } = render(
          message(STREAMED_ROWS, true, true),
        );
        const highlightedSpans = (): number =>
          container.querySelectorAll(`${HIGHLIGHTED_BODY} span`).length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });
        expect(highlightedSpans()).toBeGreaterThan(0);

        if (hideAtCompletion) {
          // The message completes while the tile is hidden: the settled pass
          // runs with nothing to highlight against.
          rerender(message(FINAL_ROWS, false, false));
          await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
          });
          expect(highlightedSpans()).toBeGreaterThan(0);
        }
        rerender(message(FINAL_ROWS, false, true));

        // The frame the completion commits, and every frame until the final
        // highlight lands.
        expect(highlightedSpans()).toBeGreaterThan(0);
        for (let frame = 0; frame < 60; frame += 1) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(16);
          });
          expect(highlightedSpans()).toBeGreaterThan(0);
        }

        // It does catch up: the highlighted block carries the final text.
        expect(
          container.querySelector(HIGHLIGHTED_BODY)?.textContent,
        ).toContain(`completionFixture_${FINAL_ROWS - 1}`);
        unmount();
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("Shiki markup rendered through trusted markup", () => {
  it("maps tabindex to React's tabIndex, so rendering it raises no invalid-property warning", async () => {
    await waitForReady();
    const { container, unmount } = render(
      <StreamingMarkdown isStreaming={false} components={markdownComponents}>
        {tsFence("const tabindexFixture = 1;")}
      </StreamingMarkdown>,
    );
    await waitFor(() => {
      expect(container.querySelector(HIGHLIGHTED_BODY)).not.toBeNull();
    });

    // Shiki puts `tabindex="0"` on the code's <pre> so it can be scrolled by
    // keyboard; it must reach the DOM as that attribute.
    const pre = container.querySelector(`${HIGHLIGHTED_BODY} pre`);
    expect(pre?.getAttribute("tabindex")).toBe("0");
    expect(
      consoleErrors.filter((message) => /tabindex/i.test(message)),
    ).toEqual([]);
    unmount();
  });
});

describe("TraycerStreamingHighlighter boot retry", () => {
  afterEach(() => {
    resetTraycerStreamingHighlighterForTests();
  });

  it("retries core load after a transient getOrCreateHighlighter failure", async () => {
    resetTraycerStreamingHighlighterForTests();
    const realCore = await getOrCreateHighlighter();
    const getOrCreate = vi
      .spyOn(shikiHighlighter, "getOrCreateHighlighter")
      .mockRejectedValueOnce(new Error("transient load failure"))
      .mockResolvedValue(realCore);
    vi.spyOn(shikiHighlighter, "ensureActiveThemePair").mockResolvedValue(
      undefined,
    );

    const hl = highlighter();
    expect(hl.highlight("const x = 1;", "ts")).toBeNull();
    await waitFor(() => {
      expect(getOrCreate).toHaveBeenCalledTimes(1);
    });
    // Failure cleared the latch; another call must try again.
    expect(hl.highlight("const x = 1;", "ts")).toBeNull();
    await waitFor(() => {
      expect(getOrCreate.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(hl.highlight("const x = 1;", "ts")).not.toBeNull();
    });
  });
});
