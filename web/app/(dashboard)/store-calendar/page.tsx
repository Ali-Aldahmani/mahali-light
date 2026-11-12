'use client';

import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { formatDate } from '@/lib/utils/format';
import { listCategoriesFlat } from '@/services/categoryService';
import { searchProducts } from '@/services/productService';
import {
  createCalendarEvent, createPromotion, endPromotion, getStoreHours, listCalendar, listPromotions,
  setStoreHours, updateCalendarEvent,
} from '@/services/storeDataService';

// Promotions, closed days and seasons, and opening hours: kept so later
// sales forecasts can tell a promotion spike or a closed day from normal
// demand. Nothing here changes prices.

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const KINDS = [
  { value: 'closed', label: 'Store closed' }, { value: 'ramadan', label: 'Ramadan' }, { value: 'eid', label: 'Eid' },
  { value: 'public_holiday', label: 'Public holiday' }, { value: 'special', label: 'Special day' },
];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TH = 'px-3 py-2 text-left text-xs font-semibold text-ink-muted';
const TD = 'px-3 py-2 align-top text-sm';

// ------------------------------------------------------------------ promotions
function PromotionsTab({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', startsOn: today(), endsOn: today(), discountPercent: '', notes: '' });
  const [targets, setTargets] = useState<{ key: string; label: string; body: any }[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { listPromotions().then((r: any) => setRows(r || [])).catch(() => {}); }, []);
  useEffect(() => { load(); listCategoriesFlat().then((r: any) => setCats(r || [])).catch(() => {}); }, [load]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => searchProducts(q, 8).then((r: any) => setFound(Array.isArray(r) ? r : r?.items || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const add = (key: string, label: string, body: any) =>
    setTargets((t) => (t.some((x) => x.key === key) ? t : [...t, { key, label, body }]));

  async function save() {
    setBusy(true);
    try {
      await createPromotion({
        name: form.name.trim(), startsOn: form.startsOn, endsOn: form.endsOn,
        discountPercent: form.discountPercent === '' ? null : Number(form.discountPercent),
        notes: form.notes.trim() || null, items: targets.map((t) => t.body),
      });
      toast.success('Promotion saved.');
      setForm({ name: '', startsOn: today(), endsOn: today(), discountPercent: '', notes: '' });
      setTargets([]);
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the promotion.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="space-y-3 rounded-card border border-border bg-surface p-4">
          <p className="text-xs text-ink-muted">Record a promotion so its sales spike isn&apos;t read as normal demand. This doesn&apos;t change prices at the till.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <Input label="Name" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} className="sm:col-span-2" />
            <Input label="From" type="date" value={form.startsOn} onChange={(e: any) => setForm({ ...form, startsOn: e.target.value })} />
            <Input label="To" type="date" value={form.endsOn} onChange={(e: any) => setForm({ ...form, endsOn: e.target.value })} />
            <Input label="Discount % (optional)" type="number" min="0" max="100" value={form.discountPercent} onChange={(e: any) => setForm({ ...form, discountPercent: e.target.value })} />
            <Input label="Notes" value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e.target.value })} className="sm:col-span-3" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select label="Add a category" value="" onChange={(v: any) => {
              const c = cats.find((x) => String(x.id) === String(v));
              if (c) add(`c:${c.id}`, `Category: ${c.name}`, { categoryId: c.id });
            }} options={[{ value: '', label: 'Choose…' }, ...cats.map((c) => ({ value: String(c.id), label: c.name }))]} />
            <div className="relative">
              <Input label="Add a product (search)" value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Name or SKU" />
              {found.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-card border border-border bg-surface shadow-pop">
                  {found.map((p: any) => {
                    const vid = p.variantId || p.variant_id;
                    const label = `${p.productName || p.name}${p.sku ? ` · ${p.sku}` : ''}`;
                    return (
                      <button key={vid || p.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                        onClick={() => { add(vid ? `v:${vid}` : `p:${p.productId || p.id}`, label, vid ? { variantId: vid } : { productId: p.productId || p.id }); setQ(''); setFound([]); }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {targets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {targets.map((t) => (
                <button key={t.key} type="button" onClick={() => setTargets((x) => x.filter((y) => y.key !== t.key))}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-error-light" title="Remove">
                  {t.label} ×
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={save} loading={busy} disabled={form.name.trim().length < 2 || targets.length === 0}>Save promotion</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full">
          <thead className="bg-surface-2"><tr><th className={TH}>Promotion</th><th className={TH}>Dates</th><th className={TH}>Items</th><th className={TH} /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-ink-muted">No promotions recorded.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className={TD}>{p.name}{p.discountPercent != null && <span className="ml-1.5 text-xs text-ink-muted">{p.discountPercent}% off</span>}
                  {p.notes && <div className="text-xs text-ink-muted">{p.notes}</div>}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatDate(p.startsOn)} – {formatDate(p.endsOn)}
                  {p.endedEarlyAt && <div className="text-xs text-ink-muted">ended early</div>}</td>
                <td className={`${TD} text-xs text-ink-muted`}>{p.items.map((i: any) => i.label).filter(Boolean).join(', ')}</td>
                <td className={`${TD} text-right`}>
                  {canEdit && p.endsOn > today() && (
                    <Button size="sm" variant="secondary" onClick={() => endPromotion(p.id).then(load).catch((e: any) => toast.error(e?.message || 'Could not end it.'))}>End today</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ calendar
function CalendarTab({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ kind: 'closed', name: '', startsOn: today(), endsOn: today(), estimated: false });
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(() => { listCalendar().then((r: any) => setRows(r || [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      const body = { ...form, name: form.name.trim() };
      if (editing) await updateCalendarEvent(editing, body); else await createCalendarEvent(body);
      toast.success(editing ? 'Updated.' : 'Added to the calendar.');
      setEditing(null);
      setForm({ kind: 'closed', name: '', startsOn: today(), endsOn: today(), estimated: false });
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save.');
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="space-y-3 rounded-card border border-border bg-surface p-4">
          <p className="text-xs text-ink-muted">Days the store was closed, and seasons like Ramadan and Eid. Ramadan and Eid are filled in as estimates; correct the dates once announced.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
            <Select label="Kind" value={form.kind} onChange={(v: any) => setForm({ ...form, kind: v })} options={KINDS} />
            <Input label="Name" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} className="sm:col-span-2" />
            <Input label="First day" type="date" value={form.startsOn} onChange={(e: any) => setForm({ ...form, startsOn: e.target.value })} />
            <Input label="Last day" type="date" value={form.endsOn} onChange={(e: any) => setForm({ ...form, endsOn: e.target.value })} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.estimated} onChange={(e) => setForm({ ...form, estimated: e.target.checked })} />
              Dates are an estimate
            </label>
            <div className="flex gap-2">
              {editing && <Button variant="secondary" onClick={() => { setEditing(null); setForm({ kind: 'closed', name: '', startsOn: today(), endsOn: today(), estimated: false }); }}>Cancel</Button>}
              <Button onClick={save} disabled={form.name.trim().length < 2}>{editing ? 'Save changes' : 'Add'}</Button>
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full">
          <thead className="bg-surface-2"><tr><th className={TH}>Name</th><th className={TH}>Kind</th><th className={TH}>Dates</th><th className={TH} /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className={TD}>{e.name}{e.estimated && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">estimate</span>}</td>
                <td className={TD}>{KINDS.find((k) => k.value === e.kind)?.label || e.kind}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatDate(e.startsOn)}{e.endsOn !== e.startsOn && ` – ${formatDate(e.endsOn)}`}</td>
                <td className={`${TD} text-right`}>
                  {canEdit && <Button size="sm" variant="secondary" onClick={() => { setEditing(e.id); setForm({ kind: e.kind, name: e.name, startsOn: e.startsOn, endsOn: e.endsOn, estimated: e.estimated }); }}>Edit</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ opening hours
function HoursTab({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<any>(null);
  const [hours, setHours] = useState<Record<string, { open: string; close: string } | null>>({});
  const [from, setFrom] = useState(today());
  const load = useCallback(() => {
    getStoreHours().then((r: any) => {
      setData(r);
      const base = r?.current?.hours || {};
      setHours(Object.fromEntries(DAYS.map((_, i) => [String(i + 1), base[String(i + 1)] === undefined ? { open: '09:00', close: '22:00' } : base[String(i + 1)]])));
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      await setStoreHours({ effectiveFrom: from, hours });
      toast.success('Opening hours saved. Earlier hours are kept for the days they applied to.');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the hours.');
    }
  }

  return (
    <div className="space-y-4">
      {!data?.current && <p className="rounded-card border border-warning bg-warning-light px-3 py-2 text-sm">Opening hours aren&apos;t recorded yet.</p>}
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="space-y-2">
          {DAYS.map((d, i) => {
            const k = String(i + 1);
            const h = hours[k];
            return (
              <div key={k} className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-sm">{d}</span>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" disabled={!canEdit} checked={h === null}
                    onChange={(e) => setHours({ ...hours, [k]: e.target.checked ? null : { open: '09:00', close: '22:00' } })} />
                  Closed
                </label>
                {h && (
                  <>
                    <input type="time" disabled={!canEdit} value={h.open} aria-label={`${d} opens`}
                      onChange={(e) => setHours({ ...hours, [k]: { ...h, open: e.target.value } })} className="h-8 rounded-input border border-border px-2 text-sm" />
                    <span className="text-sm text-ink-muted">to</span>
                    <input type="time" disabled={!canEdit} value={h.close} aria-label={`${d} closes`}
                      onChange={(e) => setHours({ ...hours, [k]: { ...h, close: e.target.value } })} className="h-8 rounded-input border border-border px-2 text-sm" />
                  </>
                )}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-end justify-end gap-2">
            <Input label="These hours apply from" type="date" value={from} onChange={(e: any) => setFrom(e.target.value)} className="w-48" />
            <Button onClick={save}>Save hours</Button>
          </div>
        )}
      </div>
      {data?.versions?.length > 0 && (
        <div className="text-xs text-ink-muted">
          Versions: {data.versions.map((v: any) => `from ${formatDate(v.effectiveFrom)}${v.createdBy ? ` (${v.createdBy})` : ''}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

export default function StoreCalendarPage() {
  const can = useAuthStore((s) => s.hasPermission);
  const [tab, setTab] = useState('promotions');
  return (
    <RequirePermission permissions={['settings.view', 'analytics.view']}>
      <div className="space-y-4">
        <PageHeader title="Store calendar" subtitle="Promotions, closed days, seasons and opening hours, kept for sales forecasting." />
        <Tabs items={[{ value: 'promotions', label: 'Promotions' }, { value: 'calendar', label: 'Closed days & seasons' }, { value: 'hours', label: 'Opening hours' }]}
          value={tab} onChange={setTab} />
        {tab === 'promotions' && <PromotionsTab canEdit={can('product.edit')} />}
        {tab === 'calendar' && <CalendarTab canEdit={can('settings.edit')} />}
        {tab === 'hours' && <HoursTab canEdit={can('settings.edit')} />}
      </div>
    </RequirePermission>
  );
}
