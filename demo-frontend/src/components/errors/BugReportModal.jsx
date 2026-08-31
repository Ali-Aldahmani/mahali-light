import { useEffect, useState } from 'react';
import { Bug, Camera } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Textarea from '../ui/Textarea.jsx';
import { useUiErrorStore } from '../../store/uiErrorStore.js';
import {
  captureScreenshot,
  submitBugReport,
} from '../../services/bugReportService.js';
import { toast } from '../../store/toastStore.js';

const URGENCY = [
  { value: 'blocking', label: 'Blocking — I cannot continue', tone: 'text-error' },
  { value: 'major', label: 'Major — affects my work', tone: 'text-warning' },
  { value: 'minor', label: 'Minor — small issue', tone: 'text-success' },
];

export default function BugReportModal() {
  const open = useUiErrorStore((s) => s.bugReportOpen);
  const prefill = useUiErrorStore((s) => s.bugReportPrefill);
  const close = useUiErrorStore((s) => s.closeBugReport);

  const [doing, setDoing] = useState('');
  const [happened, setHappened] = useState('');
  const [urgency, setUrgency] = useState('major');
  const [screenshot, setScreenshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    if (!open) return;
    setTicket(null);
    setDoing('');
    setHappened(prefill?.whatHappened || '');
    setUrgency(prefill?.urgency || 'major');
    setScreenshot(null);
    captureScreenshot().then((b64) => {
      if (b64) setScreenshot(b64);
    });
  }, [open, prefill]);

  const handleRetake = async () => {
    const b64 = await captureScreenshot();
    setScreenshot(b64);
  };

  const handleSubmit = async () => {
    if (!doing.trim() || !happened.trim()) {
      toast.warning('Please describe what you were doing and what happened.');
      return;
    }
    setSubmitting(true);
    try {
      const report = await submitBugReport({
        whatWereYouDoing: doing.trim(),
        whatHappened: happened.trim(),
        urgency,
        errorCode: prefill?.errorCode || null,
        stackTrace: prefill?.stackTrace || null,
        screenshotBase64: screenshot,
      });
      setTicket(report);
      toast.success('Bug report submitted.');
    } catch (err) {
      toast.error(err.message || 'Could not submit bug report.');
    } finally {
      setSubmitting(false);
    }
  };

  if (ticket) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="Bug report submitted"
        footer={<Button onClick={close}>OK</Button>}
      >
        <p className="text-sm text-ink">
          Ticket: <strong>{ticket.ticket_number}</strong>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Urgency: {ticket.urgency}
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          Your report has been sent to the administrator. Thank you!
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <Bug size={18} className="text-accent" />
          Report a bug
        </span>
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Submit report
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="What were you trying to do?"
          value={doing}
          onChange={(e) => setDoing(e.target.value)}
          rows={3}
          placeholder='e.g. "Adding a payment to invoice INV-2026-1042"'
        />
        <Textarea
          label="What happened instead?"
          value={happened}
          onChange={(e) => setHappened(e.target.value)}
          rows={3}
          placeholder='e.g. "App showed an error and payment did not save"'
        />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">How urgent is this?</legend>
          <div className="space-y-2">
            {URGENCY.map((u) => (
              <label
                key={u.value}
                className="flex cursor-pointer items-center gap-2 rounded-card border border-border px-3 py-2 hover:bg-surface-2"
              >
                <input
                  type="radio"
                  name="urgency"
                  value={u.value}
                  checked={urgency === u.value}
                  onChange={() => setUrgency(u.value)}
                />
                <span className={`text-sm ${u.tone}`}>{u.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Screenshot (auto-captured)</p>
          <div className="flex items-start gap-3">
            {screenshot ? (
              <img
                src={`data:image/png;base64,${screenshot}`}
                alt="Screenshot preview"
                className="h-24 w-auto rounded border border-border object-contain"
              />
            ) : (
              <div className="flex h-24 w-40 items-center justify-center rounded border border-dashed border-border bg-surface-2 text-xs text-ink-muted">
                No capture
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={handleRetake}>
              <Camera size={14} /> Retake
            </Button>
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          Auto-collected: screen, PC, app version. No passwords or sensitive payment data are included.
        </p>
      </div>
    </Modal>
  );
}
