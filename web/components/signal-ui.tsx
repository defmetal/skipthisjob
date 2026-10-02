import type { Direction } from '@/lib/signals';

const iconClass = 'w-5 h-5';

/** Simple stroke icons, one per signal category. */
export function SignalIcon({ id }: { id: string }) {
  const common = {
    className: iconClass,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (id) {
    case 'listing-age':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'applicants':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="2.5" />
          <circle cx="16" cy="9" r="2" />
          <path d="M4.5 19c.4-2.8 2.4-4.5 4.5-4.5S13.1 16.2 13.5 19" />
          <path d="M14 14.8c1.6.3 3.2 1.6 3.6 4.2" />
        </svg>
      );
    case 'pay-contact':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7.5v9" />
          <path d="M14.5 9.2c0-1-.9-1.7-2.5-1.7s-2.5.7-2.5 1.7 1 1.6 2.5 1.8 2.5.8 2.5 1.8-1 1.7-2.5 1.7-2.5-.7-2.5-1.7" />
        </svg>
      );
    case 'description':
      return (
        <svg {...common}>
          <path d="M7 3.5h7l4 4V20.5H7v-17z" />
          <path d="M14 3.5V8h4.5" />
          <path d="M10 12.5h5M10 16h4" />
        </svg>
      );
    case 'employer':
      return (
        <svg {...common}>
          <path d="M4 20.5V9l8-4.5 8 4.5v11.5" />
          <path d="M9 20.5v-5h6v5" />
          <path d="M9 11h.01M15 11h.01M9 14.5h.01M15 14.5h.01" />
        </svg>
      );
    case 'combined':
      return (
        <svg {...common}>
          <path d="M12 3.5l8 4-8 4-8-4 8-4z" />
          <path d="M4 12l8 4 8-4" />
          <path d="M4 16.5l8 4 8-4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

export function DirectionMark({ direction }: { direction: Direction }) {
  if (direction === 'lowers') {
    return (
      <span className="inline-flex items-center justify-center min-w-[1.25rem] font-semibold text-green-700" title="Lowers risk">
        <span aria-hidden="true">↓</span>
        <span className="sr-only">Lowers risk: </span>
      </span>
    );
  }
  if (direction === 'either') {
    return (
      <span className="inline-flex items-center justify-center min-w-[1.75rem] font-semibold text-amber-700" title="Raises or lowers risk">
        <span aria-hidden="true">↑↓</span>
        <span className="sr-only">Raises or lowers risk: </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center min-w-[1.25rem] font-semibold text-red-600" title="Raises risk">
      <span aria-hidden="true">↑</span>
      <span className="sr-only">Raises risk: </span>
    </span>
  );
}
