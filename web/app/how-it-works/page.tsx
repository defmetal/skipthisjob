import type { Metadata } from 'next';
import Logo from '@/components/Logo';
import { DirectionMark, SignalIcon } from '@/components/signal-ui';
import {
  DISTINCT_NOTE,
  EMPLOYER_PARAGRAPHS,
  GLASSDOOR_NOTE,
  SCORE_BANDS,
  SIGNAL_CATEGORIES,
  SIGNAL_COUNT,
} from '@/lib/signals';
import Link from 'next/link';

const PAGE_TITLE = 'How the ghost score works — Skip This Job';
const PAGE_DESCRIPTION = `Every check behind a Skip This Job score: ${SIGNAL_COUNT} distinct checks on LinkedIn and Indeed, the points each one adds or removes, and the four score bands.`;

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/how-it-works' },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: '/how-it-works',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
};

const BAND_TONE: Record<string, string> = {
  low: 'bg-green-50 text-green-800 border-green-200',
  moderate: 'bg-orange-50 text-orange-900 border-orange-200',
  high: 'bg-red-50 text-red-800 border-red-200',
  very_high: 'bg-purple-50 text-purple-800 border-purple-200',
};

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen">
      <nav className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={32} />
          <span className="text-lg font-bold tracking-[-0.01em]">Skip This Job</span>
        </Link>
        <div className="hidden sm:flex items-center gap-8 text-sm text-gray-500">
          <Link href="/#how-it-works" className="hover:text-gray-900 transition">How It Works</Link>
          <Link href="/#signals" className="hover:text-gray-900 transition">Signals</Link>
          <Link href="/how-it-works" className="text-gray-900 font-medium">Every Check</Link>
          <Link href="/leaderboard" className="hover:text-gray-900 transition">Leaderboard</Link>
          <a
            href="https://chromewebstore.google.com/detail/nodldfdkjomniknohmejdimjlejfongd"
            target="_blank"
            rel="noopener"
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition"
          >
            Add to Chrome — Free
          </a>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 pt-12 pb-24">
        <p className="text-sm font-medium text-purple-700 mb-3">Skip This Job</p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
          How the score works
        </h1>
        <p className="text-lg text-gray-500 leading-relaxed mb-3">
          A listing scores from 0 to 100. The number comes from {SIGNAL_COUNT} checks.
          That count is the number of rows on this page.
        </p>
        <p className="text-sm text-gray-500 leading-relaxed mb-10">{DISTINCT_NOTE}</p>

        <h2 className="text-xl font-semibold mb-4">Score bands</h2>
        <ul className="grid sm:grid-cols-2 gap-3 mb-10">
          {SCORE_BANDS.map((band) => (
            <li
              key={band.id}
              className={`rounded-xl border px-4 py-3 ${BAND_TONE[band.id]}`}
            >
              <p className="font-semibold">{band.name}</p>
              <p className="text-sm mt-0.5">{band.range}</p>
            </li>
          ))}
        </ul>

        <div className="space-y-4 text-sm text-gray-600 leading-relaxed mb-6">
          {EMPLOYER_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed mb-12">{GLASSDOOR_NOTE}</p>

        <nav aria-label="Check categories" className="flex flex-wrap gap-2 mb-14">
          {SIGNAL_CATEGORIES.map((category) => (
            <a
              key={category.id}
              href={`#${category.id}`}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-purple-200 hover:text-purple-800 transition"
            >
              {category.title}
              <span className="text-xs font-semibold text-purple-700">{category.checks.length}</span>
            </a>
          ))}
        </nav>

        <div className="space-y-16">
          {SIGNAL_CATEGORIES.map((category) => (
            <section key={category.id} id={category.id} className="scroll-mt-8">
              <div className="flex items-start gap-3 mb-2">
                <span
                  className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-lg ${
                    category.id === 'combined'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-purple-50 text-purple-700'
                  }`}
                >
                  <SignalIcon id={category.id} />
                </span>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{category.title}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {category.checks.length} {category.checks.length === 1 ? 'check' : 'checks'}
                  </p>
                </div>
              </div>
              <p className="text-gray-600 leading-relaxed mb-6">{category.summary}</p>

              <ul className="divide-y divide-gray-100 border-y border-gray-100">
                {category.checks.map((check) => (
                  <li key={check.id} className="py-5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-2 font-semibold text-gray-900">
                        <DirectionMark direction={check.direction} />
                        {check.phrase}
                      </span>
                      <span className="text-xs text-gray-400">{check.where}</span>
                    </div>
                    <p className="mt-2 text-sm text-gray-600 leading-relaxed">{check.summary}</p>
                    <details className="mt-3 group">
                      <summary className="cursor-pointer text-sm font-medium text-purple-700 hover:text-purple-900 list-none flex items-center gap-1">
                        <span className="inline-block transition group-open:rotate-90" aria-hidden="true">▸</span>
                        Point values
                      </summary>
                      <dl className="mt-3 rounded-lg border border-gray-100 bg-gray-50 divide-y divide-gray-100">
                        {check.points.map((point) => (
                          <div
                            key={point.when}
                            className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-6"
                          >
                            <dt className="text-sm text-gray-600">{point.when}</dt>
                            <dd className="text-sm font-medium text-gray-900 sm:text-right sm:max-w-[40%]">{point.effect}</dd>
                          </div>
                        ))}
                      </dl>
                      {check.note ? (
                        <p className="mt-3 text-sm text-gray-500 leading-relaxed">{check.note}</p>
                      ) : null}
                    </details>
                  </li>
                ))}
              </ul>

              {category.footnote ? (
                <p className="mt-4 text-sm text-gray-500 leading-relaxed">{category.footnote}</p>
              ) : null}
            </section>
          ))}
        </div>

        <p className="mt-16 text-sm text-gray-500">
          <Link href="/#signals" className="text-purple-700 font-medium hover:text-purple-900">
            ← Back to the homepage
          </Link>
        </p>
      </article>

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} Vibe Labs Marketing. San Antonio, TX.
          </p>
          <div className="flex gap-4 text-xs text-gray-400">
            <Link href="/privacy" className="hover:text-gray-600 transition">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-600 transition">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
