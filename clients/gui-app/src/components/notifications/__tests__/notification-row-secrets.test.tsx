import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { SecretsNotificationDetail } from "@/lib/notifications/secrets-notification-detail";
import type { MergedNotificationRow } from "@/stores/notifications/merged-notifications";

interface RowState {
  row: MergedNotificationRow | null;
}

const mocks = vi.hoisted(() => {
  const state: RowState = { row: null };
  return { state };
});

vi.mock("@/stores/notifications/merged-notifications", async (importActual) => {
  const actual =
    await importActual<
      typeof import("@/stores/notifications/merged-notifications")
    >();
  return {
    ...actual,
    useMergedNotificationRow: () => mocks.state.row,
  };
});
vi.mock("@/hooks/host/use-host-directory-entry", () => ({
  useHostDirectoryEntry: () => null,
}));
vi.mock("@/hooks/host/use-reactive-local-host-entry", () => ({
  useReactiveLocalHostEntry: () => null,
}));
vi.mock("@/hooks/agent/use-host-reachability", () => ({
  useRemoteSessionPollReadiness: () => false,
}));
vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHostOrNull: () => null,
}));

import { NotificationRow } from "@/components/notifications/notification-row";

type GrantRequestDetail = Extract<
  SecretsNotificationDetail,
  { kind: "grant-request" }
>;
type ExportMintedDetail = Extract<
  SecretsNotificationDetail,
  { kind: "export-minted" }
>;

const GRANT: GrantRequestDetail = {
  kind: "grant-request",
  requestId: "request-1",
  secretName: "DB_PASSWORD",
  destination: "db.example.com",
  port: 3306,
  protocol: "mysql",
  reason: "Run the migration",
  sandboxName: "build-box",
};

const EXPORT: ExportMintedDetail = {
  kind: "export-minted",
  secretName: "DEPLOY_KEY",
  exportKind: "presigned_url",
  expiresAt: 1_700_000_900_000,
};

function buildRow(
  overrides: Partial<MergedNotificationRow>,
): MergedNotificationRow {
  return {
    feedId: "host:secret-1",
    source: "host",
    sourceId: "secret-1",
    createdAt: 1_000,
    readAt: null,
    title: "Secret requested",
    body: "DB_PASSWORD • Waiting for your decision",
    payload: { kind: "chat", epicId: "epic-1", chatId: "chat-1" },
    secrets: GRANT,
    hostKind: "secret.grant.requested",
    appLocalKind: null,
    globalEntry: null,
    severity: "needs_action",
    outcome: null,
    resolvedAt: null,
    sourceRef: "request-1",
    originHostId: null,
    providerPackAttribution: null,
    category: "task",
    ...overrides,
  };
}

function renderRow(row: MergedNotificationRow): HTMLElement {
  mocks.state.row = row;
  render(
    <ul>
      <NotificationRow
        feedId={row.feedId}
        highlightRelocation={false}
        onActivate={vi.fn()}
        onAcknowledge={vi.fn()}
      />
    </ul>,
  );
  return screen.getByTestId("notification-entry");
}

beforeEach(() => {
  mocks.state.row = null;
});
afterEach(cleanup);

describe("<NotificationRow /> secrets rows", () => {
  it("renders a grant request as an ordinary row", () => {
    const entry = renderRow(buildRow({}));
    expect(within(entry).getByTestId("notification-title").textContent).toBe(
      "Secret requested",
    );
    expect(within(entry).queryByTestId("secret-export-notice")).toBeNull();
  });

  it("keeps the export notice outside the navigable body button", () => {
    const entry = renderRow(
      buildRow({ secrets: EXPORT, hostKind: "secret.export.minted" }),
    );
    const notice = within(entry).getByTestId("secret-export-notice");
    expect(notice.closest("button")).toBeNull();
  });

  it("renders the export notice for an export row", () => {
    const entry = renderRow(
      buildRow({
        title: "Secret exported",
        secrets: EXPORT,
        hostKind: "secret.export.minted",
        severity: "info",
        outcome: "completed",
      }),
    );
    expect(
      within(entry).getByTestId("secret-export-notice").textContent,
    ).toContain("An agent minted a presigned URL from DEPLOY_KEY.");
  });

  it("renders no notice for a row with no secrets detail", () => {
    const entry = renderRow(
      buildRow({
        title: "Deploy checkout fix",
        secrets: null,
        hostKind: "approval.requested",
      }),
    );
    expect(within(entry).queryByTestId("secret-export-notice")).toBeNull();
    expect(within(entry).getByTestId("notification-title").textContent).toBe(
      "Deploy checkout fix",
    );
  });

  it("renders no notice when the secrets field is absent", () => {
    const entry = renderRow(buildRow({ secrets: undefined }));
    expect(within(entry).queryByTestId("secret-export-notice")).toBeNull();
  });
});
