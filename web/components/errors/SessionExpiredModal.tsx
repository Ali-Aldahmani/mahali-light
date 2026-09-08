import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useUiErrorStore } from '@/store/uiErrorStore';

export default function SessionExpiredModal() {
  const open = useUiErrorStore((s) => s.sessionModal);
  const hide = useUiErrorStore((s) => s.hideSessionExpired);
  const router = useRouter();

  const goLogin = () => {
    hide();
    router.replace('/login');
  };

  return (
    <Modal
      open={open}
      onClose={goLogin}
      title={
        <span className="flex items-center gap-2">
          <Lock size={18} className="text-warning" />
          Session expired
        </span>
      }
      footer={
        <Button onClick={goLogin}>Log in again</Button>
      }
    >
      <p className="text-sm text-ink-muted">
        Your session has timed out. Please log in again.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        Unsaved work on this page may have been preserved — check your form after signing back in.
      </p>
    </Modal>
  );
}
