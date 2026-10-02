import type { Metadata } from 'next';
import { SIGNAL_COUNT } from '@/lib/signals';

/** Apex 307-redirects to www. Canonicals, og:url, and sitemap locs use this host. */
export const SITE_ORIGIN = 'https://www.skipthisjob.com';

export const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/nodldfdkjomniknohmejdimjlejfongd';

/** Concept A mark (ghost + chevron) on the 1200×630 social card. */
export const OG_IMAGE = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  alt: "Skip This Job — Stop applying to jobs that don't exist.",
} as const;

export const HOME_TITLE = 'Skip This Job — Ghost Job Detector for LinkedIn & Indeed';

export const HOME_DESCRIPTION = `Free Chrome extension that scores LinkedIn and Indeed listings for ghost-job risk before you apply. ${SIGNAL_COUNT} distinct checks, no account required.`;

export function absoluteUrl(path: string): string {
  if (path === '/' || path === '') return SITE_ORIGIN;
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = absoluteUrl(path);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Skip This Job',
      type: 'website',
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [
        {
          url: OG_IMAGE.url,
          width: OG_IMAGE.width,
          height: OG_IMAGE.height,
          alt: OG_IMAGE.alt,
        },
      ],
    },
  };
}

/**
 * Homepage structured data. Fields match the product as the site describes it:
 * free Chrome extension, no star ratings (we do not publish any).
 * No FAQPage: the homepage has no FAQ section.
 */
export function homepageJsonLd() {
  const organizationId = `${SITE_ORIGIN}/#organization`;
  const websiteId = `${SITE_ORIGIN}/#website`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: 'Vibe Labs Marketing',
        url: 'https://vibelabsmarketing.com',
        logo: {
          '@type': 'ImageObject',
          url: absoluteUrl('/icon-512.png'),
        },
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'San Antonio',
          addressRegion: 'TX',
          addressCountry: 'US',
        },
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: 'Skip This Job',
        url: absoluteUrl('/'),
        description: HOME_DESCRIPTION,
        inLanguage: 'en',
        publisher: { '@id': organizationId },
      },
      {
        '@type': ['SoftwareApplication', 'BrowserApplication'],
        name: 'Skip This Job',
        alternateName: 'Ghost Job Detector',
        applicationCategory: 'BrowserApplication',
        operatingSystem: 'Chrome',
        url: absoluteUrl('/'),
        installUrl: CHROME_STORE_URL,
        image: absoluteUrl('/og-image.png'),
        description: HOME_DESCRIPTION,
        isAccessibleForFree: true,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        featureList: [
          'Ghost-risk scores on LinkedIn and Indeed listings',
          `${SIGNAL_COUNT} distinct checks`,
          'Score bands: Worth Applying, Proceed with Caution, Likely a Waste of Time, Skip This Job',
          'Anonymous community reports',
        ],
        publisher: { '@id': organizationId },
      },
    ],
  };
}
