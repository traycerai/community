import { describe, expect, it } from "vitest";
import { secretsDashboardUrl } from "@/lib/sandboxes/secrets-dashboard";

describe("secretsDashboardUrl", () => {
  it("lands on the personal secrets page of the platform origin the sign-in URL names", () => {
    const url = secretsDashboardUrl("https://platform.example.dev/sign-in?x=1");
    expect(url).toBe(
      "https://platform.example.dev/environments/personal/secrets",
    );
    expect(url.endsWith("/environments/personal/secrets")).toBe(true);
  });

  it("falls back to production's personal secrets page for an unusable sign-in URL", () => {
    expect(secretsDashboardUrl("not a url")).toBe(
      "https://traycer.ai/environments/personal/secrets",
    );
  });
});
