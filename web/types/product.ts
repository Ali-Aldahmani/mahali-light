export interface Category {
  id: number;
  name: string;
  parent_id?: number | null;
}

export interface ProductVariant {
  id: number;
  product_id: number;
  sku?: string;
  barcode?: string;
  price?: number;
  cost?: number;
  stock_qty?: number;
  attributes?: Record<string, string>;
}

export interface Product {
  id: number;
  name: string;
  name_ar?: string;
  sku?: string;
  barcode?: string;
  category_id?: number | null;
  price?: number;
  cost?: number;
  stock_qty?: number;
  has_variants?: boolean;
  is_active?: boolean;
  sold_by?: 'unit' | 'weight' | string;
  image_url?: string | null;
  variants?: ProductVariant[];
}

export interface StockMovement {
  id: number;
  product_id: number;
  variant_id?: number | null;
  type: string;
  quantity: number;
  created_at: string;
  note?: string | null;
}
