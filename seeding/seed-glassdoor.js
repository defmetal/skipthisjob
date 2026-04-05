// ============================================================
// Glassdoor Enrichment Seed Script
// ============================================================
// Updates employer records in Supabase with Glassdoor ratings.
// Run: SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node seeding/seed-glassdoor.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Glassdoor data compiled from glassdoor.com reviews pages
// Format: [name_normalized, rating, review_count, glassdoor_url, company_size, industry]
const GLASSDOOR_DATA = [
  // Big Tech
  ['amazon', 3.6, 207277, 'https://www.glassdoor.com/Reviews/Amazon-Reviews-E6036.htm', '10001+', 'Information Technology'],
  ['google', 4.3, 50000, 'https://www.glassdoor.com/Reviews/Google-Reviews-E9079.htm', '10001+', 'Information Technology'],
  ['meta', 3.9, 15000, 'https://www.glassdoor.com/Reviews/Meta-Reviews-E40772.htm', '10001+', 'Information Technology'],
  ['apple', 4.0, 25000, 'https://www.glassdoor.com/Reviews/Apple-Reviews-E1138.htm', '10001+', 'Information Technology'],
  ['microsoft', 4.2, 60000, 'https://www.glassdoor.com/Reviews/Microsoft-Reviews-E1651.htm', '10001+', 'Information Technology'],
  ['salesforce', 4.0, 18000, 'https://www.glassdoor.com/Reviews/Salesforce-Reviews-E11159.htm', '10001+', 'Information Technology'],
  ['oracle', 3.7, 35000, 'https://www.glassdoor.com/Reviews/Oracle-Reviews-E1737.htm', '10001+', 'Information Technology'],
  ['ibm', 3.9, 50000, 'https://www.glassdoor.com/Reviews/IBM-Reviews-E354.htm', '10001+', 'Information Technology'],
  ['cisco', 4.2, 15000, 'https://www.glassdoor.com/Reviews/Cisco-Systems-Reviews-E1425.htm', '10001+', 'Information Technology'],
  ['intel', 3.9, 20000, 'https://www.glassdoor.com/Reviews/Intel-Corporation-Reviews-E1519.htm', '10001+', 'Information Technology'],

  // Consulting / Professional Services
  ['deloitte', 3.8, 113074, 'https://www.glassdoor.com/Reviews/Deloitte-Reviews-E2763.htm', '10001+', 'Management & Consulting'],
  ['accenture', 3.7, 175492, 'https://www.glassdoor.com/Reviews/Accenture-Reviews-E4138.htm', '10001+', 'Management & Consulting'],
  ['ey', 3.8, 50000, 'https://www.glassdoor.com/Reviews/EY-Reviews-E2784.htm', '10001+', 'Management & Consulting'],
  ['ernst & young', 3.8, 50000, 'https://www.glassdoor.com/Reviews/EY-Reviews-E2784.htm', '10001+', 'Management & Consulting'],
  ['kpmg', 3.7, 35000, 'https://www.glassdoor.com/Reviews/KPMG-Reviews-E2867.htm', '10001+', 'Management & Consulting'],
  ['pwc', 3.8, 60000, 'https://www.glassdoor.com/Reviews/PwC-Reviews-E8450.htm', '10001+', 'Management & Consulting'],
  ['pricewaterhousecoopers', 3.8, 60000, 'https://www.glassdoor.com/Reviews/PwC-Reviews-E8450.htm', '10001+', 'Management & Consulting'],
  ['mckinsey', 4.0, 10000, 'https://www.glassdoor.com/Reviews/McKinsey-and-Company-Reviews-E2893.htm', '10001+', 'Management & Consulting'],
  ['booz allen hamilton', 3.7, 10000, 'https://www.glassdoor.com/Reviews/Booz-Allen-Hamilton-Reviews-E12.htm', '10001+', 'Management & Consulting'],
  ['capgemini', 3.7, 30000, 'https://www.glassdoor.com/Reviews/Capgemini-Reviews-E3738.htm', '10001+', 'Management & Consulting'],
  ['cognizant', 3.6, 80000, 'https://www.glassdoor.com/Reviews/Cognizant-Technology-Solutions-Reviews-E8014.htm', '10001+', 'Information Technology'],
  ['infosys', 3.6, 60000, 'https://www.glassdoor.com/Reviews/Infosys-Reviews-E7927.htm', '10001+', 'Information Technology'],
  ['wipro', 3.5, 50000, 'https://www.glassdoor.com/Reviews/Wipro-Reviews-E9936.htm', '10001+', 'Information Technology'],
  ['tata consultancy', 3.6, 70000, 'https://www.glassdoor.com/Reviews/Tata-Consultancy-Services-Reviews-E13461.htm', '10001+', 'Information Technology'],

  // Finance
  ['jpmorgan chase', 3.8, 50000, 'https://www.glassdoor.com/Reviews/JPMorgan-Chase-Reviews-E145.htm', '10001+', 'Financial Services'],
  ['jpmorgan', 3.8, 50000, 'https://www.glassdoor.com/Reviews/JPMorgan-Chase-Reviews-E145.htm', '10001+', 'Financial Services'],
  ['wells fargo', 3.5, 40000, 'https://www.glassdoor.com/Reviews/Wells-Fargo-Reviews-E8876.htm', '10001+', 'Financial Services'],
  ['bank of america', 3.7, 40000, 'https://www.glassdoor.com/Reviews/Bank-of-America-Reviews-E8874.htm', '10001+', 'Financial Services'],
  ['goldman sachs', 3.8, 15000, 'https://www.glassdoor.com/Reviews/Goldman-Sachs-Reviews-E2800.htm', '10001+', 'Financial Services'],
  ['morgan stanley', 3.8, 15000, 'https://www.glassdoor.com/Reviews/Morgan-Stanley-Reviews-E2282.htm', '10001+', 'Financial Services'],
  ['citigroup', 3.6, 30000, 'https://www.glassdoor.com/Reviews/Citi-Reviews-E8843.htm', '10001+', 'Financial Services'],
  ['citi', 3.6, 30000, 'https://www.glassdoor.com/Reviews/Citi-Reviews-E8843.htm', '10001+', 'Financial Services'],
  ['capital one', 3.9, 20000, 'https://www.glassdoor.com/Reviews/Capital-One-Reviews-E3736.htm', '10001+', 'Financial Services'],

  // Retail / Consumer
  ['walmart', 3.4, 141028, 'https://www.glassdoor.com/Reviews/Walmart-Reviews-E715.htm', '10001+', 'Retail & Wholesale'],
  ['target', 3.4, 50000, 'https://www.glassdoor.com/Reviews/Target-Reviews-E194.htm', '10001+', 'Retail & Wholesale'],
  ['costco', 3.9, 15000, 'https://www.glassdoor.com/Reviews/Costco-Wholesale-Reviews-E2590.htm', '10001+', 'Retail & Wholesale'],

  // Healthcare / Insurance
  ['unitedhealth', 3.5, 30000, 'https://www.glassdoor.com/Reviews/UnitedHealth-Group-Reviews-E1456.htm', '10001+', 'Healthcare'],
  ['cvs health', 3.1, 50000, 'https://www.glassdoor.com/Reviews/CVS-Health-Reviews-E2938.htm', '10001+', 'Healthcare'],
  ['cvs', 3.1, 50000, 'https://www.glassdoor.com/Reviews/CVS-Health-Reviews-E2938.htm', '10001+', 'Healthcare'],
  ['humana', 3.5, 15000, 'https://www.glassdoor.com/Reviews/Humana-Reviews-E5005.htm', '10001+', 'Healthcare'],
  ['anthem', 3.3, 10000, 'https://www.glassdoor.com/Reviews/Anthem-Reviews-E8433.htm', '10001+', 'Healthcare'],
  ['kaiser permanente', 3.8, 20000, 'https://www.glassdoor.com/Reviews/Kaiser-Permanente-Reviews-E19466.htm', '10001+', 'Healthcare'],

  // Logistics
  ['fedex', 3.3, 50000, 'https://www.glassdoor.com/Reviews/FedEx-Reviews-E544.htm', '10001+', 'Transportation & Logistics'],
  ['ups', 3.5, 40000, 'https://www.glassdoor.com/Reviews/UPS-Reviews-E3012.htm', '10001+', 'Transportation & Logistics'],

  // Staffing Agencies (important for ghost job detection)
  ['robert half', 3.5, 15000, 'https://www.glassdoor.com/Reviews/Robert-Half-Reviews-E2710.htm', '10001+', 'Staffing & Outsourcing'],
  ['insight global', 3.8, 5000, 'https://www.glassdoor.com/Reviews/Insight-Global-Reviews-E326753.htm', '5001-10000', 'Staffing & Outsourcing'],
  ['kforce', 3.5, 3000, 'https://www.glassdoor.com/Reviews/Kforce-Reviews-E1734.htm', '5001-10000', 'Staffing & Outsourcing'],
  ['teksystems', 3.5, 8000, 'https://www.glassdoor.com/Reviews/TEKsystems-Reviews-E12352.htm', '10001+', 'Staffing & Outsourcing'],
  ['tek systems', 3.5, 8000, 'https://www.glassdoor.com/Reviews/TEKsystems-Reviews-E12352.htm', '10001+', 'Staffing & Outsourcing'],
  ['randstad', 3.6, 20000, 'https://www.glassdoor.com/Reviews/Randstad-Reviews-E2636.htm', '10001+', 'Staffing & Outsourcing'],
  ['manpower', 3.3, 10000, 'https://www.glassdoor.com/Reviews/Manpower-Reviews-E607.htm', '10001+', 'Staffing & Outsourcing'],
  ['adecco', 3.4, 15000, 'https://www.glassdoor.com/Reviews/Adecco-Reviews-E4116.htm', '10001+', 'Staffing & Outsourcing'],
  ['kelly services', 3.5, 5000, 'https://www.glassdoor.com/Reviews/Kelly-Services-Reviews-E2826.htm', '10001+', 'Staffing & Outsourcing'],
  ['apex systems', 3.3, 5000, 'https://www.glassdoor.com/Reviews/Apex-Systems-Reviews-E69810.htm', '5001-10000', 'Staffing & Outsourcing'],
  ['aerotek', 3.3, 10000, 'https://www.glassdoor.com/Reviews/Aerotek-Reviews-E7842.htm', '10001+', 'Staffing & Outsourcing'],
  ['hays', 3.6, 10000, 'https://www.glassdoor.com/Reviews/Hays-Reviews-E10458.htm', '10001+', 'Staffing & Outsourcing'],
  ['cybercoders', 3.2, 2000, 'https://www.glassdoor.com/Reviews/CyberCoders-Reviews-E46982.htm', '1001-5000', 'Staffing & Outsourcing'],
  ['crossover', 2.8, 1500, 'https://www.glassdoor.com/Reviews/Crossover-Reviews-E782267.htm', '1001-5000', 'Staffing & Outsourcing'],

  // Known ghost job offenders / BPO
  ['conduent', 2.7, 8000, 'https://www.glassdoor.com/Reviews/Conduent-Reviews-E1513498.htm', '10001+', 'Information Technology'],
  ['teleperformance', 3.1, 30000, 'https://www.glassdoor.com/Reviews/Teleperformance-Reviews-E5765.htm', '10001+', 'Call Center / Customer Service'],
  ['concentrix', 3.2, 20000, 'https://www.glassdoor.com/Reviews/Concentrix-Reviews-E139285.htm', '10001+', 'Call Center / Customer Service'],
  ['alorica', 3.1, 10000, 'https://www.glassdoor.com/Reviews/Alorica-Reviews-E45519.htm', '10001+', 'Call Center / Customer Service'],
  ['ttec', 3.2, 5000, 'https://www.glassdoor.com/Reviews/TTEC-Reviews-E14281.htm', '10001+', 'Call Center / Customer Service'],

  // Defense / Government contractors
  ['lockheed martin', 4.0, 15000, 'https://www.glassdoor.com/Reviews/Lockheed-Martin-Reviews-E404.htm', '10001+', 'Aerospace & Defense'],
  ['raytheon', 3.8, 10000, 'https://www.glassdoor.com/Reviews/RTX-Reviews-E456.htm', '10001+', 'Aerospace & Defense'],
  ['northrop grumman', 3.9, 10000, 'https://www.glassdoor.com/Reviews/Northrop-Grumman-Reviews-E488.htm', '10001+', 'Aerospace & Defense'],
  ['general dynamics', 3.8, 5000, 'https://www.glassdoor.com/Reviews/General-Dynamics-Reviews-E486.htm', '10001+', 'Aerospace & Defense'],
  ['leidos', 3.7, 5000, 'https://www.glassdoor.com/Reviews/Leidos-Reviews-E9690.htm', '10001+', 'Information Technology'],
  ['saic', 3.5, 5000, 'https://www.glassdoor.com/Reviews/SAIC-Reviews-E3657.htm', '10001+', 'Information Technology'],
  ['cgi', 3.6, 10000, 'https://www.glassdoor.com/Reviews/CGI-Reviews-E8037.htm', '10001+', 'Information Technology'],
  
  // Telecom
  ['at&t', 3.5, 30000, 'https://www.glassdoor.com/Reviews/AT-and-T-Reviews-E136.htm', '10001+', 'Telecommunications'],
  ['verizon', 3.6, 25000, 'https://www.glassdoor.com/Reviews/Verizon-Reviews-E2173.htm', '10001+', 'Telecommunications'],
  ['t-mobile', 3.8, 15000, 'https://www.glassdoor.com/Reviews/T-Mobile-Reviews-E9302.htm', '10001+', 'Telecommunications'],
  ['comcast', 3.2, 15000, 'https://www.glassdoor.com/Reviews/Comcast-Reviews-E419.htm', '10001+', 'Telecommunications'],
];

