# Skip This Job

**skipthisjob.com — Detect ghost job listings on LinkedIn and Indeed before you waste time applying.**

A Chrome extension + web platform that scores job listings for ghost risk using real-time heuristics, historical repost tracking, community reports, and Glassdoor enrichment.

Built by [Vibe Labs Marketing](https://vibelabsmarketing.com) 

---

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Chrome Extension │────▶│   Vercel API     │────▶│   Supabase       │
│                  │     │   (Next.js)      │     │   (Postgres)     │
│  • Content scripts│     │                  │     │                  │
│  • DOM parsing   │     │  • /api/employer/ │     │  • employers     │
│  • Local scoring │     │    score          │     │  • listings      │
│  • UI injection  │     │  • /api/report    │     │  • repost_patterns│
│  • Report submit │     │  • /api/leaderboard│    │  • community_    │
│                  │     │                  │     │    reports        │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                               │
                          Cloudflare DNS
                               │
                         ┌─────┴──────┐
                         │  Website   │
                         │ (Vercel)   │
                         │            │
                         │ • Landing  │
                         │ • Employer │
                         │   lookup   │
                         │ • Leader-  │
                         │   board    │
                         └────────────┘
```

## Project Structure

```
ghost-job-detector/
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── content/
│   │   ├── linkedin.js      # LinkedIn DOM parser + overlay
│   │   ├── indeed.js        # Indeed DOM parser + overlay
│   │   └── overlay.css      # Injected overlay styles
│   ├── background/
│   │   └── service-worker.js
│   ├── popup/
│   │   └── popup.html       # Extension popup (TODO)
│   └── icons/               # Extension icons (TODO)
│
├── web/                     # Next.js website (TODO)
│   ├── app/
│   │   ├── page.tsx         # Landing page
│   │   ├── employer/
│   │   │   └── [slug]/      # Employer ghost score pages
│   │   └── leaderboard/     # Worst offenders
│   └── api/
│       ├── employer/
│       │   └── score/       # GET - lookup employer ghost score
│       ├── report/          # POST - submit community report
│       └── leaderboard/     # GET - top ghost employers
│
├── database/
│   └── schema.sql           # Supabase Postgres schema
│
└── scoring/
    └── ghostScore.js        # Scoring engine (shared)
```

## Scoring Model

### Listing-Level (runs locally in extension, zero backend needed)

| Signal                  | Weight | Notes                                    |
|-------------------------|--------|------------------------------------------|
| Posting age > 30 days   | 0-15   | Escalates at 14d, 30d, 60d              |
| "Reposted" label        | 20     | Platform explicitly marks it             |
| Applicant saturation    | 0-12   | 200+ or 500+ applicants                 |
| No salary listed        | 5      |                                          |
| No hiring contact       | 5      | No recruiter/HM shown                   |
| Vague description       | 0-10   | Buzzword analysis + specificity check    |
| Seniority mismatch      | 5      | "Entry level" + "10 years required"      |

### Employer-Level (backend, aggregated data)

| Signal                  | Weight | Notes                                    |
|-------------------------|--------|------------------------------------------|
| Repost frequency        | 0-20   | Same role reposted 3-6+ times / 12mo    |
| Identical descriptions  | 8      | Description hash unchanged across reposts|
| Community ghost flags   | 0-15   | Thumbs-down count                        |
| Community no-response % | 0-12   | % of outcomes = "no_response"            |
| Low interview rate      | 0-10   | <5-15% of tracked applicants interviewed |
| Glassdoor low rating    | 5      | Employer rating < 3.0                    |
| Glassdoor low offer rate| 8      | <20% of interviewees got offers          |

### Modifiers (reduce score for legitimate patterns)

| Modifier                | Factor | Notes                                    |
|-------------------------|--------|------------------------------------------|
| High-turnover role      | 0.40x  | barista, warehouse associate, etc.       |
| High-turnover industry  | 0.35-0.60x | food service, retail, healthcare     |
| Large company (10k+)    | 0.80x  | Expected higher posting volume           |
| Entry-level role        | 0.70x  | Normal higher turnover                   |

### Final Score

Combined = (Listing heuristic × 0.4) + (Employer score × 0.6)

If no employer data exists → 100% heuristic score.

## Data Seeding Strategy

1. **Kaggle LinkedIn datasets** (free) — 1.3M+ job postings from 2023-2024.
   Batch-analyze for repost patterns per employer + title + location.

2. **TheirStack API** (free tier: 200 credits/mo) — Historical + expired
   listings going back to 2021. Verify worst offenders from Kaggle.

3. **Glassdoor** (Apify scraper, one-time seed) — Interview outcome rates
   and employer ratings for top employers in the dataset.

## Setup

### Supabase
1. Create a Supabase project
2. Run `database/schema.sql` in the SQL editor
3. Copy the project URL and anon key

### Vercel
1. Create Next.js app, connect to GitHub
2. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy

### Extension
1. `API_BASE` in content scripts is already set to `https://skipthisjob.com/api`
2. Load unpacked in `chrome://extensions` for development
3. Publish to Chrome Web Store when ready

### Cloudflare
1. Point `skipthisjob.com` DNS to Vercel (CNAME)
2. Same workflow as postmimic.app
"# skipthisjob" 
