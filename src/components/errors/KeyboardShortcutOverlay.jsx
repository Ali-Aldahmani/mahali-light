import Modal from '../ui/Modal.jsx';

const SHORTCUTS = [
  ['Ctrl+P', 'Open POS'],
  ['Ctrl+I', 'New invoice (POS)'],
  ['Ctrl+F', 'Global search'],
  ['Ctrl+Shift+B', 'Report a bug'],
  ['?', 'Show this help'],
  ['Escape', 'Close modal / blur input'],
  ['F11', 'Toggle fullscreen'],
];

export default function KeyboardShortcutOverlay({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="md">
      <div className="grid grid-cols-2 gap-2 text-sm">
        {SHORTCUTS.map(([key, desc]) => (
          <div key={key} className="flex justify-between gap-4 rounded-md bg-surface-2 px-3 py-2">
            <kbd className="font-mono text-xs text-ink">{key}</kbd>
            <span className="text-ink-muted">{desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