async function seedGlassdoor() {
  console.log(`Enriching ${GLASSDOOR_DATA.length} employers with Glassdoor data...\n`);

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const [name, rating, reviewCount, url, size, industry] of GLASSDOOR_DATA) {
    // Find employer using same strategy as API: exact → fuzzy contains → first-word exact
    let employer = null;

    // 1. Exact match on name_normalized
    const { data: exact } = await supabase
      .from('employers')
      .select('id, name_raw, name_normalized, glassdoor_rating')
      .eq('name_normalized', name)
      .single();

    if (exact) {
      employer = exact;
    } else {
      // 2. Fuzzy: DB name contains our search term
      const { data: fuzzy1 } = await supabase
        .from('employers')
        .select('id, name_raw, name_normalized, glassdoor_rating')
        .ilike('name_normalized', `%${name}%`)
        .order('total_listings_tracked', { ascending: false })
        .limit(1);

      if (fuzzy1 && fuzzy1.length > 0) {
        employer = fuzzy1[0];
      } else {
        // 3. First-word exact match (core brand name)
        const coreName = name.split(' ')[0];
        if (coreName && coreName.length >= 3) {
          const { data: fuzzy2 } = await supabase
            .from('employers')
            .select('id, name_raw, name_normalized, glassdoor_rating')
            .eq('name_normalized', coreName)
            .single();

          if (fuzzy2) {
            employer = fuzzy2;
          }
        }
      }
    }

    if (!employer) {
      console.log(`  ✗ Not found: "${name}"`);
      notFound++;
      continue;
    }

    // Log name mapping when fuzzy match found a different normalized name
    if (employer.name_normalized !== name) {
      console.log(`  ℹ Mapped "${name}" → DB name: "${employer.name_normalized}" (${employer.name_raw})`);
    }

    // Update with Glassdoor data
    const { error: updateError } = await supabase
      .from('employers')
      .update({
        glassdoor_rating: rating,
        glassdoor_review_count: reviewCount,
        glassdoor_url: url,
        company_size: size,
        industry: industry,
        is_high_turnover_industry: [
          'Staffing & Outsourcing',
          'Call Center / Customer Service',
          'Retail & Wholesale',
          'Transportation & Logistics',
        ].includes(industry),
      })
      .eq('id', employer.id);

    if (updateError) {
      console.log(`  ✗ Error updating "${name}": ${updateError.message}`);
      errors++;
    } else {
      const prev = employer.glassdoor_rating ? ` (was ${employer.glassdoor_rating})` : '';
      console.log(`  ✓ ${employer.name_raw} → ${rating}/5 (${reviewCount.toLocaleString()} reviews)${prev}`);
      updated++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${notFound} not found, ${errors} errors`);
}

seedGlassdoor().catch(console.error);
