/** Published Chrome Web Store extension id. */
export const PUBLISHED_EXTENSION_ORIGIN =
  'chrome-extension://nodldfdkjomniknohmejdimjlejfongd';

const SITE_ORIGINS = new Set([
  'https://www.skipthisjob.com',
  'https://skipthisjob.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

/**
 * Whether a POST /api/track or /api/report Origin header is acceptable.
 *
 * Missing Origin (and the literal "null") is allowed. Chrome extension
 * service-worker fetches have historically omitted Origin on some versions,
 * and rejecting those requests would drop real tracking and reports.
 * Any chrome-extension:// origin is allowed because an unpacked install
 * gets a different id (manifest.json has no "key").
 * Other website origins are rejected so a random page cannot post with the
 * visitor's browser. Non-browser clients can still set Origin, so this is
 * not the anti-abuse control — platform job ids, distinct reporters, and
 * the evidence-age gate are.
 */
export function isAllowedPostOrigin(origin: string | null | undefined): boolean {
  if (!origin || origin === 'null') return true;
  if (origin === PUBLISHED_EXTENSION_ORIGIN) return true;
  if (origin.startsWith('chrome-extension://') && origin.length <= 80) return true;
  return SITE_ORIGINS.has(origin);
}
