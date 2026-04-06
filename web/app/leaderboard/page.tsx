'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Employer {
  name_raw: string;
  industry: string | null;
  company_size: string | null;
  ghost_score: number;
  ghost_label: string;
  total_reports: number;
  total_listings_tracked: number;
  glassdoor_rating: number | null;
  glassdoor_url: string | null;
}

interface LeaderboardResponse {
  employers: Employer[];
  total: number;
  limit: number;
  offset: number;
}

const LIMIT = 20;

function ghostScoreColor(label: string): string {
  switch (label?.toLowerCase()) {
    case 'low':
      return 'bg-green-100 text-green-800';
    case 'moderate':
      return 'bg-orange-100 text-orange-800';
    case 'high':
      return 'bg-red-100 text-red-800';
    case 'very high':
    case 'ghost alert':
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/leaderboard?limit=${LIMIT}&offset=${page * LIMIT}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch leaderboard');
        return res.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  return (
    <main className="min-h-screen">
      {/* ── Nav ── */}
      <nav className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">⏭️</span>
          <span className="text-lg font-semibold tracking-tight">Skip This Job</span>
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

      {/* ── Header ── */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-medium mb-6">
          <span>🚩</span>
          <span>Ghost Job Offenders</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
          Ghost Job Leaderboard
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto leading-relaxed">
          The worst ghost job offenders ranked by ghost score. Data from community reports,
          posting patterns, and employer history.
        </p>
      </section>

      {/* ── Table ── */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        {loading && (
          <div className="text-center py-20 text-gray-400">Loading leaderboard...</div>
        )}

        {error && (
          <div className="text-center py-20 text-red-500">
            Error: {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-gray-600 w-12">#</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Employer</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Ghost Score</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Label</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Industry</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Listings</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Reports</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">Glassdoor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.employers.map((employer, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 text-gray-400 font-medium">
                        {page * LIMIT + i + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {employer.name_raw}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${ghostScoreColor(employer.ghost_label)}`}
                        >
                          {employer.ghost_score}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ghostScoreColor(employer.ghost_label)}`}
                        >
                          {employer.ghost_label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                        {employer.industry || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                        {employer.total_listings_tracked}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                        {employer.total_reports}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                        {employer.glassdoor_rating ? (
                          employer.glassdoor_url ? (
                            <a
                              href={employer.glassdoor_url}
                              target="_blank"
                              rel="noopener"
                              className="hover:text-gray-900 transition"
                            >
                              ⭐ {employer.glassdoor_rating.toFixed(1)}
                            </a>
                          ) : (
                            <span>⭐ {employer.glassdoor_rating.toFixed(1)}</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.employers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                        No employers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <p className="text-sm text-gray-500">
                  Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, data.total)} of {data.total} employers
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-500 px-2">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="grid sm:grid-cols-3 gap-10 mb-10">
            <div>
              <Link href="/" className="flex items-center gap-2 mb-3">
                <span className="text-lg">⏭️</span>
                <span className="font-semibold">Skip This Job</span>
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
