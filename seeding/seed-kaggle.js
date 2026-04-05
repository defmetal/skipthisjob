/**
 * seed-kaggle.js (streaming version)
 * 
 * Streams the Kaggle CSV line-by-line instead of loading it all at once.
 * Only stores per-employer aggregates in memory, not individual rows.
 * 
 * Usage (Windows):
 *   set SUPABASE_URL=https://xxx.supabase.co
 *   set SUPABASE_SERVICE_ROLE_KEY=xxx
 *   node seeding/seed-kaggle.js "C:\path\to\kaggle\folder"
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars. Example:');
  console.error('  set SUPABASE_URL=https://xxx.supabase.co');
  console.error('  set SUPABASE_SERVICE_ROLE_KEY=xxx');
  console.error('  node seeding/seed-kaggle.js ./data');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const dataDir = process.argv[2];

if (!dataDir) {
  console.error('Usage: node seeding/seed-kaggle.js /path/to/kaggle/folder');
  process.exit(1);
}

function normalizeCompany(name) {
  return (name || '').toLowerCase().trim()
    .replace(/\s+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.?|company|corporation|group|holdings)$/i, '')
    .replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title) {
  return (title || '').toLowerCase().trim()
    .replace(/\s*(sr\.?|jr\.?|senior|junior|lead|principal|staff|ii|iii|iv)\s*/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractCity(location) {
  if (!location) return 'unknown';
  return (location.split(',')[0] || '').toLowerCase().trim() || 'unknown';
}

const HIGH_TURNOVER = [
  /barista/i, /crew\s*member/i, /team\s*member/i, /cashier/i,
  /sales\s*associate/i, /retail\s*associate/i, /warehouse/i,
  /delivery\s*driver/i, /package\s*handler/i, /registered\s*nurse/i,
  /\b(lpn|lvn|cna)\b/i, /nursing\s*assistant/i, /home\s*health/i,
  /caregiver/i, /security\s*(officer|guard)/i, /janitor|custodian/i,
  /housekeeper/i, /front\s*desk/i, /dishwasher|line\s*cook|server|bartender/i,
  /call\s*center/i, /customer\s*service\s*rep/i, /truck\s*driver/i,
  /forklift/i, /picker|packer|stocker/i, /medical\s*assistant/i,
];

function isHighTurnover(title) {
  return HIGH_TURNOVER.some(p => p.test(title));
}

function scoreToLabel(s) {
  if (s >= 75) return 'very_high';
  if (s >= 50) return 'high';
  if (s >= 25) return 'moderate';
  return 'low';
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += c;
  }
  result.push(current);
  return result;
}

function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().includes(name.toLowerCase())) return fullPath;
    if (entry.isDirectory()) { const f = findFile(fullPath, name); if (f) return f; }
  }
  return null;
}

