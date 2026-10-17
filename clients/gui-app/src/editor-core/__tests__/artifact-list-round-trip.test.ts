import { describe, expect, it } from "vitest";
import type { JsonContent } from "@traycer/protocol/common/registry";
import { jsonContentToMarkdown } from "@traycer/protocol/common/json-content-serializer";
import { artifactDocumentBundle } from "../artifact-document-bundle";

// The serializer writes a nested list and a fenced block at the parent item's
// content column. A parser that strips a different number of columns moves
// them on every pass, so a document drifts a little further with each save.

const MARKERS = ["1.", "10.", "100."];

function pad(marker: string): string {
  return " ".repeat(marker.length + 1);
}

function roundTrip(markdown: string): string {
  return jsonContentToMarkdown(
    artifactDocumentBundle.markdownManager.parse(markdown),
    { mentionFormat: "llm", platform: "POSIX" },
  );
}

function shapes(marker: string): ReadonlyArray<readonly [string, string]> {
  const p = pad(marker);
  return [
    [
      "a fence under an ordered item",
      `${marker} a\n${p}\`\`\`\n${p}code\n${p}\`\`\``,
    ],
    [
      "a second paragraph and a fence in an ordered item",
      `${marker} First item\n\n${p}Second paragraph\n${p}\`\`\`js\n${p}x\n${p}\`\`\``,
    ],
    [
      "a fence-first ordered item",
      `${marker} \n${p}\`\`\`\n${p}code\n${p}\`\`\``,
    ],
    [
      "a task list under an ordered item",
      `${marker} a\n${p}- [ ] t\n${p}  \`\`\`\n${p}  code\n${p}  \`\`\``,
    ],
    [
      "an ordered list under a task item",
      `- [ ] t\n  ${marker} a\n  ${p}\`\`\`\n  ${p}code\n  ${p}\`\`\``,
    ],
    [
      "an ordered list under an ordered item",
      `${marker} one\n${p}${marker} nested\n${p}${p}\`\`\`\n${p}${p}x\n${p}${p}\`\`\``,
    ],
  ];
}

const FIXED_POINTS: ReadonlyArray<readonly [string, string]> = [
  ["a second paragraph in a task item", "- [ ] First\n\n  Second"],
  ["an empty first paragraph before a paragraph in a task item", "- [ ] \n  b"],
  ["a paragraph after a nested list", "- a\n  - x\n\n  c"],
  ["a fence-first task item", "- [ ] \n  ```\n  code\n  ```"],
  ["an empty ordered item mid-list", "1. a\n2. \n3. c"],
  ["an empty last ordered item", "1. a\n2. "],
];

describe("artifact markdown list round trip", () => {
  for (const [name, markdown] of FIXED_POINTS) {
    it(`reaches a fixed point for ${name}`, () => {
      const first = roundTrip(markdown);
      expect(first).toBe(markdown);
      expect(roundTrip(first)).toBe(first);
    });
  }

  for (const marker of MARKERS) {
    for (const [name, markdown] of shapes(marker)) {
      it(`reaches a fixed point for ${name} at ${marker}`, () => {
        const first = roundTrip(markdown);
        expect(first).toBe(markdown);
        expect(roundTrip(first)).toBe(first);
      });
    }
  }
});

describe("artifact markdown paren-delimited ordered item", () => {
  it("keeps the second paragraph inside the item over two passes", () => {
    const first = roundTrip("1) First item\n\n   Second paragraph");
    expect(first).toBe("1. First item\n\n   Second paragraph");
    expect(roundTrip(first)).toBe(first);
  });
});

// A hard break in an item's first paragraph writes a bare newline. The
// serializer must put the next line at the item's content column, or the
// parser moves it out of the item into a top-level paragraph.

const SERIALIZER_OPTIONS = { mentionFormat: "llm", platform: "POSIX" } as const;

function hardBreakParagraph(first: string, second: string): JsonContent {
  return {
    type: "paragraph",
    content: [
      { type: "text", text: first },
      { type: "hardBreak" },
      { type: "text", text: second },
    ],
  };
}

function collectText(node: JsonContent): string[] {
  const own =
    node.type === "text" && node.text !== undefined ? [node.text] : [];
  return [...own, ...(node.content ?? []).flatMap(collectText)];
}

