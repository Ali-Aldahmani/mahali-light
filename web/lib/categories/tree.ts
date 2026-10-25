export type CategoryId = string;

/** Rename one node without rebuilding unaffected branches. Siblings are
 * re-sorted with the same rule used by the server hierarchy response. */
export function renameCategoryInTree(nodes: any[], id: CategoryId, name: string): any[] {
  let changed = false;
  const next = nodes.map((node) => {
    const children = node.children?.length
      ? renameCategoryInTree(node.children, id, name)
      : node.children;
    if (node.id === id || children !== node.children) {
      changed = true;
      return { ...node, ...(node.id === id ? { name } : {}), children };
    }
    return node;
  });
  if (!changed) return nodes;
  return next.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}
