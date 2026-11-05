'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { changePassword } from '@/services/authService';
import { toast } from '@/store/toastStore';

export default function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError('');
    }
  }, [open]);

  async function submit() {
    if (!current || !next) {
      setError('Enter your current password and a new one.');
      return;
    }
    if (next !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await changePassword(current, next);
      toast.success('Password changed. Your other devices have been signed out.');
      onClose();
    } catch (err: any) {
      // The server applies the password rules and says what is wrong.
      setError(err?.message || 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Change password"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Change password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e: any) => setCurrent(e.target.value)}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters (12 for an Admin). A short phrase is easiest to remember."
          value={next}
          onChange={(e: any) => setNext(e.target.value)}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e: any) => setConfirm(e.target.value)}
          error={error || undefined}
        />
      </div>
    </Modal>
  );
}
