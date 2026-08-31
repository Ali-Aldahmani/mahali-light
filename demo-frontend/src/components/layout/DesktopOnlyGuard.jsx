import { useEffect, useState } from 'react';
import { Monitor, Maximize2, Zap } from 'lucide-react';

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 650;

export default function DesktopOnlyGuard({ children }) {
  const [dimensions, setDimensions] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    function handleResize() {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const isTooSmall = dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT;

  if (isTooSmall) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg p-6 text-ink">
        <div className="card w-full max-w-md p-8 text-center shadow-pop">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-light text-accent">
            <Monitor className="h-8 w-8" />
          </div>

          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-accent">
            <Zap className="h-3.5 w-3.5" />
            <span>Bytecra POS & ERP Demo</span>
          </div>

          <h1 className="mt-2 text-xl font-bold text-ink">
            Designed for Desktop Screens
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            This experience is designed for larger desktop or laptop displays to provide the full POS terminal and multi-column management experience.
          </p>

          <div className="mt-6 rounded-lg bg-surface-2 p-3.5 text-xs text-ink-muted">
            <div className="flex items-center justify-between font-mono">
              <span>Your viewport:</span>
              <span className="font-semibold text-error">
                {dimensions.width} × {dimensions.height}px
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono">
              <span>Required minimum:</span>
              <span className="font-semibold text-success">
                {MIN_WIDTH} × {MIN_HEIGHT}px
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-ink-muted">
            <Maximize2 className="h-4 w-4 text-accent" />
            <span>Maximize your browser window or switch to a laptop/PC</span>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
