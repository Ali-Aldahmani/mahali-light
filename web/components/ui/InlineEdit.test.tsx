import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InlineEdit from './InlineEdit';

function setup(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <InlineEdit
      value="Lighting"
      onSave={onSave}
      label="Category name"
      variant="body"
      validate={(name) => !name ? 'Category name is required.' : name.length > 100 ? 'Too long.' : null}
    />,
  );
  return { onSave, display: screen.getByRole('button', { name: 'Category name: Lighting' }) };
}

describe('InlineEdit', () => {
  it('activates by click, focuses the field, trims, and saves with Enter', async () => {
    const { onSave, display } = setup();
    fireEvent.click(display);
    const input = screen.getByRole('textbox', { name: 'Category name' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Arabic lights  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Arabic lights'));
    expect(screen.getByRole('button', { name: 'Category name: Arabic lights' })).toBeInTheDocument();
  });

  it('cancels with Escape and makes no request', () => {
    const { onSave, display } = setup();
    fireEvent.click(display);
    const input = screen.getByRole('textbox', { name: 'Category name' });
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Category name: Lighting' })).toBeInTheDocument();
  });

  it('supports explicit Save and Cancel controls', async () => {
    const { onSave, display } = setup();
    fireEvent.click(display);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fixtures' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save category name' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Fixtures'));

    fireEvent.click(screen.getByRole('button', { name: 'Category name: Fixtures' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saves on blur and skips unchanged values', async () => {
    const { onSave, display } = setup();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    fireEvent.click(display);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Bulbs' } });
    fireEvent.blur(input, { relatedTarget: document.body });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Bulbs'));

    fireEvent.click(screen.getByRole('button', { name: 'Category name: Bulbs' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('rejects whitespace-only and overlong names without saving', () => {
    const { onSave, display } = setup();
    fireEvent.click(display);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Category name is required.');
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'x'.repeat(101) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Too long.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('preserves Unicode and restores the last confirmed value after a failed save', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('A category with this name already exists.')).mockResolvedValueOnce(undefined);
    const { display } = setup(onSave);
    fireEvent.click(display);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'إضاءة' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await screen.findByText('A category with this name already exists.');
    expect(screen.getByRole('button', { name: 'Category name: Lighting' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith('إضاءة'));
  });
});
