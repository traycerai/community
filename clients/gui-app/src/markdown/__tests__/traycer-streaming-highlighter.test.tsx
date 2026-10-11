import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
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
    const block = createTraycerBlockHighlighter(bigCode, "ts", false);

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
    const block = createTraycerBlockHighlighter(bigCode, "ts", false);

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
    const block = createTraycerBlockHighlighter(bigCode, "ts", false);

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
    const blockA = createTraycerBlockHighlighter(bigCode, "ts", false);
    const blockB = createTraycerBlockHighlighter(bigCode, "ts", false);

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
