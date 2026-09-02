import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ChevronRight,
  CircleCheckBig,
  Package,
  Save,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import CategoryTreeSelect from '../../components/ui/CategoryTreeSelect.jsx';
import ImageUpload from '../../components/ui/ImageUpload.jsx';
import VariantsEditor from './VariantsEditor.jsx';
import { useProductStore } from '../../store/productStore.js';
import {
  createProduct,
  uploadProductImage,
  lookupBarcode,
} from '../../services/productService.js';
import { generateInternalBarcode } from '../../services/variantService.js';
import { getCategoryAttributes } from '../../services/categoryService.js';
import { toast } from '../../store/toastStore.js';
import { cn } from '../../utils/cn.js';

const SOLD_BY = [
  { value: 'piece', label: 'Piece (whole units)' },
  { value: 'meter', label: 'Meter (decimal allowed)' },
  { value: 'roll', label: 'Roll' },
  { value: 'kg', label: 'Kilogram (decimal allowed)' },
  { value: 'box', label: 'Box' },
];

const UNIT_DEFAULTS = {
  piece: 'pcs',
  meter: 'm',
  roll: 'rolls',
  kg: 'kg',
  box: 'box',
};

const STEPS = [
  { id: 'basic', label: 'Basic info', icon: Package },
  { id: 'pricing', label: 'Pricing & variants', icon: Boxes },
  { id: 'review', label: 'Review & save', icon: CircleCheckBig },
];

const EMPTY_BASIC = {
  name: '',
  description: '',
  categoryId: null,
  brand: '',
  soldBy: 'piece',
  unitLabel: 'pcs',
  defaultWarrantyMonths: 0,
  reorderThreshold: 0,
  hasVariants: false,
  imageFile: null,
};

const EMPTY_SIMPLE = {
  sku: '',
  barcode: '',
  supplierBarcode: '',
  sellingPrice: 0,
  costPrice: 0,
  openingStock: 0,
  reorderThreshold: '',
};

