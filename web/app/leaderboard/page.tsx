import Link from 'next/link';
import Logo from '@/components/Logo';
import { leaderboardMinimumNote } from '@/lib/leaderboardEligibility';
import { pageMetadata } from '@/lib/seo';
import LeaderboardTable from './LeaderboardTable';

export const metadata = pageMetadata({
  title: 'Ghost Job Leaderboard — Skip This Job',
  description:
    'Employers ranked by ghost score from public job postings, community reports, and posting patterns. Bands match the extension: Worth Applying, Proceed with Caution, Likely a Waste of Time, and Skip This Job.',
  path: '/leaderboard',
});

export default function LeaderboardPage() {
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
          <Link href="/leaderboard" className="text-gray-900 font-medium">Leaderboard</Link>
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

      <section className="max-w-5xl mx-auto px-6 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-medium mb-6">
          <span>🚩</span>
          <span>Ghost Job Offenders</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
          Ghost Job Leaderboard
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto leading-relaxed">
          The worst ghost job offenders ranked by ghost score. Bands match the
          extension: Worth Applying (0–34), Proceed with Caution (35–54), Likely
          a Waste of Time (55–74), and Skip This Job (75–100). Data comes from
          public job-posting datasets, community reports, and posting patterns.
        </p>
        <p className="mt-6 text-sm text-gray-600 max-w-2xl mx-auto leading-relaxed bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
          {leaderboardMinimumNote()}
        </p>
      </section>

      <LeaderboardTable />

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="grid sm:grid-cols-3 gap-10 mb-10">
            <div>
              <Link href="/" className="flex items-center gap-2 mb-3">
                <Logo size={28} />
                <span className="font-bold tracking-[-0.01em]">Skip This Job</span>
              </Link>
              <p className="text-sm text-gray-500 leading-relaxed">
                Bringing transparency to the job market. Built by people
                who are tired of applying to jobs that don&apos;t exist.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link href="/#how-it-works" className="hover:text-gray-900 transition">How It Works</Link></li>
                <li><Link href="/#signals" className="hover:text-gray-900 transition">Signals</Link></li>
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
