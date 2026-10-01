import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  // The apex domain 307-redirects to www, so resolve relative URLs against the canonical www host.
  metadataBase: new URL('https://www.skipthisjob.com'),
  title: 'Skip This Job — Ghost Job Detector for LinkedIn & Indeed',
  description:
    'Free Chrome extension that detects ghost job listings on LinkedIn and Indeed before you waste time applying. Community-powered ghost scores, repost tracking, and employer transparency.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Skip This Job',
    description: 'Stop applying to jobs that don\'t exist.',
    url: 'https://skipthisjob.com',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Skip This Job — Stop applying to jobs that don\'t exist.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Skip This Job',
    description: 'Stop applying to jobs that don\'t exist.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
        className="antialiased"
      >
        {children}
      </body>
    </html>
  );
}
