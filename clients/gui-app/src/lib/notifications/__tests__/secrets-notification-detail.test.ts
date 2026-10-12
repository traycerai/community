import { describe, expect, it } from "vitest";
import {
  SECRET_GRANT_DECISIONS,
  secretExportNotice,
  secretGrantRequestDestination,
  secretGrantRequestReason,
  secretRequestStatusLine,
  secretsNotificationDetail,
  type SecretsNotificationDetail,
} from "@/lib/notifications/secrets-notification-detail";

type GrantRequestDetail = Extract<
  SecretsNotificationDetail,
  { kind: "grant-request" }
>;
type ExportMintedDetail = Extract<
  SecretsNotificationDetail,
  { kind: "export-minted" }
>;

const GRANT_PAYLOAD = {
  kind: "secret_grant_request",
  requestId: "request-1",
  hostId: "host-1",
  secretName: "DB_PASSWORD",
  destination: "db.example.com",
  port: 3306,
  protocol: "mysql",
  reason: "Run the migration",
  sandboxName: "build-box",
  agentId: "agent-1",
  epicId: "epic-1",
  chatId: "chat-1",
};

const MINIMAL_GRANT_PAYLOAD = {
  kind: "secret_grant_request",
  requestId: "request-2",
  hostId: "host-1",
  secretName: null,
  destination: null,
  protocol: null,
  reason: "",
};

const EXPORT_PAYLOAD = {
  kind: "secret_export_minted",
  secretName: "DEPLOY_KEY",
  exportKind: "presigned_url",
  expiresAt: 1_700_000_900_000,
  hostId: "host-1",
};

function grantDetail(
  overrides: Partial<GrantRequestDetail>,
): GrantRequestDetail {
  return {
    kind: "grant-request",
    requestId: "request-1",
    secretName: "DB_PASSWORD",
    destination: "db.example.com",
    port: null,
    protocol: null,
    reason: "Run the migration",
    sandboxName: null,
    ...overrides,
  };
}

function exportDetail(
  overrides: Partial<ExportMintedDetail>,
): ExportMintedDetail {
  return {
    kind: "export-minted",
    secretName: "DEPLOY_KEY",
    exportKind: "presigned_url",
    expiresAt: 1_700_000_900_000,
    ...overrides,
  };
}

describe("secretsNotificationDetail", () => {
  it("reads a grant request into every field of its detail", () => {
    expect(
      secretsNotificationDetail("secret.grant.requested", GRANT_PAYLOAD),
    ).toEqual({
      kind: "grant-request",
      requestId: "request-1",
      secretName: "DB_PASSWORD",
      destination: "db.example.com",
      port: 3306,
      protocol: "mysql",
      reason: "Run the migration",
      sandboxName: "build-box",
    });
  });

  it("turns a missing port and sandbox name into null", () => {
    expect(
      secretsNotificationDetail(
        "secret.grant.requested",
        MINIMAL_GRANT_PAYLOAD,
      ),
    ).toEqual({
      kind: "grant-request",
      requestId: "request-2",
      secretName: null,
      destination: null,
      port: null,
      protocol: null,
      reason: "",
      sandboxName: null,
    });
  });

  it("reads a minted export into its detail", () => {
    expect(
      secretsNotificationDetail("secret.export.minted", EXPORT_PAYLOAD),
    ).toEqual({
      kind: "export-minted",
      secretName: "DEPLOY_KEY",
      exportKind: "presigned_url",
      expiresAt: 1_700_000_900_000,
    });
  });

  it("returns null when the payload belongs to the other secrets kind", () => {
    expect(
      secretsNotificationDetail("secret.grant.requested", EXPORT_PAYLOAD),
    ).toBeNull();
    expect(
      secretsNotificationDetail("secret.export.minted", GRANT_PAYLOAD),
    ).toBeNull();
  });

  it("returns null for an unrelated kind, even with a secrets payload", () => {
    expect(
      secretsNotificationDetail("agent.stopped", GRANT_PAYLOAD),
    ).toBeNull();
  });

  it("returns null for an unreadable payload", () => {
    expect(
      secretsNotificationDetail("secret.grant.requested", null),
    ).toBeNull();
    expect(
      secretsNotificationDetail("secret.export.minted", {
        kind: "secret_export_minted",
      }),
    ).toBeNull();
  });
});

