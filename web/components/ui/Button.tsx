import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import Spinner from './Spinner';

const VARIANTS = {
  primary:
    'bg-accent text-white hover:bg-accent-hover focus-visible:outline-accent disabled:bg-accent/60',
  secondary:
    'bg-surface text-ink border border-border hover:bg-surface-2 disabled:opacity-60',
  danger:
    'bg-error text-white hover:bg-red-700 disabled:bg-error/60',
  ghost:
    'bg-transparent text-ink hover:bg-surface-2 disabled:opacity-60',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    type = 'button',
    loading = false,
    disabled = false,
    leftIcon = null,
    rightIcon = null,
    className = '',
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-input font-medium transition select-none',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Spinner size={size === 'lg' ? 'md' : 'sm'} className="text-current" />
      ) : (
        leftIcon
      )}
      <span>{children}</span>
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
