import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxFrame } from "@/components/sandbox/sandbox-frame";
import type { SandboxStatus } from "@/lib/sandbox/bridge-host";
import { useThemeLibraryStore } from "@/stores/settings/theme-library-store";

const { openLink } = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock("@/lib/links/open-link", () => ({ useOpenLink: () => openLink }));

afterEach(() => {
  cleanup();
  openLink.mockReset();
});

function frameWindow(): Window {
  const iframe = document.querySelector("iframe");
  const win = iframe?.contentWindow ?? null;
  if (win === null) throw new Error("no frame window");
  return win;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A message as the frame's own window posts it. */
function fromFrame(data: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data, source: frameWindow() }),
    );
  });
}

const PROXY_READY = {
  jsonrpc: "2.0",
  method: "ui/notifications/sandbox-proxy-ready",
  params: {},
};

describe("<SandboxFrame /> link confirm", () => {
  it("takes the confirm down when the bridge is disposed under it", () => {
    const statuses: SandboxStatus[] = [];
    render(
      <SandboxFrame
        html="<p>page</p>"
        kind="page"
        title="Page"
        appName={null}
        networkPolicy="open"
        appCsp={null}
        permissions={[]}
        appRequests={null}
        className=""
        height={null}
        onSize={() => undefined}
        onStatus={(status) => statuses.push(status)}
        onRequestTeardown={() => undefined}
        displayMode="inline"
        onBridge={null}
        ref={null}
      />,
    );
    fromFrame(PROXY_READY);
    fromFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/open-link",
      params: { url: "https://example.com/a" },
    });
    expect(screen.getByRole("dialog").textContent).toContain(
      "https://example.com/a",
    );

    // The loader coming back disposes the bridge; the frame stays mounted.
    fromFrame(PROXY_READY);
    expect(statuses).toContain("disposed");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openLink).not.toHaveBeenCalled();
  });
});

describe("<SandboxFrame /> theme", () => {
  afterEach(() => {
    act(() => {
      useThemeLibraryStore.setState({ contrast: 100 });
    });
  });

  it("sends the live page new theme variables when the cascade changes under the same mode", () => {
    render(
      <SandboxFrame
        html="<p>page</p>"
        kind="page"
        title="Page"
        appName={null}
        networkPolicy="open"
        appCsp={null}
        permissions={[]}
        appRequests={null}
        className=""
        height={null}
        onSize={() => undefined}
        onStatus={() => undefined}
        onRequestTeardown={() => undefined}
        displayMode="inline"
        onBridge={null}
        ref={null}
      />,
    );
    const posted = vi.spyOn(frameWindow(), "postMessage");
    const postedRecords = (): Record<string, unknown>[] =>
      posted.mock.calls.flatMap((call) => {
        const message: unknown = call[0];
        return isRecord(message) ? [message] : [];
      });
    fromFrame(PROXY_READY);
    // The page proves it holds this frame's nonce, which only the delivered
    // resource carries; that is what makes the bridge ready.
    const delivered = postedRecords().find(
      (message) => message.method === "ui/notifications/sandbox-resource-ready",
    );
    const nonce = isRecord(delivered?.params)
      ? delivered.params.nonce
      : undefined;
    expect(typeof nonce).toBe("string");
    fromFrame({
      jsonrpc: "2.0",
      method: "traycer/notifications/document-ready",
      params: { nonce },
    });
    posted.mockClear();

    // Same light mode, same preset: only the contrast the cascade is built
    // with moves, which rewrites `--foreground` on the root.
    act(() => {
      useThemeLibraryStore.setState({ contrast: 70 });
    });

    const contextChanges = postedRecords().filter(
      (message) => message.method === "ui/notifications/host-context-changed",
    );
    expect(contextChanges).toHaveLength(1);
    expect(JSON.stringify(contextChanges[0])).toContain("--color-text-primary");
  });
});
