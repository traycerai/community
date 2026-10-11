import { describe, expect, it } from "vitest";
import type { Event, EventHint } from "@sentry/core";
import {
  boundFeedbackEvent,
  FEEDBACK_EVENT_BUDGET_BYTES,
  FEEDBACK_MESSAGE_KEEP_BYTES,
  headOfText,
  REPORT_TEXT_ATTACHMENT_FILENAME,
  REPORT_TRIMMED_TAG,
} from "../support-report-size-guard";

const MIB = 1024 * 1024;

function feedbackEvent(message: string, extra: Partial<Event>): Event {
  return {
    type: "feedback",
    event_id: "8b8bcd4306ab4aa78fb60f3096ded3ae",
    tags: { reportId: "rpt_8b8bcd4306ab4aa78fb60f3096ded3ae" },
    contexts: {
      feedback: { message, contact_email: "anonymous", name: "anonymous" },
      layer0: { status: "unavailable", evidence: "x".repeat(2_000) },
      appMetrics: { "0": { type: "Browser", pid: 1 } },
      processMetrics: { main: { pid: 1 } },
      os: { name: "Windows", version: "10.0.26300" },
    },
    ...extra,
  };
}

function lines(count: number, width: number): string {
  return Array.from(
    { length: count },
    (_, i) => `${String(i).padStart(6, "0")} ${"log ".repeat(width / 4)}`,
  ).join("\n");
}

function bigBreadcrumbs(totalBytes: number): Event["breadcrumbs"] {
  const each = 8 * 1024;
  return Array.from({ length: Math.ceil(totalBytes / each) }, (_, i) => ({
    category: "console",
    message: `${i} ${"b".repeat(each)}`,
    timestamp: 1_791_000_000 + i,
  }));
}

function bytes(event: Event): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

describe("boundFeedbackEvent", () => {
  it("returns an event that fits as given, with no attachment added", () => {
    const event = feedbackEvent(
      "Type: bug\n\nWhat they were trying to do:\nshort",
      {},
    );
    const hint: EventHint = { attachments: [] };
    const result = boundFeedbackEvent(event, hint);
    expect(result.event).toBe(event);
    expect(result.trimmed).toBeNull();
    expect(result.sentBytes).toBe(result.originalBytes);
    expect(hint.attachments).toEqual([]);
  });

  it("moves an oversize report text into an attachment and keeps its head inline", () => {
    const text = lines(20_000, 100); // about 2 MiB of pasted log excerpts
    expect(Buffer.byteLength(text)).toBeGreaterThan(2 * MIB);
    const event = feedbackEvent(text, {});
    const hint: EventHint = {
      attachments: [{ filename: "local-host.log", data: "tail" }],
    };
    const result = boundFeedbackEvent(event, hint);

    expect(result.trimmed).toBe("message");
    expect(result.sentBytes).toBeLessThanOrEqual(FEEDBACK_EVENT_BUDGET_BYTES);
    expect(bytes(result.event)).toBe(result.sentBytes);
    // The full text travels as an attachment, appended after the existing ones.
    expect(hint.attachments?.map((a) => a.filename)).toEqual([
      "local-host.log",
      REPORT_TEXT_ATTACHMENT_FILENAME,
    ]);
    expect(hint.attachments?.[1]?.data).toBe(text);
    expect(hint.attachments?.[1]?.contentType).toBe("text/plain");
    // The inline message is the head, cut on a line, plus the marker.
    const sent = (result.event.contexts?.feedback as { message: string })
      .message;
    expect(Buffer.byteLength(sent)).toBeLessThan(
      FEEDBACK_MESSAGE_KEEP_BYTES + 256,
    );
    expect(sent.startsWith("000000 log ")).toBe(true);
    expect(sent).toContain(
      `[Report text continues in the attachment ${REPORT_TEXT_ATTACHMENT_FILENAME} (${text.length} characters in total).]`,
    );
    const head = sent.slice(0, sent.indexOf("\n\n[Report text continues"));
    expect(text.startsWith(head)).toBe(true);
    expect(text.charAt(head.length)).toBe("\n");
    // Breadcrumbs and the app's contexts survive: the text alone was the overflow.
    expect(result.event.contexts?.layer0).toBeDefined();
    expect(result.event.tags?.[REPORT_TRIMMED_TAG]).toBe("message");
    expect(result.event.contexts?.reportSize).toEqual({
      originalBytes: result.originalBytes,
      sentBytes: expect.any(Number),
    });
    // The input event was not mutated.
    expect((event.contexts?.feedback as { message: string }).message).toBe(
      text,
    );
  });

  it("drops breadcrumbs when they are the overflow and keeps a short message intact", () => {
    const message = "Type: bug\n\nWhat they were trying to do:\nclick";
    const event = feedbackEvent(message, {
      breadcrumbs: bigBreadcrumbs(MIB),
    });
    const hint: EventHint = { attachments: [] };
    const result = boundFeedbackEvent(event, hint);

    expect(result.trimmed).toBe("breadcrumbs");
    expect(result.sentBytes).toBeLessThanOrEqual(FEEDBACK_EVENT_BUDGET_BYTES);
    expect(result.event.breadcrumbs).toBeUndefined();
    expect(
      (result.event.contexts?.feedback as { message: string }).message,
    ).toBe(message);
    expect(hint.attachments).toEqual([]);
    expect(result.event.tags?.[REPORT_TRIMMED_TAG]).toBe("breadcrumbs");
  });

  it("drops the app's own contexts last, largest first, and never the SDK's", () => {
    const event = feedbackEvent("short", {
      breadcrumbs: bigBreadcrumbs(16 * 1024),
      contexts: {
        feedback: { message: "short" },
        layer0: { evidence: "e".repeat(MIB) },
        appMetrics: { "0": { pid: 1 } },
        processMetrics: { main: { pid: 1 } },
        os: { name: "Windows" },
      },
    });
    const result = boundFeedbackEvent(event, { attachments: [] });

    expect(result.trimmed).toBe("breadcrumbs+contexts");
    expect(result.sentBytes).toBeLessThanOrEqual(FEEDBACK_EVENT_BUDGET_BYTES);
    expect(result.event.contexts?.layer0).toBeUndefined();
    // Dropping layer0 was enough: the smaller contexts stay.
    expect(result.event.contexts?.appMetrics).toBeDefined();
    expect(result.event.contexts?.processMetrics).toBeDefined();
    expect(result.event.contexts?.os).toEqual({ name: "Windows" });
  });

  it("leaves a non-feedback event alone whatever its size", () => {
    const event: Event = {
      type: undefined,
      message: "x".repeat(2 * MIB),
      breadcrumbs: bigBreadcrumbs(MIB),
    };
    const hint: EventHint = {};
    const result = boundFeedbackEvent(event, hint);
    expect(result.event).toBe(event);
    expect(result.trimmed).toBeNull();
    expect(hint.attachments).toBeUndefined();
  });
});

describe("headOfText", () => {
  it("returns short text unchanged", () => {
    expect(headOfText("a\nb", 100)).toBe("a\nb");
  });

  it("cuts on the last line break inside the byte budget", () => {
    expect(headOfText("one\ntwo\nthree", 9)).toBe("one\ntwo");
  });

  it("falls back to the last space when the head has no line break", () => {
    expect(headOfText("one two three", 9)).toBe("one two");
  });

  it("drops a multi-byte character split by the byte cut", () => {
    // "é" is two bytes; a 4-byte cut lands inside the second "é".
    expect(headOfText("aéé", 4)).toBe("aé");
  });
});
