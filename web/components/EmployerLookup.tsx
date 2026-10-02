'use client';

import { useState, type FormEvent } from 'react';
import { bandNameForScore } from '@/lib/leaderboardEligibility';

type LookupResponse = {
  found?: boolean;
  score?: number | null;
  label?: string | null;
  signals?: string[];
  totalReports?: number | null;
  totalListings?: number | null;
  live?: boolean;
  error?: string;
  glassdoor?: { rating?: number | null; url?: string | null } | null;
};

function glassdoorHref(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('https://www.glassdoor.com/')) return null;
  return url;
}

export default function EmployerLookup() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [searched, setSearched] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const query = name.trim();
    if (!query) {
      setError('Enter a company name.');
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    setSearched(query);
    try {
      const response = await fetch(`/api/employer/score?name=${encodeURIComponent(query)}`);
      const body = (await response.json()) as LookupResponse;
      if (!response.ok) {
        setResult(null);
        setError(body.error || 'Lookup failed.');
        return;
      }
      setResult(body);
    } catch {
      setResult(null);
      setError('Lookup failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const href = glassdoorHref(result?.glassdoor?.url);
  const score = result?.found && typeof result.score === 'number' ? result.score : null;

  return (
    <div className="max-w-md mx-auto">
      <form onSubmit={onSubmit} className="flex gap-3">
        <label htmlFor="employer-lookup" className="sr-only">
          Company name
        </label>
        <input
          id="employer-lookup"
          type="text"
          name="company"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Search a company name..."
          maxLength={200}
          className="flex-1 px-4 py-3 rounded-lg border border-gray-200 text-base focus:outline-none focus:border-gray-400 transition"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-gray-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition text-sm disabled:opacity-60"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      <p className="text-xs text-gray-400 mt-3 text-center">
        Data from public job-posting datasets, community reports, posting patterns, and Glassdoor ratings where we have them.
      </p>

      <div className="mt-8 text-sm" aria-live="polite">
        {error && <p className="text-center text-red-600">{error}</p>}
        {!error && !result && !loading && (
          <p className="text-center text-gray-400">
            Search a company to see its ghost score.
          </p>
        )}
        {!error && result && result.found === false && (
          <p className="text-center text-gray-500">
            No score on file for {searched}. Scores show up after listings are tracked or the company is in the public dataset.
          </p>
        )}
        {score != null && (
          <div className="rounded-xl border border-gray-200 p-5 text-left">
            <p className="text-xs uppercase tracking-wide text-gray-400">{searched}</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{score}</p>
            <p className="mt-1 font-medium text-gray-800">{bandNameForScore(score)}</p>
            <p className="mt-2 text-gray-500">
              {result?.totalListings ?? 0} tracked listings · {result?.totalReports ?? 0} community reports
              {result?.live ? ' · live evidence' : ''}
            </p>
            {result?.glassdoor?.rating != null && Number.isFinite(Number(result.glassdoor.rating)) && (
              <p className="mt-2 text-gray-500">
                Glassdoor {Number(result.glassdoor.rating).toFixed(1)}
                {href ? (
                  <>
                    {' '}
                    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
                      reviews
                    </a>
                  </>
                ) : null}
              </p>
            )}
            {result?.signals && result.signals.length > 0 && (
              <ul className="mt-3 space-y-1 text-gray-600">
                {result.signals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
