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
      expect(childTypes(items[0])).toEqual(["paragraph"]);
      expect(paragraphText((items[0].content ?? [])[0])).toBe("b");

      const md2 = jsonContentToMarkdown(parsed, SERIALIZER_OPTIONS);
      const md3 = jsonContentToMarkdown(
        artifactDocumentBundle.markdownManager.parse(md2),
        SERIALIZER_OPTIONS,
      );
      expect(md3).toBe(md2);
    });
  }
});

// Lines after an item's first line join that line's paragraph while they open
// no block of their own, whether they are indented or lazily at column zero.
// The soft break arrives as a newline inside the paragraph's text, so a
// paragraph's text is the concatenation of its text nodes.

function parseMarkdown(markdown: string): JsonContent {
  return artifactDocumentBundle.markdownManager.parse(markdown);
}

function childTypes(node: JsonContent): string[] {
  return (node.content ?? []).map((child) => child.type ?? "");
}

function onlyListItem(markdown: string, listType: string): JsonContent {
  const top = parseMarkdown(markdown).content ?? [];
  expect(top.map((node) => node.type)).toEqual([listType]);
  const items = top[0].content ?? [];
  expect(items).toHaveLength(1);
  return items[0];
}

function paragraphText(paragraph: JsonContent): string {
  return collectText(paragraph).join("");
}

function nestedInOnlyItem(markdown: string, listType: string): JsonContent {
  const parent = onlyListItem(markdown, listType);
  expect(childTypes(parent)).toEqual(["paragraph", "taskList"]);
  const nestedItems = parent.content?.[1].content ?? [];
  expect(nestedItems).toHaveLength(1);
  return nestedItems[0];
}

function expectJoinedParagraph(item: JsonContent): void {
  expect(childTypes(item)).toEqual(["paragraph"]);
  expect(paragraphText((item.content ?? [])[0])).toBe("First\nSecond");
}

describe("artifact markdown list continuation lines join the item's paragraph", () => {
  it("joins an indented continuation of a task item", () => {
    expectJoinedParagraph(onlyListItem("- [ ] First\n  Second", "taskList"));
  });

  it("joins a lazy column-zero continuation of a task item", () => {
    expectJoinedParagraph(onlyListItem("- [ ] First\nSecond", "taskList"));
  });

  it("joins the continuation of a task item nested under a bullet item", () => {
    expectJoinedParagraph(
      nestedInOnlyItem("- a\n  - [ ] First\n    Second", "bulletList"),
    );
  });

  for (const marker of MARKERS) {
    const p = pad(marker);

    it(`joins the continuation of a task item nested under an ordered item at ${marker}`, () => {
      expectJoinedParagraph(
        nestedInOnlyItem(
          `${marker} a\n${p}- [ ] First\n${p}  Second`,
          "orderedList",
        ),
      );
    });

    it(`keeps the indented continuation of an ordered item at ${marker} in one paragraph`, () => {
      expectJoinedParagraph(
        onlyListItem(`${marker} First\n${p}Second`, "orderedList"),
      );
    });
  }

  it("keeps the indented continuation of a bullet item in one paragraph", () => {
    expectJoinedParagraph(onlyListItem("- First\n  Second", "bulletList"));
  });

  const BLOCK_STARTS: ReadonlyArray<readonly [string, string, string]> = [
    ["a bullet list", "- [ ] First\n  - x", "bulletList"],
    ["an ordered list", "- [ ] First\n  1. x", "orderedList"],
    ["a fence", "- [ ] First\n  ```\n  code\n  ```", "codeBlock"],
    ["a blockquote", "- [ ] First\n  > q", "blockquote"],
  ];

  for (const [name, markdown, blockType] of BLOCK_STARTS) {
    it(`nests ${name} under the task item instead of joining it`, () => {
      const item = onlyListItem(markdown, "taskList");
      expect(childTypes(item)).toEqual(["paragraph", blockType]);
      expect(paragraphText((item.content ?? [])[0])).toBe("First");
    });
  }

  const FIXED_POINT_SHAPES: ReadonlyArray<readonly [string, string]> = [
    ["a task item", "- [ ] First\n  Second"],
    ["a task item under a bullet item", "- a\n  - [ ] First\n    Second"],
    ...MARKERS.map((marker): readonly [string, string] => [
      `a task item under an ordered item at ${marker}`,
      `${marker} a\n${pad(marker)}- [ ] First\n${pad(marker)}  Second`,
    ]),
  ];

  for (const [name, markdown] of FIXED_POINT_SHAPES) {
    it(`writes ${name} back byte for byte over three passes`, () => {
      const pass1 = roundTrip(markdown);
      expect(pass1).toBe(markdown);
      const pass2 = roundTrip(pass1);
      expect(pass2).toBe(markdown);
      expect(roundTrip(pass2)).toBe(markdown);
    });
  }

  const EMPTY_FIRST_LINE: ReadonlyArray<
    readonly [string, string, string, string]
  > = [
    ["a task item", "taskList", "- [ ] \n  b", "- [ ] b"],
    ["a bullet item", "bulletList", "-\n  b", "- b"],
    ["an ordered item", "orderedList", "1. \n   b", "1. b"],
  ];

  for (const [name, listType, markdown, written] of EMPTY_FIRST_LINE) {
    it(`takes the continuation as the text of ${name} with an empty first line`, () => {
      const item = onlyListItem(markdown, listType);
      // The empty first line used to leave a bare text node in a bullet item,
      // which the editor schema rejects: the item holds one paragraph.
      expect(childTypes(item)).toEqual(["paragraph"]);
      expect(paragraphText((item.content ?? [])[0])).toBe("b");

      const pass1 = roundTrip(markdown);
      expect(pass1).toBe(written);
      const pass2 = roundTrip(pass1);
      expect(pass2).toBe(written);
      expect(roundTrip(pass2)).toBe(written);
    });
  }

  it("holds the continuation of a nested bullet item with an empty first line in one paragraph", () => {
    const parent = onlyListItem("- a\n  - x\n  -\n    b", "bulletList");
    expect(childTypes(parent)).toEqual(["paragraph", "bulletList"]);
    const nestedItems = parent.content?.[1].content ?? [];
    expect(nestedItems).toHaveLength(2);
    expect(childTypes(nestedItems[1])).toEqual(["paragraph"]);
    expect(paragraphText((nestedItems[1].content ?? [])[0])).toBe("b");
  });

  it("keeps a hard-broken task item in one paragraph and converges from the editor JSON", () => {
    const source = listDoc({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [hardBreakParagraph("First", "Second")],
        },
      ],
    });
    const md1 = jsonContentToMarkdown(source, SERIALIZER_OPTIONS);
    const parsed = parseMarkdown(md1);
    const item = (parsed.content ?? [])[0].content?.[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    expectJoinedParagraph(item);

    const md2 = jsonContentToMarkdown(parsed, SERIALIZER_OPTIONS);
    const md3 = jsonContentToMarkdown(parseMarkdown(md2), SERIALIZER_OPTIONS);
    expect(md2).toBe(md1);
    expect(md3).toBe(md1);
  });
});

