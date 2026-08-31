export default function SetupWizardStep({
  step,
  total,
  title,
  subtitle,
  children,
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
  hideBack = false,
}) {
  const pct = Math.round((step / total) * 100);
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
      <div className="mb-8">
        <div className="mb-2 flex justify-between text-xs text-ink-muted">
          <span>
            Step {step} of {total}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-2 bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      <div className="card p-6">{children}</div>
      <div className="mt-6 flex justify-between">
        {!hideBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-ink-muted hover:text-ink"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={nextDisabled}
          onClick={onNext}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
