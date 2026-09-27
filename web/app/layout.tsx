import type { Metadata, Viewport } from 'next';
import './globals.css';
import SetupGateClient from '@/components/guards/SetupGateClient';
import ToastViewport from '@/components/ui/Toast';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bytecra POS',
  description: 'LAN point of sale',
};

// viewport-fit=cover exposes env(safe-area-inset-*) to the phone shell.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SetupGateClient>{children}</SetupGateClient>
        <ToastViewport />
      </body>
    </html>
  );
}
