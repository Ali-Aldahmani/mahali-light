import Skeleton from '@/components/ui/skeleton';

// Next's own route-segment loading state, shown while a route's data
// fetch is in flight. Previously nothing existed here at any level, so a
// slow initial load on any route (including (auth)/login and
// (auth)/setup) showed a blank screen until the page had something to
// render.
export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 pt-[18vh]">
      <div className="w-full max-w-xl rounded-card border border-border bg-surface p-6">
        <Skeleton lines={6} avatar label="Loading page" />
      </div>
    </div>
  );
}
