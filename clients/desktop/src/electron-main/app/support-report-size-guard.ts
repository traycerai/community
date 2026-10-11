import type { Attachment, Event, EventHint } from "@sentry/core";

/**
 * Keeps a support report's `feedback` event under Sentry's event size limit.
 *
 * Relay checks the serialized feedback item against `max_event_size` (1 MiB;
 * a feedback item is sized as an event) and discards an oversize item AFTER
 * answering the envelope with a 2xx, dropping its attachments as
 * `missing_event` with it. The client never sees that drop: `support.ts`
 * reads the 2xx as `delivered` and the public draft prints a bare report id.
 * Two reports in thirty days went this way (2026-10-01, 2026-10-10;
 * traycer#2461's `rpt_8b8bcd43…` was the second). So the event is bounded
 * here, at the last point this process controls it.
 *
 * Why an event processor and not `beforeSend`: core applies `beforeSend` to
 * error events only (`type === undefined`); a `type: "feedback"` event never
 * reaches it. Global event processors run inside `prepareEvent`, before
 * `sendEvent` reads `hint.attachments` to build the envelope, so one hook can
 * both trim the event and add an attachment to the same hint.
 *
 * Order of trimming, re-measuring after each step and stopping as soon as
 * the event fits:
 *
 * 1. The report text (`contexts.feedback.message`) above its keep size moves
 *    into a `report-text.txt` attachment in full; the message keeps its head
 *    plus one marker line. Attachments have their own 200 MiB limit and are
 *    not part of the event size, so the reporter's text is never discarded.
 * 2. Breadcrumbs are dropped (the report carries both log tails as
 *    attachments anyway).
 * 3. This app's own contexts are dropped largest first.
 *
 * What was trimmed is recorded as a bounded tag so a reader of the Sentry
 * item knows the shape is not the full one.
 */

/** Headroom under Relay's 1 MiB for normalization and the envelope header. */
export const FEEDBACK_EVENT_BUDGET_BYTES = 768 * 1024;

/** How much of an oversize report text stays inline in the message. */
export const FEEDBACK_MESSAGE_KEEP_BYTES = 32 * 1024;

export const REPORT_TEXT_ATTACHMENT_FILENAME = "report-text.txt";

/** `support.ts`'s own contexts, in the order they are dropped. */
const OWN_CONTEXTS_LARGEST_FIRST = [
  "layer0",
  "appMetrics",
  "processMetrics",
] as const;

/** Bounded, so it can ride as a Sentry tag. */
export type FeedbackTrim =
  | "message"
  | "breadcrumbs"
  | "message+breadcrumbs"
  | "breadcrumbs+contexts"
  | "message+breadcrumbs+contexts";

export const REPORT_TRIMMED_TAG = "reportTrimmed";

export interface BoundFeedbackEventResult {
  readonly event: Event;
  /** `null` when the event already fit and was returned as given. */
  readonly trimmed: FeedbackTrim | null;
  readonly originalBytes: number;
  readonly sentBytes: number;
}

function serializedBytes(event: Event): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

function feedbackMessageOf(event: Event): string | null {
  const feedback = event.contexts?.feedback;
  const message =
    feedback !== undefined && feedback !== null
      ? (feedback as { message?: unknown }).message
      : undefined;
  return typeof message === "string" ? message : null;
}

/**
 * The first `keepBytes` of `text`, cut back to the last line break (or, when
 * the kept head has none, the last space) so the inline head ends on a
 * boundary a reader expects. A multi-byte character split by the byte cut is
 * dropped with the tail rather than left as U+FFFD.
 */
export function headOfText(text: string, keepBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= keepBytes) return text;
  let head = bytes.subarray(0, keepBytes).toString("utf8");
  if (head.endsWith("�")) head = head.slice(0, -1);
  const lastBreak = head.lastIndexOf("\n");
  if (lastBreak > 0) return head.slice(0, lastBreak);
  const lastSpace = head.lastIndexOf(" ");
  return lastSpace > 0 ? head.slice(0, lastSpace) : head;
}

function trimName(
  message: boolean,
  breadcrumbs: boolean,
  contexts: boolean,
): FeedbackTrim | null {
  if (contexts) {
    return message ? "message+breadcrumbs+contexts" : "breadcrumbs+contexts";
  }
  if (breadcrumbs) return message ? "message+breadcrumbs" : "breadcrumbs";
  return message ? "message" : null;
}

/**
 * Bounds a `feedback` event to {@link FEEDBACK_EVENT_BUDGET_BYTES}. The input
 * event is not mutated; `hint.attachments` is extended in place when the
 * report text is moved out, because the SDK reads attachments from this same
 * hint object when it builds the envelope.
 *
 * Any other event type is returned as given.
 */
export function boundFeedbackEvent(
  event: Event,
  hint: EventHint,
): BoundFeedbackEventResult {
  const originalBytes = serializedBytes(event);
  if (
    event.type !== "feedback" ||
    originalBytes <= FEEDBACK_EVENT_BUDGET_BYTES
  ) {
    return { event, trimmed: null, originalBytes, sentBytes: originalBytes };
  }

  let bounded: Event = { ...event };
  let sentBytes = originalBytes;
  let messageMoved = false;
  let breadcrumbsDropped = false;
  let contextsDropped = false;

  const message = feedbackMessageOf(bounded);
  if (
    message !== null &&
    Buffer.byteLength(message, "utf8") > FEEDBACK_MESSAGE_KEEP_BYTES
  ) {
    const attachment: Attachment = {
      filename: REPORT_TEXT_ATTACHMENT_FILENAME,
      data: message,
      contentType: "text/plain",
    };
    hint.attachments = [...(hint.attachments ?? []), attachment];
    const head = headOfText(message, FEEDBACK_MESSAGE_KEEP_BYTES);
    const marker = `[Report text continues in the attachment ${REPORT_TEXT_ATTACHMENT_FILENAME} (${message.length} characters in total).]`;
    bounded = {
      ...bounded,
      contexts: {
        ...bounded.contexts,
        feedback: {
          ...bounded.contexts?.feedback,
          message: `${head}\n\n${marker}`,
        },
      },
    };
    messageMoved = true;
    sentBytes = serializedBytes(bounded);
  }

  if (
    sentBytes > FEEDBACK_EVENT_BUDGET_BYTES &&
    bounded.breadcrumbs !== undefined
  ) {
    const { breadcrumbs: _dropped, ...withoutBreadcrumbs } = bounded;
    bounded = withoutBreadcrumbs;
    breadcrumbsDropped = true;
    sentBytes = serializedBytes(bounded);
  }

  for (const name of OWN_CONTEXTS_LARGEST_FIRST) {
    if (sentBytes <= FEEDBACK_EVENT_BUDGET_BYTES) break;
    if (bounded.contexts === undefined || !(name in bounded.contexts)) continue;
    const { [name]: _dropped, ...rest } = bounded.contexts;
    bounded = { ...bounded, contexts: rest };
    contextsDropped = true;
    sentBytes = serializedBytes(bounded);
  }

  const trimmed = trimName(messageMoved, breadcrumbsDropped, contextsDropped);
  if (trimmed !== null) {
    bounded = {
      ...bounded,
      tags: { ...bounded.tags, [REPORT_TRIMMED_TAG]: trimmed },
      contexts: {
        ...bounded.contexts,
        reportSize: { originalBytes, sentBytes },
      },
    };
    sentBytes = serializedBytes(bounded);
  }
  return { event: bounded, trimmed, originalBytes, sentBytes };
}