async function main() {
  console.log('=== Skip This Job - Kaggle Seeder (streaming) ===\n');

  const postingsFile = findFile(dataDir, 'postings.csv');
  if (!postingsFile) {
    console.error('Could not find postings.csv in', dataDir);
    process.exit(1);
  }
  console.log('Streaming:', postingsFile, '\n');

  // Stream CSV and aggregate per employer
  const employers = new Map();
  let colMap = null;
  let lineCount = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(postingsFile, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    // First line = headers
    if (!colMap) {
      const headers = parseCSVLine(line).map(h => h.trim().toLowerCase());
      colMap = {};
      headers.forEach((h, i) => { colMap[h] = i; });
      console.log('Columns found:', Object.keys(colMap).join(', '), '\n');
      continue;
    }

    lineCount++;
    if (lineCount % 200000 === 0) {
      console.log(`  ${(lineCount / 1000).toFixed(0)}K rows... ${employers.size} employers`);
    }

    const v = parseCSVLine(line);

    const companyName = (v[colMap['company_name']] || v[colMap['company']] || '').trim();
    const title = (v[colMap['title']] || v[colMap['job_title']] || '').trim();
    const location = (v[colMap['location']] || v[colMap['job_location']] || '').trim();
    const salary = (v[colMap['min_salary']] || v[colMap['max_salary']] || v[colMap['salary']] || '').trim();
    const industry = (v[colMap['company_industry']] || v[colMap['industry']] || '').trim();

    if (!companyName) continue;
    const normalized = normalizeCompany(companyName);
    if (!normalized) continue;

    if (!employers.has(normalized)) {
      employers.set(normalized, {
        nameRaw: companyName, industry: industry || null,
        total: 0, roleCounts: {}, titleSet: {},
        hasSalary: 0, noSalary: 0,
      });
    }

    const emp = employers.get(normalized);
    emp.total++;

    const key = `${normalizeTitle(title)}|${extractCity(location)}`;
    emp.roleCounts[key] = (emp.roleCounts[key] || 0) + 1;
    emp.titleSet[normalizeTitle(title)] = true;

    if (salary && salary !== '0') emp.hasSalary++;
    else emp.noSalary++;
  }

  console.log(`\nRead ${lineCount.toLocaleString()} rows, ${employers.size.toLocaleString()} employers.\n`);

  // Score
  const scored = [];
  for (const [normalized, emp] of employers) {
    if (emp.total < 3) continue;

    let score = 0;
    let worstRepost = 0, repostRoles = 0;

    for (const k in emp.roleCounts) {
      const c = emp.roleCounts[k];
      if (c > worstRepost) worstRepost = c;
      if (c >= 3) repostRoles++;
    }

    if (worstRepost >= 6) score += 20;
    else if (worstRepost >= 4) score += 12;
    else if (worstRepost >= 3) score += 6;
    if (repostRoles >= 5) score += 8;

    const total = emp.hasSalary + emp.noSalary;
    if (total > 5 && emp.noSalary / total > 0.9) score += 5;

    const titles = Object.keys(emp.titleSet);
    const htRatio = titles.filter(t => isHighTurnover(t)).length / Math.max(titles.length, 1);
    if (htRatio > 0.5) score *= 0.4;

    score = Math.min(100, Math.max(0, Math.round(score)));

    if (score >= 10) {
      scored.push({
        name_raw: emp.nameRaw,
        name_normalized: normalized,
        ghost_score: score,
        ghost_label: scoreToLabel(score),
        total_listings_tracked: emp.total,
        industry: emp.industry,
        is_high_turnover_industry: htRatio > 0.5,
      });
    }
  }

  scored.sort((a, b) => b.ghost_score - a.ghost_score);

  console.log(`Scored ${scored.length.toLocaleString()} employers\n`);
  console.log('Top 20 worst offenders:');
  scored.slice(0, 20).forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.name_raw} — ${e.ghost_score}/100 (${e.total_listings_tracked} listings)`);
  });

  console.log(`\nDistribution:`);
  console.log(`  Very High (75+):  ${scored.filter(e => e.ghost_score >= 75).length}`);
  console.log(`  High (50-74):     ${scored.filter(e => e.ghost_score >= 50 && e.ghost_score < 75).length}`);
  console.log(`  Moderate (25-49): ${scored.filter(e => e.ghost_score >= 25 && e.ghost_score < 50).length}`);
  console.log(`  Low (10-24):      ${scored.filter(e => e.ghost_score >= 10 && e.ghost_score < 25).length}`);

  // Upload
  console.log(`\nUploading to Supabase...`);
  let uploaded = 0, errs = 0;

  for (let i = 0; i < scored.length; i += 100) {
    const batch = scored.slice(i, i + 100);
    const { error } = await supabase
      .from('employers')
      .upsert(batch, { onConflict: 'name_normalized', ignoreDuplicates: false });

    if (error) { console.error(`  Error at ${i}:`, error.message); errs++; }
    else uploaded += batch.length;

    if (i % 1000 === 0 && i > 0) console.log(`  ${uploaded} / ${scored.length}`);
  }

  console.log(`\n=== Done === Uploaded: ${uploaded} | Errors: ${errs}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
