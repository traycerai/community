import { describe, expect, it } from "vitest";
import type { SandboxRouteReadiness } from "@traycer/protocol/host/sandbox-control";
import type {
  SandboxGitHubAccess,
  SandboxGrant,
  SandboxGrantsSummary,
} from "@traycer/protocol/host/sandbox-secrets";
import {
  sandboxGitHubLine,
  sandboxGrantViews,
  sandboxRouteAddresses,
} from "@/lib/sandboxes/sandbox-grants-view";

function grant(overrides: Partial<SandboxGrant>): SandboxGrant {
  return {
    secretName: "DB_PASSWORD",
    kind: "password",
    protocol: "postgres",
    mode: "brokered",
    source: "approved",
    connectorName: null,
    routes: [{ route: "route-1", destination: "db.internal", port: 5432 }],
    ...overrides,
  };
}

function summary(grants: readonly SandboxGrant[]): SandboxGrantsSummary {
  return { version: 1, grants, github: null };
}

function readiness(
  route: string,
  state: SandboxRouteReadiness["state"],
  code: string | null,
): SandboxRouteReadiness {
  return { route, state, code };
}

describe("sandboxGrantViews", () => {
  it("returns no views for a summary with no grants", () => {
    expect(sandboxGrantViews(summary([]), [])).toEqual([]);
  });

  it("describes a brokered grant and joins its route to the reported readiness", () => {
    const [view] = sandboxGrantViews(summary([grant({})]), [
      readiness("route-1", "ready", null),
    ]);
    expect(view).toEqual({
      secretName: "DB_PASSWORD",
      modeLine: "postgres · brokered",
      exposed: false,
      via: null,
      source: "approved for this sandbox",
      routes: [
        {
          route: "route-1",
          address: "db.internal:5432",
          readiness: "ready",
          readinessText: "ready",
        },
      ],
    });
  });

  it("words a route nothing has used yet as not used yet", () => {
    const [view] = sandboxGrantViews(summary([grant({})]), [
      readiness("route-1", "pending", null),
    ]);
    expect(view.routes[0]).toMatchObject({
      readiness: "pending",
      readinessText: "not used yet",
    });
  });

  it("uses the refusal headline for an unavailable route with a known code", () => {
    const [view] = sandboxGrantViews(summary([grant({})]), [
      readiness("route-1", "unavailable", "grant_missing"),
    ]);
    expect(view.routes[0]).toMatchObject({
      readiness: "unavailable",
      readinessText: "No grant for this destination",
    });
  });

  it("says unavailable for a refusal with no code or an unknown code", () => {
    const withoutCode = sandboxGrantViews(summary([grant({})]), [
      readiness("route-1", "unavailable", null),
    ]);
    const unknownCode = sandboxGrantViews(summary([grant({})]), [
      readiness("route-1", "unavailable", "from_a_newer_host"),
    ]);
    expect(withoutCode[0].routes[0]).toMatchObject({
      readiness: "unavailable",
      readinessText: "unavailable",
    });
    expect(unknownCode[0].routes[0]).toMatchObject({
      readiness: "unavailable",
      readinessText: "unavailable",
    });
  });

  it("shows no state for a route the sandbox has not reported", () => {
    const [view] = sandboxGrantViews(summary([grant({})]), [
      readiness("another-route", "ready", null),
    ]);
    expect(view.routes[0]).toEqual({
      route: "route-1",
      address: "db.internal:5432",
      readiness: null,
      readinessText: null,
    });
  });

  it("shows no state for any route when the sandbox reports no routes at all", () => {
    const [view] = sandboxGrantViews(
      summary([
        grant({
          routes: [
            { route: "route-1", destination: "db.internal", port: 5432 },
            { route: "route-2", destination: "cache.internal", port: null },
          ],
        }),
      ]),
      null,
    );
    expect(view.routes.map((route) => route.readiness)).toEqual([null, null]);
    expect(view.routes.map((route) => route.readinessText)).toEqual([
      null,
      null,
    ]);
  });

  it("names a route without a port by its bare destination", () => {
    const [view] = sandboxGrantViews(
      summary([
        grant({
          routes: [
            { route: "route-2", destination: "api.example.com", port: null },
          ],
        }),
      ]),
      null,
    );
    expect(view.routes[0].address).toBe("api.example.com");
  });

  it("marks an exposed grant and gives it no routes", () => {
    const [view] = sandboxGrantViews(
      summary([grant({ mode: "exposed", protocol: "https", routes: [] })]),
      [readiness("route-1", "ready", null)],
    );
    expect(view).toMatchObject({
      exposed: true,
      modeLine: "https · exposed, readable on the sandbox",
      routes: [],
    });
  });

  it("carries the connector name as a via line", () => {
    const [view] = sandboxGrantViews(
      summary([grant({ connectorName: "office-vpc" })]),
      null,
    );
    expect(view.via).toBe("through connector office-vpc");
  });

  it("drops the protocol from the mode line when there is none", () => {
    const [view] = sandboxGrantViews(summary([grant({ protocol: "" })]), null);
    expect(view.modeLine).toBe("brokered");
  });

  it("shows a mode this build does not know as its own word", () => {
    const [view] = sandboxGrantViews(
      summary([grant({ mode: "tunnelled" })]),
      null,
    );
    expect(view.modeLine).toBe("postgres · tunnelled");
    expect(view.exposed).toBe(false);
  });

  it.each([
    ["default", "granted to every sandbox"],
    ["inherited", "inherited from the sandbox that created this one"],
    ["approved", "approved for this sandbox"],
  ])("words the %s source", (source, words) => {
    const [view] = sandboxGrantViews(summary([grant({ source })]), null);
    expect(view.source).toBe(words);
  });

  it("gives a source this build has no word for as null", () => {
    const [view] = sandboxGrantViews(
      summary([grant({ source: "delegated" })]),
      null,
    );
    expect(view.source).toBeNull();
    const [inherited] = sandboxGrantViews(
      summary([grant({ source: "toString" })]),
      null,
    );
    expect(inherited.source).toBeNull();
  });

  it("joins each grant's routes independently and keeps grant order", () => {
    const views = sandboxGrantViews(
      summary([
        grant({ secretName: "A" }),
        grant({
          secretName: "B",
          routes: [
            { route: "route-2", destination: "cache.internal", port: 6379 },
          ],
        }),
      ]),
      [
        readiness("route-1", "pending", null),
        readiness("route-2", "ready", null),
      ],
    );
    expect(views.map((view) => view.secretName)).toEqual(["A", "B"]);
    expect(views[0].routes[0].readiness).toBe("pending");
    expect(views[1].routes[0].readiness).toBe("ready");
  });
});

