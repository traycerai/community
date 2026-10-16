import { describe, expect, it } from "vitest";
import { sidebarBulkDeleteIds } from "../epic-sidebar-selection";
import type {
  EpicTreeNodeType,
  TreeNode,
  TreeSlice,
} from "@/stores/epics/open-epic/types";

function node(
  id: string,
  parentId: string | null,
  type: EpicTreeNodeType,
): TreeNode {
  return {
    id,
    parentId,
    title: id,
    type,
    status: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function treeOf(nodes: readonly TreeNode[]): TreeSlice {
  return {
    rootIds: nodes.filter((n) => n.parentId === null).map((n) => n.id),
    childrenByParent: {},
    nodeById: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

describe("sidebarBulkDeleteIds", () => {
  const tree = treeOf([
    node("chat-root", null, "chat"),
    node("chat-child", "chat-root", "chat"),
    node("chat-grandchild", "chat-child", "chat"),
    node("agent-root", null, "terminal-agent"),
    node("spec-root", null, "spec"),
    node("ticket-child", "spec-root", "ticket"),
    node("ticket-orphan-sibling", null, "ticket"),
  ]);
  const types = new Map(
    Object.values(tree.nodeById).map((n) => [n.id, n.type]),
  );
  const isAgentId = (id: string): boolean =>
    types.get(id) === "chat" || types.get(id) === "terminal-agent";

  it("keeps every selected agent, deepest first, since an agent delete removes only itself", () => {
    expect(
      sidebarBulkDeleteIds({
        ids: ["chat-root", "agent-root", "chat-grandchild", "chat-child"],
        tree,
        isAgentId,
      }),
    ).toEqual(["chat-grandchild", "chat-child", "chat-root", "agent-root"]);
  });

  it("drops a selected descendant of a selected artifact, which the parent's delete cascades to", () => {
    expect(
      sidebarBulkDeleteIds({
        ids: ["ticket-child", "spec-root", "ticket-orphan-sibling"],
        tree,
        isAgentId,
      }),
    ).toEqual(["spec-root", "ticket-orphan-sibling"]);
  });

  it("applies each rule to its own family in a mixed selection", () => {
    expect(
      sidebarBulkDeleteIds({
        ids: ["spec-root", "ticket-child", "chat-root", "chat-child"],
        tree,
        isAgentId,
      }),
    ).toEqual(["chat-child", "chat-root", "spec-root"]);
  });
});
