import {
  sandboxGrantsSummarySchema,
  secretRequestDecideBodySchema,
  type SandboxGrantsSummary,
  type SecretRequestDecision,
} from "@traycer/protocol/host/sandbox-secrets";
import { composeRequestAbort } from "../auth/request-abort";

/**
 * The two calls a client makes to the secrets broker (authn) with the user's
 * bearer: the grants summary a sandbox's card shows, and the decision on an
 * agent's grant request. Everything else about a secret is the dashboard's.
 *
 * Both go to authn directly, never through the sandbox host: a sandbox holds
 * no user bearer, and its own credential is refused by these routes.
 */

/** Bounds either call; both are single reads or writes of one row. */
export const SANDBOX_SECRETS_FETCH_TIMEOUT_MS = 15_000;

/**
 * A non-`ok` answer:
 *  - `unauthorized`  - the bearer was rejected (401/403).
 *  - `not-found`     - no such host or request for this user (404). The
 *                      broker answers a foreign id the same way.
 *  - `network-error` - transport or timeout, a status with no meaning here, a
 *                      body this build cannot parse, or an id that is not one
 *                      path segment (refused before any request). `detail` is
 *                      a stable classification, never a raw server body.
 */
export type SandboxSecretsFailure =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "not-found" }
  | { readonly kind: "network-error"; readonly detail: string };

export type SandboxGrantsFetchResult =
  | { readonly kind: "ok"; readonly summary: SandboxGrantsSummary }
  | SandboxSecretsFailure;

/**
 * `ok` is the `200`: the request now stands at `status` (repeating a decision
 * answers the same). `conflict` is the `409`: it stands at `status` and this
 * decision did not change it - decided otherwise, expired, or `code` names
 * what is missing (`secret_required`).
 */
export type SecretRequestDecideFetchResult =
  | { readonly kind: "ok"; readonly status: string }
  | {
      readonly kind: "conflict";
      readonly status: string;
      readonly code: string | null;
    }
  | SandboxSecretsFailure;

/**
 * An id as a URL may carry it: one plain path segment. `encodeURIComponent`
 * leaves `.` and `..` alone and `new URL` resolves them as dot segments, so
 * an id that is not this shape is refused before a URL is built (as
 * `sandbox-control.ts` refuses a sandbox id).
 */
const PATH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const INVALID_ID: SandboxSecretsFailure = {
  kind: "network-error",
  detail: "the id is not one path segment",
};

function secretsUrl(authnBaseUrl: string, path: string): string {
  const base = authnBaseUrl.endsWith("/") ? authnBaseUrl : `${authnBaseUrl}/`;
  return new URL(`api/v3/secrets/${path}`, base).toString();
}

type RawCall =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly body: unknown;
    }
  | { readonly kind: "network-error"; readonly detail: string };

async function call(
  url: string,
  method: "GET" | "POST",
  body: string | null,
  bearerToken: string,
): Promise<RawCall> {
  // Not `AbortSignal.timeout`, which the iOS WebView floor does not have; see
  // `request-abort.ts`. Cleared once the body is read, which the timeout also
  // bounds.
  const abort = composeRequestAbort(null, SANDBOX_SECRETS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers:
        body === null
          ? {
              Authorization: `Bearer ${bearerToken}`,
              Accept: "application/json",
            }
          : {
              Authorization: `Bearer ${bearerToken}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
      body,
      signal: abort.signal,
    });
    // An empty or non-JSON body (a proxy's HTML page) reads as `null` rather
    // than throwing before the status is classified.
    const text = await response.text();
    return {
      kind: "response",
      status: response.status,
      body: parseJsonOrNull(text),
    };
  } catch (error: unknown) {
    return {
      kind: "network-error",
      detail:
        error instanceof Error
          ? `the request never completed (${error.name})`
          : "the request never completed",
    };
  } finally {
    abort.clear();
  }
}

function parseJsonOrNull(text: string): unknown {
  if (text.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

/** The outcomes every status shares, or `null` for one the caller reads. */
function sharedFailureOf(status: number): SandboxSecretsFailure | null {
  if (status === 401 || status === 403) return { kind: "unauthorized" };
  if (status === 404) return { kind: "not-found" };
  return null;
}

/**
 * `GET /api/v3/secrets/hosts/:hostId/grants`: the secrets one sandbox host may
 * use, with each brokered destination's route id.
 */
export async function fetchSandboxGrantsViaHttp(
  authnBaseUrl: string,
  bearerToken: string,
  hostId: string,
): Promise<SandboxGrantsFetchResult> {
  if (!PATH_ID_PATTERN.test(hostId)) return INVALID_ID;
  const raw = await call(
    secretsUrl(authnBaseUrl, `hosts/${hostId}/grants`),
    "GET",
    null,
    bearerToken,
  );
  if (raw.kind === "network-error") return raw;
  const failure = sharedFailureOf(raw.status);
  if (failure !== null) return failure;
  if (raw.status !== 200) {
    return {
      kind: "network-error",
      detail: `the broker answered HTTP ${raw.status}`,
    };
  }
  const parsed = sandboxGrantsSummarySchema.safeParse(raw.body);
  if (!parsed.success) {
    return {
      kind: "network-error",
      detail: "the grants summary did not match the contract",
    };
  }
  return { kind: "ok", summary: parsed.data };
}

/**
 * `POST /api/v3/secrets/requests/:id/decide`: the user's answer to an agent's
 * grant request.
 */
export async function decideSecretRequestViaHttp(
  authnBaseUrl: string,
  bearerToken: string,
  requestId: string,
  decision: SecretRequestDecision,
): Promise<SecretRequestDecideFetchResult> {
  if (!PATH_ID_PATTERN.test(requestId)) return INVALID_ID;
  const raw = await call(
    secretsUrl(authnBaseUrl, `requests/${requestId}/decide`),
    "POST",
    JSON.stringify({ decision }),
    bearerToken,
  );
  if (raw.kind === "network-error") return raw;
  const failure = sharedFailureOf(raw.status);
  if (failure !== null) return failure;
  if (raw.status !== 200 && raw.status !== 409) {
    return {
      kind: "network-error",
      detail: `the broker answered HTTP ${raw.status}`,
    };
  }
  const parsed = secretRequestDecideBodySchema.safeParse(raw.body);
  if (!parsed.success) {
    return {
      kind: "network-error",
      detail: "the decision's answer did not match the contract",
    };
  }
  return raw.status === 200
    ? { kind: "ok", status: parsed.data.status }
    : { kind: "conflict", status: parsed.data.status, code: parsed.data.code };
}
