import { describe, expect, it } from "vitest";
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
