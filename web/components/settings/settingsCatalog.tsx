import { Bell, Palette, Printer, ShieldCheck, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import type { SettingDef, SettingsSection, SettingsValues } from '@/components/ui/settings-command';

/**
 * The settings shown in the Settings command. Front end only for now:
 * nothing here is read by the rest of the app or saved to the server yet.
 * Wire a setting up by reading its id from the saved values and saving
 * through SettingsCommand's onSave.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'general', label: 'General', description: 'Store name and regional defaults.', icon: <SlidersHorizontal /> },
  { id: 'appearance', label: 'Appearance', description: 'How the app looks for you on this computer.', icon: <Palette /> },
  { id: 'pos', label: 'Point of sale', description: 'How sales are rung up at the counter.', icon: <ShoppingCart /> },
  { id: 'receipts', label: 'Receipts & printing', description: 'What prints after a sale.', icon: <Printer /> },
  { id: 'notifications', label: 'Notifications', description: 'What the app tells you about, and how.', icon: <Bell /> },
  { id: 'security', label: 'Security', description: 'Locking and approvals on this computer.', icon: <ShieldCheck /> },
];

const required = (label: string) => (v: unknown) => (String(v ?? '').trim() ? null : `${label} can't be empty.`);

export const SETTINGS: SettingDef[] = [
  { id: 'storeName', section: 'general', label: 'Store name', description: 'Shown on receipts, invoices and reports.', kind: 'text', placeholder: 'Your store name', validate: required('Store name'), keywords: ['business', 'shop'] },
  { id: 'storePhone', section: 'general', label: 'Store phone', description: 'Printed under the store name.', kind: 'phone', keywords: ['contact', 'number', 'mobile'] },
  { id: 'language', section: 'general', label: 'Language', description: 'Used for dates, numbers and interface text.', kind: 'select', options: [{ value: 'en-GB', label: 'English (UK)' }, { value: 'ar-AE', label: 'العربية (الإمارات)' }], keywords: ['arabic', 'english', 'locale'] },
  { id: 'timezone', section: 'general', label: 'Time zone', description: 'Day boundaries for sales and reports follow this zone.', kind: 'select', options: [{ value: 'Asia/Dubai', label: 'Dubai (GMT+4)' }, { value: 'Asia/Riyadh', label: 'Riyadh (GMT+3)' }, { value: 'Asia/Muscat', label: 'Muscat (GMT+4)' }], keywords: ['timezone', 'clock'] },
  { id: 'weekStart', section: 'general', label: 'Week starts on', description: 'Affects calendars and weekly reports.', kind: 'segmented', options: [{ value: 'mon', label: 'Monday' }, { value: 'sat', label: 'Saturday' }, { value: 'sun', label: 'Sunday' }], keywords: ['calendar'] },

  { id: 'theme', section: 'appearance', label: 'Theme', description: 'Match the system or pick one.', kind: 'segmented', options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }], keywords: ['dark mode', 'colors'] },
  { id: 'density', section: 'appearance', label: 'Density', description: 'Compact fits more rows in lists and tables.', kind: 'segmented', options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], keywords: ['spacing', 'rows'] },
  { id: 'reduceMotion', section: 'appearance', label: 'Reduce motion', description: 'Fewer animations across the app.', kind: 'switch', keywords: ['animation', 'accessibility'] },

  { id: 'defaultPayment', section: 'pos', label: 'Default payment method', description: 'Pre-selected when you take payment.', kind: 'segmented', options: [{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }], keywords: ['checkout', 'pay'] },
  { id: 'askCustomer', section: 'pos', label: 'Ask for a customer on every sale', description: 'Otherwise sales default to Guest.', kind: 'switch', keywords: ['guest', 'walk-in'] },
  { id: 'scanSound', section: 'pos', label: 'Beep on barcode scan', description: 'Plays a short sound when a scan adds an item.', kind: 'switch', keywords: ['barcode', 'sound', 'scanner'] },
  { id: 'lowStockWarn', section: 'pos', label: 'Warn when selling low-stock items', description: 'Shows a note in the cart below the reorder level.', kind: 'switch', keywords: ['stock', 'inventory'] },

  { id: 'autoPrint', section: 'receipts', label: 'Print receipt automatically', description: 'Prints as soon as a sale is confirmed.', kind: 'switch', keywords: ['printer', 'receipt'] },
  { id: 'receiptSize', section: 'receipts', label: 'Receipt paper', description: 'Match your receipt printer.', kind: 'segmented', options: [{ value: '80mm', label: '80 mm' }, { value: '58mm', label: '58 mm' }, { value: 'a4', label: 'A4' }], keywords: ['paper', 'width', 'printer'] },
  { id: 'showVat', section: 'receipts', label: 'Show VAT breakdown', description: 'Lists taxable amount and VAT on receipts.', kind: 'switch', keywords: ['tax', 'trn'] },
  { id: 'receiptFooter', section: 'receipts', label: 'Receipt footer', description: 'A short line at the bottom of every receipt.', kind: 'text', placeholder: 'Thank you for shopping with us', keywords: ['message', 'note'] },

  { id: 'notifyLowStock', section: 'notifications', label: 'Low-stock alerts', description: 'Notify when an item drops below its threshold.', kind: 'switch', keywords: ['stock', 'telegram', 'reorder'] },
  { id: 'notifyApprovals', section: 'notifications', label: 'Approval requests', description: 'Returns, edits and adjustments waiting for you.', kind: 'switch', keywords: ['approve', 'requests'] },
  { id: 'notifySound', section: 'notifications', label: 'Notification sound', description: 'Play a sound when something new arrives.', kind: 'switch', keywords: ['sound', 'alert'] },
  { id: 'dailySummary', section: 'notifications', label: 'Daily summary', description: 'A short recap of the day’s sales at closing.', kind: 'segmented', options: [{ value: 'off', label: 'Off' }, { value: 'telegram', label: 'Telegram' }, { value: 'email', label: 'Email' }], keywords: ['report', 'recap', 'email', 'telegram'] },

  { id: 'autoLock', section: 'security', label: 'Lock after inactivity', description: 'Asks for the password again after this long.', kind: 'select', options: [{ value: '5', label: 'After 5 minutes' }, { value: '15', label: 'After 15 minutes' }, { value: '30', label: 'After 30 minutes' }, { value: 'never', label: 'Never' }], keywords: ['timeout', 'password', 'idle'] },
  { id: 'refundApproval', section: 'security', label: 'Manager approval for refunds', description: 'Cashiers need a manager to approve every refund.', kind: 'switch', keywords: ['return', 'refund', 'manager'] },
  { id: 'discountLimit', section: 'security', label: 'Cashier discount limit', description: 'Largest discount a cashier can give without approval.', kind: 'segmented', options: [{ value: '0', label: 'None' }, { value: '5', label: '5%' }, { value: '10', label: '10%' }, { value: '20', label: '20%' }], keywords: ['discount', 'price'] },
];

export const SETTINGS_DEFAULTS: SettingsValues = {
  storeName: 'Mahali Electrical',
  storePhone: '',
  language: 'en-GB',
  timezone: 'Asia/Dubai',
  weekStart: 'mon',
  theme: 'light',
  density: 'comfortable',
  reduceMotion: false,
  defaultPayment: 'cash',
  askCustomer: false,
  scanSound: true,
  lowStockWarn: true,
  autoPrint: true,
  receiptSize: '80mm',
  showVat: true,
  receiptFooter: 'Thank you for shopping with us',
  notifyLowStock: true,
  notifyApprovals: true,
  notifySound: false,
  dailySummary: 'off',
  autoLock: '15',
  refundApproval: true,
  discountLimit: '5',
};

export const SETTINGS_SUGGESTED = ['autoPrint', 'receiptSize', 'notifyLowStock', 'autoLock', 'theme'];
