export default function PCIdentifierBadge() {
  const id = 'DEMO-POS-01';

  return (
    <span
      className="inline-flex items-center rounded-md bg-accent-light px-2 py-0.5 text-[11px] font-semibold text-accent"
      title="Front-End Static Demo Clone with In-Memory Mock Data"
    >
      {id} · DEMO
    </span>
  );
}
