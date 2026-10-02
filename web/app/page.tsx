import Logo from '@/components/Logo';
import { DirectionMark, SignalIcon } from '@/components/signal-ui';
import {
  DISTINCT_NOTE,
  EMPLOYER_SHORT,
  GLASSDOOR_SHORT,
  SIGNAL_CATEGORIES,
  SIGNAL_COUNT,
  highlightGroups,
} from '@/lib/signals';
import Link from 'next/link';

const HIGHLIGHTS = highlightGroups();

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* ── Nav ── */}
      <nav className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo size={32} />
          <span className="text-lg font-bold tracking-[-0.01em]">Skip This Job</span>
        </div>
        <div className="hidden sm:flex items-center gap-8 text-sm text-gray-500">
          <a href="#how-it-works" className="hover:text-gray-900 transition">How It Works</a>
          <a href="#signals" className="hover:text-gray-900 transition">Signals</a>
          <a href="#lookup" className="hover:text-gray-900 transition">Employer Lookup</a>
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

      {/* ── Hero ── */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-xs font-medium mb-6">
          <Logo size={18} />
          <span>Free Chrome Extension</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-6">
          Stop applying to jobs<br />that don&apos;t exist.
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10 leading-relaxed">
          Ghost Job Detector scores every LinkedIn and Indeed listing you open.
          It combines that listing&apos;s own signals with the employer&apos;s track
          record, weighted by how much evidence we have, so you spend time on
          real opportunities. Free, no account needed.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="https://chromewebstore.google.com/detail/nodldfdkjomniknohmejdimjlejfongd"
            target="_blank"
            rel="noopener"
            className="bg-gray-900 text-white px-8 py-3 rounded-lg font-medium hover:bg-gray-800 transition text-base"
          >
            Add to Chrome — It&apos;s Free
          </a>
          <a
            href="#how-it-works"
            className="text-gray-500 hover:text-gray-900 transition text-base"
          >
            See how it works ↓
          </a>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="border-y border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
          {[
            { number: String(SIGNAL_COUNT), label: 'distinct checks in the score' },
            { number: '0', label: 'personal identifiers collected' },
            { number: '100%', label: 'free, no account needed' },
          ].map((stat, i) => (
            <div key={i}>
              <div className="text-2xl font-bold">{stat.number}</div>
              <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
        <p className="max-w-2xl mx-auto px-6 pb-8 text-center text-sm text-gray-500 leading-relaxed">
          In a May 2024{' '}
          <a
            href="https://www.resumebuilder.com/3-in-10-companies-currently-have-fake-job-posting-listed/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-900"
          >
            Resume Builder
          </a>{' '}
          survey of 1,641 hiring managers, 40% said their company had posted a
          fake job listing in the past year (649 completed the full follow-up).
          That figure is company-level and self-reported, not a share of listings.
        </p>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="max-w-4xl mx-auto px-6 py-24">
        <h2 className="text-3xl font-bold text-center mb-4">How It Works</h2>
        <p className="text-gray-500 text-center mb-16 max-w-lg mx-auto">
          Install the extension, browse jobs like normal, and get instant ghost risk scores on every listing.
        </p>

        <div className="grid sm:grid-cols-3 gap-10">
          {[
            {
              step: '1',
              title: 'Browse Jobs',
              desc: 'Open any job listing on LinkedIn or Indeed. The extension reads the page automatically — posting age, applicant count, salary, repost status.',
            },
            {
              step: '2',
              title: 'See the Score',
              desc: 'A score from 0 to 100 appears on the listing: Worth Applying (0–34), Proceed with Caution (35–54), Likely a Waste of Time (55–74), or Skip This Job (75–100), with the signals that triggered it.',
            },
            {
              step: '3',
              title: 'Flag & Report',
              desc: 'Applied and never heard back? Hit the thumbs down. Your anonymous report helps other job seekers avoid the same dead end.',
            },
          ].map((item, i) => (
            <div key={i} className="text-center sm:text-left">
              <div className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-bold mx-auto sm:mx-0 mb-4">
                {item.step}
              </div>
              <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Signals ── */}
      <section id="signals" className="bg-white border-y border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold text-center mb-4">What We Check</h2>
          <p className="text-gray-500 text-center mb-3 max-w-2xl mx-auto leading-relaxed">
            The score uses {SIGNAL_COUNT} checks, in {SIGNAL_CATEGORIES.length} groups.
          </p>
          <p className="text-gray-500 text-center mb-12 max-w-2xl mx-auto text-sm leading-relaxed">
            {DISTINCT_NOTE}
          </p>

          <h3 className="text-lg font-semibold text-center mb-2">What Moves the Score Most</h3>
          <p className="text-sm text-gray-500 text-center mb-6">
            <span className="text-red-600 font-semibold">↑</span> raises ghost risk.{' '}
            <span className="text-green-700 font-semibold">↓</span> lowers it.
          </p>
          <ul className="grid sm:grid-cols-2 gap-3 mb-14">
            {HIGHLIGHTS.map((group) => (
              <li key={group.id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <ul className="space-y-1.5">
                  {group.checks.map((check) => (
                    <li key={check.id} className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      <DirectionMark direction={check.direction} />
                      <span>{check.phrase}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SIGNAL_CATEGORIES.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/how-it-works#${category.id}`}
                  className="flex h-full gap-3 rounded-xl border border-gray-200 bg-white p-5 hover:border-purple-200 hover:bg-purple-50/40 transition"
                >
                  <span
                    className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-lg ${
                      category.id === 'combined'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-purple-50 text-purple-700'
                    }`}
                  >
                    <SignalIcon id={category.id} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-gray-900">{category.title}</span>
                    <span className="mt-1 block text-sm text-gray-500 leading-relaxed">{category.summary}</span>
                    <span className="mt-3 block text-xs font-semibold text-purple-700">
                      {category.checks.length} {category.checks.length === 1 ? 'check' : 'checks'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-10 text-center">
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-5 py-3 text-sm font-semibold text-purple-800 hover:bg-purple-100 transition"
            >
              See every check
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="mt-10 max-w-2xl mx-auto space-y-3 text-center text-sm text-gray-500 leading-relaxed">
            <p>{EMPLOYER_SHORT}</p>
            <p>{GLASSDOOR_SHORT}</p>
          </div>
        </div>
      </section>

      {/* ── Employer Lookup ── */}
      <section id="lookup" className="max-w-4xl mx-auto px-6 py-24">
        <h2 className="text-3xl font-bold text-center mb-4">Employer Lookup</h2>
        <p className="text-gray-500 text-center mb-10 max-w-lg mx-auto">
          Search any company to see their ghost job score, repost history, and community reports.
        </p>

        <div className="max-w-md mx-auto">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Search a company name..."
              className="flex-1 px-4 py-3 rounded-lg border border-gray-200 text-base focus:outline-none focus:border-gray-400 transition"
            />
            <button className="bg-gray-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition text-sm">
              Search
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">
            Data from public job-posting datasets, community reports, posting patterns, and Glassdoor ratings where we have them.
          </p>
        </div>

        {/* Placeholder for results — would be client component in production */}
        <div className="mt-12 text-center text-sm text-gray-400">
          Employer data populates as the community grows.
          Install the extension to contribute.
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gray-900 text-white">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold mb-4">
            Your time is worth more than ghost jobs.
          </h2>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">
            Free. No account. No name or email — public listing details help improve ghost scores.
          </p>
          <a
            href="https://chromewebstore.google.com/detail/nodldfdkjomniknohmejdimjlejfongd"
            target="_blank"
            rel="noopener"
            className="inline-block bg-white text-gray-900 px-8 py-3 rounded-lg font-medium hover:bg-gray-100 transition"
          >
            Add to Chrome — It&apos;s Free
          </a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="grid sm:grid-cols-3 gap-10 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Logo size={28} />
                <span className="font-bold tracking-[-0.01em]">Skip This Job</span>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                Bringing transparency to the job market. Built by people
                who are tired of applying to jobs that don&apos;t exist.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#how-it-works" className="hover:text-gray-900 transition">How It Works</a></li>
                <li><a href="#signals" className="hover:text-gray-900 transition">Signals</a></li>
                <li><Link href="/how-it-works" className="hover:text-gray-900 transition">Every check</Link></li>
                <li><a href="#lookup" className="hover:text-gray-900 transition">Employer Lookup</a></li>
                <li><Link href="/leaderboard" className="hover:text-gray-900 transition">Leaderboard</Link></li>
                <li><a href="https://chromewebstore.google.com/detail/nodldfdkjomniknohmejdimjlejfongd" className="hover:text-gray-900 transition">Chrome Web Store</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="https://vibelabsmarketing.com" target="_blank" rel="noopener" className="hover:text-gray-900 transition">Vibe Labs Marketing</a></li>
                <li><a href="https://postmimic.app" target="_blank" rel="noopener" className="hover:text-gray-900 transition">PostMimic</a></li>
                <li><a href="https://x.com/defmetal" target="_blank" rel="noopener" className="hover:text-gray-900 transition">@defmetal</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              &copy; {new Date().getFullYear()} Vibe Labs Marketing. All rights reserved. San Antonio, TX.
            </p>
            <div className="flex gap-4 text-xs text-gray-400">
              <a href="/privacy" className="hover:text-gray-600 transition">Privacy</a>
              <a href="/terms" className="hover:text-gray-600 transition">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
