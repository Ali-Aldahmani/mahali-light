import Spinner from '@/components/ui/Spinner';

// Next's own route-segment loading state, shown while a route's data
// fetch is in flight. Previously nothing existed here at any level, so a
// slow initial load on any route (including (auth)/login and
// (auth)/setup) showed a blank screen until the page had something to
// render.
export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner size="lg" className="text-accent" />
    </div>
  );
}
