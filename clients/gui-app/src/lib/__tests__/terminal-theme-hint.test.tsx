import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTerminalThemeHint } from "@/lib/terminal-theme-hint";
import { ThemeProvider } from "@/providers/theme-provider";
import { useSettingsStore } from "@/stores/settings/settings-store";
import { useThemeLibraryStore } from "@/stores/settings/theme-library-store";

function resetThemeStores(): void {
  window.localStorage.clear();
  useThemeLibraryStore.setState({
    version: 2,
    themes: [],
    selected: { light: null, dark: null },
    draft: null,
    error: null,
  });
  useSettingsStore.setState({ theme: "dark", themePreset: "neutral" });
}

function Wrapper(props: { readonly children: ReactNode }) {
  return <ThemeProvider>{props.children}</ThemeProvider>;
}

describe("useTerminalThemeHint", () => {
  beforeEach(resetThemeStores);
  afterEach(() => {
    cleanup();
    resetThemeStores();
  });

  it("follows a preset change made under the same light or dark mode", () => {
    const { result } = renderHook(() => useTerminalThemeHint(), {
      wrapper: Wrapper,
    });
    const before = result.current;
    expect(before.appearance).toBe("dark");

    act(() => {
      useSettingsStore.getState().setThemePreset("nord");
    });

    expect(result.current.appearance).toBe("dark");
    expect(result.current.background).not.toBe(before.background);
  });
});
