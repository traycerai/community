import { describe, expect, it } from "vitest";

import type { JsonContent } from "../registry";
import { jsonContentToMarkdown } from "../json-content-serializer";

// traycer#2357 item 4: the artifact parser reads `- [ ]` / `- [x]` into
// `taskList` / `taskItem` nodes. Without an arm for either, the serializer's
// default arm concatenated the items' text into one line.
describe("jsonContentToMarkdown task lists", () => {
  it("writes each item back as a checkbox line", () => {
    expect(
      toMarkdown(
        doc([
          taskList([
            taskItem(false, [paragraph("Write the spec")]),
            taskItem(true, [paragraph("Review it")]),
          ]),
        ]),
      ),
    ).toBe("- [ ] Write the spec\n- [x] Review it");
  });

  it("keeps a nested task list under its parent item", () => {
    expect(
      toMarkdown(
        doc([
          taskList([
            taskItem(false, [
              paragraph("Parent"),
              taskList([taskItem(true, [paragraph("Child")])]),
            ]),
          ]),
        ]),
      ),
    ).toBe("- [ ] Parent\n  - [x] Child");
  });

  it("separates a task list from the paragraph after it", () => {
    expect(
      toMarkdown(
        doc([
          taskList([taskItem(false, [paragraph("Only item")])]),
          paragraph("After"),
        ]),
      ),
    ).toBe("- [ ] Only item\n\nAfter");
  });

  it("keeps the space after the checkbox of an empty item mid-document", () => {
    expect(
      toMarkdown(
        doc([
          taskList([
            taskItem(false, [{ type: "paragraph" }]),
            taskItem(true, [paragraph("Next")]),
          ]),
        ]),
      ),
    ).toBe("- [ ] \n- [x] Next");
  });

  it("keeps the space after the checkbox of an empty item on the last line", () => {
    expect(
      toMarkdown(
        doc([
          taskList([
            taskItem(true, [paragraph("First")]),
            taskItem(false, [{ type: "paragraph" }]),
          ]),
        ]),
      ),
    ).toBe("- [x] First\n- [ ] ");
  });

  it("renders an unchecked box when attrs.checked is missing or not a boolean", () => {
    const item = (attrs: Record<string, unknown> | undefined): JsonContent => ({
      type: "taskItem",
      attrs,
      content: [paragraph("x")],
    });
    for (const attrs of [
      undefined,
      {},
      { checked: "true" },
      { checked: 1 },
      { checked: null },
    ]) {
      expect(toMarkdown(doc([taskList([item(attrs)])]))).toBe("- [ ] x");
    }
  });

  it("writes a second paragraph at the bullet's content column", () => {
    expect(
      toMarkdown(
        doc([
          taskList([
            taskItem(false, [paragraph("First"), paragraph("Second")]),
          ]),
        ]),
      ),
    ).toBe("- [ ] First\n  Second");
  });

  it("writes a code block under a task item at the item's content column", () => {
    expect(
      toMarkdown(
        doc([
          taskList([
            taskItem(false, [
              paragraph("a"),
              {
                type: "codeBlock",
                attrs: { language: "js" },
                content: [{ type: "text", text: "x" }],
              },
            ]),
          ]),
        ]),
      ),
    ).toBe("- [ ] a\n  ```js\n  x\n  ```");
  });

  it("nests a task list under a bullet item", () => {
    expect(
      toMarkdown(
        doc([
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  paragraph("Parent"),
                  taskList([taskItem(true, [paragraph("Child")])]),
                ],
              },
            ],
          },
        ]),
      ),
    ).toBe("- Parent\n  - [x] Child");
  });

  it("nests a bullet list under a task item", () => {
    expect(
      toMarkdown(
        doc([
          taskList([
            taskItem(false, [
              paragraph("Parent"),
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [paragraph("Child")] }],
              },
            ]),
          ]),
        ]),
      ),
    ).toBe("- [ ] Parent\n  - Child");
  });

  it("uses the configured bullet marker before the checkbox", () => {
    expect(
      jsonContentToMarkdown(
        doc([
          taskList([
            taskItem(false, [paragraph("a")]),
            taskItem(true, [paragraph("b")]),
          ]),
        ]),
        { mentionFormat: "llm", platform: "POSIX", bulletMarker: "*" },
      ),
    ).toBe("* [ ] a\n* [x] b");
  });

  it("does not throw on a top-level task item", () => {
    expect(() =>
      toMarkdown(doc([taskItem(true, [paragraph("Lone")])])),
    ).not.toThrow();
    expect(toMarkdown(doc([taskItem(true, [paragraph("Lone")])]))).toBe(
      "- [x] Lone",
    );
  });
});

function doc(content: JsonContent[]): JsonContent {
  return { type: "doc", content };
}

function taskList(items: JsonContent[]): JsonContent {
  return { type: "taskList", content: items };
}

function taskItem(checked: boolean, content: JsonContent[]): JsonContent {
  return { type: "taskItem", attrs: { checked }, content };
}

function paragraph(text: string): JsonContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function toMarkdown(content: JsonContent): string {
  return jsonContentToMarkdown(content, {
    mentionFormat: "llm",
    platform: "POSIX",
  });
}
