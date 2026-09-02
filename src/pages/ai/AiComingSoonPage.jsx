import { Sparkles } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';

export default function AiComingSoonPage({ title }) {
  return (
    <div>
      <PageHeader title={title} subtitle="AI-powered insights for your store." />
      <div className="card flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-light text-accent">
          <Sparkles size={22} />
        </div>
        <p className="text-sm font-medium text-ink">
          The data is the fuel of AI, come back soon
        </p>
      </div>
    </div>
  );
}
