/**
 * clean-corrupted-employers.js
 *
 * Deletes employer records where name_normalized is longer than 100 characters
 * or contains job description text (corrupted rows from Kaggle CSV import).
 *
 * Usage:
 *   export SUPABASE_URL=https://xxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=xxx
 *   node seeding/clean-corrupted-employers.js
 *
 * Add --dry-run to preview without deleting.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

// Job description phrases that should never appear in a company name
const DESCRIPTION_PHRASES = [
  'ability to',
  'communication',
  'point of sale',
  'responsible for',
  'requirements',
  'qualifications',
  'experience with',
  'must have',
  'preferred',
  'bachelor',
  'knowledge of',
  'working knowledge',
  'team environment',
  'fast-paced',
  'detail-oriented',
  'self-starter',
  'problem solving',
  'customer service',
  'work independently',
  'strong analytical',
  'excellent written',
  'years of experience',
  'job description',
  'duties include',
  'we are looking',
  'the ideal candidate',
  'equal opportunity',
  'competitive salary',
  'benefits package',
  'full-time',
  'part-time',
];

async function main() {
  console.log(`=== Skip This Job - Corrupted Employer Cleanup ===`);
  if (DRY_RUN) console.log('*** DRY RUN — no records will be deleted ***\n');

  // Build the OR filter: length > 100 OR contains any description phrase
  // Supabase JS doesn't support length() filters directly, so we use RPC/raw SQL
  // We'll use multiple queries: one for long names, one per phrase pattern

  const corruptedIds = new Set();

  // 1. Find employers with name_normalized longer than 100 chars
  //    We fetch all and filter client-side since Supabase JS lacks length filter
  console.log('Scanning for name_normalized > 100 characters...');
  let page = 0;
  const PAGE_SIZE = 1000;
  let longCount = 0;

  while (true) {
    const { data, error } = await supabase
      .from('employers')
      .select('id, name_normalized, name_raw')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error('Error fetching employers:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) break;

    for (const emp of data) {
      if (emp.name_normalized && emp.name_normalized.length > 100) {
        corruptedIds.add(emp.id);
        longCount++;
      }
    }

    page++;
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  Found ${longCount} with length > 100`);

  // 2. Find employers containing description phrases via ilike
  console.log('Scanning for job description text in name_normalized...');
  let phraseCount = 0;

  for (const phrase of DESCRIPTION_PHRASES) {
    const { data, error } = await supabase
      .from('employers')
      .select('id, name_normalized')
      .ilike('name_normalized', `%${phrase}%`);

    if (error) {
      console.error(`Error searching for "${phrase}":`, error.message);
      continue;
    }

    if (data && data.length > 0) {
      const newFinds = data.filter(e => !corruptedIds.has(e.id));
      for (const emp of data) corruptedIds.add(emp.id);
      if (newFinds.length > 0) {
        phraseCount += newFinds.length;
        console.log(`  "${phrase}" → ${data.length} matches (${newFinds.length} new)`);
      }
    }
  }
  console.log(`  Found ${phraseCount} additional via phrase matching`);

  const totalCorrupted = corruptedIds.size;
  console.log(`\nTotal corrupted employers to delete: ${totalCorrupted}`);

  if (totalCorrupted === 0) {
    console.log('Nothing to clean up!');
    return;
  }

  // Print some examples
  const ids = Array.from(corruptedIds);
  const { data: examples } = await supabase
    .from('employers')
    .select('id, name_normalized')
    .in('id', ids.slice(0, 10));

  if (examples) {
    console.log('\nExamples of corrupted records:');
    for (const e of examples) {
      const display = e.name_normalized.length > 80
        ? e.name_normalized.substring(0, 80) + '...'
        : e.name_normalized;
      console.log(`  [${e.name_normalized.length} chars] "${display}"`);
    }
  }

  if (DRY_RUN) {
    console.log('\n*** DRY RUN complete. Re-run without --dry-run to delete. ***');
    return;
  }

  // Delete in batches, child tables first due to foreign keys
  console.log('\nDeleting corrupted records...');
  const BATCH_SIZE = 100;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    // Delete from child tables first
    const { error: e1 } = await supabase
      .from('employer_score_log')
      .delete()
      .in('employer_id', batch);
    if (e1) console.error('  employer_score_log error:', e1.message);

    const { error: e2 } = await supabase
      .from('community_reports')
      .delete()
      .in('employer_id', batch);
    if (e2) console.error('  community_reports error:', e2.message);

    const { error: e3 } = await supabase
      .from('repost_patterns')
      .delete()
      .in('employer_id', batch);
    if (e3) console.error('  repost_patterns error:', e3.message);

    const { error: e4 } = await supabase
      .from('listings')
      .delete()
      .in('employer_id', batch);
    if (e4) console.error('  listings error:', e4.message);

    // Now delete the employers
    const { error: e5 } = await supabase
      .from('employers')
      .delete()
      .in('id', batch);
    if (e5) console.error('  employers error:', e5.message);

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= ids.length) {
      console.log(`  Deleted ${Math.min(i + BATCH_SIZE, ids.length)} / ${ids.length}`);
    }
  }

  console.log(`\n=== Done === Deleted ${totalCorrupted} corrupted employer records.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
