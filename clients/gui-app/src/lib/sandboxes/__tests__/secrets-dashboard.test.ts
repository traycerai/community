import { describe, expect, it } from "vitest";
import { secretsDashboardUrl } from "@/lib/sandboxes/secrets-dashboard";

describe("secretsDashboardUrl", () => {
  it("lands on the secrets page of the platform origin the sign-in URL names", () => {
    expect(
      secretsDashboardUrl("https://platform.example.dev/sign-in?x=1"),
    ).toBe("https://platform.example.dev/secrets");
  });

  it("falls back to production's secrets page for an unusable sign-in URL", () => {
    expect(secretsDashboardUrl("not a url")).toBe("https://traycer.ai/secrets");
  });
});