function listDoc(list: JsonContent): JsonContent {
  return { type: "doc", content: [list] };
}

const HARD_BREAK_CASES: ReadonlyArray<readonly [string, string, JsonContent]> =
  [
    [
      "a task item",
      "taskList",
      listDoc({
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [hardBreakParagraph("First", "Second")],
          },
        ],
      }),
    ],
    [
      "a task item whose second line looks like a bullet",
      "taskList",
      listDoc({
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [hardBreakParagraph("First", "- Second")],
          },
        ],
      }),
    ],
    [
      "a bullet item",
      "bulletList",
      listDoc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [hardBreakParagraph("First", "Second")],
          },
        ],
      }),
    ],
    ...[1, 10, 100].map((start): readonly [string, string, JsonContent] => [
      `an ordered item numbered ${String(start)}`,
      "orderedList",
      listDoc({
        type: "orderedList",
        attrs: { start },
        content: [
          {
            type: "listItem",
            content: [hardBreakParagraph("First", "Second")],
          },
        ],
      }),
    ]),
  ];

describe("artifact markdown list hard break in the first paragraph", () => {
  for (const [name, listType, source] of HARD_BREAK_CASES) {
    it(`keeps both lines inside ${name} and converges`, () => {
      const md1 = jsonContentToMarkdown(source, SERIALIZER_OPTIONS);
      const parsed = artifactDocumentBundle.markdownManager.parse(md1);

      const top = parsed.content ?? [];
      expect(top.map((node) => node.type)).toEqual([listType]);
      const items = top[0].content ?? [];
      expect(items).toHaveLength(1);
      const inside = collectText(items[0]).join("");
      expect(inside).toContain("First");
      expect(inside).toContain("Second");

      const md2 = jsonContentToMarkdown(parsed, SERIALIZER_OPTIONS);
      const md3 = jsonContentToMarkdown(
        artifactDocumentBundle.markdownManager.parse(md2),
        SERIALIZER_OPTIONS,
      );
      expect(md3).toBe(md2);
    });
  }
});

// An item whose first paragraph is empty writes its marker line with nothing on
// it. A blank line after that ends the item, so the next paragraph has to
// follow directly or it falls out of the list.

function emptyFirstParagraphItems(): JsonContent[] {
  return [
    { type: "paragraph" },
    { type: "paragraph", content: [{ type: "text", text: "b" }] },
  ];
}

const EMPTY_FIRST_PARAGRAPH_CASES: ReadonlyArray<
  readonly [string, string, JsonContent]
> = [
  [
    "a bullet item",
    "bulletList",
    listDoc({
      type: "bulletList",
      content: [{ type: "listItem", content: emptyFirstParagraphItems() }],
    }),
  ],
  [
    "a task item",
    "taskList",
    listDoc({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: emptyFirstParagraphItems(),
        },
      ],
    }),
  ],
  ...[1, 10, 100].map((start): readonly [string, string, JsonContent] => [
    `an ordered item numbered ${String(start)}`,
    "orderedList",
    listDoc({
      type: "orderedList",
      attrs: { start },
      content: [{ type: "listItem", content: emptyFirstParagraphItems() }],
    }),
  ]),
];

describe("artifact markdown list empty first paragraph before a paragraph", () => {
  for (const [name, listType, source] of EMPTY_FIRST_PARAGRAPH_CASES) {
    it(`keeps the paragraph inside ${name} and converges`, () => {
      const md1 = jsonContentToMarkdown(source, SERIALIZER_OPTIONS);
      const parsed = artifactDocumentBundle.markdownManager.parse(md1);

      const top = parsed.content ?? [];
      expect(top.map((node) => node.type)).toEqual([listType]);
      const items = top[0].content ?? [];
      expect(items).toHaveLength(1);
      expect(collectText(items[0])).toContain("b");

      const md2 = jsonContentToMarkdown(parsed, SERIALIZER_OPTIONS);
      const md3 = jsonContentToMarkdown(
        artifactDocumentBundle.markdownManager.parse(md2),
        SERIALIZER_OPTIONS,
      );
      expect(md3).toBe(md2);
    });
  }
});
