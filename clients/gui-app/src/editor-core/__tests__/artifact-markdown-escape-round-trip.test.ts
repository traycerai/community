import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "@tiptap/y-tiptap";
import type { JsonContent } from "@traycer/protocol/common/registry";
import { jsonContentToArtifactMarkdown } from "@traycer/protocol/common/json-content-serializer";
import { artifactDocumentBundle } from "../artifact-document-bundle";

/**
 * The artifact serializer's markdown must be a fixed point of
 * md -> doc -> md, and re-ingesting it must produce the identical Yjs
 * document. The disk mirror writes serializer output and the ingest path
 * parses it back, so any markup the serializer leaves unescaped changes the
 * document on the next pass and shows up as sync churn (traycer#1563).
 */

const { markdownManager, schema } = artifactDocumentBundle;

const OPTIONS = { mentionFormat: "llm", platform: "POSIX" } as const;

const CORPUS: ReadonlyArray<{ readonly name: string; readonly md: string }> = [
  {
    name: "identifier with underscores",
    md: "foo_bar_baz and snake_case_name",
  },
  { name: "bare URL with underscores", md: "see https://example.com/a_b_c" },
  { name: "autolink with underscores", md: "<https://example.com/a_b>" },
  { name: "inline code holding markup", md: "`a*b_c[d]`" },
  { name: "escaped asterisk", md: "2 \\* 3" },
  { name: "escaped backtick", md: "a \\` b" },
  { name: "escaped open bracket", md: "\\[x\\]" },
  { name: "escaped close bracket", md: "a \\] b" },
  { name: "escaped angle brackets", md: "\\<b\\>" },
  { name: "escaped leading underscore", md: "\\_leading" },
  { name: "escaped tildes", md: "\\~tilde\\~" },
  { name: "escaped entity", md: "\\&amp;" },
  { name: "backslash before punctuation", md: "a \\\\* b" },
  { name: "escaped heading marker", md: "\\# not a heading" },
  { name: "escaped bullet marker", md: "\\- not a list" },
  { name: "escaped ordered marker", md: "1\\. not ordered" },
  { name: "escaped quote marker", md: "\\> not a quote" },
  { name: "escaped thematic break", md: "\\---" },
  {
    name: "link with underscores",
    md: "[text_with_underscore](https://example.com/x_y)",
  },
  {
    name: "table with asterisk and underscore in a cell",
    md: "| h | i |\n| --- | --- |\n| a\\*b | c\\_d |",
  },
  { name: "blockquote with bold", md: "> quoted **bold**" },
  // A list item's later paragraph is traycerai/traycer#2574's fixed point.
  { name: "heading with asterisk", md: "# Title with \\* star" },
  { name: "bold containing underscore", md: "**bold \\_ text**" },
  { name: "italic containing underscore", md: "*italic \\_ text*" },
];

function parseJson(md: string): JsonContent {
  return markdownManager.parse(md);
}

function fragmentOf(json: JsonContent): Y.XmlFragment {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  prosemirrorJSONToYXmlFragment(schema, json, fragment);
  return fragment;
}

function isJsonContent(value: unknown): value is JsonContent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function proseMirrorJsonOf(fragment: Y.XmlFragment): JsonContent {
  const json: unknown = yXmlFragmentToProseMirrorRootNode(
    fragment,
    schema,
  ).toJSON();
  if (!isJsonContent(json)) {
    throw new Error("The fragment did not convert to a document.");
  }
  return json;
}

function serialize(fragment: Y.XmlFragment): string {
  return jsonContentToArtifactMarkdown(proseMirrorJsonOf(fragment), OPTIONS);
}

function textOf(node: JsonContent): string {
  const own = node.text ?? "";
  const children = (node.content ?? []).map(textOf).join("\n");
  return own + children;
}

describe("artifact markdown escaping round trip (traycer#1563)", () => {
  describe.each(CORPUS)("$name", ({ md }) => {
    const json1 = parseJson(md);
    const fragment1 = fragmentOf(json1);
    const md1 = serialize(fragment1);
    const json2 = parseJson(md1);
    const fragment2 = fragmentOf(json2);
    const md2 = serialize(fragment2);

    it("is a fixed point after one pass", () => {
      expect(md2).toBe(md1);
    });

    it("re-ingesting the serialized markdown gives an identical Yjs document", () => {
      expect(fragment2.toJSON()).toBe(fragment1.toJSON());
      expect(proseMirrorJsonOf(fragment2)).toEqual(
        proseMirrorJsonOf(fragment1),
      );
    });

    it("keeps the text content and leaks no escape backslash into it", () => {
      expect(textOf(json2)).toBe(textOf(json1));
    });
  });
});
