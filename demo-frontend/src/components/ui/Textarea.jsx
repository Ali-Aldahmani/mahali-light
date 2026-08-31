import { forwardRef, useId } from 'react';
import { cn } from '../../utils/cn.js';

const Textarea = forwardRef(function Textarea(
  {
    label,
    hint,
    error,
    required = false,
    id,
    className = '',
    containerClassName = '',
    rows = 4,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const inputId = id || autoId;

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
          {required && <span className="text-error ml-0.5">*</span>}
        </label>
      )}
      <textarea
        id={inputId}
        ref={ref}
        rows={rows}
        className={cn(
          'w-full rounded-input border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted',
          'focus:outline-none focus:ring-2',
          error
            ? 'border-error focus:border-error focus:ring-error/30'
            : 'border-border focus:border-accent focus:ring-accent/20',
          className,
        )}
        {...props}
      />
      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export default Textarea;