describe("secretGrantRequestReason", () => {
  it("returns null for a blank reason", () => {
    expect(secretGrantRequestReason("")).toBeNull();
    expect(secretGrantRequestReason("  \n ")).toBeNull();
  });

  it("trims the reason", () => {
    expect(secretGrantRequestReason("  Run the migration \n")).toBe(
      "Run the migration",
    );
  });

  it("keeps a reason of exactly the longest length whole", () => {
    const reason = "a".repeat(400);
    expect(secretGrantRequestReason(reason)).toBe(reason);
  });

  it("cuts a longer reason at 400 characters and marks the cut", () => {
    expect(secretGrantRequestReason("b".repeat(401))).toBe(
      `${"b".repeat(400)}…`,
    );
  });
});

describe("secretGrantRequestDestination", () => {
  it("returns null with no destination", () => {
    expect(
      secretGrantRequestDestination(
        grantDetail({ destination: null, port: 5432, protocol: "postgres" }),
      ),
    ).toBeNull();
  });

  it("returns the bare destination without a port or protocol", () => {
    expect(
      secretGrantRequestDestination(
        grantDetail({ destination: "db.internal" }),
      ),
    ).toBe("db.internal");
  });

  it("appends the port when there is one", () => {
    expect(
      secretGrantRequestDestination(
        grantDetail({ destination: "db.internal", port: 5432 }),
      ),
    ).toBe("db.internal:5432");
  });

  it("appends the protocol in parentheses", () => {
    expect(
      secretGrantRequestDestination(
        grantDetail({
          destination: "db.internal",
          port: 5432,
          protocol: "postgres",
        }),
      ),
    ).toBe("db.internal:5432 (postgres)");
    expect(
      secretGrantRequestDestination(
        grantDetail({ destination: "db.internal", protocol: "postgres" }),
      ),
    ).toBe("db.internal (postgres)");
  });
});

describe("SECRET_GRANT_DECISIONS", () => {
  it("offers the three decisions in order with their labels", () => {
    expect(SECRET_GRANT_DECISIONS).toEqual([
      { decision: "approve", label: "Approve for this sandbox" },
      { decision: "approve_default", label: "Approve for all sandboxes" },
      { decision: "decline", label: "Decline" },
    ]);
  });
});

describe("secretRequestStatusLine", () => {
  it.each([
    ["approved", "Approved for this sandbox, for as long as it exists."],
    [
      "approved_default",
      "Approved for this sandbox, and every new sandbox gets it by default.",
    ],
    ["declined", "Declined. Nothing was granted and the agent has been told."],
    ["expired", "This request expired before it was answered."],
    ["pending", "This request is still waiting for an answer."],
  ])("describes %s", (status, line) => {
    expect(secretRequestStatusLine(status)).toBe(line);
  });

  it("reads a status this build does not know as closed", () => {
    expect(secretRequestStatusLine("revoked")).toBe("This request is closed.");
  });

  it("does not read an inherited object property as a known status", () => {
    expect(secretRequestStatusLine("toString")).toBe("This request is closed.");
  });
});

describe("secretExportNotice", () => {
  function formatTime(at: number): string {
    return `T+${at}`;
  }

  it("names the secret, the export kind and the formatted expiry", () => {
    expect(
      secretExportNotice(
        exportDetail({ exportKind: "presigned_url", expiresAt: 42 }),
        formatTime,
      ),
    ).toBe(
      "An agent minted a presigned URL from DEPLOY_KEY. It works until T+42 wherever it is copied.",
    );
  });

  it("words short-lived credentials", () => {
    expect(
      secretExportNotice(
        exportDetail({
          exportKind: "short_lived_credentials",
          secretName: "AWS_ROLE",
        }),
        formatTime,
      ),
    ).toContain("minted short-lived credentials from AWS_ROLE");
  });

  it("falls back to generic wording for an export kind it does not know", () => {
    expect(
      secretExportNotice(
        exportDetail({ exportKind: "signed_cookie" }),
        formatTime,
      ),
    ).toContain("minted a short-lived export from DEPLOY_KEY");
  });
});