// A nested list whose first item is empty writes a bare `-` right under the
// parent's paragraph. Read directly under that line it is a setext heading
// underline, so the serializer puts a blank line before such a list.

function emptyText(): JsonContent {
  return { type: "paragraph" };
}

function textPara(text: string): JsonContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

const NESTED_EMPTY_ITEMS: ReadonlyArray<
  readonly [string, ReadonlyArray<JsonContent>, string | null]
> = [
  ["an empty nested item", [{ type: "listItem" }], null],
  [
    "an empty first paragraph before a paragraph in the nested item",
    [{ type: "listItem", content: [emptyText(), textPara("b")] }],
    "b",
  ],
];

function outerItem(
  outer: "bulletList" | "taskList" | "orderedList",
  start: number,
  nested: ReadonlyArray<JsonContent>,
): JsonContent {
  const inner: JsonContent = { type: "bulletList", content: [...nested] };
  const content = [textPara("a"), inner];
  if (outer === "taskList") {
    return listDoc({
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: false }, content }],
    });
  }
  if (outer === "orderedList") {
    return listDoc({
      type: "orderedList",
      attrs: { start },
      content: [{ type: "listItem", content }],
    });
  }
  return listDoc({
    type: "bulletList",
    content: [{ type: "listItem", content }],
  });
}

const NESTED_PARENTS: ReadonlyArray<
  readonly [string, "bulletList" | "taskList" | "orderedList", number]
> = [
  ["a bullet item", "bulletList", 1],
  ["a task item", "taskList", 1],
  ["an ordered item at 1.", "orderedList", 1],
  ["an ordered item at 10.", "orderedList", 10],
];

describe("keeps an item's paragraph when a nested list opens with an empty bullet item", () => {
  for (const [parentName, outer, start] of NESTED_PARENTS) {
    for (const [nestedName, nested, nestedText] of NESTED_EMPTY_ITEMS) {
      it(`under ${parentName}: ${nestedName}`, () => {
        const md1 = jsonContentToMarkdown(
          outerItem(outer, start, nested),
          SERIALIZER_OPTIONS,
        );
        const parsed = parseMarkdown(md1);

        const top = parsed.content ?? [];
        expect(top.map((node) => node.type)).toEqual([outer]);
        const items = top[0].content ?? [];
        expect(items).toHaveLength(1);
        const children = items[0].content ?? [];
        expect(childTypes(items[0])).toEqual(["paragraph", "bulletList"]);
        expect(paragraphText(children[0])).toBe("a");
        if (nestedText !== null) {
          const nestedItem = (children[1].content ?? [])[0];
          expect(childTypes(nestedItem)).toEqual(["paragraph"]);
          expect(paragraphText((nestedItem.content ?? [])[0])).toBe(nestedText);
        }

        const md2 = jsonContentToMarkdown(parsed, SERIALIZER_OPTIONS);
        const md3 = jsonContentToMarkdown(
          parseMarkdown(md2),
          SERIALIZER_OPTIONS,
        );
        expect(md3).toBe(md2);
      });
    }
  }

  it("is not needed for a nested ordered list with an empty first item", () => {
    const parent = onlyListItem("- a\n  1. ", "bulletList");
    expect(childTypes(parent)).toEqual(["paragraph", "orderedList"]);
    expect(paragraphText((parent.content ?? [])[0])).toBe("a");
    const md2 = roundTrip("- a\n  1. ");
    expect(roundTrip(md2)).toBe(md2);
  });
});
