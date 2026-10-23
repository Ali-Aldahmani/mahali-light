import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ShortcutList } from '../ui/shortcut-recorder';
import { useShortcutBindings } from '@/store/shortcutStore';
import { useShortcutActions } from '@/hooks/useShortcutActions';
import { useQuickActionStore } from '@/store/quickActionStore';
import { BUILT_IN_SHORTCUTS } from '@/lib/shortcuts/actions';

const OTHER_KEYS = [
  { label: 'Show this help', shortcut: 'shift+/' },
  { label: 'Close modal / leave a field', shortcut: 'escape' },
];

export default function KeyboardShortcutOverlay({ open, onClose }) {
  const actions = useShortcutActions();
  const bindings = useShortcutBindings();
  const openShortcuts = useQuickActionStore((s) => s.openShortcuts);

  const mine = actions
    .filter((a) => bindings[a.id])
    .map((a) => ({ label: a.label, shortcut: bindings[a.id] as string }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      size="md"
      footer={
        <Button
          variant="secondary"
          onClick={() => {
            onClose?.();
            openShortcuts();
          }}
        >
          Customize my shortcuts
        </Button>
      }
    >
      <ShortcutList
        searchPlaceholder="Search shortcuts"
        groups={[
          ...(mine.length ? [{ label: 'My shortcuts', items: mine }] : []),
          { label: 'Built-in', items: [...BUILT_IN_SHORTCUTS, ...OTHER_KEYS] },
        ]}
      />
    </Modal>
  );
}