describe("sandboxRouteAddresses", () => {
  it("is empty without a summary", () => {
    expect(sandboxRouteAddresses(null).size).toBe(0);
  });

  it("maps every route id across every grant to its address", () => {
    const addresses = sandboxRouteAddresses(
      summary([
        grant({}),
        grant({
          routes: [
            { route: "route-2", destination: "api.example.com", port: null },
            { route: "route-3", destination: "cache.internal", port: 6379 },
          ],
        }),
        grant({ mode: "exposed", routes: [] }),
      ]),
    );
    expect([...addresses.entries()]).toEqual([
      ["route-1", "db.internal:5432"],
      ["route-2", "api.example.com"],
      ["route-3", "cache.internal:6379"],
    ]);
  });
});

describe("sandboxGitHubLine", () => {
  function github(
    linked: boolean,
    installations: SandboxGitHubAccess["installations"],
  ): SandboxGitHubAccess {
    return { linked, installations };
  }

  it("says GitHub is not linked", () => {
    expect(sandboxGitHubLine(github(false, []))).toBe(
      "GitHub: not linked. Git on this sandbox can't reach your repositories.",
    );
  });

  it("says a linked account with no installation has the App nowhere", () => {
    expect(sandboxGitHubLine(github(true, []))).toBe(
      "GitHub: linked, with the Traycer App installed nowhere yet.",
    );
  });

  it("lists an all-repositories installation by its account", () => {
    expect(
      sandboxGitHubLine(
        github(true, [{ account: "traycerai", repositorySelection: "all" }]),
      ),
    ).toBe("GitHub: traycerai");
  });

  it("marks a selected-repositories installation", () => {
    expect(
      sandboxGitHubLine(
        github(true, [
          { account: "traycerai", repositorySelection: "selected" },
        ]),
      ),
    ).toBe("GitHub: traycerai (selected repositories)");
  });

  it("joins several installations in order", () => {
    expect(
      sandboxGitHubLine(
        github(true, [
          { account: "traycerai", repositorySelection: "selected" },
          { account: "alice", repositorySelection: "all" },
        ]),
      ),
    ).toBe("GitHub: traycerai (selected repositories), alice");
  });

  it("does not list installations of an unlinked account", () => {
    expect(
      sandboxGitHubLine(
        github(false, [{ account: "traycerai", repositorySelection: "all" }]),
      ),
    ).toContain("not linked");
  });
});
