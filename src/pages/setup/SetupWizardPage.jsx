import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, CheckCircle2 } from 'lucide-react';
import SetupWizardStep from '../../components/setup/SetupWizardStep.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import {
  completeSetup,
  getSetupStatus,
  testServerConnection,
} from '../../services/setupService.js';
import { toast } from '../../store/toastStore.js';

const TOTAL = 8;

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [connOk, setConnOk] = useState(false);

  const [store, setStore] = useState({
    store_name: '',
    store_name_ar: '',
    store_address: '',
    store_phone: '',
    store_email: '',
    store_trn: '',
  });
  const [vat, setVat] = useState({ vat_enabled: true, vat_rate: 5, vat_number: '' });
  const [network, setNetwork] = useState({
    mode: 'server',
    server_ip: '127.0.0.1',
    server_port: 3000,
    pc_identifier: 'SERVER',
  });
  const [admin, setAdmin] = useState({
    full_name: '',
    username: '',
    password: '',
    confirm: '',
  });
  const [cash, setCash] = useState({ opening_balance: 0 });
  const [bank, setBank] = useState({
    bank_name: '',
    account_name: '',
    account_number: '',
    iban: '',
    skip: true,
  });
  const [doneSummary, setDoneSummary] = useState(null);

  useEffect(() => {
    getSetupStatus()
      .then((s) => {
        setStatus(s);
        if (s?.setup_completed) navigate('/login', { replace: true });
        if (s?.server_port) {
          setNetwork((n) => ({
            ...n,
            server_port: Number(s.server_port),
          }));
        }
      })
      .catch((err) => {
        toast.error(err.message || 'Cannot reach the POS server. Restart with npm run dev.');
      });
  }, [navigate]);

  const sampleVat = useMemo(() => {
    const base = 100;
    const v = vat.vat_enabled ? (base * Number(vat.vat_rate || 0)) / 100 : 0;
    return { base, v, total: base + v };
  }, [vat]);

  const passwordStrength = useMemo(() => {
    const p = admin.password;
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-Z]/.test(p)) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return s;
  }, [admin.password]);

  async function testConnection() {
    const base = `http://${network.server_ip}:${network.server_port}`;
    try {
      await testServerConnection(base);
      setConnOk(true);
      toast.success('Connected to server.');
    } catch (_e) {
      setConnOk(false);
      toast.error('Cannot reach server at that address.');
    }
  }

  async function finish() {
    setSubmitting(true);
    try {
      const result = await completeSetup({
        store,
        vat: {
          ...vat,
          vat_enabled: Boolean(vat.vat_enabled),
          vat_rate: Number(vat.vat_rate) || 5,
          vat_number: vat.vat_number || store.store_trn,
        },
        network,
        admin: status?.has_admin ? undefined : {
          full_name: admin.full_name,
          username: admin.username,
          password: admin.password,
        },
        cash_drawer: { opening_balance: Number(cash.opening_balance) || 0 },
        bank: bank.skip
          ? undefined
          : {
              bank_name: bank.bank_name,
              account_name: bank.account_name,
              account_number: bank.account_number,
              iban: bank.iban,
            },
      });
      setDoneSummary(result);
      setStep(8);
      if (window.electron?.setConfig) {
        const port = Number(network.server_port) || Number(status?.server_port) || 3002;
        await window.electron.setConfig({
          // Server PC always talks to itself on loopback. LAN IP is for client PCs.
          serverIp: network.mode === 'server' ? '127.0.0.1' : network.server_ip,
          serverPort: port,
          mode: network.mode,
          pcIdentifier: network.pc_identifier,
        });
      }
    } catch (err) {
      toast.error(err.message || 'Setup failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <div className="max-w-md text-center">
          <Zap size={48} className="mx-auto text-accent" />
          <h1 className="mt-4 text-3xl font-semibold text-ink">Welcome to your POS system</h1>
          <p className="mt-2 text-ink-muted">
            Let&apos;s set up your store in a few quick steps. This will only take about 5 minutes.
          </p>
          <button
            type="button"
            className="mt-8 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
            onClick={() => setStep(2)}
          >
            Get started →
          </button>
        </div>
      </div>
    );
  }

  if (step === 8 && doneSummary) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <div className="card max-w-md p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto text-success" />
          <h1 className="mt-4 text-2xl font-semibold text-ink">Your store is ready!</h1>
          <ul className="mt-4 space-y-1 text-sm text-ink-muted text-left">
            <li>Store: {doneSummary.store_name}</li>
            <li>Cash drawer: {cash.opening_balance} AED</li>
          </ul>
          <button
            type="button"
            className="mt-6 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white"
            onClick={() => navigate('/login', { replace: true })}
          >
            Go to login →
          </button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <SetupWizardStep
        step={2}
        total={TOTAL}
        title="Store profile"
        subtitle="Shown on invoices and receipts."
        onBack={() => setStep(1)}
        onNext={() => {
          const emailVal = store.store_email.trim();
          if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
            toast.error('store email: Please enter a valid email address or leave it empty.');
            return;
          }
          setStep(3);
        }}
        nextDisabled={!store.store_name || !store.store_address || !store.store_phone}
      >
        <div className="space-y-3">
          <Input label="Store name" value={store.store_name} onChange={(e) => setStore({ ...store, store_name: e.target.value })} required />
          <Input label="Store name (Arabic)" value={store.store_name_ar} onChange={(e) => setStore({ ...store, store_name_ar: e.target.value })} />
          <Textarea label="Address" value={store.store_address} onChange={(e) => setStore({ ...store, store_address: e.target.value })} rows={2} />
          <Input label="Phone" value={store.store_phone} onChange={(e) => setStore({ ...store, store_phone: e.target.value })} />
          <Input label="Email" value={store.store_email} onChange={(e) => setStore({ ...store, store_email: e.target.value })} />
          <Input label="TRN" value={store.store_trn} onChange={(e) => setStore({ ...store, store_trn: e.target.value })} />
          <div className="rounded-card border border-border bg-surface-2/50 p-3 text-xs">
            <p className="font-semibold text-ink">{store.store_name || 'Store name'}</p>
            <p className="text-ink-muted">{store.store_address}</p>
            <p className="text-ink-muted">{store.store_phone}</p>
          </div>
        </div>
      </SetupWizardStep>
    );
  }

  if (step === 3) {
    return (
      <SetupWizardStep step={3} total={TOTAL} title="VAT settings" onBack={() => setStep(2)} onNext={() => setStep(4)}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={vat.vat_enabled} onChange={(e) => setVat({ ...vat, vat_enabled: e.target.checked })} />
          VAT enabled
        </label>
        <Input label="VAT rate (%)" type="number" value={vat.vat_rate} onChange={(e) => setVat({ ...vat, vat_rate: e.target.value })} />
        <Input label="VAT number" value={vat.vat_number} onChange={(e) => setVat({ ...vat, vat_number: e.target.value })} />
        <p className="mt-3 text-sm text-ink-muted">
          Sample: AED {sampleVat.base} + VAT {sampleVat.v.toFixed(2)} = AED {sampleVat.total.toFixed(2)}
        </p>
      </SetupWizardStep>
    );
  }

  if (step === 4) {
    return (
      <SetupWizardStep
        step={4}
        total={TOTAL}
        title="Network setup"
        onBack={() => setStep(3)}
        onNext={() => setStep(status?.has_admin ? 6 : 5)}
        nextDisabled={network.mode === 'client' && !connOk}
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 rounded-card border border-border p-3">
            <input type="radio" checked={network.mode === 'server'} onChange={() => setNetwork({ ...network, mode: 'server', pc_identifier: 'SERVER' })} />
            This is the SERVER PC
          </label>
          <label className="flex items-center gap-2 rounded-card border border-border p-3">
            <input type="radio" checked={network.mode === 'client'} onChange={() => setNetwork({ ...network, mode: 'client', pc_identifier: 'POS-1' })} />
            This is a CLIENT PC
          </label>
          {network.mode === 'server' && (
            <p className="text-sm text-ink-muted">
              Client PCs should use IP: <strong>{status?.local_ips?.[0] || 'this PC LAN address'}</strong> port {status?.server_port || network.server_port}
            </p>
          )}
          {network.mode === 'client' && (
            <>
              <Input label="Server IP" value={network.server_ip} onChange={(e) => { setConnOk(false); setNetwork({ ...network, server_ip: e.target.value }); }} />
              <button type="button" className="text-sm font-semibold text-accent" onClick={testConnection}>
                Test connection
              </button>
              {connOk && <p className="text-sm text-success">Connected to server</p>}
            </>
          )}
          <Input label="PC identifier" value={network.pc_identifier} onChange={(e) => setNetwork({ ...network, pc_identifier: e.target.value })} />
        </div>
      </SetupWizardStep>
    );
  }

  if (step === 5) {
    return (
      <SetupWizardStep
        step={5}
        total={TOTAL}
        title="Create admin account"
        onBack={() => setStep(4)}
        onNext={() => setStep(6)}
        nextDisabled={
          !admin.full_name ||
          !admin.username ||
          admin.password.length < 6 ||
          admin.password !== admin.confirm
        }
      >
        <Input label="Full name" value={admin.full_name} onChange={(e) => setAdmin({ ...admin, full_name: e.target.value })} />
        <Input label="Username" value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} />
        <Input label="Password" type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
        <div className="h-1 rounded bg-surface-2">
          <div className="h-1 rounded bg-accent" style={{ width: `${(passwordStrength / 4) * 100}%` }} />
        </div>
        <Input label="Confirm password" type="password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} />
      </SetupWizardStep>
    );
  }

  if (step === 6) {
    return (
      <SetupWizardStep step={6} total={TOTAL} title="Cash drawer" onBack={() => setStep(status?.has_admin ? 4 : 5)} onNext={() => setStep(7)}>
        <p className="mb-3 text-sm text-ink-muted">Count your starting cash and enter the total.</p>
        <Input label="Opening balance (AED)" type="number" value={cash.opening_balance} onChange={(e) => setCash({ opening_balance: e.target.value })} />
      </SetupWizardStep>
    );
  }

  if (step === 7) {
    return (
      <SetupWizardStep
        step={7}
        total={TOTAL}
        title="Bank account"
        onBack={() => setStep(6)}
        onNext={finish}
        nextLabel={submitting ? 'Saving…' : 'Complete setup'}
        nextDisabled={submitting}
      >
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={bank.skip} onChange={(e) => setBank({ ...bank, skip: e.target.checked })} />
          Skip for now
        </label>
        {!bank.skip && (
          <>
            <Input label="Bank name" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} />
            <Input label="Account name" value={bank.account_name} onChange={(e) => setBank({ ...bank, account_name: e.target.value })} />
            <Input label="Account number" value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} />
            <Input label="IBAN" value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.target.value })} />
          </>
        )}
      </SetupWizardStep>
    );
  }

  return null;
}
