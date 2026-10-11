// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { reactCompiler } from "../vite/react-compiler";

const root = mkdtempSync(join(tmpdir(), "react-compiler-guard-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Runs one source file through the real compiler pass, as a build does. */
async function compile(name: string, source: string): Promise<string> {
  const entry = join(root, name);
  writeFileSync(entry, source);
  const output = await build({
    configFile: false,
    logLevel: "silent",
    root,
    plugins: [reactCompiler()],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["es"] },
      rolldownOptions: { external: [/^react/] },
    },
  });
  const chunks = Array.isArray(output) ? output : [output];
  return chunks
    .flatMap((result) => ("output" in result ? result.output : []))
    .map((chunk) => ("code" in chunk ? chunk.code : ""))
    .join("\n");
}

describe("the React Compiler pass", () => {
  it("compiles a component from source, a ref on an element included", async () => {
    const code = await compile(
      "plain.tsx",
      `import { useRef } from "react";
       export function Plain(props: { readonly label: string }) {
         const ref = useRef<HTMLDivElement>(null);
         return <div ref={ref}>{props.label}</div>;
       }`,
    );
    // The memo cache is what a compiled function opens with.
    expect(code).toContain("react/compiler-runtime");
  });

  it("stops on a closure the compiler moved out of the scope of what it reads", async () => {
    // The compiler bug itself: `slot` belongs to `makeWrapper`, and the
    // closure that reads it is moved to module scope.
    await expect(
      compile(
        "nested.tsx",
        `import { useSyncExternalStore } from "react";
         export function makeWrapper() {
           const slot = { current: 1 };
           const Wrapper = (props: { readonly children: React.ReactNode }) => {
             const value = useSyncExternalStore(
               () => () => undefined,
               () => slot.current,
             );
             return <div data-value={value}>{props.children}</div>;
           };
           return Wrapper;
         }`,
      ),
    ).rejects.toThrow(/reads `slot` from a scope where it is not defined/);
  });

  it("stops on a compiled component declared inside a function, in product code", async () => {
    // Captures nothing, so it runs today; the shape is what is refused.
    await expect(
      compile(
        "factory.tsx",
        `import { useState } from "react";
         export function makeCounter() {
           const Counter = () => {
             const [count] = useState(0);
             return <span>{count}</span>;
           };
           return Counter;
         }`,
      ),
    ).rejects.toThrow(/is declared inside another function/);
  });
});
