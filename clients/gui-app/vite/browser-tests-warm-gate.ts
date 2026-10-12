import type { DevEnvironment, EnvironmentModuleNode, Plugin } from "vite";

interface WarmGateOptions {
  /** The path the gate answers on. */
  readonly path: string;
  /** The url of every page script to warm, given the server's root. */
  readonly entries: (root: string) => Promise<readonly string[]>;
}

/**
 * # The browser tests' warm gate
 *
 * Answers `path` once the module graph of every entry is transformed, so
 * `playwright.config.ts` can wait on it (`webServer.url`) before a test runs.
 *
 * A dev server transforms a module when it is first asked for, and the
 * heaviest fixtures import most of the app. On a cold server that first load
 * is the whole transform, React Compiler included: over two minutes on a CI
 * runner, against a navigation timeout of one. Vite's own `server.warmup`
 * starts the same work but tells nobody when it ends, so the first tests of
 * a run raced it. The gate does that work once, up front.
 *
 * - No timer. The one bound on the wait is Playwright's `webServer.timeout`.
 * - It walks the graph itself because Vite has no signal for "warm":
 *   `waitForRequestsIdle()` resolves once, the first time nothing has been in
 *   flight for 50 ms, and says nothing about a request that starts after.
 * - A walk that fails ends the server process with the error. A page whose
 *   module cannot be transformed cannot load, and a gate that answered
 *   anyway, or never, would turn that into a timeout far from its cause.
 */
export function warmGate(options: WarmGateOptions): Plugin {
  let warm: Promise<void> | null = null;
  return {
    name: "browser-tests-warm-gate",
    configureServer(server) {
      server.middlewares.use(options.path, (_request, response) => {
        warm ??= options
          .entries(server.config.root)
          .then((entries) =>
            transformModuleGraph(server.environments.client, entries),
          );
        warm.then(
          () => {
            response.end("warm");
          },
          (error: unknown) => {
            server.config.logger.error(
              `The browser tests' dev server could not be warmed, so the run cannot start.\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
            );
            process.exit(1);
          },
        );
      });
    },
  };
}

/**
 * Transforms every module `entries` can reach, and resolves when all of them
 * are done. It rejects with the first module that cannot be transformed.
 *
 * `transformRequest` is the transform a browser request runs, and shares one
 * result with it. `warmupRequest` is the same call with the error logged and
 * dropped, which is right for a hint and wrong for a gate.
 */
export async function transformModuleGraph(
  environment: DevEnvironment,
  entries: readonly string[],
): Promise<void> {
  const seen = new Set<string>();
  const visit = async (url: string): Promise<void> => {
    if (seen.has(url)) return;
    seen.add(url);
    await environment.transformRequest(url);
    const node = await environment.moduleGraph.getModuleByUrl(url);
    if (node === undefined) return;
    await Promise.all(
      importsNamedBy(node).map(async (imported) => {
        // The graph's own url for it: no `?import`, the key Vite transforms by.
        const child = await environment.moduleGraph.getModuleByUrl(imported);
        if (child !== undefined) await visit(child.url);
      }),
    );
  };
  await Promise.all(entries.map(visit));
}

/**
 * The modules this module's own code imports: `import ... from` and every
 * `import("...")` with a literal path. The lazy ones are included on purpose.
 * A test meets a lazy panel under a 10 second `expect`, so it has to be warm
 * too, and across the fixtures they are about 70 of 4,100 source modules.
 *
 * `importedModules`, the published field, is this set PLUS every file a
 * plugin registered as a dependency of the module (`addWatchFile`). Tailwind
 * registers each source file it scans, so that set pulls in Markdown, HTML
 * and the desktop shell, none of which a page loads and some of which cannot
 * be transformed at all.
 *
 * So the read is of `staticImportedUrls`, a field Vite keeps on each module
 * node for its own bookkeeping but leaves out of its published types (and
 * which, despite the name, holds the literal dynamic imports as well; read
 * here as of Vite 8.3.4). The read is checked, not assumed: a Vite that drops
 * the field fails the walk with this message, and the run stops at once. It
 * must never leave the gate answering over a cold graph.
 */
function importsNamedBy(node: EnvironmentModuleNode): string[] {
  if (!("staticImportedUrls" in node)) {
    throw new Error(
      "The browser tests' warm gate reads `staticImportedUrls` from Vite's module nodes, an unpublished field. " +
        "It was written against Vite 8.3.4 and this Vite has no such field, so the gate cannot tell what a page loads. " +
        "Find where this Vite records the imports a module's code names and update `importsNamedBy` in vite/browser-tests-warm-gate.ts.",
    );
  }
  // Unset on a module with no imports of its own to record, such as CSS.
  const urls: unknown = node.staticImportedUrls;
  if (!(urls instanceof Set)) return [];
  return Array.from(urls).filter(
    (url): url is string => typeof url === "string",
  );
}
