import Logo from '@/components/Logo';
import Link from 'next/link';

type ScoreDirection = 'Raises' | 'Lowers' | 'Raises or lowers';

type ScoreSignal = {
  title: string;
  direction: ScoreDirection;
  desc: string;
};

/**
 * Every check that can change the number in the shipped extension.
 * Listing checks: extension/content/shared.js scoreListingSignals, plus
 * scoreLocally() in extension/content/linkedin.js and extension/content/indeed.js.
 * Employer checks: the record blendGhostScore mixes in, from
 * web/app/api/employer/score/route.ts and web/lib/employerScore.ts.
 * The stat and the heading both use SIGNAL_COUNT, so the stated count
 * stays equal to the number of items below.
 */
const SIGNAL_GROUPS: { title: string; items: ScoreSignal[] }[] = [
  {
    title: 'Listing age and reposts',
    items: [
      {
        title: 'Posted in the last 48 hours',
        direction: 'Lowers',
        desc: 'A listing from the last two days gets a credit. The credit is larger on a LinkedIn job page than on Indeed or on a search card.',
      },
      {
        title: 'Open more than two days',
        direction: 'Raises',
        desc: 'After two days, the score rises the longer the listing stays open. The add levels off once the listing is about 90 days old.',
      },
      {
        title: 'Posting age missing on Indeed',
        direction: 'Raises',
        desc: 'On an Indeed job page, a missing posting date raises the score.',
      },
      {
        title: 'Age floor',
        direction: 'Raises',
        desc: 'At 60 days the score is lifted to at least 50 if it was lower. At 90 days the floor is 75. At 120 days the floor is 88.',
      },
      {
        title: 'Marked as a repost',
        direction: 'Raises',
        desc: 'A listing the platform marks as reposted adds a large amount of risk.',
      },
      {
        title: 'High-turnover job title',
        direction: 'Lowers',
        desc: 'Titles such as barista, warehouse associate, and CNA reduce age and repost points to 40% of the usual add, and reduce applicant points to 60%. The overlay notes the title.',
      },
    ],
  },
  {
    title: 'Applicants and engagement',
    items: [
      {
        title: '100 or more applicants',
        direction: 'Raises',
        desc: 'The score rises at 100 applicants, more at 200, and more again at 500.',
      },
      {
        title: '100+ applicants on an older listing',
        direction: 'Raises',
        desc: 'A listing open 60 days or more with 100+ applicants takes an extra hit. The extra hit is larger at 90 days and larger again at 120.',
      },
      {
        title: 'LinkedIn: 30+ days and 200+ applicants',
        direction: 'Raises',
        desc: 'On LinkedIn, a listing open 30 days with 200 or more applicants takes an additional hit on top of the applicant checks.',
      },
      {
        title: 'LinkedIn: repost with 100+ applicants',
        direction: 'Raises',
        desc: 'On LinkedIn, a repost that already has 100 or more applicants takes an additional hit.',
      },
      {
        title: 'Easy Apply on an older listing',
        direction: 'Raises',
        desc: 'Easy Apply on a listing open 60 days or more raises the score. The add is larger at 90 days and larger again at 120.',
      },
      {
        title: 'Actively reviewing applications',
        direction: 'Lowers',
        desc: 'An “actively reviewing” label lowers the score. The credit shrinks after 60 days and again after 90. At 120 days the label no longer lowers the score.',
      },
      {
        title: 'No review activity after 14 days',
        direction: 'Raises',
        desc: 'A listing open 14 days or more with no “actively reviewing” label raises the score.',
      },
      {
        title: 'Indeed: 30+ days with no active review',
        direction: 'Raises',
        desc: 'On Indeed, a listing open 30 days with no active review takes a further hit beyond the 14-day check.',
      },
    ],
  },
  {
    title: 'Pay, contact, and where you apply',
    items: [
      {
        title: 'Salary listed or missing',
        direction: 'Raises or lowers',
        desc: 'No salary on the job page raises the score. On a search card, a missing salary raises it a little, and a salary that is shown lowers it a little.',
      },
      {
        title: 'Staffing agency or job board',
        direction: 'Raises',
        desc: 'A third-party or staffing poster raises the score, on the job page and on a search card.',
      },
      {
        title: 'No hiring contact on LinkedIn',
        direction: 'Raises',
        desc: 'When the LinkedIn page does not show someone you can follow up with, the score goes up.',
      },
      {
        title: 'Responses managed off LinkedIn',
        direction: 'Raises',
        desc: 'A listing that says responses are managed off LinkedIn raises the score.',
      },
      {
        title: 'No response data',
        direction: 'Raises',
        desc: 'On LinkedIn, a “no response insights” line raises the score. On Indeed, the score rises when the page does not say the employer responds quickly.',
      },
      {
        title: 'Indeed: employer responds quickly',
        direction: 'Lowers',
        desc: 'When Indeed says the employer responds quickly, the score goes down a little.',
      },
      {
        title: 'Apply button leaves Indeed',
        direction: 'Raises',
        desc: 'An Indeed listing that sends you to the company site to apply raises the score a little.',
      },
      {
        title: 'Indeed employer rating',
        direction: 'Raises or lowers',
        desc: 'A rating under 2.5 raises the score more than a rating under 3. A rating of 4 or higher lowers it a little. From 3 up to 4, this check leaves the score where it is.',
      },
    ],
  },
  {
    title: 'Description quality',
    items: [
      {
        title: 'Missing or short description',
        direction: 'Raises',
        desc: 'On LinkedIn, a missing description or one under 200 characters raises the score more than one under 500 characters. On Indeed, a missing description raises the score. A description that is present and under 280 characters raises it by a smaller step.',
      },
      {
        title: 'Vague or generic wording',
        direction: 'Raises',
        desc: 'Buzzword-heavy copy raises the score. Heavier vague language raises it more than a lighter dose. The add is similar on LinkedIn and Indeed.',
      },
      {
        title: 'Specific description',
        direction: 'Lowers',
        desc: 'A concrete description, with tools, scope, or reporting lines, lowers the score by a small step.',
      },
      {
        title: 'Placeholder or broken template',
        direction: 'Raises',
        desc: 'Leftover template text in the title or description, such as an unfilled company or job-title token, raises the score.',
      },
      {
        title: 'Seniority mismatch',
        direction: 'Raises',
        desc: 'An entry-level title that asks for 10 or more years raises the score. A senior title that asks for 0–2 years raises it too.',
      },
      {
        title: 'Work arrangement contradicts the description',
        direction: 'Raises',
        desc: 'The score rises when the page and the description disagree, such as an on-site tag with a remote-only description.',
      },
    ],
  },
  {
    title: 'Stacked gaps',
    items: [
      {
        title: 'LinkedIn: old listing missing the basics',
        direction: 'Raises',
        desc: 'Open 14 days or more, with no hiring contact, a description under 300 characters or none at all, and no salary, raises the score further.',
      },
      {
        title: 'Indeed: old listing missing the basics',
        direction: 'Raises',
        desc: 'Open 14 days or more, with no salary, no quick response, and no active review, raises the score further.',
      },
      {
        title: 'Indeed: old, quiet, and unpaid',
        direction: 'Raises',
        desc: 'Open 30 days or more, with no review, no response, and no salary, adds still more on top of the other Indeed checks.',
      },
    ],
  },
  {
    title: 'Platform',
    items: [
      {
        title: 'Indeed job page baseline',
        direction: 'Raises',
        desc: 'An Indeed job page starts higher than a LinkedIn page or a search card, before the other checks are applied.',
      },
    ],
  },
  {
    title: 'Employer record',
    items: [
      {
        title: 'Recent ghost reports or no response',
        direction: 'Raises',
        desc: 'With at least three recent community reports, a high share of ghost flags or “no response” outcomes lifts the employer score. These reports can raise that score and do not pull it down.',
      },
      {
        title: 'Same role reposted again and again',
        direction: 'Raises',
        desc: 'Four or more tracked reposts of the same role lift the employer score. Six or more lift it further.',
      },
      {
        title: 'Same description reused on those reposts',
        direction: 'Raises',
        desc: 'When that repeated role also reuses one description, and it has happened at least three times, the employer score goes up further.',
      },
    ],
  },
];

