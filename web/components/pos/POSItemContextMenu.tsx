'use client';

import { useEffect, useRef } from 'react';
import { FilePlus2, PackagePlus, Pencil } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export interface POSItemContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  variant: any;
  onClose: () => void;
  onQuickAddStock: (variant: any) => void;
  onQuickMakePO: (variant: any) => void;
  onQuickEdit: (variant: any) => void;
}

export default function POSItemContextMenu({
  open,
  x,
  y,
  variant,
  onClose,
  onQuickAddStock,
  onQuickMakePO,
  onQuickEdit,
}: POSItemContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const permissions = useAuthStore((s) => s.permissions);
  // Same permissions as the routes these actions call, so a cashier isn't
  // offered something that can only end in "Access denied".
  const canAddStock =
    permissions.includes('stock.adjust_request') || permissions.includes('stock.adjust_direct');
  const canMakePO = permissions.includes('supplier.purchase_order.create');
  const canEdit = permissions.includes('product.edit');

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScrollOrResize = () => onClose();

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open, onClose]);

  if (!open || !variant || (!canAddStock && !canMakePO && !canEdit)) return null;

  const menuWidth = 220;
  const menuHeight = 175;
  const maxX = typeof window !== 'undefined' ? Math.max(8, window.innerWidth - menuWidth - 8) : x;
  const maxY = typeof window !== 'undefined' ? Math.max(8, window.innerHeight - menuHeight - 8) : y;
  const clampedX = Math.min(Math.max(8, x), maxX);
  const clampedY = Math.min(Math.max(8, y), maxY);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Quick actions for ${variant.productName}`}
      style={{ top: clampedY, left: clampedX }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 w-56 rounded-card border border-border bg-surface py-1.5 shadow-pop"
    >
      <div className="px-3 py-1.5 border-b border-border">
        <div className="text-xs font-semibold text-ink truncate">{variant.productName}</div>
        {variant.sku && (
          <div className="text-[11px] text-ink-muted font-mono truncate">{variant.sku}</div>
        )}
      </div>
      <div className="py-1">
        {canAddStock && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onQuickAddStock(variant);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-surface-2 transition text-left"
          >
            <PackagePlus className="h-4 w-4 text-accent shrink-0" />
            <span>Quick add stock</span>
          </button>
        )}
        {canMakePO && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onQuickMakePO(variant);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-surface-2 transition text-left"
          >
            <FilePlus2 className="h-4 w-4 text-accent shrink-0" />
            <span>Quick make PO</span>
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onQuickEdit(variant);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-surface-2 transition text-left"
          >
            <Pencil className="h-4 w-4 text-accent shrink-0" />
            <span>Quick edit</span>
          </button>
        )}
      </div>
    </div>
  );
}

