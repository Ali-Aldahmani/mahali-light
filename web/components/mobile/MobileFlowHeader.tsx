'use client';

export default function MobileFlowHeader({
  title,
  onBack,
  backSrc = '/mobile/back.svg',
}: {
  title: string;
  onBack: () => void;
  backSrc?: string;
}) {
  return (
    <header className="flex items-center gap-2 px-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="-ml-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full active:bg-m-field"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={backSrc} alt="" aria-hidden className="h-6 w-6" />
      </button>
      <h1 className="min-w-0 truncate font-m-work text-[22px] font-semibold text-ink">{title}</h1>
    </header>
  );
}
