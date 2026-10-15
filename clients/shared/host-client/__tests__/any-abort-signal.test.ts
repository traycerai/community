import { afterEach, describe, expect, it, vi } from "vitest";
import { anyAbortSignal } from "../any-abort-signal";

const nativeAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");

function removeNativeAny(): void {
  Object.defineProperty(AbortSignal, "any", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  if (nativeAny === undefined) {
    Reflect.deleteProperty(AbortSignal, "any");
  } else {
    Object.defineProperty(AbortSignal, "any", nativeAny);
  }
});

describe("anyAbortSignal", () => {
  it("delegates to AbortSignal.any where the runtime has it", () => {
    const any = vi.spyOn(AbortSignal, "any");
    const first = new AbortController();
    const second = new AbortController();

    const signal = anyAbortSignal(first.signal, second.signal);

    expect(any).toHaveBeenCalledWith([first.signal, second.signal]);
    second.abort("gone");
    expect(signal.reason).toBe("gone");
  });

  describe("without AbortSignal.any", () => {
    it.each([
      ["first", "binding-replaced"],
      ["second", "context-aborted"],
    ] as const)("aborts with the %s source's reason", (which, reason) => {
      removeNativeAny();
      const first = new AbortController();
      const second = new AbortController();
      const signal = anyAbortSignal(first.signal, second.signal);
      expect(signal.aborted).toBe(false);

      (which === "first" ? first : second).abort(reason);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe(reason);
    });

    it("is already aborted when a source was aborted before", () => {
      removeNativeAny();
      const first = new AbortController();
      const second = new AbortController();
      second.abort("already-dead");

      const signal = anyAbortSignal(first.signal, second.signal);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe("already-dead");
    });

    it("shares one composed signal per source pair, so requests add no listeners", () => {
      removeNativeAny();
      const first = new AbortController();
      const second = new AbortController();
      const attachFirst = vi.spyOn(first.signal, "addEventListener");
      const attachSecond = vi.spyOn(second.signal, "addEventListener");

      const signals = Array.from({ length: 20 }, () =>
        anyAbortSignal(first.signal, second.signal),
      );

      expect(new Set(signals).size).toBe(1);
      expect(attachFirst).toHaveBeenCalledTimes(1);
      expect(attachSecond).toHaveBeenCalledTimes(1);
    });

    it("detaches from both sources once either aborts", () => {
      removeNativeAny();
      const first = new AbortController();
      const second = new AbortController();
      const detachFirst = vi.spyOn(first.signal, "removeEventListener");
      const detachSecond = vi.spyOn(second.signal, "removeEventListener");
      anyAbortSignal(first.signal, second.signal);

      first.abort("binding-replaced");

      expect(detachFirst).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(detachSecond).toHaveBeenCalledWith("abort", expect.any(Function));
    });
  });
});
