import { useMemo } from 'react';
import Select from './Select.jsx';
import Badge from './Badge.jsx';
import { cn } from '../../utils/cn.js';

// Renders one searchable select per attribute, plus a badge marking required.
// Props:
//   attributes: [{ attributeId, name, unit, isRequired, values: [{id,value}] }]
//   value: { [attributeId]: valueId }
//   onChange: (next) => void
//   errors: { [attributeId]: errorMessage }
//   inline: render as a horizontal row (used inside variant matrix rows)
export default function AttributeValueSelect({
  attributes = [],
  value = {},
  onChange,
  errors = {},
  inline = false,
  className = '',
}) {
  if (!attributes.length) {
    return (
      <div className="rounded-input border border-dashed border-border bg-surface-2 px-3 py-2 text-xs text-ink-muted">
        No attributes assigned to this category.
      </div>
    );
  }

  return (
    <div
      className={cn(
        inline ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3' : 'space-y-3',
        className,
      )}
    >
      {attributes.map((attr) => (
        <AttributeField
          key={attr.attributeId}
          attribute={attr}
          value={value[attr.attributeId] || ''}
          error={errors[attr.attributeId]}
          onChange={(v) => onChange?.({ ...value, [attr.attributeId]: v || undefined })}
        />
      ))}
    </div>
  );
}

function AttributeField({ attribute, value, onChange, error }) {
  const options = useMemo(
    () =>
      (attribute.values || []).map((v) => ({
        value: v.id,
        label: v.value,
      })),
    [attribute.values],
  );

  const label = (
    <span className="inline-flex items-center gap-2">
      <span>
        {attribute.name}
        {attribute.unit && (
          <span className="text-ink-muted font-normal"> ({attribute.unit})</span>
        )}
      </span>
      {attribute.isRequired && (
        <Badge tone="accent" size="sm">
          Required
        </Badge>
      )}
    </span>
  );

  return (
    <Select
      label={label}
      placeholder="—"
      value={value}
      onChange={onChange}
      options={options}
      error={error}
      required={attribute.isRequired}
      emptyLabel="No values defined"
    />
  );
}
