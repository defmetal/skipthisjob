/**
 * seed-kaggle.js (streaming, multi-dataset version)
 *
 * Streams CSV files line-by-line from one or more Kaggle dataset folders.
 * Auto-detects column names across different dataset schemas (LinkedIn, Indeed, etc).
 * Only stores per-employer aggregates in memory, not individual rows.
 * Upserts employers and increments total_listings_tracked for existing records.
 *
 * Usage:
 *   set SUPABASE_URL=https://xxx.supabase.co
 *   set SUPABASE_SERVICE_ROLE_KEY=xxx
 *   node seeding/seed-kaggle.js /path/to/kaggle/folder
 *
 * Expects subfolders (archive, archive2, archive3, archive4) containing CSV files,
 * or CSV files directly in the given folder.
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
  console.error('  node seeding/seed-kaggle.js ./kaggle');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const dataDir = process.argv[2];

if (!dataDir) {
  console.error('Usage: node seeding/seed-kaggle.js /path/to/kaggle/folder');
  process.exit(1);
}

// --- Column name mappings ---
// Maps various header names to our canonical field names.
// Each canonical field has an array of known header variants (lowercased).
const COLUMN_ALIASES = {
  company:  ['company_name', 'company name', 'company', 'employer', 'employer_name', 'organization'],
  title:    ['title', 'job_title', 'job title', 'jobtitle', 'position', 'role'],
  location: ['location', 'job_location', 'job location', 'joblocation', 'city_state', 'place'],
  city:     ['city', 'employer city', 'employer_city', 'job_city'],
  state:    ['state', 'employer state', 'employer_state', 'job_state'],
  salary:   ['salary', 'salary_range', 'salary range', 'type-salary', 'compensation', 'salary_offered'],
  salaryMin:['min_salary', 'salary from', 'salary_from', 'salary_min', 'minimum_salary', 'inferred_salary_from'],
  salaryMax:['max_salary', 'salary to', 'salary_to', 'salary_max', 'maximum_salary', 'inferred_salary_to'],
  industry: ['industry', 'company_industry', 'categories', 'category', 'sector'],
  companySize: ['company_size', 'company size', 'employees', 'size'],
};

// --- LDJSON field mappings ---
// Maps LDJSON field names to our canonical field names.
const LDJSON_FIELD_MAP = {
  company:     ['company_name', 'company', 'employer_name'],
  title:       ['job_title', 'title', 'position'],
  location:    ['location'],
  city:        ['city', 'inferred_city'],
  state:       ['state', 'inferred_state'],
  salary:      ['salary_offered', 'salary'],
  salaryMin:   ['inferred_salary_from', 'salary_from'],
  salaryMax:   ['inferred_salary_to', 'salary_to'],
  industry:    ['category', 'industry'],
  companySize: ['company_size', 'employees'],
};

function resolveLdjsonField(obj, canonical) {
  const aliases = LDJSON_FIELD_MAP[canonical] || [];
  for (const alias of aliases) {
    if (obj[alias] !== undefined && obj[alias] !== null && obj[alias] !== '') {
      return String(obj[alias]).trim();
    }
  }
  return '';
}

function resolveColumns(headers) {
  const headerLower = headers.map(h => h.trim().toLowerCase());
  const resolved = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = headerLower.findIndex(h => aliases.includes(h));
    resolved[canonical] = idx >= 0 ? idx : -1;
  }
  return resolved;
}

function getField(values, colIdx) {
  if (colIdx < 0 || colIdx >= values.length) return '';
  return (values[colIdx] || '').trim();
}

// --- Normalization helpers ---

function normalizeCompany(name) {
  let n = (name || '').toLowerCase().trim().replace(/\.com$/i, '');
  // Iterative suffix stripping (up to 4 passes per CLAUDE.md)
  const suffixes = /\s+(inc\.?|llc\.?|llp\.?|corp\.?|ltd\.?|co\.?|company|corporation|group|holdings|services|consulting|solutions|enterprises|international|worldwide|global|associates|partners)$/i;
  for (let i = 0; i < 4; i++) {
    const cleaned = n.replace(suffixes, '');
    if (cleaned === n) break;
    n = cleaned;
  }
  return n.replace(/\s+/g, ' ').trim();
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

// Reject garbage that bled into the company_name column from other CSV fields
function isValidCompanyName(normalized, rawName) {
  const words = normalized.split(' ');

  // Too long — real company names rarely exceed 60 chars
  if (normalized.length > 60) return false;

  // Starts with non-alphanumeric (quotes, dashes, special chars)
  if (/^[^a-zA-Z0-9]/.test(normalized)) return false;

  // Pure numbers / prices / salary fragments
  if (/^[\d$.,\-\s%+]+$/.test(normalized)) return false;

  // Contains URLs
  if (/https?:|www\.|\.com\//.test(normalized)) return false;

  // State + zip code patterns ("ca 95814", "fl 33132")
  if (/^[a-z]{2}\s+\d{4,5}/.test(normalized)) return false;

  // Contains zip codes anywhere
  if (/\b\d{5}(-\d{4})?\b/.test(normalized)) return false;

  // Marketing / mission statement phrases
  if (/proudly (offers|provides|serves)|is proud to|is pleased|is committed|is dedicated/.test(normalized)) return false;

  // Ends with location qualifiers
  if (/- *(onsite|remote|hybrid)$/i.test(normalized)) return false;

  // Sentence fragments: high ratio of common English function words
  const filler = new Set(['a','an','the','and','or','of','to','in','on','at','by',
    'for','with','is','are','was','were','be','been','being','has','have','had',
    'do','does','did','will','would','shall','should','may','might','can','could',
    'must','not','but','if','so','as','it','its','no','than','then','also','just',
    'very','too','only','even','still','about','into','from','up','out','off',
    'over','down','through','after','before','between','under','we','you','they',
    'our','your','their','us','them','him','her','who','what','which','where',
    'when','while','that','this','these','those','each','every','all','any','some',
    'both','more','most','much','many','such','own','other','how','why','without',
    'regard','upon','during','until','after','before','against','across','along',
    'around','within','beyond','toward','per','via']);

  if (words.length >= 3) {
    const fillerCount = words.filter(w => filler.has(w)).length;
    if (fillerCount / words.length >= 0.4) return false;
  }

  // Single common English words that are not company names
  if (words.length === 1) {
    const notCompanies = new Set([
      // EEO/demographic
      'color','race','religion','ancestry','sex','age','disability','ethnicity',
      // Skills / tech / tools (not companies)
      'skills','knowledge','training','excel','word','javascript','python','java',
      'kotlin','swift','rust','react','angular','terraform','kubernetes','docker',
      'agile','scrum','mongodb','redis','linux','html','typescript','golang',
      'ruby','perl','scala','matlab','fortran','figma','jenkins','ansible',
      // Job desc vocabulary
      'business','engineering','nursing','accounting','marketing','operations',
      'sales','pharmacy','construction','manufacturing','logistics','testing',
      'programming','procedures','licenses','technology','finance','planning',
      'emotional','health','policies','regulations','benefits','maintenance',
      'processes','electrical','clean','employees','service','support',
      'written','verbal','oral','competitive','friendly','safe','integrity',
      'equity','discussed','customers','market','state','trade',
      'standing','sitting','walking','lifting','bending','reaching',
      'pushing','pulling','climbing','hiring','staff','empathy',
      'interpersonal','certifications','respect','compassionate','perspectives',
      'energy','interviewing','dressing','hire','tools','develop','analyze',
      'deliver','monitor','copy','administer','personally','perform',
      'care','body','data','lift','pull','push','walk','bend','stand',
      'modify','predict','floating','classification','generation','incidents',
      'screen','prepped','switchgear','biotech','industrial','medical',
      'dental','clinical','surgical','mechanical','chemical','documentation',
    ]);
    if (notCompanies.has(normalized)) return false;

    // Lowercase single word in the raw name = almost certainly not a company
    if (rawName && rawName === rawName.toLowerCase() && normalized.length > 3) return false;
  }

  // Two-word generic phrases (not companies)
  if (words.length === 2) {
    const notCompanyPairs = new Set([
      'supply chain','human resources','data science','machine learning',
      'quality assurance','business development','project management',
      'graphic design','web development','critical thinking','critical illness',
      'paid holidays','sick days','sick time','paid time','base salary',
      'hourly rate','background check','drug screen','drug test',
      'cover letter','phone screen','working remotely','fine manipulation',
      'kids clothes','cross domain','knowledge &','information systems',
      'national origin','gender identity','sexual orientation',
      'veteran status','marital status','genetic information',
      'computer science','business administration','information technology',
    ]);
    if (notCompanyPairs.has(normalized)) return false;

    // Both words lowercase in raw = probably not a company
    const rawWords = (rawName || '').split(/\s+/);
    if (rawWords.length >= 2 && /^[a-z]/.test(rawWords[0]) && /^[a-z]/.test(rawWords[1])) {
      return false;
    }
  }

  // Starts with common sentence/description openers
  const badStarts = ['including ','such as ','ability to ','required to ',
    'expected to ','responsible for ','looking for ','seeking ','based in ',
    'located in ','knowledge of ','experience in ','experience with ',
    'must be ','must have ','will be ','we are ','we offer ','you will ',
    'please ','click ','visit ','apply ','about us ','join us ','come join ',
    'recognized as ','committed to ','dedicated to ','focused on ',
    'according to ','subject to ','provides for ','among other ',
    'starting at ','log into ','published '];
  if (badStarts.some(p => normalized.startsWith(p))) return false;

  // Job listing content keywords (in multi-word entries)
  if (words.length >= 2 && /paid |tuition |reimbursement|401k|salary|compensation |insurance |per hour|per year|usd |applicant|candidate|lawful |permanent resident|state and local|regard to|date of hire|job-related|manipulation|professionally/.test(normalized)) {
    return false;
  }

  // EEO / legal boilerplate
  if (/equal opportunity|affirmative action|discrimination|reasonable accommodation|drug (test|screen)|pre-employment|criminal history|fair chance|protected class/.test(normalized)) {
    return false;
  }

  return true;
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

function hasSalaryValue(val) {
  if (!val) return false;
  const stripped = val.replace(/[^0-9.]/g, '');
  return stripped.length > 0 && parseFloat(stripped) > 0;
}

// --- File discovery ---

function findDataFiles(dir) {
  const dataFiles = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const lower = entry.name.toLowerCase();
      if (entry.isFile() && (lower.endsWith('.csv') || lower.endsWith('.ldjson'))) {
        dataFiles.push(fullPath);
      }
      if (entry.isDirectory()) {
        dataFiles.push(...findDataFiles(fullPath));
      }
    }
  } catch (err) {
    console.error(`  Warning: cannot read ${dir}: ${err.message}`);
  }
  return dataFiles;
}

// --- Stream a single CSV and aggregate into employers map ---

async function streamCSV(filePath, employers) {
  console.log(`\nStreaming: ${filePath}`);

  let colIdx = null;
  let lineCount = 0;
  let skipped = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    // First line = headers
    if (!colIdx) {
      const headers = parseCSVLine(line);
      colIdx = resolveColumns(headers);
      const mapped = Object.entries(colIdx)
        .filter(([, v]) => v >= 0)
        .map(([k, v]) => `${k}→col${v}`)
        .join(', ');
      console.log(`  Headers: ${headers.map(h => h.trim()).join(', ')}`);
      console.log(`  Mapped:  ${mapped}`);

      if (colIdx.company < 0) {
        console.error(`  ERROR: No company name column found. Skipping file.`);
        return { lineCount: 0, skipped: 0 };
      }
      continue;
    }

    lineCount++;
    if (lineCount % 200000 === 0) {
      console.log(`  ${(lineCount / 1000).toFixed(0)}K rows... ${employers.size} employers`);
    }

    const v = parseCSVLine(line);

    const companyName = getField(v, colIdx.company);
    const title = getField(v, colIdx.title);
    const location = getField(v, colIdx.location);
    const city = getField(v, colIdx.city);
    const industry = getField(v, colIdx.industry);

    // Determine salary presence from whichever columns are available
    const salaryMin = getField(v, colIdx.salaryMin);
    const salaryMax = getField(v, colIdx.salaryMax);
    const salaryGeneric = getField(v, colIdx.salary);
    const hasSalary = hasSalaryValue(salaryMin) || hasSalaryValue(salaryMax) || hasSalaryValue(salaryGeneric);

    if (!companyName) { skipped++; continue; }
    const normalized = normalizeCompany(companyName);
    if (!normalized || !isValidCompanyName(normalized, companyName)) { skipped++; continue; }

    if (!employers.has(normalized)) {
      employers.set(normalized, {
        nameRaw: companyName, industry: industry || null,
        total: 0, roleCounts: {}, titleSet: {},
        hasSalary: 0, noSalary: 0,
      });
    }

    const emp = employers.get(normalized);
    emp.total++;

    // Use explicit city column if available, otherwise extract from location
    const cityVal = city || extractCity(location);
    const key = `${normalizeTitle(title)}|${cityVal}`;
    emp.roleCounts[key] = (emp.roleCounts[key] || 0) + 1;
    if (title) emp.titleSet[normalizeTitle(title)] = true;

    if (hasSalary) emp.hasSalary++;
    else emp.noSalary++;
  }

  console.log(`  Read ${lineCount.toLocaleString()} rows (${skipped} skipped, no company name)`);
  return { lineCount, skipped };
}

// --- Stream a single LDJSON file and aggregate into employers map ---

async function streamLDJSON(filePath, employers) {
  console.log(`\nStreaming LDJSON: ${filePath}`);

  let lineCount = 0;
  let skipped = 0;
  let parseErrors = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      parseErrors++;
      continue;
    }

    lineCount++;
    if (lineCount % 200000 === 0) {
      console.log(`  ${(lineCount / 1000).toFixed(0)}K rows... ${employers.size} employers`);
    }

    const companyName = resolveLdjsonField(obj, 'company');
    const title = resolveLdjsonField(obj, 'title');
    const location = resolveLdjsonField(obj, 'location');
    const city = resolveLdjsonField(obj, 'city');
    const industry = resolveLdjsonField(obj, 'industry');

    const salaryMin = resolveLdjsonField(obj, 'salaryMin');
    const salaryMax = resolveLdjsonField(obj, 'salaryMax');
    const salaryGeneric = resolveLdjsonField(obj, 'salary');
    const hasSalary = hasSalaryValue(salaryMin) || hasSalaryValue(salaryMax) || hasSalaryValue(salaryGeneric);

    if (!companyName) { skipped++; continue; }
    const normalized = normalizeCompany(companyName);
    if (!normalized || !isValidCompanyName(normalized, companyName)) { skipped++; continue; }

    if (!employers.has(normalized)) {
      employers.set(normalized, {
        nameRaw: companyName, industry: industry || null,
        total: 0, roleCounts: {}, titleSet: {},
        hasSalary: 0, noSalary: 0,
      });
    }

    const emp = employers.get(normalized);
    emp.total++;

    const cityVal = city || extractCity(location);
    const key = `${normalizeTitle(title)}|${cityVal}`;
    emp.roleCounts[key] = (emp.roleCounts[key] || 0) + 1;
    if (title) emp.titleSet[normalizeTitle(title)] = true;

    if (hasSalary) emp.hasSalary++;
    else emp.noSalary++;
  }

  console.log(`  Read ${lineCount.toLocaleString()} rows (${skipped} skipped, ${parseErrors} parse errors)`);
  return { lineCount, skipped };
}

// --- Main ---

async function main() {
  console.log('=== Skip This Job - Kaggle Seeder (multi-dataset, streaming) ===\n');

  // Find all CSV and LDJSON files across archive folders
  const dataFiles = findDataFiles(dataDir);
  if (dataFiles.length === 0) {
    console.error('No CSV or LDJSON files found in', dataDir);
    process.exit(1);
  }
  console.log(`Found ${dataFiles.length} data file(s):`);
  dataFiles.forEach(f => console.log(`  ${f}`));

  // Aggregate all files into a single employers map
  const employers = new Map();
  let totalRows = 0;

  for (const file of dataFiles) {
    const isLdjson = file.toLowerCase().endsWith('.ldjson');
    const { lineCount } = isLdjson
      ? await streamLDJSON(file, employers)
      : await streamCSV(file, employers);
    totalRows += lineCount;
  }

  console.log(`\n=== Totals: ${totalRows.toLocaleString()} rows across ${dataFiles.length} files, ${employers.size.toLocaleString()} unique employers ===\n`);

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
        new_listings: emp.total,
        industry: emp.industry,
        is_high_turnover_industry: htRatio > 0.5,
      });
    }
  }

  scored.sort((a, b) => b.ghost_score - a.ghost_score);

  console.log(`Scored ${scored.length.toLocaleString()} employers (with ghost_score >= 10)\n`);
  console.log('Top 20 worst offenders:');
  scored.slice(0, 20).forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.name_raw} — ${e.ghost_score}/100 (${e.new_listings} listings)`);
  });

  console.log(`\nDistribution:`);
  console.log(`  Very High (75+):  ${scored.filter(e => e.ghost_score >= 75).length}`);
  console.log(`  High (50-74):     ${scored.filter(e => e.ghost_score >= 50 && e.ghost_score < 75).length}`);
  console.log(`  Moderate (25-49): ${scored.filter(e => e.ghost_score >= 25 && e.ghost_score < 50).length}`);
  console.log(`  Low (10-24):      ${scored.filter(e => e.ghost_score >= 10 && e.ghost_score < 25).length}`);

  // Fetch existing employer listing counts so we can increment
  console.log(`\nFetching existing employers from Supabase for merge...`);
  const existingCounts = new Map();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('employers')
      .select('name_normalized, total_listings_tracked')
      .range(from, from + PAGE - 1);
    if (error) { console.error('  Error fetching existing:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      existingCounts.set(row.name_normalized, row.total_listings_tracked || 0);
    }
    from += data.length;
    if (data.length < PAGE) break;
  }
  console.log(`  Found ${existingCounts.size.toLocaleString()} existing employers in DB.`);

  // Build upsert rows with incremented counts
  const upsertRows = scored.map(e => ({
    name_raw: e.name_raw,
    name_normalized: e.name_normalized,
    ghost_score: e.ghost_score,
    ghost_label: e.ghost_label,
    total_listings_tracked: (existingCounts.get(e.name_normalized) || 0) + e.new_listings,
    industry: e.industry,
    is_high_turnover_industry: e.is_high_turnover_industry,
  }));

  // Upload
  console.log(`\nUploading ${upsertRows.length.toLocaleString()} employers to Supabase...`);
  let uploaded = 0, errs = 0;

  for (let i = 0; i < upsertRows.length; i += 100) {
    const batch = upsertRows.slice(i, i + 100);
    const { error } = await supabase
      .from('employers')
      .upsert(batch, { onConflict: 'name_normalized', ignoreDuplicates: false });

    if (error) { console.error(`  Error at batch ${i}:`, error.message); errs++; }
    else uploaded += batch.length;

    if (i % 1000 === 0 && i > 0) console.log(`  ${uploaded} / ${upsertRows.length}`);
  }

  console.log(`\n=== Done === Uploaded: ${uploaded} | Errors: ${errs}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
