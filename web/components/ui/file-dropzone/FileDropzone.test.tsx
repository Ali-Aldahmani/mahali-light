import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReceiptUpload from '../ReceiptUpload';
import { FileDropzone } from './FileDropzone';
import { uploadWith } from './uploadWith';

function pick(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

const pdf = (name = 'receipt.pdf', size = 1000) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' });

describe('FileDropzone', () => {
  it('ReceiptUpload passes an accepted file up and clears when removed', async () => {
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const { container } = render(<ReceiptUpload onSelect={onSelect} onClear={onClear} />);
    const file = pdf();
    pick(container, [file]);
    expect(onSelect).toHaveBeenCalledWith(file);
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove receipt.pdf' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('refuses a type that is not accepted and a file over the size limit', () => {
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const { container } = render(<ReceiptUpload onSelect={onSelect} onClear={onClear} />);
    pick(container, [new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt is not an accepted file type.');
    pick(container, [pdf('big.pdf', 6 * 1024 * 1024)]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
    expect(screen.getAllByText(/larger than 5 MB/).length).toBeGreaterThan(0);
  });

  it('uploads through uploadWith and shows the API reason on failure', async () => {
    let fail = true;
    const send = vi.fn(async (_file: File, opts: any) => {
      opts.onProgress?.(50);
      if (fail) throw { message: 'Server said no' };
      return { ok: true };
    });
    const done = vi.fn();
    const { container } = render(
      <FileDropzone multiple={false} maxFiles={1} onUpload={uploadWith(send, done)} />,
    );
    await act(async () => pick(container, [pdf()]));
    await waitFor(() => expect(screen.getByText('Server said no')).toBeInTheDocument());
    expect(done).not.toHaveBeenCalled();
    fail = false;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry receipt.pdf' })));
    await waitFor(() => expect(done).toHaveBeenCalledWith({ ok: true }));
    expect(send).toHaveBeenCalledTimes(2);
  });
});
