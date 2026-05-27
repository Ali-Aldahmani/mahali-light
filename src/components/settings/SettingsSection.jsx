export default function SettingsSection({ title, description, children, onSave, saving, saveLabel = 'Save changes' }) {
  return (
    <section className="card p-6">
      <header className="mb-4 border-b border-border pb-3">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </header>
      <div className="space-y-4">{children}</div>
      {onSave && (
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      )}
    </section>
  );
}
