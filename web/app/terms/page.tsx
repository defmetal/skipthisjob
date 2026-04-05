export default function Terms() {
  return (
    <main className="min-h-screen bg-white">
      <nav className="max-w-3xl mx-auto px-6 py-6 flex items-center gap-2">
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition">
          <span className="text-2xl">⏭️</span>
          <span className="text-lg font-semibold tracking-tight">Skip This Job</span>
        </a>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-10">Last updated: April 5, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-600 leading-relaxed">
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your use of the Skip This Job
            Chrome extension and the skipthisjob.com website (collectively, the &quot;Service&quot;),
            operated by Vibe Digital Marketing (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Use of the Service</h2>
          <p>
            Skip This Job is a free tool that provides ghost job risk scores for job
            listings on LinkedIn and Indeed. Scores are generated using automated
            heuristics, historical posting data, and anonymous community reports.
            The Service is provided &quot;as is&quot; for informational purposes only.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">No Guarantee of Accuracy</h2>
          <p>
            Ghost risk scores are estimates based on available signals and community
            data. We do not guarantee that any score accurately reflects whether a
            job listing is genuine or fraudulent. A low score does not guarantee a
            legitimate opportunity, and a high score does not prove a listing is fake.
            Always use your own judgment when applying to jobs.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Community Reports</h2>
          <p>
            By submitting a community report (flagging a listing or reporting an outcome),
            you confirm that your report is based on your honest experience. Deliberately
            submitting false reports to manipulate employer scores is prohibited.
            We reserve the right to remove reports that appear fraudulent or abusive.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Intellectual Property</h2>
          <p>
            The Skip This Job name, logo, scoring algorithms, and website content are
            owned by Vibe Digital Marketing. You may not copy, modify, or redistribute
            the extension or its code without permission.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Third-Party Platforms</h2>
          <p>
            Skip This Job operates on LinkedIn and Indeed as a browser extension. We are
            not affiliated with, endorsed by, or sponsored by LinkedIn, Indeed, or
            Glassdoor. Your use of those platforms is governed by their respective
            terms of service.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Vibe Digital Marketing shall not
            be liable for any damages arising from your use of the Service, including
            but not limited to missed job opportunities, reliance on ghost scores,
            or decisions made based on the information provided.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Termination</h2>
          <p>
            We reserve the right to discontinue the Service at any time. You may stop
            using the extension at any time by uninstalling it from your browser.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. Continued use of the Service
            after changes constitutes acceptance.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-10">Contact</h2>
          <p>
            Questions about these Terms? Contact us at:<br />
            <a href="mailto:support@vibedigitalmarketing.com" className="text-purple-600 hover:underline">
              support@vibedigitalmarketing.com
            </a>
          </p>
          <p className="text-sm text-gray-400 mt-8">
            Vibe Digital Marketing · San Antonio, TX
          </p>
        </div>
      </article>
    </main>
  );
}