const SIGNAL_COUNT = SIGNAL_GROUPS.reduce((n, group) => n + group.items.length, 0);

function directionClass(direction: ScoreDirection): string {
  if (direction === 'Lowers') return 'bg-green-50 text-green-800';
  if (direction === 'Raises or lowers') return 'bg-amber-50 text-amber-900';
  return 'bg-red-50 text-red-800';
}

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
            { number: String(SIGNAL_COUNT), label: 'signals in the score' },
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
          <p className="text-gray-500 text-center mb-4 max-w-2xl mx-auto leading-relaxed">
            The score uses {SIGNAL_COUNT} signals. Each one is listed below.
            The first groups run on the listing in your browser. The employer
            record is mixed in afterward. A thin record can raise the score
            and will not pull it down. Recent reports, saved reposts, or at
            least eight tracked listings let that record pull a score down.
          </p>
          <p className="text-gray-500 text-center mb-16 max-w-2xl mx-auto text-sm leading-relaxed">
            A Glassdoor rating under 3.0, or an interview-to-offer rate under 20%,
            is shown beside the score when we have it on file. That line does not
            add points by itself.
          </p>

          <div className="space-y-12">
            {SIGNAL_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="text-lg font-semibold mb-4">{group.title}</h3>
                <ul className="grid sm:grid-cols-2 gap-4">
                  {group.items.map((signal) => (
                    <li
                      key={signal.title}
                      className="p-5 rounded-xl border border-gray-100"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h4 className="font-semibold">{signal.title}</h4>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${directionClass(signal.direction)}`}
                        >
                          {signal.direction} the score
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 leading-relaxed">{signal.desc}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
