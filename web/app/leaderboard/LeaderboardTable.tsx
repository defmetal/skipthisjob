'use client';

import { useEffect, useState } from 'react';
import { bandNameForScore, confidenceLabel } from '@/lib/leaderboardEligibility';

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
  confidence?: string;
}

interface LeaderboardResponse {
  employers: Employer[];
  total: number;
  limit: number;
  offset: number;
}

type SortColumn = 'ghost_score' | 'name_raw' | 'total_listings_tracked' | 'total_reports' | 'glassdoor_rating' | 'industry';
type SortDir = 'asc' | 'desc';

const LIMIT = 20;

/** Same bands as the extension overlay (extension/content/shared.js labelForScore). */
function bandForScore(score: number): { name: string; tone: string } {
  const name = bandNameForScore(score);
  if (name === 'Skip This Job') return { name, tone: 'bg-purple-100 text-purple-800' };
  if (name === 'Likely a Waste of Time') return { name, tone: 'bg-red-100 text-red-800' };
  if (name === 'Proceed with Caution') return { name, tone: 'bg-orange-100 text-orange-800' };
  return { name, tone: 'bg-green-100 text-green-800' };
}

function SortArrow({ column, sortBy, sortDir }: { column: SortColumn; sortBy: SortColumn; sortDir: SortDir }) {
  if (sortBy !== column) return <span className="text-gray-300 ml-1">↕</span>;
  return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

export default function LeaderboardTable() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortColumn>('ghost_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/leaderboard?limit=${LIMIT}&offset=${page * LIMIT}&sort_by=${sortBy}&sort_dir=${sortDir}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch leaderboard');
        return res.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page, sortBy, sortDir]);

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  function handleSort(column: SortColumn) {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir(column === 'name_raw' ? 'asc' : 'desc');
    }
    setPage(0);
  }

  const thClass = 'px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 transition select-none';

  return (
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
                  <th className={thClass} onClick={() => handleSort('name_raw')}>
                    Employer<SortArrow column="name_raw" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className={thClass} onClick={() => handleSort('ghost_score')}>
                    Ghost Score<SortArrow column="ghost_score" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Label</th>
                  <th className={`${thClass} hidden md:table-cell`} onClick={() => handleSort('industry')}>
                    Industry<SortArrow column="industry" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className={`${thClass} hidden sm:table-cell`} onClick={() => handleSort('total_listings_tracked')}>
                    Listings<SortArrow column="total_listings_tracked" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className={`${thClass} hidden sm:table-cell`} onClick={() => handleSort('total_reports')}>
                    Reports<SortArrow column="total_reports" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th className={`${thClass} hidden lg:table-cell`} onClick={() => handleSort('glassdoor_rating')}>
                    Glassdoor<SortArrow column="glassdoor_rating" sortBy={sortBy} sortDir={sortDir} />
                  </th>
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
                      <div className="text-xs font-normal text-gray-400 mt-0.5">
                        {employer.confidence ||
                          confidenceLabel(employer.total_listings_tracked, employer.total_reports)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${bandForScore(employer.ghost_score).tone}`}
                      >
                        {employer.ghost_score}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bandForScore(employer.ghost_score).tone}`}
                      >
                        {bandForScore(employer.ghost_score).name}
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
  );
}
