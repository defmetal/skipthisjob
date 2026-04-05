import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Skip This Job — Ghost Job Detector for LinkedIn & Indeed',
  description:
    'Free Chrome extension that detects ghost job listings on LinkedIn and Indeed before you waste time applying. Community-powered ghost scores, repost tracking, and employer transparency.',
  openGraph: {
    title: 'Skip This Job',
    description: 'Stop applying to jobs that don\'t exist.',
    url: 'https://skipthisjob.com',
    type: 'website',
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
