import Logo from '@/components/Logo';
export default function Privacy() {
  return (
    <main className="min-h-screen bg-white">
      <nav className="max-w-3xl mx-auto px-6 py-6 flex items-center gap-2">
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition">
          <Logo size={32} />
          <span className="text-lg font-bold tracking-[-0.01em]">Skip This Job</span>
        </a>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: October 2, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-600 leading-relaxed">
          <p>
            Skip This Job (&quot;we,&quot; &quot;our,&quot; or &quot;the extension&quot;) is a Chrome extension
            and website operated by Vibe Labs Marketing, based in San Antonio, TX.
            This policy explains what the current version of the extension sends, how
            we use it, and what we leave alone.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">What We Collect</h2>
          <p>
            <strong>We don&apos;t send personal info, just public listing details.</strong>{' '}
            For each job listing you view on LinkedIn or Indeed, the extension reads
            that page and sends the listing&apos;s public details to our server. We use
            them to compute and improve ghost scores. It does not send your name,
            email, account info, or login credentials, and it does not send browsing
            outside LinkedIn and Indeed job pages.
          </p>
          <p>
            The current version sends these fields for a listing you view:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Platform (LinkedIn or Indeed)</li>
            <li>Platform job ID</li>
            <li>Job title</li>
            <li>Company name</li>
            <li>Listing URL</li>
            <li>Location</li>
            <li>Whether a salary is listed</li>
            <li>Whether the listing is marked as a repost</li>
            <li>How many days the listing has been open</li>
            <li>Engagement labels shown on the page, such as actively reviewing, urgently hiring, or hiring multiple candidates</li>
            <li>Employer response time, if the page shows one</li>
            <li>Whether you clicked Apply on that listing</li>
            <li>Work arrangement, if shown (remote, hybrid, or on-site)</li>
            <li>Employment type, if shown (full-time, part-time, contract, or internship)</li>
            <li>A hash of the job description, not the description text</li>
            <li>The heuristic ghost-risk score calculated in your browser</li>
          </ul>
          <p>
            Applicant counts and other on-page facts are read on your device and
            folded into that heuristic score. The raw applicant count is not sent
            as its own field. The job description itself is not sent — only the hash.
            We store those listing fields with the job, other than the listing
            URL, which is sent and not saved in its own column. From listings we
            already have, our server also counts similar titles for that employer.
            That count is not read from your browser.
          </p>
          <p>
            <strong>Anonymous ID.</strong> When you submit a community report, the
            extension creates a random ID on your device and saves it in the
            extension&apos;s local storage. That ID is sent to our server and stored
            with each report you submit. We use it so the same browser is not
            counted twice for the same listing. It is not linked to your name,
            email, or account, and we do not share it with anyone else. It is not
            sent when you only view a listing.
          </p>
          <p>
            <strong>Community reports.</strong> If you choose &quot;Flag Ghost Job&quot; or
            &quot;Report Outcome,&quot; the extension sends the company name, job title,
            platform, platform job ID, listing URL, the reason or outcome you
            picked, and the anonymous ID. You choose when to send a report.
          </p>
          <p>
            <strong>Employer score lookups.</strong> When you view a listing, the
            extension also asks our server for that employer&apos;s ghost score. The
            request sends the company name, the platform, and the platform job ID.
            It does not include your name, email, or account.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">What We Do Not Collect</h2>
          <p>
            We do not collect, store, or transmit any of the following:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Your name, email address, or LinkedIn or Indeed account information</li>
            <li>Your login credentials</li>
            <li>Your resume, profile, or the contents of a job application</li>
            <li>Browsing outside LinkedIn and Indeed job pages</li>
            <li>Cookies or tracking pixels</li>
            <li>Raw IP addresses in our database (see Abuse Prevention)</li>
          </ul>
          <p>
            Viewing a job listing does send that listing&apos;s public details, listed
            above. That is limited to the listing you opened. It is not a record
            of the rest of your browsing.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">How We Use Data</h2>
          <p>
            Listing details and the heuristic score are stored with the job and
            combined with other listings and community reports for the same
            employer. That employer score is shown in the extension and on
            skipthisjob.com, including a public leaderboard. Reports and listing
            views are not tied to your name.
          </p>
          <p>
            Employer records start from public job-posting data (a Kaggle dataset
            of job postings seeded into our database) and Glassdoor ratings
            compiled for a set of major employers. Community reports and the
            listing details described above update those records.
          </p>
          <p>
            We may show aggregated totals, such as how many community reports an
            employer has. We do not publish the anonymous ID or tie a report to
            a person.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Abuse Prevention</h2>
          <p>
            We don&apos;t store raw IP addresses in our database. Public write APIs
            (listing tracking and community reports) keep a short-lived hash of
            the request IP in server memory so we can throttle floods. That hash
            is not written to the database, is not linked to your anonymous ID,
            and is discarded when the server instance recycles.
          </p>
          <p>
            Vercel hosts the website and API and may log IP addresses under its
            own policy. Cloudflare provides DNS for the domain. If a request is
            proxied through Cloudflare, Cloudflare may log IP addresses under its
            own policy.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Data Storage</h2>
          <p>
            Community reports, listing details, and employer scores are stored in
            a Supabase (PostgreSQL) database hosted in the United States. Your
            anonymous ID is stored locally in the extension and, when you submit
            a report, in that database with the report. We do not share it
            elsewhere.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Third-Party Services</h2>
          <p>
            We use the following third-party services:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Supabase</strong> — database hosting for listing details, employer scores, and community reports</li>
            <li><strong>Vercel</strong> — website and API hosting</li>
            <li><strong>Cloudflare</strong> — DNS</li>
          </ul>
          <p>
            We do not use analytics, advertising, or tracking services. We do not sell,
            share, or transfer your data to any third party for marketing purposes.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Your Rights</h2>
          <p>
            You can clear your anonymous ID at any time by removing the
            extension or clearing the extension&apos;s storage in your browser
            settings. There is no account to delete.
          </p>
          <p>
            If you have submitted community reports and wish to have them removed, contact
            us at the email below and provide the approximate date and listing details so
            we can locate and delete them.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Children&apos;s Privacy</h2>
          <p>
            Skip This Job is not directed at children under 13. We do not knowingly
            collect information from children.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. Changes will be posted
            on this page with an updated &quot;Last updated&quot; date. Continued use of the
            extension after changes constitutes acceptance of the updated policy.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Contact</h2>
          <p>
            If you have questions about this privacy policy, contact us at:<br />
            <a href="mailto:support@vibelabsmarketing.com" className="text-purple-600 hover:underline">
              support@vibelabsmarketing.com
            </a>
          </p>
          <p className="text-sm text-gray-400 mt-8">
            Vibe Labs Marketing · San Antonio, TX
          </p>
        </div>
      </article>
    </main>
  );
}
