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
                         │ • Privacy  │
                         │ • Terms    │
                         └────────────┘
```

## Project Structure

```
skipthisjob/
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── content/
│   │   ├── linkedin.js      # LinkedIn DOM parser + overlay
│   │   ├── indeed.js        # Indeed DOM parser + overlay
│   │   └── overlay.css      # Injected overlay styles
│   ├── background/
│   │   └── service-worker.js
│   ├── popup/
│   │   └── popup.html       # Extension popup
│   └── icons/               # Extension icons
│
├── web/                     # Next.js 14 website (App Router)
│   ├── app/
│   │   ├── page.tsx         # Landing page
│   │   ├── privacy/page.tsx # Privacy policy
│   │   ├── terms/page.tsx   # Terms of service
│   │   └── api/
│   │       ├── employer/score/route.ts  # GET employer ghost score
│   │       ├── report/route.ts          # POST community report
│   │       └── leaderboard/route.ts     # GET top ghost employers
│   └── lib/
│       ├── supabase.ts      # Supabase client
│       └── cors.ts          # CORS helpers
│
├── database/
│   └── schema.sql           # Supabase Postgres schema
│
├── seeding/
│   ├── seed-kaggle.js       # Kaggle LinkedIn data → Supabase (22K+ employers)
│   ├── seed-glassdoor.js    # Glassdoor rating enrichment (~90 employers)
│   └── clean-corrupted-employers.js  # Cleanup corrupted employer records
│
├── scoring/
│   └── ghostScore.js        # Scoring engine (reference implementation)
│
└── .github/workflows/
    └── deploy-extension.yml # Publish extension to Chrome Web Store on v* tag
```

## Scoring Model

### Listing-Level (runs locally in extension)

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

### Final Score

Combined = (Listing heuristic x 0.4) + (Employer score x 0.6). If no employer data: 100% heuristic.

## Setup

### Supabase
1. Create a Supabase project
2. Run `database/schema.sql` in the SQL editor
3. Copy the project URL and keys

### Vercel
1. Create Next.js app, connect to GitHub
2. Set root directory to `web/`
3. Add environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy — auto-deploys on push to `main`

### Extension
1. Load unpacked from `extension/` in `chrome://extensions` for development
2. Auto-published to Chrome Web Store via GitHub Actions on `v*` tag push

### Seeding
```bash
# Seed employers from Kaggle LinkedIn dataset
SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node seeding/seed-kaggle.js /path/to/kaggle/data

# Enrich with Glassdoor ratings
SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node seeding/seed-glassdoor.js
```
