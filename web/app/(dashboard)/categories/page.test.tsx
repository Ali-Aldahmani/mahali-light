import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import CategoriesPage from './page';

const api = vi.hoisted(() => ({
  listTree: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  listAttributes: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/services/categoryService', () => ({
  listCategoriesTree: api.listTree,
  listCategoriesFlat: vi.fn().mockResolvedValue([]),
  updateCategory: api.update,
  deleteCategory: api.delete,
}));
vi.mock('@/services/attributeService', () => ({ listAttributes: api.listAttributes }));
vi.mock('@/components/products/CategoryAttributesPanel', () => ({ default: () => <div data-testid="attributes" /> }));
vi.mock('@/components/products/CategoryFormSlideOver', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ default: () => null }));

const tree = [{
  id: 'root', name: 'Lighting', sortOrder: 0, productCount: 3, children: [
    { id: 'child', name: 'Bulbs', sortOrder: 0, productCount: 1, children: [] },
  ],
}];

describe('Categories hierarchy inline rename', () => {
  beforeEach(() => {
    api.listTree.mockReset().mockResolvedValue(tree);
    api.listAttributes.mockReset().mockResolvedValue([]);
    api.update.mockReset().mockImplementation(async (id, body) => ({ id, ...body }));
    useAuthStore.setState({
      permissions: ['product.view', 'product.edit'],
      user: { id: 'user', username: 'manager', role: 'Manager', permissions: ['product.view', 'product.edit'] },
      token: 'test',
    });
  });

  it('renames by immutable id with a name-only patch and preserves expanded nodes', async () => {
    render(<CategoriesPage />);
    const expand = await screen.findByRole('button', { name: 'Expand Lighting' });
    fireEvent.click(expand);
    expect(screen.getByText('Bulbs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Category name for Lighting: Lighting' }));
    const input = screen.getByRole('textbox', { name: 'Category name for Lighting' });
    fireEvent.change(input, { target: { value: '  Lamps  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('root', { name: 'Lamps' }));
    expect(screen.getByText('Bulbs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Lamps' })).toBeInTheDocument();
  });

  it('does not start editing from the expand control or product-count badge', async () => {
    render(<CategoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Lighting' }));
    expect(screen.queryByRole('textbox', { name: /Category name/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('3'));
    expect(screen.queryByRole('textbox', { name: /Category name/ })).not.toBeInTheDocument();
  });

  it('renders category names as read-only without product.edit', async () => {
    useAuthStore.setState({ permissions: ['product.view'] });
    render(<CategoriesPage />);
    expect(await screen.findByText('Lighting')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Category name for Lighting/ })).not.toBeInTheDocument();
  });
});
