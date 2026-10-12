import { reactCompilerPreset } from "@vitejs/plugin-react";

/**
 * What Vite's `PluginOption` asks of a plugin that was typed against another
 * copy of rolldown, which the Babel plugin is (it resolves its own).
 */
interface ReactCompilerPlugin {
  readonly name: string;
}

/**
 * # The React Compiler pass
 *
 * One function for every config that runs the compiler (the desktop renderer,
 * mobile, the test suite), so the three cannot drift apart.
 *
 * - It keeps the Babel plugin's own `enforce: "pre"`: the compiler has to
 *   read SOURCE. It knows a component by its JSX, so after the JSX transform
 *   it skips every component that has no hook or passes a ref, and under the
 *   dev transform every component (`jsxDEV` is handed `this`). Wrapping the
 *   plugin to `enforce: "post"` did exactly that for months, in the build, the
 *   dev server and the suite alike.
 * - `compact: false` is Babel's default below 500 kB; above it Babel prints a
 *   note per file.
 * - {@link reactCompilerGuard} runs in the same pass and fails the transform
 *   on the one way the compiler is known to emit broken code.
 */
export async function reactCompiler(): Promise<ReactCompilerPlugin> {
  // Imported here, not at the top: the desktop config is bundled as CommonJS,
  // and a static default import of this ESM-only package from a file outside
  // that config's own package arrives there as the module namespace.
  const { default: babel } = await import("@rolldown/plugin-babel");
  return babel({
    presets: [reactCompilerPreset()],
    plugins: [reactCompilerGuard],
    compact: false,
  });
}

/** The few members of Babel's API the guard touches; Babel's types are not installed. */
interface GuardFunctionPath {
  readonly node: {
    readonly id?: { readonly name: string } | null;
    readonly body: {
      readonly body?: ReadonlyArray<{
        readonly type: string;
        readonly declarations?: ReadonlyArray<{
          readonly id: { readonly type: string; readonly name?: string };
        }>;
      }>;
    };
  };
  getFunctionParent(): GuardFunctionPath | null;
  buildCodeFrameError(message: string): Error;
}

interface GuardProgramPath {
  readonly node: object;
  readonly scope: {
    readonly globals: Readonly<Record<string, unknown>>;
    crawl(): void;
  };
  traverse(visitor: { Function(path: GuardFunctionPath): void }): void;
  buildCodeFrameError(message: string): Error;
}

interface GuardState {
  readonly filename: string | undefined;
}

interface GuardPlugin {
  readonly name: string;
  readonly visitor: {
    readonly Program: {
      enter(path: GuardProgramPath): void;
      exit(path: GuardProgramPath, state: GuardState): void;
    };
  };
}

/** Names the compiler's own output reads from the global scope. */
const COMPILER_GLOBALS: ReadonlySet<string> = new Set(["Symbol", "undefined"]);

const TEST_FILE = /[/\\]__tests__[/\\]|\.test\.[jt]sx?$/;

/**
 * A tripwire for a compiler bug (`babel-plugin-react-compiler` 1.0.0, and the
 * experimental builds after it). The upstream issue, open at the time of
 * writing, is https://github.com/react/react/issues/36128. This guard can go
 * when a compiler release fixes it.
 *
 * The compiler also compiles a component or hook that is declared INSIDE
 * another function. When that component is an arrow function or a function
 * expression bound to a variable, the compiler moves its inner closures to
 * module scope when they capture nothing of the component. It does not check
 * whether they capture a local of the ENCLOSING function. The moved closure
 * then reads a name that does not exist there, and the first render throws
 * `ReferenceError`:
 *
 * ```tsx
 * export function makeWrapper() {
 *   const slot = { current: 1 };
 *   const Wrapper = () => {
 *     return <i>{useSyncExternalStore(subscribe, () => slot.current)}</i>;
 *   };
 *   return Wrapper;
 * }
 * // compiles to a module-level `function _temp() { return slot.current; }`
 * ```
 *
 * The other forms do not break: a nested `function Wrapper() {}` declaration
 * keeps its moved closures inside the enclosing function, and
 * `return function Wrapper() {}` is not compiled at all.
 *
 * Two checks, both on what the compiler actually produced:
 *
 * 1. No identifier may be unbound after the compiler that was bound before
 *    it. This is the bug itself, in whatever shape it arrives, and it holds
 *    for every file.
 * 2. Product code may not hold the shape at all: a compiled function nested
 *    inside another function, the safe declaration form included, so the
 *    rule is one a reader can hold. Tests are exempt from this one, because
 *    a component declared inside an `it()` is ordinary there and the first
 *    check still catches the case that breaks.
 *
 * It throws, so the build, the dev server and the suite all stop on the file.
 */
function reactCompilerGuard(): GuardPlugin {
  const sourceGlobals = new WeakMap<object, ReadonlySet<string>>();
  return {
    name: "traycer-react-compiler-guard",
    visitor: {
      Program: {
        // Plugins run before presets, so this is the program as written.
        enter(path) {
          sourceGlobals.set(
            path.node,
            new Set(Object.keys(path.scope.globals)),
          );
        },
        exit(path, state) {
          const before = sourceGlobals.get(path.node);
          if (before === undefined) return;
          path.scope.crawl();
          const unbound = Object.keys(path.scope.globals).filter(
            (name) => !before.has(name) && !COMPILER_GLOBALS.has(name),
          );
          if (unbound.length > 0) {
            throw path.buildCodeFrameError(
              `React Compiler output reads ${unbound.map((name) => `\`${name}\``).join(", ")} from a scope where it is not defined. ` +
                "A component or hook declared inside another function had a closure moved to module scope. " +
                "Declare it at module scope and pass it what it needs.",
            );
          }
          if (state.filename !== undefined && TEST_FILE.test(state.filename)) {
            return;
          }
          path.traverse({
            Function(fn) {
              const first = fn.node.body.body?.[0];
              const compiled =
                first?.type === "VariableDeclaration" &&
                first.declarations?.[0]?.id.type === "Identifier" &&
                first.declarations[0].id.name === "$";
              if (!compiled || fn.getFunctionParent() === null) return;
              throw fn.buildCodeFrameError(
                `\`${fn.node.id?.name ?? "A component or hook"}\` is declared inside another function. ` +
                  "For an arrow function or a function expression, the React Compiler moves the inner closures to module scope, where the enclosing function's variables do not exist. " +
                  "Declare it at module scope.",
              );
            },
          });
        },
      },
    },
  };
}
