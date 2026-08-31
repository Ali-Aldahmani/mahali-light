import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const Input = forwardRef(function Input(
  {
    label,
    hint,
    error,
    leftIcon = null,
    rightIcon = null,
    type = 'text',
    className = '',
    containerClassName = '',
    id,
    required = false,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const inputId = id || autoId;
  const isPassword = type === 'password';
  const [show, setShow] = useState(false);
  const effectiveType = isPassword ? (show ? 'text' : 'password') : type;

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          {label}
          {required && <span className="text-error ml-0.5">*</span>}
        </label>
      )}
      <div
        className={cn(
          'relative flex items-center rounded-input border bg-surface transition',
          error
            ? 'border-error focus-within:ring-2 focus-within:ring-error/30'
            : 'border-border focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
        )}
      >
        {leftIcon && (
          <span className="pl-3 text-ink-muted flex items-center">{leftIcon}</span>
        )}
        <input
          id={inputId}
          ref={ref}
          type={effectiveType}
          className={cn(
            'h-10 w-full bg-transparent px-3 text-sm text-ink placeholder:text-ink-muted outline-none',
            leftIcon && 'pl-2',
            (isPassword || rightIcon) && 'pr-10',
            className,
          )}
          {...props}
        />
        {isPassword ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShow((v) => !v)}
            className="absolute right-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        ) : (
          rightIcon && (
            <span className="absolute right-3 text-ink-muted">{rightIcon}</span>
          )
        )}
      </div>
      {error ? (
        <p className="text-xs text-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export default Input;
