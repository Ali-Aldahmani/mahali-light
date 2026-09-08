import { create } from 'zustand';
import { listCategoriesTree, listCategoriesFlat } from '@/services/categoryService';
import { listAttributes } from '@/services/attributeService';

interface CategoryTreeNode {
  id: number;
  name?: string;
  children?: CategoryTreeNode[];
  [key: string]: any;
}

interface CategoryFlat {
  id: number;
  name?: string;
  path?: string;
  [key: string]: any;
}

interface AttributeItem {
  id: number;
  name?: string;
  values?: any[];
  [key: string]: any;
}

interface ProductState {
  categoriesTree: CategoryTreeNode[];
  categoriesFlat: CategoryFlat[];
  attributes: AttributeItem[];
  loadingCategories: boolean;
  loadingAttributes: boolean;
  loadedAt: number | null;
  fetchCategories: (force?: boolean) => Promise<void>;
  fetchAttributes: (force?: boolean) => Promise<void>;
  refreshAll: () => Promise<void>;
  findCategoryById: (id: number) => CategoryFlat | null;
  findAttributeById: (id: number) => AttributeItem | null;
}

// Cached lookup data for products: the categories tree, a flat list with
// breadcrumb paths, and the full attribute catalog. The POS module in a later
// phase will reuse this exact shape for fast local lookups.
export const useProductStore = create<ProductState>()((set, get) => ({
  categoriesTree: [],
  categoriesFlat: [],
  attributes: [],

  loadingCategories: false,
  loadingAttributes: false,
  loadedAt: null,

  async fetchCategories(force = false) {
    if (!force && get().loadedAt && get().categoriesFlat.length) return;
    set({ loadingCategories: true });
    try {
      const [tree, flat] = await Promise.all([
        listCategoriesTree(),
        listCategoriesFlat(),
      ]);
      set({
        categoriesTree: tree || [],
        categoriesFlat: flat || [],
        loadingCategories: false,
        loadedAt: Date.now(),
      });
    } catch (_err) {
      set({ loadingCategories: false });
    }
  },

  async fetchAttributes(force = false) {
    if (!force && get().attributes.length) return;
    set({ loadingAttributes: true });
    try {
      const attrs = await listAttributes();
      set({ attributes: attrs || [], loadingAttributes: false });
    } catch (_err) {
      set({ loadingAttributes: false });
    }
  },

  async refreshAll() {
    await Promise.all([get().fetchCategories(true), get().fetchAttributes(true)]);
  },

  findCategoryById(id) {
    return get().categoriesFlat.find((c) => c.id === id) || null;
  },

  findAttributeById(id) {
    return get().attributes.find((a) => a.id === id) || null;
  },
}));
