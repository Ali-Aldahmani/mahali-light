import { describe, expect, it } from 'vitest';
import { renameCategoryInTree } from './tree';

describe('renameCategoryInTree', () => {
  const tree = [
    {
      id: 'root', name: 'Lighting', sortOrder: 0, description: 'kept', children: [
        { id: 'leaf-a', name: 'Bulbs', sortOrder: 0, productCount: 4, children: [] },
        { id: 'leaf-b', name: 'Cables', sortOrder: 0, productCount: 2, children: [] },
      ],
    },
    { id: 'other', name: 'Tools', sortOrder: 1, children: [] },
  ];

  it('renames only the immutable-id match and preserves relationships and metadata', () => {
    const next = renameCategoryInTree(tree, 'leaf-b', 'أسلاك');
    expect(next[0].children[1]).toMatchObject({ id: 'leaf-b', name: 'أسلاك', productCount: 2 });
    expect(next[0]).toMatchObject({ id: 'root', name: 'Lighting', description: 'kept' });
    expect(next[1]).toBe(tree[1]);
  });

  it('keeps the original references when the id is absent', () => {
    expect(renameCategoryInTree(tree, 'missing', 'Nope')).toBe(tree);
  });

  it('re-sorts renamed siblings with the server hierarchy rule', () => {
    const next = renameCategoryInTree(tree, 'leaf-b', 'Appliances');
    expect(next[0].children.map((node: any) => node.id)).toEqual(['leaf-b', 'leaf-a']);
  });
});
