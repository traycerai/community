import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  SANDBOX_SECRETS_FETCH_TIMEOUT_MS,
  decideSecretRequestViaHttp,
  fetchSandboxGrantsViaHttp,
} from "../sandbox-secrets";

const BASE = "https://auth.example.test";
const BEARER = "user-jwt";
const HOST_ID = "host_abc-123";
const REQUEST_ID = "req_01JBZ8K3M4N5P6Q7R8S9T0VWXY";

/** Ids that are not one plain path segment, so no URL is built from them. */
const UNSAFE_IDS = [
  "",
  ".",
  "..",
  "a/b",
  "../x",
  "a%2Fb",
  "odd id",
  "a?b",
  "a#b",
  "x".repeat(129),
] as const;

const INVALID_ID_RESULT = {
  kind: "network-error",
  detail: "the id is not one path segment",
};

const SUMMARY_BODY = {
  version: 3,
  grants: [
    {
      secretName: "DB_PASSWORD",
      kind: "password",
      protocol: "mysql",
      mode: "brokered",
      source: "approved",
      connectorName: null,
      rotation: null,
      routes: [
        {
          route: "route-1",
          destination: "db.example.com",
          port: 3306,
          unready: null,
        },
      ],
    },
  ],
  github: {
    linked: true,
    installations: [{ account: "traycerai", repositorySelection: "all" }],
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

/** Stubs `fetch` with a responder that builds a fresh Response per call. */
function stubFetch(respond: () => Response): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(respond()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubRejectingFetch(error: unknown): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(error));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSandboxGrantsViaHttp", () => {
  it("GETs the host's grants route with the user bearer and no body", async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, SUMMARY_BODY));

    await fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v3/secrets/hosts/${HOST_ID}/grants`,
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: `Bearer ${BEARER}`,
          Accept: "application/json",
        },
        body: null,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("joins the path onto a base URL that already ends in a slash", async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, SUMMARY_BODY));

    await fetchSandboxGrantsViaHttp(`${BASE}/`, BEARER, HOST_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v3/secrets/hosts/${HOST_ID}/grants`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("keeps a path prefix on the base URL", async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, SUMMARY_BODY));

    await fetchSandboxGrantsViaHttp(`${BASE}/gateway`, BEARER, HOST_ID);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/gateway/api/v3/secrets/hosts/${HOST_ID}/grants`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("bounds the call with a positive timeout", () => {
    expect(SANDBOX_SECRETS_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("returns the parsed summary on a 200", async () => {
    stubFetch(() => jsonResponse(200, SUMMARY_BODY));

    const result = await fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID);

    expect(result).toEqual({ kind: "ok", summary: SUMMARY_BODY });
  });

  it("fills the defaults of a sparse 200 and drops fields it does not know", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        version: 1,
        grants: [
          {
            secretName: "TOKEN",
            kind: "token",
            protocol: "https",
            mode: "exposed",
            source: "default",
            futureField: true,
          },
        ],
        futureTopLevel: 1,
      }),
    );

    const result = await fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID);

    expect(result).toEqual({
      kind: "ok",
      summary: {
        version: 1,
        grants: [
          {
            secretName: "TOKEN",
            kind: "token",
            protocol: "https",
            mode: "exposed",
            source: "default",
            connectorName: null,
            rotation: null,
            routes: [],
          },
        ],
        github: null,
      },
    });
  });

  it("fails a 200 whose body does not match the contract", async () => {
    stubFetch(() => jsonResponse(200, { grants: "none" }));

    await expect(
      fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the grants summary did not match the contract",
    });
  });

  it("fails a 200 with a body that is not JSON", async () => {
    stubFetch(() => textResponse(200, "<html>proxy error</html>"));

    await expect(
      fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the grants summary did not match the contract",
    });
  });

  it("fails a 200 with an empty body", async () => {
    stubFetch(() => textResponse(200, ""));

    await expect(
      fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the grants summary did not match the contract",
    });
  });

  it.each([401, 403])("reads a %i as unauthorized", async (status) => {
    stubFetch(() => jsonResponse(status, { error: "no" }));

    await expect(
      fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("reads a 404 as not-found, even with an unparsable body", async () => {
    stubFetch(() => textResponse(404, "<html>not found</html>"));

    await expect(
      fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
    ).resolves.toEqual({ kind: "not-found" });
  });

  it.each([500, 502, 400, 409, 201])(
    "reads a %i as a network error naming the status",
    async (status) => {
      stubFetch(() => jsonResponse(status, SUMMARY_BODY));

      await expect(
        fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
      ).resolves.toEqual({
        kind: "network-error",
        detail: `the broker answered HTTP ${status}`,
      });
    },
  );

  it("reads a thrown fetch as a network error that names only the error class", async () => {
    stubRejectingFetch(new TypeError("connect ECONNREFUSED 10.0.0.1:443"));

    await expect(
      fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the request never completed (TypeError)",
    });
  });

  it("reads a thrown non-Error as a network error", async () => {
    stubRejectingFetch("offline");

    await expect(
      fetchSandboxGrantsViaHttp(BASE, BEARER, HOST_ID),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the request never completed",
    });
  });

  it.each(UNSAFE_IDS)(
    "refuses the host id %j before any request",
    async (hostId) => {
      const fetchMock = stubFetch(() => jsonResponse(200, SUMMARY_BODY));

      await expect(
        fetchSandboxGrantsViaHttp(BASE, BEARER, hostId),
      ).resolves.toEqual(INVALID_ID_RESULT);

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("accepts a 128-character id", async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, SUMMARY_BODY));
    const hostId = "h".repeat(128);

    await fetchSandboxGrantsViaHttp(BASE, BEARER, hostId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("decideSecretRequestViaHttp", () => {
  it("POSTs the decision as JSON to the request's decide route with the user bearer", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse(200, { status: "approved" }),
    );

    await decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/v3/secrets/requests/${REQUEST_ID}/decide`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${BEARER}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ decision: "approve" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each(["approve", "approve_default", "decline"] as const)(
    "sends the %s decision as the body",
    async (decision) => {
      const fetchMock = stubFetch(() =>
        jsonResponse(200, { status: "approved" }),
      );

      await decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, decision);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/decide"),
        expect.objectContaining({ body: JSON.stringify({ decision }) }),
      );
    },
  );

  it("returns ok with the status of a 200", async () => {
    stubFetch(() => jsonResponse(200, { status: "approved_default" }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve_default"),
    ).resolves.toEqual({ kind: "ok", status: "approved_default" });
  });

  it("returns ok when a 200 carries a code too", async () => {
    stubFetch(() => jsonResponse(200, { status: "declined", code: null }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "decline"),
    ).resolves.toEqual({ kind: "ok", status: "declined" });
  });

  it("fails a 200 whose body does not match the contract", async () => {
    stubFetch(() => jsonResponse(200, { decided: true }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the decision's answer did not match the contract",
    });
  });

  it("fails a 200 with a body that is not JSON", async () => {
    stubFetch(() => textResponse(200, "ok"));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the decision's answer did not match the contract",
    });
  });

  it("fails a 200 with an empty status", async () => {
    stubFetch(() => jsonResponse(200, { status: "" }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the decision's answer did not match the contract",
    });
  });

  it("returns a conflict with the standing status and no code on a 409", async () => {
    stubFetch(() => jsonResponse(409, { status: "declined" }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({ kind: "conflict", status: "declined", code: null });
  });

  it("returns a conflict for an expired request", async () => {
    stubFetch(() => jsonResponse(409, { status: "expired" }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({ kind: "conflict", status: "expired", code: null });
  });

  it("returns a conflict carrying the secret_required code", async () => {
    stubFetch(() =>
      jsonResponse(409, { status: "pending", code: "secret_required" }),
    );

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "conflict",
      status: "pending",
      code: "secret_required",
    });
  });

  it("returns a conflict carrying a code it does not know", async () => {
    stubFetch(() =>
      jsonResponse(409, { status: "pending", code: "some_future_code" }),
    );

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "conflict",
      status: "pending",
      code: "some_future_code",
    });
  });

  it("fails a 409 whose body is not JSON", async () => {
    stubFetch(() => textResponse(409, "<html>conflict</html>"));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the decision's answer did not match the contract",
    });
  });

  it("fails a 409 with an empty body", async () => {
    stubFetch(() => textResponse(409, ""));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the decision's answer did not match the contract",
    });
  });

  it("fails a 409 whose body has no status", async () => {
    stubFetch(() => jsonResponse(409, { code: "secret_required" }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the decision's answer did not match the contract",
    });
  });

  it.each([401, 403])("reads a %i as unauthorized", async (status) => {
    stubFetch(() => jsonResponse(status, { error: "no" }));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({ kind: "unauthorized" });
  });

  it("reads a 404 as not-found, even with an unparsable body", async () => {
    stubFetch(() => textResponse(404, "<html>not found</html>"));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({ kind: "not-found" });
  });

  it.each([500, 502, 400, 201])(
    "reads a %i as a network error naming the status",
    async (status) => {
      stubFetch(() => jsonResponse(status, { status: "approved" }));

      await expect(
        decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
      ).resolves.toEqual({
        kind: "network-error",
        detail: `the broker answered HTTP ${status}`,
      });
    },
  );

  it("reads a thrown fetch as a network error that names only the error class", async () => {
    stubRejectingFetch(new TypeError("connect ECONNREFUSED 10.0.0.1:443"));

    await expect(
      decideSecretRequestViaHttp(BASE, BEARER, REQUEST_ID, "approve"),
    ).resolves.toEqual({
      kind: "network-error",
      detail: "the request never completed (TypeError)",
    });
  });

  it.each(UNSAFE_IDS)(
    "refuses the request id %j before any request",
    async (requestId) => {
      const fetchMock = stubFetch(() =>
        jsonResponse(200, { status: "approved" }),
      );

      await expect(
        decideSecretRequestViaHttp(BASE, BEARER, requestId, "approve"),
      ).resolves.toEqual(INVALID_ID_RESULT);

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
