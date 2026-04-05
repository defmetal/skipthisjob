# CLAUDE.md — Skip This Job

## Project Overview
**Skip This Job** (skipthisjob.com) is a Chrome extension + website that detects ghost job listings on LinkedIn and Indeed. It scores listings for ghost risk using real-time heuristics, historical repost tracking, community reports, and Glassdoor enrichment.

**Owner:** Austin (@defmetal), Vibe Labs Marketing, San Antonio TX
**Repo:** github.com/defmetal/skipthisjob
**Live site:** https://skipthisjob.com
**Domain:** Cloudflare DNS → Vercel

## Stack
- **Chrome Extension:** Manifest V3, vanilla JS content scripts + background service worker
- **Website:** Next.js 14 (App Router) on Vercel, root directory `web/`
- **Database:** Supabase Postgres
- **Styling:** Tailwind CSS, DM Sans font
- **DNS:** Cloudflare (DNS only, not proxy)

## Architecture
```
Extension content scripts (linkedin.js, indeed.js)
  → chrome.runtime.sendMessage to background service worker
  → service worker makes API calls (bypasses CORS)
  → Vercel API routes (/api/employer/score, /api/report, /api/leaderboard)
  → Supabase Postgres
```

All API calls from the extension go through the background service worker to avoid CORS issues. Content scripts never make direct fetch calls to skipthisjob.com.

## Key File Locations

### Extension (`extension/`)
- `manifest.json` — Manifest V3, matches `*://*.linkedin.com/*` and `*://*.indeed.com/*`
- `content/linkedin.js` — LinkedIn DOM parser + heuristic scoring + overlay injection
- `content/indeed.js` — Indeed DOM parser + heuristic scoring + fixed-position overlay
- `content/overlay.css` — Injected overlay styles
- `background/service-worker.js` — Handles FETCH_EMPLOYER_SCORE, SUBMIT_REPORT, UPDATE_BADGE messages
- `popup/popup.html` — Extension popup with usage instructions
- `icons/` — icon-16.png, icon-48.png, icon-128.png

### Website (`web/`)
- `app/page.tsx` — Landing page
- `app/privacy/page.tsx` — Privacy policy (required for Chrome Web Store)
- `app/terms/page.tsx` — Terms of service
- `app/layout.tsx` — Root layout with DM Sans font, SEO metadata
- `app/globals.css` — Tailwind + CSS variables
- `app/api/employer/score/route.ts` — GET employer ghost score (called by extension)
- `app/api/report/route.ts` — POST community report (called by extension)
- `app/api/leaderboard/route.ts` — GET worst offenders
- `lib/supabase.ts` — Supabase client (anon + admin)
- `lib/cors.ts` — CORS helper (corsResponse, corsOptions)
- `middleware.ts` — CORS middleware (exists but routes handle CORS directly)

### Database (`database/`)
- `schema.sql` — Full Postgres schema

### Scoring (`scoring/`)
- `ghostScore.js` — Shared scoring engine (reference implementation, not bundled with extension)

### Seeding (`seeding/`)
- `seed-kaggle.js` — Streaming CSV parser for Kaggle LinkedIn data → Supabase
- `seed-glassdoor.js` — Glassdoor rating enrichment (~100 major employers). Uses exact match → starts-with fuzzy matching against DB `name_normalized`.

## Database Schema (Supabase)
Tables: `employers`, `listings`, `repost_patterns`, `community_reports`, `high_turnover_roles`, `high_turnover_industries`, `employer_score_log`
Views: `v_ghost_leaderboard`, `v_employer_quick_lookup`

**22,086 employers** seeded from Kaggle LinkedIn dataset (1.3M postings).

## Company Name Normalization
The employer score API normalizes company names by:
1. Lowercasing and trimming
2. Stripping `.com`
3. Iteratively stripping suffixes: inc, llc, llp, corp, ltd, services, consulting, solutions, etc. (up to 4 passes)
4. Exact match → fuzzy match (DB contains search) → reverse fuzzy (first word exact match)

Example: "Amazon.com Services LLC" → "amazon" (matches database)

## Scoring Model

### LinkedIn Signals
- Posting age (14d/30d/60d escalation, 0-15 pts)
- "Reposted" label (+20)
- Applicant count (200+/500+, 0-12 pts)
- No salary (+5), No hiring contact (+5)
- Third-party/staffing agency (+15)
- No response insights (+8)
- Responses managed off LinkedIn (+5)
- High turnover role detection (informational, not score-affecting)

### Indeed Signals
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

## Environment Variables (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## Deployment
- Push to `main` → Vercel auto-deploys (root directory: `web/`)
- Push to `main` → GitHub Actions auto-publishes extension to Chrome Web Store (`.github/workflows/chrome-web-store.yml`)
- Extension: load unpacked from `extension/` folder in chrome://extensions for development

## Known Issues / TODO
- Indeed overlay uses fixed positioning (top-right) because Indeed destroys DOM on job click
- LinkedIn date detection can sometimes read sidebar listing ages instead of the viewed listing
- Live employer scan on Indeed disabled — raw HTML fetch doesn't include JS-rendered job counts
- Website employer lookup search is a placeholder (not functional yet)
- Leaderboard page not built yet

## Code Style
- No TypeScript in extension (vanilla JS for simplicity)
- TypeScript in Next.js web app
- Console logs prefixed with `[SkipThisJob]`
- All extension API calls go through background service worker messages
- CORS handled per-route with corsResponse/corsOptions helpers

## Branding
- Name: Skip This Job
- Emoji: ⏭️
- Colors: purple accent (#7c3aed), ghost score colors (green/orange/red/purple)
- Font: DM Sans
- Company: Vibe Labs Marketing / vibelabsmarketing.com
- Twitter: @defmetal
