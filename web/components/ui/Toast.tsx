'use client';

import { ToastStack, ToastStackProvider } from './toast-stack';
import { appToasts } from '@/store/toastStore';

/** The app's toasts: top-right, stacked, each closing after 5 seconds. Mounted once in the root layout. */
export default function ToastViewport() {
  return (
    <ToastStackProvider store={appToasts}>
      <ToastStack position="top-right" />
    </ToastStackProvider>
  );
}
