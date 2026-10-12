import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTerminalTheme } from "@/lib/terminal-theme";
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
  useSettingsStore.setState({ theme: "light", themePreset: "neutral" });
}

function Wrapper(props: { readonly children: ReactNode }) {
  return <ThemeProvider>{props.children}</ThemeProvider>;
}

describe("useTerminalTheme", () => {
  beforeEach(resetThemeStores);
  afterEach(() => {
    cleanup();
    resetThemeStores();
  });

  it("returns a rebuilt xterm theme after the app theme changes", () => {
    const { result } = renderHook(() => useTerminalTheme(), {
      wrapper: Wrapper,
    });
    const light = result.current;

    act(() => {
      useSettingsStore.getState().setTheme("dark");
    });
    const dark = result.current;
    expect(dark).not.toBe(light);
    expect(dark.background).not.toBe(light.background);

    act(() => {
      useSettingsStore.getState().setTheme("light");
    });
    expect(result.current.background).toBe(light.background);
  });
});
