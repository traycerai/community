import { describe, expect, it } from "vitest";
import {
  hostRpcRegistry,
  providersListV100,
  providersListV101,
} from "@traycer/protocol/host/registry";
import {
  providersListResponseSchema,
  providersListResponseSchemaV100,
} from "@traycer/protocol/host/provider-schemas";

/**
 * `providers.list@10.1`: the envelope's `credentialsManagedInAccount`, true on
 * a sandbox host. A new KEY, so the frozen 10.0 response strips it on the
 * within-major re-parse.
 */

describe("providers.list@10.1 registry binding", () => {
  it("opens 10.1 above a frozen 10.0", () => {
    const line = hostRpcRegistry["providers.list"][10];
    expect(line.latestMinor).toBe(1);
    expect(line.versions[0].contract).toBe(providersListV100);
    expect(line.versions[1].contract).toBe(providersListV101);
    expect(providersListV101.responseSchema).toBe(providersListResponseSchema);
    expect(providersListV100.responseSchema).toBe(
      providersListResponseSchemaV100,
    );
  });
});

describe("providers.list live response", () => {
  it.each([true, false])("keeps credentialsManagedInAccount %s", (flag) => {
    const parsed = providersListResponseSchema.parse({
      providers: [],
      credentialsManagedInAccount: flag,
    });
    expect(parsed.credentialsManagedInAccount).toBe(flag);
  });

  it("parses a response without the key and leaves it absent", () => {
    const parsed = providersListResponseSchema.parse({ providers: [] });
    expect(parsed.providers).toEqual([]);
    expect(parsed.credentialsManagedInAccount).toBeUndefined();
  });
});

describe("providers.list frozen 10.0 response", () => {
  it.each([true, false])("strips credentialsManagedInAccount %s", (flag) => {
    const parsed = providersListResponseSchemaV100.parse({
      providers: [],
      credentialsManagedInAccount: flag,
    });
    expect(Object.hasOwn(parsed, "credentialsManagedInAccount")).toBe(false);
    expect(parsed.providers).toEqual([]);
  });
});
