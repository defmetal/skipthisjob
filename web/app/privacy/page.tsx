export default function Privacy() {
  return (
    <main className="min-h-screen bg-white">
      <nav className="max-w-3xl mx-auto px-6 py-6 flex items-center gap-2">
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition">
          <span className="text-2xl">⏭️</span>
          <span className="text-lg font-semibold tracking-tight">Skip This Job</span>
        </a>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 5, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-600 leading-relaxed">
          <p>
            Skip This Job (&quot;we,&quot; &quot;our,&quot; or &quot;the extension&quot;) is a Chrome extension
            and website operated by Vibe Labs Marketing, based in San Antonio, TX.
            We are committed to protecting your privacy. This policy explains what data
            the extension collects, how it is used, and your rights.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">What We Collect</h2>
          <p>
            <strong>Anonymous browser identifier.</strong> When you submit a community report
            (flagging a ghost job or reporting an outcome), the extension generates a random
            anonymous ID stored locally in your browser. This ID is not linked to your name,
            email, or any personal information. It exists solely to prevent duplicate reports
            from the same browser.
          </p>
          <p>
            <strong>Job listing metadata from community reports.</strong> When you voluntarily
            click &quot;Flag Ghost Job&quot; or &quot;Report Outcome,&quot; the extension sends the following
            data to our server: the company name, job title, platform (LinkedIn or Indeed),
            the listing URL, and your selected flag reason or outcome. This data is used to
            compute community-powered ghost scores for employers.
          </p>
          <p>
            <strong>Employer score lookups.</strong> When you view a job listing, the extension
            sends the employer name to our API to retrieve their ghost score. No information
            about you is sent with this request — only the company name.
          </p>
          <p>
            <strong>Passive listing metadata.</strong> When you view a job listing, the extension
            sends publicly visible listing information to our server: company name, job title,
            platform, location, whether a salary is listed, whether it is a repost, and how
            long the listing has been open. This data comes from the job listing itself —
            no information about you or your device is included. This helps us track
            employer posting patterns and improve ghost scores for the community.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">What We Do NOT Collect</h2>
          <p>
            We do not collect, store, or transmit any of the following:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Your name, email address, or any personal identifiers</li>
            <li>Your browsing history or pages visited</li>
            <li>Your LinkedIn or Indeed login credentials</li>
            <li>Your resume, profile information, or job applications</li>
            <li>Cookies or tracking pixels</li>
            <li>Your IP address (our server does not log IPs)</li>
          </ul>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">How We Use Data</h2>
          <p>
            Community reports are aggregated anonymously to compute employer ghost scores.
            These scores are displayed to other users of the extension and on the
            skipthisjob.com website. Individual reports cannot be traced back to any person.
          </p>
          <p>
            We may display aggregated statistics publicly, such as the total number of
            community reports or the employers with the highest ghost scores. No individual
            user data is ever made public.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Data Storage</h2>
          <p>
            Community reports and employer scores are stored in a Supabase (PostgreSQL)
            database hosted in the United States. The anonymous browser identifier is stored
            locally in your browser using Chrome&apos;s storage API and is never sent to any
            third party.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Third-Party Services</h2>
          <p>
            We use the following third-party services:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Supabase</strong> — database hosting (stores anonymous community reports)</li>
            <li><strong>Vercel</strong> — website and API hosting</li>
            <li><strong>Cloudflare</strong> — DNS and security</li>
          </ul>
          <p>
            We do not use analytics, advertising, or tracking services. We do not sell,
            share, or transfer your data to any third party for marketing purposes.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Your Rights</h2>
          <p>
            You can clear your anonymous browser identifier at any time by removing the
            extension or clearing the extension&apos;s storage in your browser settings.
            Since we do not collect personal information, there is no account to delete.
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
