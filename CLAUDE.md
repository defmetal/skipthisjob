# CLAUDE.md — Skip This Job

## Project Overview
**Skip This Job** (skipthisjob.com) is a Chrome extension + website that detects ghost job listings on LinkedIn and Indeed. It scores listings for ghost risk using real-time heuristics, historical repost tracking, community reports, and Glassdoor enrichment.

**Owner:** Austin (@defmetal), Vibe Labs Marketing, San Antonio TX
**Repo:** github.com/defmetal/skipthisjob
**Live site:** https://skipthisjob.com
**Domain:** Cloudflare DNS → Vercel
**Extension version:** 0.1.1

## Stack
- **Chrome Extension:** Manifest V3, vanilla JS content scripts + background service worker
- **Website:** Next.js 14 (App Router) on Vercel, root directory `web/`
- **Database:** Supabase Postgres
- **Styling:** Tailwind CSS, DM Sans font
- **DNS:** Cloudflare (DNS only, not proxy)
- **Seeding:** Node.js scripts using `@supabase/supabase-js` (CommonJS)

## Architecture
```
Extension content scripts (linkedin.js, indeed.js)
  → chrome.runtime.sendMessage to background service worker
  → service worker makes API calls (bypasses CORS)
  → Vercel API routes (/api/employer/score, /api/report, /api/leaderboard)
  → Supabase Postgres
```

All API calls from the extension go through the background service worker to avoid CORS issues. Content scripts never make direct fetch calls to skipthisjob.com.

## Codebase Stats
- **31 source files**, ~4,937 total lines
- Extension: 1,716 lines (JS/CSS/HTML)
- Website: 1,033 lines (TS/TSX/CSS)
- Scoring engine: 455 lines (JS, reference only)
- Seeding: 1,049 lines (JS)
- Schema: 279 lines (SQL)
- Docs/config: 405 lines

## Key File Locations

### Extension (`extension/`) — 1,716 lines
| File | Lines | Description |
|------|-------|-------------|
| `manifest.json` | 50 | Manifest V3, matches `*://*.linkedin.com/*` and `*://*.indeed.com/*` |
| `content/linkedin.js` | 589 | LinkedIn DOM parser + heuristic scoring + overlay injection |
| `content/indeed.js` | 695 | Indeed DOM parser + heuristic scoring + fixed-position overlay |
| `content/overlay.css` | 197 | Injected overlay styles |
| `background/service-worker.js` | 161 | Handles FETCH_EMPLOYER_SCORE, SCAN_EMPLOYER_LISTINGS, SUBMIT_REPORT, UPDATE_BADGE messages |
| `popup/popup.html` | 74 | Extension popup with usage instructions |
| `icons/` | — | icon-16.png, icon-48.png, icon-128.png |

