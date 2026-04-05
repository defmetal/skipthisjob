import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* ── Nav ── */}
      <nav className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⏭️</span>
          <span className="text-lg font-semibold tracking-tight">Skip This Job</span>
        </div>
        <div className="hidden sm:flex items-center gap-8 text-sm text-gray-500">
          <a href="#how-it-works" className="hover:text-gray-900 transition">How It Works</a>
          <a href="#signals" className="hover:text-gray-900 transition">Signals</a>
          <a href="#lookup" className="hover:text-gray-900 transition">Employer Lookup</a>
          <a
            href="https://chromewebstore.google.com"
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
          <span>🚩</span>
          <span>Free Chrome Extension</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-6">
          Stop applying to jobs<br />that don&apos;t exist.
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10 leading-relaxed">
          Ghost Job Detector scores every LinkedIn and Indeed listing for ghost risk —
          repost patterns, employer history, community reports, and Glassdoor data —
          so you spend time on real opportunities. Free forever, no account needed.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="https://chromewebstore.google.com"
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
        <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { number: '40-60%', label: 'of listings may be ghost jobs' },
            { number: '6', label: 'heuristic signals analyzed' },
            { number: '0', label: 'data collected about you' },
            { number: '100%', label: 'free, no account needed' },
          ].map((stat, i) => (
            <div key={i}>
              <div className="text-2xl font-bold">{stat.number}</div>
              <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
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
              desc: 'A ghost risk score appears on the listing. Low, Moderate, High, or Ghost Alert — with the specific signals that triggered it.',
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
        <div className="max-w-4xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold text-center mb-4">What We Check</h2>
          <p className="text-gray-500 text-center mb-16 max-w-lg mx-auto">
            The extension scores listings using real signals — not guesswork.
            Some run locally in your browser. Others come from aggregated community data.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                icon: '📅',
                title: 'Posting Age',
                desc: 'Jobs open 30+ days get flagged. 60+ days is a red flag. The extension reads the exact date from the page.',
              },
              {
                icon: '🔄',
                title: 'Repost Detection',
                desc: 'LinkedIn labels reposted listings. We also track how many times an employer has posted the same role in the same city.',
              },
              {
                icon: '👥',
                title: 'Applicant Volume',
                desc: '500+ applicants on a month-old listing? The numbers tell a story about whether this role is actually being filled.',
              },
              {
                icon: '💰',
                title: 'Salary Transparency',
                desc: 'No salary listed correlates with lower-quality listings. It\'s a small signal, but it adds up with others.',
              },
              {
                icon: '📊',
                title: 'Community Reports',
                desc: 'Other users flag ghost jobs and report outcomes. "Applied 3 months ago, never heard back" is the most honest signal.',
              },
              {
                icon: '⭐',
                title: 'Glassdoor Data',
                desc: 'When available, we show employer ratings and interview-to-offer rates. A 2.3-star company reposting the same role? Ghost.',
              },
            ].map((signal, i) => (
              <div
                key={i}
                className="flex gap-4 p-5 rounded-xl border border-gray-100 hover:border-gray-200 transition"
              >
                <span className="text-2xl shrink-0">{signal.icon}</span>
                <div>
                  <h3 className="font-semibold mb-1">{signal.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{signal.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 p-5 rounded-xl bg-amber-50 border border-amber-100">
            <p className="text-sm text-amber-900 leading-relaxed">
              <strong>Smart enough to know the difference.</strong> Not every
              reposted listing is a ghost job. The scoring engine applies modifiers
              for high-turnover roles (barista, warehouse associate, CNA),
              high-turnover industries (food service, retail, healthcare), large
              companies, and entry-level positions. A Starbucks barista listing
              won&apos;t trigger a false alarm.
            </p>
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
            Data from community reports, historical posting patterns, and Glassdoor.
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
            Free. No account. No data collected. Just install and browse.
          </p>
          <a
            href="https://chromewebstore.google.com"
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
                <span className="text-lg">⏭️</span>
                <span className="font-semibold">Skip This Job</span>
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
                <li><a href="#lookup" className="hover:text-gray-900 transition">Employer Lookup</a></li>
                <li><a href="https://chromewebstore.google.com" className="hover:text-gray-900 transition">Chrome Web Store</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="https://vibedigitalmarketing.com" target="_blank" rel="noopener" className="hover:text-gray-900 transition">Vibe Digital Marketing</a></li>
                <li><a href="https://postmimic.app" target="_blank" rel="noopener" className="hover:text-gray-900 transition">PostMimic</a></li>
                <li><a href="https://x.com/defmetal" target="_blank" rel="noopener" className="hover:text-gray-900 transition">@defmetal</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-400">
              &copy; {new Date().getFullYear()} Vibe Digital Marketing. All rights reserved. San Antonio, TX.
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
