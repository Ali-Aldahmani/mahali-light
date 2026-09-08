import type { Metadata } from 'next';
import './globals.css';
import SetupGateClient from '@/components/guards/SetupGateClient';
import ToastViewport from '@/components/ui/Toast';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bytecra POS',
  description: 'LAN point of sale',
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
