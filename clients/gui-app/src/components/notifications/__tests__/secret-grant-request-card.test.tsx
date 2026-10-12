import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SecretRequestDecision } from "@traycer/protocol/host/sandbox-secrets";
import type { SecretRequestDecideOutcome } from "@/hooks/sandboxes/use-secret-request-decide-mutation";
import type { SecretsNotificationDetail } from "@/lib/notifications/secrets-notification-detail";

interface DecideState {
  data: SecretRequestDecideOutcome | undefined;
  isPending: boolean;
  variables: SecretRequestDecision | undefined;
}

const mocks = vi.hoisted(() => {
  const state: DecideState = {
    data: undefined,
    isPending: false,
    variables: undefined,
  };
  return {
    state,
    mutate: vi.fn<(decision: SecretRequestDecision) => void>(),
    decideRequestId: vi.fn<(requestId: string) => void>(),
  };
});

vi.mock("@/hooks/sandboxes/use-secret-request-decide-mutation", () => ({
  useSecretRequestDecide: (requestId: string) => {
    mocks.decideRequestId(requestId);
    return {
      data: mocks.state.data,
      isPending: mocks.state.isPending,
      variables: mocks.state.variables,
      mutate: mocks.mutate,
    };
  },
}));
vi.mock("@/components/providers/secrets-dashboard-link", () => ({
  SecretsDashboardLink: (props: { readonly testId: string }): ReactNode => (
    <a href="https://dashboard.test/secrets" data-testid={props.testId}>
      Open Secrets
    </a>
  ),
}));

import { SecretGrantRequestCard } from "@/components/notifications/secret-grant-request-card";

type GrantRequestDetail = Extract<
  SecretsNotificationDetail,
  { kind: "grant-request" }
>;

const DETAIL: GrantRequestDetail = {
  kind: "grant-request",
  requestId: "request-1",
  secretName: "DB_PASSWORD",
  destination: "db.example.com",
  port: 3306,
  protocol: "mysql",
  reason: "Run the migration",
  sandboxName: "build-box",
};

const ANSWER_IDS = [
  "secret-grant-request-approve",
  "secret-grant-request-approve_default",
  "secret-grant-request-decline",
] as const;

function renderCard(detail: GrantRequestDetail, resolved: boolean): void {
  render(<SecretGrantRequestCard detail={detail} resolved={resolved} />);
}

function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent;
}

function isAbsent(testId: string): boolean {
  return screen.queryByTestId(testId) === null;
}

function isDisabled(testId: string): boolean {
  const element = screen.getByTestId(testId);
  return element instanceof HTMLButtonElement && element.disabled;
}

beforeEach(() => {
  mocks.state.data = undefined;
  mocks.state.isPending = false;
  mocks.state.variables = undefined;
  mocks.mutate.mockClear();
  mocks.decideRequestId.mockClear();
});
afterEach(cleanup);

