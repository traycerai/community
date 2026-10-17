import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MockRunnerHost } from "@traycer-clients/shared/host-client/mock/mock-runner-host";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostUnresponsivePrompt } from "@/components/layout/bridges/host-unresponsive-prompt";
import { Toaster } from "@/components/ui/sonner";
import { RunnerHostContext } from "@/providers/runner-host-context";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

const TITLE = "Host is not responding. Force restart?";

function createRunnerHost(): MockRunnerHost {
  return new MockRunnerHost({
    signInUrl: "https://auth.example/sign-in",
    authnBaseUrl: "https://auth.example",
    localHost: null,
    hosts: [],
    workspaceFolderPickerPaths: undefined,
    hasLocalHost: undefined,
    traycerCli: undefined,
  });
}

function renderPrompt(host: MockRunnerHost): { readonly rerender: () => void } {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const tree = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <RunnerHostContext.Provider value={host}>
        <HostUnresponsivePrompt />
        <Toaster />
      </RunnerHostContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
}

afterEach(() => {
  cleanup();
});

describe("<HostUnresponsivePrompt />", () => {
  it("shows nothing while the host is not reported unresponsive", () => {
    const host = createRunnerHost();
    renderPrompt(host);

    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Force restart" })).toBeNull();
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });

  it("offers a force restart naming how long the host has been silent", async () => {
    const host = createRunnerHost();
    renderPrompt(host);

    act(() => {
      host.setLocalHostUnresponsive({
        pid: 4242,
        unreachableForMs: 12 * 60_000,
      });
    });

    expect(await screen.findByText(TITLE)).not.toBeNull();
    expect(screen.getByText(/12 min/)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Force restart" }),
    ).not.toBeNull();
  });

  it("requests one host respawn when the person chooses Force restart", async () => {
    const host = createRunnerHost();
    renderPrompt(host);
    act(() => {
      host.setLocalHostUnresponsive({
        pid: 4242,
        unreachableForMs: 12 * 60_000,
      });
    });

    const button = await screen.findByRole("button", { name: "Force restart" });
    expect(host.requestHostRespawnCalls).toBe(0);
    fireEvent.click(button);

    await waitFor(() => {
      expect(host.requestHostRespawnCalls).toBe(1);
    });
  });

  it("withdraws the offer when the shell reports the host answering again", async () => {
    const host = createRunnerHost();
    renderPrompt(host);
    act(() => {
      host.setLocalHostUnresponsive({
        pid: 4242,
        unreachableForMs: 12 * 60_000,
      });
    });
    expect(await screen.findByText(TITLE)).not.toBeNull();

    act(() => {
      host.setLocalHostUnresponsive(null);
    });

    await waitFor(() => {
      expect(screen.queryByText(TITLE)).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Force restart" }),
      ).toBeNull();
    });
  });

  it("keeps an open offer through a re-render, and Force restart still requests one respawn", async () => {
    const host = createRunnerHost();
    const view = renderPrompt(host);
    act(() => {
      host.setLocalHostUnresponsive({
        pid: 4242,
        unreachableForMs: 12 * 60_000,
      });
    });
    expect(await screen.findByText(TITLE)).not.toBeNull();

    act(() => {
      view.rerender();
    });
    expect(screen.queryByText(TITLE)).not.toBeNull();

    fireEvent.click(
      await screen.findByRole("button", { name: "Force restart" }),
    );
    await waitFor(() => {
      expect(host.requestHostRespawnCalls).toBe(1);
    });
  });
});