### Website (`web/`) — 1,033 lines
| File | Lines | Description |
|------|-------|-------------|
| `app/page.tsx` | 278 | Landing page with hero, how-it-works, signals, employer lookup placeholder |
| `app/privacy/page.tsx` | 130 | Privacy policy (required for Chrome Web Store) |
| `app/terms/page.tsx` | 96 | Terms of service |
| `app/layout.tsx` | 39 | Root layout with DM Sans font, SEO metadata |
| `app/globals.css` | 19 | Tailwind + CSS variables |
| `app/api/employer/score/route.ts` | 113 | GET employer ghost score (called by extension) |
| `app/api/report/route.ts` | 179 | POST community report (called by extension) |
| `app/api/leaderboard/route.ts` | 53 | GET worst offenders |
| `lib/supabase.ts` | 11 | Supabase client (anon + admin) |
| `lib/cors.ts` | 15 | CORS helper (corsResponse, corsOptions) |
| `middleware.ts` | 28 | CORS middleware for all /api/* routes |

### Database (`database/`) — 279 lines
| File | Lines | Description |
|------|-------|-------------|
| `schema.sql` | 279 | Full Postgres schema (7 tables, 2 views, 1 trigger function) |

### Scoring (`scoring/`) — 455 lines
| File | Lines | Description |
|------|-------|-------------|
| `ghostScore.js` | 455 | Shared scoring engine (reference implementation, ES module syntax, not bundled with extension) |

### Seeding (`seeding/`) — 1,049 lines
| File | Lines | Description |
|------|-------|-------------|
| `seed-kaggle.js` | 599 | Streaming CSV/LDJSON parser for Kaggle LinkedIn data → Supabase |
| `seed-glassdoor.js` | 242 | Glassdoor rating enrichment (~90 major employers). Exact match → starts-with fuzzy matching against DB `name_normalized` |
| `clean-corrupted-employers.js` | 208 | Cleanup script for corrupted employer records (long names, job description fragments) |

### CI/CD (`.github/workflows/`)
| File | Lines | Description |
|------|-------|-------------|
| `deploy-extension.yml` | 26 | Zips extension + publishes to Chrome Web Store via `mnao305/chrome-extension-upload@v6.0.0` |

## Database Schema (Supabase)
**Tables:** `employers`, `listings`, `repost_patterns`, `community_reports`, `high_turnover_roles`, `high_turnover_industries`, `employer_score_log`
**Views:** `v_ghost_leaderboard`, `v_employer_quick_lookup`
**Triggers:** `trg_employers_updated`, `trg_repost_patterns_updated` (auto-set `updated_at`)

**22,086 employers** seeded from Kaggle LinkedIn dataset (1.3M postings).

## Company Name Normalization
The employer score API normalizes company names by:
1. Lowercasing and trimming
2. Stripping `.com`
3. Iteratively stripping suffixes: inc, llc, llp, corp, ltd, co, company, corporation, group, holdings, services, consulting, solutions, enterprises, technologies, international, worldwide, global, north america, usa, us (up to 4 passes)
4. Exact match → fuzzy match (DB `ilike %name%`) → reverse fuzzy (first word exact match)

Example: "Amazon.com Services LLC" → "amazon" (matches database)

## Scoring Model

### LinkedIn Signals (content/linkedin.js)
- Posting age (14d/30d/60d escalation, 0-15 pts)
- "Reposted" label (+20)
- Applicant count (200+/500+, 0-12 pts)
- No salary (+5), No hiring contact (+5)
- Third-party/staffing agency (+15) — includes known aggregator list
- No response insights (+8)
- Responses managed off LinkedIn (+5)
- High turnover role detection (informational, not score-affecting)

### Indeed Signals (content/indeed.js)
- Platform opacity baseline (+10)
- Posting age with "unknown" penalty (+5)
- No salary (+5), Third party (+15)
- Employer responsive (-5 to -10) vs no response data (+8)
- "Apply on company site" redirect (+5)
- Indeed employer rating (< 2.5: +10, < 3.0: +5, >= 4.0: -3)
- Description quality: short < 300 chars (+8), vague buzzwords (+5 to +10)
- Seniority mismatch: entry title + 5+ years required (+12)
- Engagement signals: "Actively reviewing" (-8) vs no engagement on old listing (+10)
- Stale listing combo: 30+ days + no engagement + no response + no salary (+10)
- High turnover role detection (informational)

### Combined Score
40% listing heuristic + 60% employer backend score (when available).
If no backend data: 100% heuristic.

## Service Worker Messages
The background service worker (`background/service-worker.js`) handles these message types:
- `FETCH_EMPLOYER_SCORE` — GET `/api/employer/score?name=...`
- `SCAN_EMPLOYER_LISTINGS` — Fetches Indeed search results for employer (with 1hr cache)
- `SUBMIT_REPORT` — POST `/api/report` with ghost flag or outcome
- `UPDATE_BADGE` — Sets extension badge text/color per tab

## Environment Variables (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## Deployment
- Push to `main` → Vercel auto-deploys (root directory: `web/`)
- Push a `v*` tag → GitHub Actions publishes extension to Chrome Web Store (`.github/workflows/deploy-extension.yml`)
- Extension: load unpacked from `extension/` folder in chrome://extensions for development
- Seeding scripts: run locally with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars

## Known Issues / TODO
- Indeed overlay uses fixed positioning (top-right) because Indeed destroys DOM on job click
- LinkedIn date detection can sometimes read sidebar listing ages instead of the viewed listing
- Live employer scan on Indeed disabled — raw HTML fetch doesn't include JS-rendered job counts
- Website employer lookup search is a placeholder (not functional yet)
- Leaderboard page not built yet
- Console log prefix inconsistency: linkedin.js uses `[GhostDetector]` for parse functions but `[SkipThisJob]` for main flow
- `scoring/ghostScore.js` uses ES module `export` syntax but isn't used at runtime — it's a reference implementation only
- CORS is handled both by middleware.ts (all `/api/*` routes) and per-route corsResponse/corsOptions helpers — redundant but harmless
- Overlay footer links to `vibedigitalmarketing.com` but branding says "Vibe Labs Marketing" / `vibelabsmarketing.com`

## Code Style
- No TypeScript in extension (vanilla JS for simplicity)
- TypeScript in Next.js web app
- Console logs prefixed with `[SkipThisJob]` (preferred) or `[GhostDetector]` (legacy, in linkedin.js parse functions)
- All extension API calls go through background service worker messages
- CORS handled per-route with corsResponse/corsOptions helpers
- Seeding scripts use CommonJS `require()` (not ES modules)

## Branding
- Name: Skip This Job
- Emoji: ⏭️
- Colors: purple accent (#7c3aed), ghost score colors (green #4caf50 / orange #ff9800 / red #f44336 / purple #9c27b0)
- Font: DM Sans
- Company: Vibe Labs Marketing / vibelabsmarketing.com
- Twitter/X: @defmetal
- Chrome Web Store Extension ID: nodldfdkjomniknohmejdimjlejfongd
