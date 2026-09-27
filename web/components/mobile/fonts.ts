import localFont from 'next/font/local';

// Self-hosted (OFL) so LAN installs and offline builds never reach for
// Google Fonts. Only the mobile shell applies these variables.
export const mobileWorkSans = localFont({
  src: '../../app/fonts/WorkSans-latin-var.woff2',
  variable: '--font-m-work',
  weight: '100 900',
  display: 'swap',
  preload: false,
});

export const mobileInter = localFont({
  src: '../../app/fonts/Inter-latin-var.woff2',
  variable: '--font-m-inter',
  weight: '100 900',
  display: 'swap',
  preload: false,
});

export const mobileFontVars = `${mobileWorkSans.variable} ${mobileInter.variable}`;
