import { describe, expect, it } from "vitest";

import type { JsonContent } from "../registry";
import { jsonContentToMarkdown } from "../json-content-serializer";

describe("jsonContentToMarkdown ordered lists", () => {
  it("preserves an explicit starting number and increments later items", () => {
    expect(toMarkdown(orderedList(["First", "Second"], 2))).toBe(
      "2. First\n3. Second",
    );
  });

  it("keeps the default start at one when the attribute is absent", () => {
    expect(toMarkdown(orderedList(["First", "Second"], null))).toBe(
      "1. First\n2. Second",
    );
  });

  it("renders a code block that follows the first child of a bullet item at the item's content column", () => {
    expect(
      toMarkdown({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "a" }] },
                  {
                    type: "codeBlock",
                    attrs: { language: "js" },
                    content: [{ type: "text", text: "x" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe("- a\n  ```js\n  x\n  ```");
  });
});

function orderedList(
  items: ReadonlyArray<string>,
  start: number | null,
): JsonContent {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: start === null ? undefined : { start },
        content: items.map((text) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text }],
            },
          ],
        })),
      },
    ],
  };
}

function toMarkdown(content: JsonContent): string {
  return jsonContentToMarkdown(content, {
    mentionFormat: "llm",
    platform: "POSIX",
  });
}
