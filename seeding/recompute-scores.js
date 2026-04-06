/**
 * recompute-scores.js
 *
 * Recalculates ghost_score for all employers using all available data:
 *   - Repost patterns (from repost_patterns table)
 *   - Listing volume & density signals
 *   - Community reports
 *   - Glassdoor enrichment (low rating, low offer rate)
 *   - Salary transparency ratio (from seed data)
 *   - High-turnover industry modifier
 *   - Large company modifier
 *
 * This produces meaningful score variation instead of every employer being 33.
 *
 * Usage:
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node seeding/recompute-scores.js
 *   Add --dry-run to preview without writing to DB.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars. Example:');
  console.error('  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node seeding/recompute-scores.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function scoreToLabel(s) {
  if (s >= 75) return 'very_high';
  if (s >= 50) return 'high';
  if (s >= 25) return 'moderate';
  return 'low';
}

// Company size string → estimated employee count
function parseCompanySize(sizeStr) {
  if (!sizeStr) return 0;
  if (sizeStr.includes('10001') || sizeStr.includes('10000+')) return 15000;
  if (sizeStr.includes('5001') || sizeStr.includes('5000')) return 7500;
  if (sizeStr.includes('1001') || sizeStr.includes('1000')) return 3000;
  if (sizeStr.includes('501') || sizeStr.includes('500')) return 750;
  if (sizeStr.includes('201') || sizeStr.includes('200')) return 350;
  return 100;
}

async function main() {
  console.log(`=== Ghost Score Recompute ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  // Fetch all employers
  const employers = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('employers')
      .select('id, name_raw, name_normalized, ghost_score, ghost_label, total_listings_tracked, total_reports, glassdoor_rating, glassdoor_offer_rate, company_size, industry, is_high_turnover_industry')
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fetch error:', error.message); break; }
    if (!data || data.length === 0) break;
    employers.push(...data);
    from += data.length;
    if (data.length < PAGE) break;
  }
  console.log(`Loaded ${employers.length.toLocaleString()} employers.`);

  // Fetch repost patterns indexed by employer_id
  const repostMap = new Map();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('repost_patterns')
      .select('employer_id, occurrence_count, descriptions_identical')
      .range(from, from + PAGE - 1);
    if (error) { console.error('Repost fetch error:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!repostMap.has(row.employer_id)) repostMap.set(row.employer_id, []);
      repostMap.get(row.employer_id).push(row);
    }
    from += data.length;
    if (data.length < PAGE) break;
  }
  console.log(`Loaded repost patterns for ${repostMap.size.toLocaleString()} employers.`);

  // Fetch community report aggregates by employer
  const reportMap = new Map();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('community_reports')
      .select('employer_id, report_type, outcome')
      .range(from, from + PAGE - 1);
    if (error) { console.error('Reports fetch error:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!reportMap.has(row.employer_id)) {
        reportMap.set(row.employer_id, { ghostFlags: 0, outcomes: 0, noResponse: 0, interviewed: 0 });
      }
      const agg = reportMap.get(row.employer_id);
      if (row.report_type === 'ghost_flag') agg.ghostFlags++;
      if (row.report_type === 'outcome') {
        agg.outcomes++;
        if (row.outcome === 'no_response') agg.noResponse++;
        if (row.outcome === 'interviewed' || row.outcome === 'offered' || row.outcome === 'hired') agg.interviewed++;
      }
    }
    from += data.length;
    if (data.length < PAGE) break;
  }
  console.log(`Loaded community reports for ${reportMap.size.toLocaleString()} employers.\n`);

  // Build percentile lookup for listing volume
  const allListings = employers.map(e => e.total_listings_tracked || 0).sort((a, b) => a - b);
  function listingPercentile(n) {
    let pos = 0;
    for (const v of allListings) {
      if (v <= n) pos++;
      else break;
    }
    return pos / allListings.length;
  }

  // Recompute scores
  let changed = 0;
  const updates = [];

  for (const emp of employers) {
    let score = 0;

    // === 1. Repost frequency (0-28 pts) ===
    const reposts = repostMap.get(emp.id) || [];
    let worstRepost = 0;
    let repostRoles = 0;
    let hasIdenticalDesc = false;

    for (const rp of reposts) {
      if (rp.occurrence_count > worstRepost) worstRepost = rp.occurrence_count;
      if (rp.occurrence_count >= 3) repostRoles++;
      if (rp.descriptions_identical) hasIdenticalDesc = true;
    }

    if (worstRepost >= 6) score += 20;
    else if (worstRepost >= 4) score += 12;
    else if (worstRepost >= 3) score += 6;

    if (repostRoles >= 5) score += 8;
    else if (repostRoles >= 3) score += 4;

    if (hasIdenticalDesc) score += 8;

    // === 2. Listing volume signals (0-45 pts) ===
    // Uses percentile ranking for smooth variation + absolute tiers +
    // listings-to-company-size ratio.
    const listings = emp.total_listings_tracked || 0;
    const empSize = parseCompanySize(emp.company_size);
    const pct = listingPercentile(listings);

    // Percentile-based score (0-25): creates smooth variation
    if (pct >= 0.99) score += 25;
    else if (pct >= 0.97) score += 22;
    else if (pct >= 0.95) score += 19;
    else if (pct >= 0.90) score += 16;
    else if (pct >= 0.80) score += 12;
    else if (pct >= 0.70) score += 9;
    else if (pct >= 0.50) score += 6;
    else if (pct >= 0.30) score += 3;
    else score += 1;

    // Listings-to-size ratio (0-12): penalizes disproportionate posting
    if (empSize > 0 && listings > 0) {
      const ratio = listings / empSize;
      if (ratio >= 0.10) score += 12;
      else if (ratio >= 0.05) score += 8;
      else if (ratio >= 0.03) score += 5;
      else if (ratio >= 0.01) score += 2;
    }

    // Absolute volume bonus (0-8)
    if (listings >= 400) score += 8;
    else if (listings >= 200) score += 5;
    else if (listings >= 100) score += 3;

    // === 3. Community reports (0-27 pts) ===
    const reports = reportMap.get(emp.id);
    if (reports) {
      if (reports.ghostFlags >= 20) score += 15;
      else if (reports.ghostFlags >= 10) score += 9;
      else if (reports.ghostFlags >= 3) score += 3;

      if (reports.outcomes >= 5) {
        const noResponseRate = reports.noResponse / reports.outcomes;
        if (noResponseRate >= 0.8) score += 12;
        else if (noResponseRate >= 0.5) score += 6;

        const interviewRate = reports.interviewed / reports.outcomes;
        if (reports.outcomes >= 10 && interviewRate < 0.05) score += 10;
        else if (reports.outcomes >= 10 && interviewRate < 0.15) score += 4;
      }
    }

    // === 4. Glassdoor signals (0-13 pts) ===
    if (emp.glassdoor_rating != null) {
      if (emp.glassdoor_rating < 2.5) score += 5;
      else if (emp.glassdoor_rating < 3.0) score += 3;
      // Good ratings reduce score slightly
      else if (emp.glassdoor_rating >= 4.0) score -= 3;
    }

    if (emp.glassdoor_offer_rate != null) {
      if (emp.glassdoor_offer_rate < 0.15) score += 8;
      else if (emp.glassdoor_offer_rate < 0.20) score += 4;
    }

    // === 5. No Glassdoor data penalty (0-3 pts) ===
    // Well-known companies (many listings) with zero Glassdoor presence is slightly suspect
    if (emp.glassdoor_rating == null && listings >= 100) {
      score += 3;
    }

    // === 6. Apply modifiers ===
    if (emp.is_high_turnover_industry) {
      score *= 0.60;
    }

    if (empSize >= 10000) {
      score *= 0.85;
    }

    score = Math.min(100, Math.max(0, Math.round(score)));
    const label = scoreToLabel(score);

    if (score !== Number(emp.ghost_score) || label !== emp.ghost_label) {
      changed++;
      updates.push({
        id: emp.id,
        ghost_score: score,
        ghost_label: label,
        total_reports: reports ? reports.ghostFlags + reports.outcomes : emp.total_reports,
      });
    }
  }

  console.log(`Score changes: ${changed} of ${employers.length} employers`);

  // Show distribution
  const allScores = updates.length > 0
    ? employers.map(e => {
        const upd = updates.find(u => u.id === e.id);
        return upd ? upd.ghost_score : Number(e.ghost_score);
      })
    : employers.map(e => Number(e.ghost_score));

  console.log(`\nProjected distribution:`);
  console.log(`  Very High (75+):  ${allScores.filter(s => s >= 75).length}`);
  console.log(`  High (50-74):     ${allScores.filter(s => s >= 50 && s < 75).length}`);
  console.log(`  Moderate (25-49): ${allScores.filter(s => s >= 25 && s < 50).length}`);
  console.log(`  Low (10-24):      ${allScores.filter(s => s >= 10 && s < 25).length}`);
  console.log(`  Minimal (0-9):    ${allScores.filter(s => s < 10).length}`);

  // Show some examples of changes
  if (updates.length > 0) {
    console.log('\nSample changes (first 20):');
    const samples = updates.slice(0, 20);
    for (const upd of samples) {
      const emp = employers.find(e => e.id === upd.id);
      console.log(`  ${emp.name_raw}: ${emp.ghost_score} → ${upd.ghost_score} (${upd.ghost_label})`);
    }
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: No changes written to DB ---');
    return;
  }

  // Write updates in batches
  if (updates.length > 0) {
    console.log(`\nWriting ${updates.length} updates to Supabase...`);
    let written = 0;
    let errs = 0;

    for (const upd of updates) {
      const { error } = await supabase
        .from('employers')
        .update({
          ghost_score: upd.ghost_score,
          ghost_label: upd.ghost_label,
          total_reports: upd.total_reports,
        })
        .eq('id', upd.id);

      if (error) {
        console.error(`  Error updating ${upd.id}: ${error.message}`);
        errs++;
      } else {
        written++;
      }

      if (written % 500 === 0 && written > 0) {
        console.log(`  ${written} / ${updates.length}`);
      }
    }

    console.log(`\nDone: ${written} updated, ${errs} errors`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
