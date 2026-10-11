// @vitest-environment node
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type DevEnvironment, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { transformModuleGraph } from "../vite/browser-tests-warm-gate";

// The warm gate answers the browser tests' "ready" probe only after every
// module a page loads is transformed. Its walk reads a field Vite does not
// publish, and a plugin (Tailwind) registers files that must not be followed,
// so the behavior is held against a REAL dev server, never a stub of one.

let root: string | null = null;
let server: ViteDevServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  if (root !== null) await rm(root, { recursive: true, force: true });
  root = null;
});

/** A dev server over a temp project holding `files`, under `src/`. */
async function startServer(
  files: Readonly<Record<string, string>>,
): Promise<DevEnvironment> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "warm-gate-"));
  root = projectRoot;
  await mkdir(path.join(projectRoot, "src"));
  for (const [name, source] of Object.entries(files)) {
    await writeFile(path.join(projectRoot, "src", name), source);
  }
  const started = await createServer({
    configFile: false,
    root: projectRoot,
    logLevel: "silent",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true },
    plugins: [
      {
        // What Tailwind does with each file it scans: a dependency that is
        // not an import, and that the browser never loads.
        name: "registers-a-dependency",
        transform(_code, id) {
          if (id.endsWith("static.js") || id.endsWith("style.css")) {
            this.addWatchFile(path.join(projectRoot, "src/watched.md"));
          }
          return null;
        },
      },
    ],
  });
  server = started;
  return started.environments.client;
}

const GRAPH: Readonly<Record<string, string>> = {
  "entry.js":
    'import "./static.js"; import "./style.css"; export const lazy = () => import("./dynamic.js");',
  "static.js": 'import "./static-child.js"; export const s = 1;',
  "static-child.js": "export const sc = 1;",
  "dynamic.js": 'import "./dynamic-child.js"; export const d = 1;',
  "dynamic-child.js": "export const dc = 1;",
  "style.css": "body { color: red; }",
  "watched.md": "not a module <<<",
};

async function isTransformed(
  environment: DevEnvironment,
  url: string,
): Promise<boolean> {
  const node = await environment.moduleGraph.getModuleByUrl(url);
  return node?.transformResult !== null && node?.transformResult !== undefined;
}

describe("transformModuleGraph", () => {
  it("transforms every module an entry reaches, lazy imports and their children included", async () => {
    const environment = await startServer(GRAPH);

    await transformModuleGraph(environment, ["/src/entry.js"]);

    for (const url of [
      "/src/entry.js",
      "/src/static.js",
      "/src/static-child.js",
      "/src/style.css",
      "/src/dynamic.js",
      "/src/dynamic-child.js",
    ]) {
      expect(await isTransformed(environment, url), url).toBe(true);
    }
  });

  it("does not follow a file a plugin registered as a dependency", async () => {
    const environment = await startServer(GRAPH);

    // Rejects if it tried to transform the Markdown file.
    await transformModuleGraph(environment, ["/src/entry.js"]);

    const watched = Array.from(
      environment.moduleGraph.idToModuleMap.values(),
    ).filter((node) => node.url.endsWith("watched.md"));
    // The plugin really did register it, or this test proves nothing.
    expect(watched.length).toBeGreaterThan(0);
    for (const node of watched) {
      expect(node.transformResult, node.url).toBeNull();
    }
  });

  it("rejects the walk when a module cannot be transformed", async () => {
    const environment = await startServer({
      ...GRAPH,
      "entry-broken.js": 'import "./missing.js";',
    });

    await expect(
      transformModuleGraph(environment, ["/src/entry-broken.js"]),
    ).rejects.toThrow(/missing\.js/);
  });

  it("stops with a message naming the field when this Vite does not keep it", async () => {
    const environment = await startServer(GRAPH);
    await environment.transformRequest("/src/entry.js");
    const node = await environment.moduleGraph.getModuleByUrl("/src/entry.js");
    if (node === undefined) throw new Error("the entry has no module node");
    Reflect.deleteProperty(node, "staticImportedUrls");

    await expect(
      transformModuleGraph(environment, ["/src/entry.js"]),
    ).rejects.toThrow(/staticImportedUrls[\s\S]*Vite 8\.3\.4/);
  });
});