export default function NewProductPage() {
  const navigate = useNavigate();
  const tree = useProductStore((s) => s.categoriesTree);
  const fetchCategories = useProductStore((s) => s.fetchCategories);
  const refreshStore = useProductStore((s) => s.refreshAll);

  const [stepIdx, setStepIdx] = useState(0);

  const [basic, setBasic] = useState(EMPTY_BASIC);
  const [simple, setSimple] = useState(EMPTY_SIMPLE);
  const [variants, setVariants] = useState([]);
  const [categoryAttributes, setCategoryAttributes] = useState([]);

  const [basicErrors, setBasicErrors] = useState({});
  const [pricingError, setPricingError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [scanCode, setScanCode] = useState('');
  const [looking, setLooking] = useState(false);

  async function fetchImageAsFile(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
      return new File([blob], `barcode-lookup.${ext}`, { type: blob.type });
    } catch {
      // Cross-origin image hosts don't always allow fetching bytes — that's
      // fine, the rest of the auto-fill still applies.
      return null;
    }
  }

  async function runBarcodeLookup() {
    const code = scanCode.trim();
    if (!code) return;
    setLooking(true);
    try {
      const result = await lookupBarcode(code);
      if (!result?.found) {
        toast.info('No match found for that barcode — enter details manually.');
        return;
      }
      setBasic((b) => ({
        ...b,
        name: b.name || result.title || b.name,
        brand: b.brand || result.brand || b.brand,
        description: b.description || result.description || b.description,
      }));
      setSimple((s) => ({ ...s, supplierBarcode: s.supplierBarcode || code }));
      if (result.imageUrl) {
        const file = await fetchImageAsFile(result.imageUrl);
        if (file) setBasic((b) => ({ ...b, imageFile: b.imageFile || file }));
      }
      toast.success(
        result.category
          ? `Found "${result.title || code}" — category suggestion: ${result.category}. Please pick the closest match below.`
          : `Found "${result.title || code}".`,
      );
    } catch (err) {
      toast.error(err?.message || 'Barcode lookup failed.');
    } finally {
      setLooking(false);
    }
  }

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Load category attributes when category changes.
  useEffect(() => {
    if (!basic.categoryId) {
      setCategoryAttributes([]);
      return;
    }
    let cancelled = false;
    getCategoryAttributes(basic.categoryId)
      .then((data) => {
        if (cancelled) return;
        setCategoryAttributes(data || []);
        // Reset variants when category changes since attribute schema shifted.
        setVariants([]);
      })
      .catch(() => {
        if (!cancelled) setCategoryAttributes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [basic.categoryId]);

  function setBasicField(key, value) {
    setBasic((b) => {
      const next = { ...b, [key]: value };
      if (key === 'soldBy' && (!b.unitLabel || b.unitLabel === UNIT_DEFAULTS[b.soldBy])) {
        next.unitLabel = UNIT_DEFAULTS[value] || b.unitLabel;
      }
      return next;
    });
  }

  function validateBasic() {
    const errs = {};
    if (!basic.name.trim()) errs.name = 'Name is required.';
    if (!basic.categoryId) errs.categoryId = 'Select a category.';
    if (basic.defaultWarrantyMonths < 0)
      errs.defaultWarrantyMonths = 'Cannot be negative.';
    if (basic.reorderThreshold < 0)
      errs.reorderThreshold = 'Cannot be negative.';
    setBasicErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validatePricing() {
    setPricingError(null);
    if (basic.hasVariants) {
      if (!variants.length) {
        setPricingError('Add at least one variant.');
        return false;
      }
      const requiredAttrs = categoryAttributes.filter((a) => a.isRequired);
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        for (const a of requiredAttrs) {
          if (!v.attributeValueIds?.[a.attributeId]) {
            setPricingError(
              `Variant ${i + 1}: "${a.name}" is required.`,
            );
            return false;
          }
        }
        if (Number(v.sellingPrice) < 0 || Number(v.costPrice) < 0) {
          setPricingError(`Variant ${i + 1}: prices cannot be negative.`);
          return false;
        }
      }
    } else {
      if (Number(simple.sellingPrice) < 0 || Number(simple.costPrice) < 0) {
        setPricingError('Prices cannot be negative.');
        return false;
      }
    }
    return true;
  }

  function next() {
    if (stepIdx === 0 && !validateBasic()) return;
    if (stepIdx === 1 && !validatePricing()) return;
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  }
  function back() {
    setStepIdx((i) => Math.max(0, i - 1));
  }

  async function save() {
    if (!validateBasic()) {
      setStepIdx(0);
      return;
    }
    if (!validatePricing()) {
      setStepIdx(1);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: basic.name.trim(),
        description: basic.description.trim() || null,
        categoryId: basic.categoryId,
        brand: basic.brand.trim() || null,
        hasVariants: basic.hasVariants,
        soldBy: basic.soldBy,
        unitLabel: basic.unitLabel.trim() || UNIT_DEFAULTS[basic.soldBy] || 'pcs',
        defaultWarrantyMonths: Number(basic.defaultWarrantyMonths) || 0,
        reorderThreshold: Number(basic.reorderThreshold) || 0,
        isActive: true,
      };

      if (basic.hasVariants) {
        payload.variants = variants.map((v) => ({
          attributeValueIds: Object.values(v.attributeValueIds || {}).filter(Boolean),
          sku: v.sku || null,
          barcode: v.barcode || null,
          supplierBarcode: v.supplierBarcode || null,
          sellingPrice: Number(v.sellingPrice || 0),
          costPrice: Number(v.costPrice || 0),
          openingStock: Number(v.openingStock || 0),
          reorderThreshold:
            v.reorderThreshold === '' || v.reorderThreshold === null
              ? null
              : Number(v.reorderThreshold),
        }));
      } else {
        payload.simple = {
          sku: simple.sku || null,
          barcode: simple.barcode || null,
          supplierBarcode: simple.supplierBarcode || null,
          sellingPrice: Number(simple.sellingPrice || 0),
          costPrice: Number(simple.costPrice || 0),
          openingStock: Number(simple.openingStock || 0),
          reorderThreshold:
            simple.reorderThreshold === '' || simple.reorderThreshold === null
              ? null
              : Number(simple.reorderThreshold),
        };
      }

      const created = await createProduct(payload);

      if (basic.imageFile) {
        try {
          await uploadProductImage(created.id, basic.imageFile);
        } catch (err) {
          toast.warning('Product created, but image upload failed.');
        }
      }

      toast.success(`Product ${created.name} created.`);
      refreshStore();
      navigate(`/products/${created.id}`);
    } catch (err) {
      if (err?.code === 'RESOURCE_CONFLICT') {
        toast.error(err.message);
        setStepIdx(1);
      } else {
        toast.error(err?.message || 'Could not create product.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New product"
        subtitle="Add an item to your catalog in three quick steps."
        action={
          <Link to="/products">
            <Button variant="secondary" leftIcon={<ArrowLeft size={14} />}>
              Back to products
            </Button>
          </Link>
        }
      />

      <Stepper stepIdx={stepIdx} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
        <div className="xl:col-span-2">
          {stepIdx === 0 && (
            <StepBasic
              basic={basic}
              setField={setBasicField}
              tree={tree}
              errors={basicErrors}
              scanCode={scanCode}
              setScanCode={setScanCode}
              onLookup={runBarcodeLookup}
              looking={looking}
            />
          )}
          {stepIdx === 1 && (
            <StepPricing
              basic={basic}
              setField={setBasicField}
              simple={simple}
              setSimple={setSimple}
              variants={variants}
              setVariants={setVariants}
              categoryAttributes={categoryAttributes}
              error={pricingError}
            />
          )}
          {stepIdx === 2 && (
            <StepReview
              basic={basic}
              simple={simple}
              variants={variants}
              categoryAttributes={categoryAttributes}
              categoryName={
                tree && findInTree(tree, basic.categoryId)?.name
              }
            />
          )}
        </div>

        <aside className="card p-5 self-start sticky top-4">
          <h3 className="text-sm font-semibold text-ink mb-3">Summary</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Name">{basic.name || <Empty />}</Row>
            <Row label="Brand">{basic.brand || <Empty />}</Row>
            <Row label="Category">
              {basic.categoryId
                ? findInTree(tree, basic.categoryId)?.name || <Empty />
                : <Empty />}
            </Row>
            <Row label="Sold by">
              {basic.soldBy} ({basic.unitLabel})
            </Row>
            <Row label="Type">
              {basic.hasVariants
                ? `${variants.length} variant${variants.length === 1 ? '' : 's'}`
                : 'Single product'}
            </Row>
            <Row label="Warranty">
              {basic.defaultWarrantyMonths
                ? `${basic.defaultWarrantyMonths} months`
                : 'None'}
            </Row>
          </dl>
        </aside>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="secondary"
          onClick={back}
          disabled={stepIdx === 0 || saving}
          leftIcon={<ArrowLeft size={14} />}
        >
          Back
        </Button>
        {stepIdx < STEPS.length - 1 ? (
          <Button onClick={next} rightIcon={<ArrowRight size={14} />}>
            Continue
          </Button>
        ) : (
          <Button onClick={save} loading={saving} leftIcon={<Save size={14} />}>
            Save product
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ stepIdx }) {
  return (
    <ol className="flex items-center gap-3 flex-wrap">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const isActive = i === stepIdx;
        const isDone = i < stepIdx;
        return (
          <li key={s.id} className="flex items-center gap-3">
            <div
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium',
                isActive
                  ? 'bg-accent text-white'
                  : isDone
                    ? 'bg-success-light text-success'
                    : 'bg-surface-2 text-ink-muted',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs',
                  isActive
                    ? 'bg-white/20'
                    : isDone
                      ? 'bg-success text-white'
                      : 'bg-surface text-ink-muted',
                )}
              >
                {isDone ? <Check size={12} /> : i + 1}
              </span>
              <Icon size={14} />
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight size={14} className="text-ink-muted" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepBasic({ basic, setField, tree, errors, scanCode, setScanCode, onLookup, looking }) {
  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-base font-semibold text-ink">Step 1 · Basic info</h2>

      <div className="rounded-input border border-dashed border-border bg-surface-2 p-4">
        <div className="flex items-end gap-2">
          <Input
            label="Scan or enter a barcode"
            placeholder="Scan with a USB scanner, or type a UPC/EAN"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onLookup();
              }
            }}
            containerClassName="flex-1"
          />
          <Button type="button" variant="secondary" onClick={onLookup} loading={looking}>
            Look up
          </Button>
        </div>
        <p className="text-xs text-ink-muted mt-1.5">
          Best-effort match against a public UPC/EAN database — fills name, brand and
          image when found. Most locally-stocked electrical parts won't have a match,
          which is normal; just fill the fields below by hand.
        </p>
      </div>

      <Input
        label="Product name"
        required
        value={basic.name}
        onChange={(e) => setField('name', e.target.value)}
        error={errors.name}
      />

      <div>
        <label className="text-sm font-medium text-ink mb-1.5 block">Description</label>
        <textarea
          value={basic.description}
          onChange={(e) => setField('description', e.target.value)}
          rows={3}
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CategoryTreeSelect
          label="Category"
          tree={tree}
          value={basic.categoryId}
          onChange={(id) => setField('categoryId', id)}
          required
          error={errors.categoryId}
        />
        <Input
          label="Brand"
          placeholder="e.g. Philips"
          value={basic.brand}
          onChange={(e) => setField('brand', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select
          label="Sold by"
          value={basic.soldBy}
          onChange={(v) => setField('soldBy', v)}
          options={SOLD_BY}
        />
        <Input
          label="Unit label"
          value={basic.unitLabel}
          onChange={(e) => setField('unitLabel', e.target.value)}
          hint='Shown to cashiers in carts and on invoices.'
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label="Default warranty (months)"
          type="number"
          min="0"
          max="120"
          value={basic.defaultWarrantyMonths}
          onChange={(e) => setField('defaultWarrantyMonths', e.target.value)}
          error={errors.defaultWarrantyMonths}
        />
        <Input
          label="Reorder threshold (total)"
          type="number"
          min="0"
          step="0.01"
          value={basic.reorderThreshold}
          onChange={(e) => setField('reorderThreshold', e.target.value)}
          error={errors.reorderThreshold}
          hint="Applies across all variants if the product has them."
        />
      </div>

      <ImageUpload
        label="Product image"
        value={null}
        onChange={(file) => setField('imageFile', file)}
        hint="Optional. We compress to 800x800 webp after upload."
      />

      <label className="mt-2 flex items-start gap-3 rounded-input border border-border bg-surface-2 px-4 py-3">
        <input
          type="checkbox"
          checked={basic.hasVariants}
          onChange={(e) => setField('hasVariants', e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
        />
        <span>
          <span className="text-sm font-medium text-ink">This product has variants</span>
          <span className="block text-xs text-ink-muted mt-0.5">
            Use variants when the same product comes in different sizes, wattages, colors etc.
          </span>
        </span>
      </label>
    </div>
  );
}

function StepPricing({
  basic,
  setField,
  simple,
  setSimple,
  variants,
  setVariants,
  categoryAttributes,
  error,
}) {
  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-base font-semibold text-ink">
        Step 2 · {basic.hasVariants ? 'Variants' : 'Pricing & stock'}
      </h2>
      {error && (
        <div className="rounded-input bg-error-light text-error text-sm px-3 py-2">
          {error}
        </div>
      )}

      {basic.hasVariants ? (
        categoryAttributes.length === 0 ? (
          <div className="rounded-input border border-dashed border-warning bg-warning-light/40 px-4 py-3 text-sm text-warning">
            This category has no attributes configured. Add attributes on the Categories
            page before creating variants, or switch this product to a single (no
            variants) item.
          </div>
        ) : (
          <VariantsEditor
            variants={variants}
            setVariants={setVariants}
            attributes={categoryAttributes}
            categoryId={basic.categoryId}
          />
        )
      ) : (
        <SimpleEditor
          simple={simple}
          setSimple={setSimple}
          unitLabel={basic.unitLabel}
          soldBy={basic.soldBy}
          categoryId={basic.categoryId}
        />
      )}
    </div>
  );
}

function SimpleEditor({ simple, setSimple, unitLabel, soldBy, categoryId }) {
  const decimal = soldBy === 'meter' || soldBy === 'kg';
  const [generating, setGenerating] = useState(false);

  async function generate() {
    setGenerating(true);
    try {
      const { barcode } = await generateInternalBarcode(categoryId);
      setSimple((s) => ({ ...s, barcode }));
    } catch (err) {
      toast.error(err?.message || 'Could not generate a barcode.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label="SKU"
          placeholder="Leave blank to auto-generate"
          value={simple.sku}
          onChange={(e) => setSimple((s) => ({ ...s, sku: e.target.value }))}
        />
        <div className="flex items-end gap-2">
          <Input
            label="Internal barcode"
            placeholder="Leave blank to auto-generate"
            value={simple.barcode}
            onChange={(e) => setSimple((s) => ({ ...s, barcode: e.target.value }))}
            containerClassName="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={generate}
            loading={generating}
            className="mb-0"
          >
            Generate
          </Button>
        </div>
      </div>

      <Input
        label="Supplier barcode"
        placeholder="Optional, scanned from supplier label"
        value={simple.supplierBarcode}
        onChange={(e) => setSimple((s) => ({ ...s, supplierBarcode: e.target.value }))}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          label="Selling price (AED)"
          type="number"
          step="0.01"
          min="0"
          required
          value={simple.sellingPrice}
          onChange={(e) => setSimple((s) => ({ ...s, sellingPrice: e.target.value }))}
        />
        <Input
          label="Cost price (AED)"
          type="number"
          step="0.01"
          min="0"
          value={simple.costPrice}
          onChange={(e) => setSimple((s) => ({ ...s, costPrice: e.target.value }))}
        />
        <Input
          label={`Opening stock (${unitLabel})`}
          type="number"
          step={decimal ? '0.01' : '1'}
          min="0"
          value={simple.openingStock}
          onChange={(e) => setSimple((s) => ({ ...s, openingStock: e.target.value }))}
        />
      </div>

      <Input
        label="Variant reorder threshold (optional)"
        type="number"
        step="0.01"
        min="0"
        value={simple.reorderThreshold}
        onChange={(e) =>
          setSimple((s) => ({ ...s, reorderThreshold: e.target.value }))
        }
        hint="If empty, the product-level threshold from step 1 is used."
      />
    </div>
  );
}

function StepReview({ basic, simple, variants, categoryAttributes, categoryName }) {
  return (
    <div className="card p-6 space-y-5">
      <h2 className="text-base font-semibold text-ink">Step 3 · Review</h2>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-2">Basic info</h3>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="Name">{basic.name}</Row>
          <Row label="Category">{categoryName || <Empty />}</Row>
          <Row label="Brand">{basic.brand || <Empty />}</Row>
          <Row label="Sold by">
            {basic.soldBy} ({basic.unitLabel})
          </Row>
          <Row label="Warranty (months)">{basic.defaultWarrantyMonths || 0}</Row>
          <Row label="Reorder threshold">{basic.reorderThreshold || 0}</Row>
        </dl>
        {basic.description && (
          <p className="mt-3 text-sm text-ink-muted whitespace-pre-line">
            {basic.description}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-2">
          {basic.hasVariants ? 'Variants' : 'Pricing & stock'}
        </h3>
        {basic.hasVariants ? (
          variants.length === 0 ? (
            <p className="text-sm text-error">No variants defined yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-input border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-ink-muted">
                  <tr>
                    {categoryAttributes.map((a) => (
                      <th key={a.attributeId} className="px-3 py-2 text-left">
                        {a.name}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => (
                    <tr key={i} className="border-t border-border">
                      {categoryAttributes.map((a) => {
                        const id = v.attributeValueIds?.[a.attributeId];
                        const val = id
                          ? a.values.find((x) => x.id === id)?.value
                          : null;
                        return (
                          <td key={a.attributeId} className="px-3 py-2 text-ink-muted">
                            {val || '—'}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 font-mono text-xs text-ink">
                        {v.sku || 'auto'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink">
                        {Number(v.sellingPrice || 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-muted">
                        {Number(v.costPrice || 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-muted">
                        {v.openingStock || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <Row label="SKU">{simple.sku || 'auto'}</Row>
            <Row label="Barcode">{simple.barcode || 'auto'}</Row>
            <Row label="Supplier barcode">{simple.supplierBarcode || <Empty />}</Row>
            <Row label="Selling price">
              {Number(simple.sellingPrice || 0).toFixed(2)}
            </Row>
            <Row label="Cost price">{Number(simple.costPrice || 0).toFixed(2)}</Row>
            <Row label="Opening stock">{simple.openingStock || 0}</Row>
          </dl>
        )}
      </section>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </>
  );
}

function Empty() {
  return <span className="text-ink-muted/70">—</span>;
}

function findInTree(tree, id) {
  if (!id) return null;
  const stack = [...(tree || [])];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === id) return n;
    if (n.children?.length) stack.push(...n.children);
  }
  return null;
}
