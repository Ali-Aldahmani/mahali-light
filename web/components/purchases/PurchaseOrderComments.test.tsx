import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommentThread, { type ThreadComment } from './CommentThread';

describe('CommentThread Component for Purchase Orders', () => {
  const sampleComments: ThreadComment[] = [
    {
      id: 'c-1',
      author: { id: 'u-1', name: 'Alice Supervisor' },
      body: 'Please verify the pricing for item 1.',
      createdAt: '10m ago',
      reactions: [{ emoji: '👍', users: ['u-2'] }],
      replies: [
        {
          id: 'c-2',
          author: { id: 'u-2', name: 'Bob Cashier' },
          body: 'Pricing matches the supplier quote.',
          createdAt: '5m ago',
          reactions: [],
          replies: [],
        },
      ],
    },
  ];

  const currentUser = { id: 'u-1', name: 'Alice Supervisor' };

  it('renders root comments and nested replies properly', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
        title="Discussion"
      />,
    );

    expect(screen.getByText('Alice Supervisor')).toBeInTheDocument();
    expect(screen.getByText('Please verify the pricing for item 1.')).toBeInTheDocument();
    expect(screen.getByText('Bob Cashier')).toBeInTheDocument();
    expect(screen.getByText('Pricing matches the supplier quote.')).toBeInTheDocument();
  });

  it('does NOT render Edit button for any comment (immutable requirement)', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Edit$/i)).not.toBeInTheDocument();
  });

  it('does NOT render Delete button for any comment (immutable requirement)', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Delete$/i)).not.toBeInTheDocument();
  });

  it('does NOT render Resolve or Reopen button (disabled requirement)', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Resolve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reopen$/i })).not.toBeInTheDocument();
  });

  it('mentions suggestions do NOT appear when typing @ (mentions disabled)', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
        people={[{ id: 'u-2', name: 'Bob Cashier' }]}
        mentionsEnabled={false}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '@Bob' } });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('disables composer and shows notice when canCreate is false', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
        canCreate={false}
      />,
    );

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.getByText(/You do not have permission to post comments/),
    ).toBeInTheDocument();
  });

  it('hides add-reaction button when canReact is false', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
        canReact={false}
      />,
    );

    expect(screen.queryByLabelText(/Add reaction/i)).not.toBeInTheDocument();
  });

  it('submits a new comment and triggers callback', async () => {
    const onSubmit = vi.fn();
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
        onSubmitComment={onSubmit}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'New verified PO note' } });

    const sendBtn = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('New verified PO note', null);
    });
  });

  it('disables send button when isSubmitting is true (prevent duplicate submit)', () => {
    render(
      <CommentThread
        comments={sampleComments}
        currentUser={currentUser}
        isSubmitting={true}
      />,
    );

    const sendBtn = screen.getByRole('button', { name: 'Sending...' });
    expect(sendBtn).toBeDisabled();
  });
  it('opens scrolled to the latest comment', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
    try {
      render(<CommentThread comments={sampleComments} currentUser={currentUser} title="Discussion" />);
      expect(screen.getByTestId('comment-scroll').scrollTop).toBe(900);
    } finally {
      spy.mockRestore();
    }
  });
});
