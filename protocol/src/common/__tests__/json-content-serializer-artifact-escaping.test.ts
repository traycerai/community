import { describe, expect, it } from "vitest";

import type { JsonContent } from "../registry";
import {
  jsonContentToArtifactMarkdown,
  jsonContentToMarkdown,
} from "../json-content-serializer";

/**
 * `jsonContentToArtifactMarkdown` escapes plain text wherever the parser would
 * otherwise read markup, so the md -> doc -> md pass every artifact write runs
 * is a fixed point (traycer#1563). `jsonContentToMarkdown` keeps the raw text:
 * prompts are read by a model or a person, who gains nothing from a backslash.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

const OPTIONS = { mentionFormat: "llm", platform: "POSIX" } as const;

function text(value: string, marks: Mark[] | undefined): JsonContent {
  return marks
    ? { type: "text", text: value, marks }
    : { type: "text", text: value };
}

function plain(value: string): JsonContent {
  return text(value, undefined);
}

function paragraph(content: JsonContent[]): JsonContent {
  return { type: "paragraph", content };
}

function doc(content: JsonContent[]): JsonContent {
  return { type: "doc", content };
}

function paragraphDoc(content: JsonContent[]): JsonContent {
  return doc([paragraph(content)]);
}

function listItem(content: JsonContent[]): JsonContent {
  return { type: "listItem", content };
}

function bulletList(items: JsonContent[]): JsonContent {
  return { type: "bulletList", content: items };
}

function artifact(content: JsonContent): string {
  return jsonContentToArtifactMarkdown(content, OPTIONS);
}

function prompt(content: JsonContent): string {
  return jsonContentToMarkdown(content, OPTIONS);
}

function artifactOf(value: string): string {
  return artifact(paragraphDoc([plain(value)]));
}

function tableDoc(content: JsonContent[]): JsonContent {
  const cell = (body: JsonContent[], header: boolean): JsonContent => ({
    type: header ? "tableHeader" : "tableCell",
    content: [paragraph(body)],
  });
  return doc([
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell([plain("h")], true)] },
        { type: "tableRow", content: [cell(content, false)] },
      ],
    },
  ]);
}

describe("artifact text escaping: inline characters", () => {
  it("escapes an asterisk", () => {
    expect(artifactOf("a * b")).toBe("a \\* b");
  });

  it("escapes a backtick", () => {
    expect(artifactOf("a ` b")).toBe("a \\` b");
  });

  it("escapes a tilde", () => {
    expect(artifactOf("a ~ b")).toBe("a \\~ b");
  });

  it("escapes an opening bracket and leaves a closing bracket alone outside a link", () => {
    expect(artifactOf("a [b] c")).toBe("a \\[b] c");
  });

  it("escapes an underscore that is not intraword", () => {
    expect(artifactOf("a _b_ c")).toBe("a \\_b\\_ c");
  });

  it("escapes an angle bracket only before a letter, slash, bang or question mark", () => {
    expect(artifactOf("a <b> c < d")).toBe("a \\<b> c < d");
    expect(artifactOf("a </b> c")).toBe("a \\</b> c");
    expect(artifactOf("a <!-- c")).toBe("a \\<!-- c");
    expect(artifactOf("a <?x c")).toBe("a \\<?x c");
    expect(artifactOf("a <3 c")).toBe("a <3 c");
  });

  it("escapes an ampersand only before a complete entity reference", () => {
    expect(artifactOf("&amp; and AT&T")).toBe("\\&amp; and AT&T");
  });

  it("escapes a backslash before ASCII punctuation and at the end of a text segment", () => {
    expect(artifactOf("a\\*b")).toBe("a\\\\\\*b");
    expect(artifactOf("a\\")).toBe("a\\\\");
  });

  it("leaves a backslash before a letter alone", () => {
    expect(artifactOf("a\\b")).toBe("a\\b");
  });

  it("escapes a closing bracket inside link text", () => {
    const linked = paragraphDoc([
      text("a]b", [{ type: "link", attrs: { href: "https://example.com/x" } }]),
    ]);
    expect(artifact(linked)).toBe("[a\\]b](https://example.com/x)");
  });
});

describe("artifact text escaping: text that must not change", () => {
  it("leaves intraword underscores in identifiers alone", () => {
    expect(artifactOf("foo_bar_baz and snake_case_name")).toBe(
      "foo_bar_baz and snake_case_name",
    );
  });

  it("leaves text inside a code mark literal", () => {
    expect(artifact(paragraphDoc([text("_ * \\ [", [{ type: "code" }])]))).toBe(
      "`_ * \\ [`",
    );
  });

  it("leaves a code block's text literal", () => {
    const codeBlock: JsonContent = {
      type: "codeBlock",
      attrs: { language: "" },
      content: [plain("_ * \\ [ # x")],
    };
    expect(artifact(doc([codeBlock]))).toBe("```\n_ * \\ [ # x\n```");
  });

  it("escapes a link's text but not its href", () => {
    const linked = paragraphDoc([
      text("a_b *c*", [
        { type: "link", attrs: { href: "https://example.com/_x_" } },
      ]),
    ]);
    expect(artifact(linked)).toBe("[a_b \\*c\\*](https://example.com/_x_)");
  });

  it("writes a link whose text is its absolute URL as an autolink without escapes", () => {
    const linked = paragraphDoc([
      text("https://example.com/_x_", [
        { type: "link", attrs: { href: "https://example.com/_x_" } },
      ]),
    ]);
    expect(artifact(linked)).toBe("<https://example.com/_x_>");
  });
});

describe("artifact text escaping: line-start block markers", () => {
  it("escapes an ATX heading marker", () => {
    expect(artifactOf("# x")).toBe("\\# x");
  });

  it("escapes a dash bullet marker", () => {
    expect(artifactOf("- x")).toBe("\\- x");
  });

  it("escapes a plus bullet marker", () => {
    expect(artifactOf("+ x")).toBe("\\+ x");
  });

  it("escapes a block quote marker", () => {
    expect(artifactOf("> x")).toBe("\\> x");
  });

  it("escapes an ordered list marker after the digits", () => {
    expect(artifactOf("1. x")).toBe("1\\. x");
  });

  it("escapes a long ordered list marker", () => {
    expect(artifactOf("2024. A year")).toBe("2024\\. A year");
  });

  it("escapes a thematic break", () => {
    expect(artifactOf("---")).toBe("\\---");
  });

  it("leaves a hashtag without a space alone", () => {
    expect(artifactOf("#hashtag")).toBe("#hashtag");
  });

  it("leaves a dash without a space alone", () => {
    expect(artifactOf("-x")).toBe("-x");
  });

  it("escapes a heading marker inside a bullet list item", () => {
    const list = doc([bulletList([listItem([paragraph([plain("# kept")])])])]);
    expect(artifact(list)).toBe("- \\# kept");
  });

  it("escapes a task checkbox inside a bullet list item", () => {
    const list = doc([
      bulletList([listItem([paragraph([plain("[ ] not a task")])])]),
    ]);
    expect(artifact(list)).toBe("- \\[ ] not a task");
  });
});

describe("artifact text escaping: later lines of a paragraph", () => {
  it("escapes an ordered marker of 1 on a later line", () => {
    expect(artifactOf("a\n1. b")).toBe("a\n1\\. b");
  });

  it("leaves an ordered marker other than 1 on a later line alone", () => {
    expect(artifactOf("a\n2. b")).toBe("a\n2. b");
  });

  it("escapes a setext underline on a later line", () => {
    expect(artifactOf("a\n===")).toBe("a\n\\===");
  });

  it("does not escape a line start inside an inline code span", () => {
    const content = paragraphDoc([
      plain("a "),
      text("x\n# y", [{ type: "code" }]),
    ]);
    expect(artifact(content)).toBe("a `x\n# y`");
  });
});

describe("artifact text escaping: table cells", () => {
  it("escapes a cell's markup characters as well as its pipes", () => {
    const content = tableDoc([plain("*x* p_q _r | s")]);
    expect(artifact(content)).toBe(
      "| h |\n| --- |\n| \\*x\\* p_q \\_r \\| s |",
    );
  });

  it("doubles a backslash in front of an escaped pipe so the cell does not split", () => {
    const content = tableDoc([plain("a\\|b")]);
    expect(artifact(content)).toBe("| h |\n| --- |\n| a\\\\\\|b |");
  });

  it("leaves code text in a cell to the pipe-only code rule", () => {
    const content = tableDoc([text("c_d*e\\f|g", [{ type: "code" }])]);
    expect(artifact(content)).toBe(prompt(content));
    expect(artifact(content)).toBe("| h |\n| --- |\n| `c_d*e\\f\\|g` |");
  });

  it("keeps the prompt serializer's cell escaping", () => {
    const content = tableDoc([plain("p_q and * | \\")]);
    expect(prompt(content)).toBe("| h |\n| --- |\n| p_q and * \\| \\\\ |");
  });
});

describe("artifact block quotes", () => {
  const quoteOf = (blocks: JsonContent[]): JsonContent =>
    doc([{ type: "blockquote", content: blocks }]);

  it("writes a quote as a markdown block quote with its marks", () => {
    const content = quoteOf([
      paragraph([plain("quote "), text("b", [{ type: "bold" }])]),
    ]);
    expect(artifact(content)).toBe("> quote **b**");
  });

  it("separates two paragraphs of a quote with an empty quote line", () => {
    const content = quoteOf([paragraph([plain("a")]), paragraph([plain("b")])]);
    expect(artifact(content)).toBe("> a\n>\n> b");
  });

  it("quotes a bullet list inside a quote", () => {
    const content = quoteOf([
      bulletList([
        listItem([paragraph([plain("x")])]),
        listItem([paragraph([plain("y")])]),
      ]),
    ]);
    expect(artifact(content)).toBe("> - x\n> - y");
  });

  it("keeps the prompt serializer's user_quoted_section form", () => {
    const content = quoteOf([
      paragraph([plain("quote "), text("b", [{ type: "bold" }])]),
    ]);
    expect(prompt(content)).toBe(
      "<user_quoted_section>quote b</user_quoted_section>",
    );
  });
});

describe("prompt serializer leaves plain text raw", () => {
  it("does not escape emphasis characters", () => {
    expect(prompt(paragraphDoc([plain("a *b* c")]))).toBe("a *b* c");
  });
});

// A later paragraph's blank line belongs to traycerai/traycer#2574, which
// adds it for every caller; these pin only what stays artifact-specific.
describe("artifact list items with several blocks", () => {
  it("keeps a first block's later lines inside the item", () => {
    const list = doc([
      bulletList([
        listItem([
          {
            type: "blockquote",
            content: [paragraph([plain("a")]), paragraph([plain("b")])],
          },
        ]),
      ]),
    ]);
    expect(artifact(list)).toBe("- > a\n  >\n  > b");
  });

  it("puts every line of a later block at the item's content column", () => {
    const list = doc([
      bulletList([
        listItem([
          paragraph([plain("a")]),
          {
            type: "blockquote",
            content: [paragraph([plain("q")]), paragraph([plain("r")])],
          },
        ]),
      ]),
    ]);
    expect(artifact(list)).toBe("- a\n  > q\n  >\n  > r");
  });
});