describe("<SecretGrantRequestCard />", () => {
  it("shows the secret, destination, sandbox and reason", () => {
    renderCard(DETAIL, false);
    expect(textOf("secret-grant-request-secret")).toBe("DB_PASSWORD");
    expect(textOf("secret-grant-request-destination")).toBe(
      "db.example.com:3306 (mysql)",
    );
    expect(screen.getByText("build-box")).toBeTruthy();
    expect(textOf("secret-grant-request-reason")).toBe("Run the migration");
  });

  it("binds the decision to the request's id", () => {
    renderCard(DETAIL, false);
    expect(mocks.decideRequestId).toHaveBeenCalledWith("request-1");
  });

  it("omits the sections the request does not carry", () => {
    renderCard(
      {
        ...DETAIL,
        secretName: null,
        destination: null,
        sandboxName: null,
        reason: "  ",
      },
      false,
    );
    expect(textOf("secret-grant-request-secret")).toBe(
      "None stored for this destination yet",
    );
    expect(isAbsent("secret-grant-request-destination")).toBe(true);
    expect(isAbsent("secret-grant-request-reason")).toBe(true);
    expect(screen.queryByText("Sandbox")).toBeNull();
  });

  it("offers the three answers", () => {
    renderCard(DETAIL, false);
    expect(textOf("secret-grant-request-approve")).toBe(
      "Approve for this sandbox",
    );
    expect(textOf("secret-grant-request-approve_default")).toBe(
      "Approve for all sandboxes",
    );
    expect(textOf("secret-grant-request-decline")).toBe("Decline");
  });

  it.each<SecretRequestDecision>(["approve", "approve_default", "decline"])(
    "posts %s when its button is clicked",
    (decision) => {
      renderCard(DETAIL, false);
      fireEvent.click(screen.getByTestId(`secret-grant-request-${decision}`));
      expect(mocks.mutate).toHaveBeenCalledTimes(1);
      expect(mocks.mutate).toHaveBeenCalledWith(decision);
    },
  );

  it("disables every answer while one is pending and spins on the chosen one", () => {
    mocks.state.isPending = true;
    mocks.state.variables = "approve_default";
    renderCard(DETAIL, false);
    for (const testId of ANSWER_IDS) {
      expect(isDisabled(testId)).toBe(true);
    }
    expect(
      screen.getByTestId("secret-grant-request-approve_default-spinner"),
    ).toBeTruthy();
    expect(isAbsent("secret-grant-request-approve-spinner")).toBe(true);
  });

  it("enables the answers and shows no outcome while idle", () => {
    renderCard(DETAIL, false);
    for (const testId of ANSWER_IDS) {
      expect(isDisabled(testId)).toBe(false);
    }
    expect(isAbsent("secret-grant-request-outcome")).toBe(true);
  });

  it.each<readonly [string, SecretRequestDecideOutcome, string, string]>([
    [
      "a landed approval",
      { kind: "decided", status: "approved" },
      "decided",
      "Approved for this sandbox, for as long as it exists.",
    ],
    [
      "a landed decline",
      { kind: "decided", status: "declined" },
      "decided",
      "Declined. Nothing was granted and the agent has been told.",
    ],
    [
      "a request decided otherwise",
      { kind: "already", status: "declined" },
      "already",
      "Already answered. Declined. Nothing was granted and the agent has been told.",
    ],
    [
      "an expired request",
      { kind: "already", status: "expired" },
      "already",
      "Already answered. This request expired before it was answered.",
    ],
    [
      "a request the broker no longer has",
      { kind: "gone" },
      "gone",
      "This request is no longer open.",
    ],
  ])("words %s and withdraws the answers", (_name, outcome, kind, line) => {
    mocks.state.data = outcome;
    renderCard(DETAIL, false);
    const outcomeLine = screen.getByTestId("secret-grant-request-outcome");
    expect(outcomeLine.textContent).toBe(line);
    expect(outcomeLine.getAttribute("data-outcome")).toBe(kind);
    for (const testId of ANSWER_IDS) {
      expect(isAbsent(testId)).toBe(true);
    }
  });

  it("explains a secret-required outcome, links the dashboard and keeps the answers", () => {
    mocks.state.data = { kind: "secret-required" };
    renderCard({ ...DETAIL, secretName: null }, false);
    const outcomeLine = screen.getByTestId("secret-grant-request-outcome");
    expect(outcomeLine.getAttribute("data-outcome")).toBe("secret-required");
    expect(outcomeLine.textContent).toContain(
      "There is no secret stored for this destination yet",
    );
    expect(
      screen.getByTestId("secret-grant-request-open-secrets"),
    ).toBeTruthy();
    for (const testId of ANSWER_IDS) {
      expect(isDisabled(testId)).toBe(false);
    }
  });

  it("hides the answers once the row is resolved", () => {
    renderCard(DETAIL, true);
    for (const testId of ANSWER_IDS) {
      expect(isAbsent(testId)).toBe(true);
    }
    expect(textOf("secret-grant-request-secret")).toBe("DB_PASSWORD");
  });

  it("hides the answers on a resolved row even after a secret-required outcome", () => {
    mocks.state.data = { kind: "secret-required" };
    renderCard(DETAIL, true);
    for (const testId of ANSWER_IDS) {
      expect(isAbsent(testId)).toBe(true);
    }
  });
});
