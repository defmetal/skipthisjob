import Logo from '@/components/Logo';
import Link from 'next/link';

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
            { number: '28', label: 'listing signals in the score' },
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
        <div className="max-w-4xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold text-center mb-4">What We Check</h2>
          <p className="text-gray-500 text-center mb-16 max-w-lg mx-auto">
            The extension runs 28 checks on the listing in your browser, then
            combines that result with the employer&apos;s track record when we
            have one. Weight depends on how much evidence that record has.
            Some of what goes into the score:
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                icon: '📅',
                title: 'Posting Age',
                desc: 'The extension reads the age shown on the listing. Older posts add risk, with minimum scores once a listing has been open 60, 90, or 120 days. A post from the last 48 hours gets a small credit.',
              },
              {
                icon: '🔄',
                title: 'Repost Detection',
                desc: 'A listing marked as reposted adds risk. We also track how many times an employer has posted the same role in the same city.',
              },
              {
                icon: '👥',
                title: 'Applicant Volume',
                desc: '100, 200, and 500+ applicants add risk. On listings open 60 days or more, 100+ applicants adds more. On LinkedIn, 30+ days with 200+ applicants adds more still.',
              },
              {
                icon: '💰',
                title: 'Salary Transparency',
                desc: 'No salary listed adds a small amount of risk. It is one check among the rest, not a verdict by itself.',
              },
              {
                icon: '📝',
                title: 'Description Quality',
                desc: 'Missing, very short, or vague descriptions add risk. Placeholder text and a title that conflicts with the years of experience required add more. A specific description is a small credit.',
              },
              {
                icon: '👀',
                title: 'Engagement and Response',
                desc: '“Actively reviewing” lowers the score, less so on old posts. No review activity on a listing open 14+ days, missing response data, or responses managed off LinkedIn add risk. On Indeed, a fast response is a small credit, and “Apply on company site” adds a little risk.',
              },
              {
                icon: '📊',
                title: 'Community Reports',
                desc: 'Other users can flag a ghost job or report an outcome, such as never hearing back. Those reports feed the employer’s track record.',
              },
              {
                icon: '⭐',
                title: 'Glassdoor Ratings',
                desc: 'When we have a Glassdoor rating on file, a rating under 3.0 or an interview-to-offer rate under 20% is shown with the employer score.',
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
              <strong>High-turnover job titles.</strong> When the title matches
              a role that is reposted often — barista, warehouse associate, CNA,
              and similar titles — posting-age and applicant-count points are
              reduced, and the overlay notes that. Staffing or third-party posts
              and a missing hiring contact on LinkedIn are separate checks.
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
