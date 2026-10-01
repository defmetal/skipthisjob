import { useId } from 'react';

/**
 * Skip This Job brand mark (concept A: ghost + » chevron).
 * Inline SVG so it is crisp at any size and needs no extra request.
 * Source of truth: /public/icon.svg (keep the two in sync).
 * The mark carries its own purple background, so it works on light and dark UI.
 */
export default function Logo({
  size = 32,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Omit for decorative use next to the "Skip This Job" wordmark. */
  title?: string;
}) {
  const gradientId = `stj-logo-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="30" fill={`url(#${gradientId})`} />
      <path
        fill="#fff"
        d="M12 98 V48 A31 31 0 0 1 74 48 V94 C74 101 80 103 86 100 L86 108 C78 112 70 110 66 106 C62 102 58 100 53 100 C48 100 45 108 38 108 C31 108 27 100 22 100 C17 100 14 102 12 98 Z"
      />
      <ellipse cx="33" cy="50" rx="5.5" ry="6.5" fill="#4C1D95" />
      <ellipse cx="55" cy="50" rx="5.5" ry="6.5" fill="#4C1D95" />
      <path d="M38 64 Q44 70 50 64" fill="none" stroke="#4C1D95" strokeWidth="3.5" strokeLinecap="round" />
      <g fill="none" stroke="#FBBF24" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
        <path d="M86 72 L98 90 L86 108" />
        <path d="M104 72 L116 90 L104 108" />
      </g>
    </svg>
  );
}
