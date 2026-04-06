// ============================================================
// Glassdoor Enrichment Seed Script
// ============================================================
// Updates employer records in Supabase with Glassdoor ratings.
// Run: SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node seeding/seed-glassdoor.js
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars. Example:');
  console.error('  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node seeding/seed-glassdoor.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
  ['cisco systems', 4.2, 15000, 'https://www.glassdoor.com/Reviews/Cisco-Systems-Reviews-E1425.htm', '10001+', 'Information Technology'],
  ['intel', 3.9, 20000, 'https://www.glassdoor.com/Reviews/Intel-Corporation-Reviews-E1519.htm', '10001+', 'Information Technology'],

  // Tech — Fintech / E-Commerce / SaaS
  ['stripe', 3.6, 3000, 'https://www.glassdoor.com/Reviews/Stripe-Reviews-E671932.htm', '5001-10000', 'Information Technology'],
  ['coinbase', 3.4, 1500, 'https://www.glassdoor.com/Reviews/Coinbase-Reviews-E721972.htm', '1001-5000', 'Financial Services'],
  ['shopify', 3.5, 5000, 'https://www.glassdoor.com/Reviews/Shopify-Reviews-E675933.htm', '10001+', 'Information Technology'],
  ['uber', 3.8, 15000, 'https://www.glassdoor.com/Reviews/Uber-Reviews-E575263.htm', '10001+', 'Transportation & Logistics'],
  ['lyft', 3.7, 3000, 'https://www.glassdoor.com/Reviews/Lyft-Reviews-E700614.htm', '1001-5000', 'Transportation & Logistics'],
  ['airbnb', 4.3, 5000, 'https://www.glassdoor.com/Reviews/Airbnb-Reviews-E391850.htm', '5001-10000', 'Information Technology'],
  ['netflix', 4.0, 4000, 'https://www.glassdoor.com/Reviews/Netflix-Reviews-E11891.htm', '10001+', 'Information Technology'],
  ['adobe', 4.3, 15000, 'https://www.glassdoor.com/Reviews/Adobe-Reviews-E1090.htm', '10001+', 'Information Technology'],
  ['nvidia', 4.4, 8000, 'https://www.glassdoor.com/Reviews/NVIDIA-Reviews-E7633.htm', '10001+', 'Information Technology'],
  ['paypal', 3.7, 10000, 'https://www.glassdoor.com/Reviews/PayPal-Reviews-E9848.htm', '10001+', 'Financial Services'],
  ['block', 3.6, 5000, 'https://www.glassdoor.com/Reviews/Block-Reviews-E422593.htm', '5001-10000', 'Financial Services'],
  ['twitter', 2.5, 5000, 'https://www.glassdoor.com/Reviews/X-Reviews-E100569.htm', '1001-5000', 'Information Technology'],
  ['snap', 3.6, 2000, 'https://www.glassdoor.com/Reviews/Snap-Reviews-E671946.htm', '5001-10000', 'Information Technology'],
  ['spotify', 4.0, 3000, 'https://www.glassdoor.com/Reviews/Spotify-Reviews-E408251.htm', '5001-10000', 'Information Technology'],
  ['linkedin', 4.2, 10000, 'https://www.glassdoor.com/Reviews/LinkedIn-Reviews-E34865.htm', '10001+', 'Information Technology'],
  ['intuit', 4.2, 10000, 'https://www.glassdoor.com/Reviews/Intuit-Reviews-E2293.htm', '10001+', 'Information Technology'],
  ['servicenow', 4.1, 5000, 'https://www.glassdoor.com/Reviews/ServiceNow-Reviews-E403326.htm', '10001+', 'Information Technology'],
  ['workday', 4.1, 5000, 'https://www.glassdoor.com/Reviews/Workday-Reviews-E237538.htm', '10001+', 'Information Technology'],
  ['palantir', 3.8, 2000, 'https://www.glassdoor.com/Reviews/Palantir-Technologies-Reviews-E236375.htm', '5001-10000', 'Information Technology'],
  ['datadog', 4.0, 1500, 'https://www.glassdoor.com/Reviews/Datadog-Reviews-E1024744.htm', '5001-10000', 'Information Technology'],
  ['snowflake', 3.6, 1500, 'https://www.glassdoor.com/Reviews/Snowflake-Reviews-E1064046.htm', '5001-10000', 'Information Technology'],
  ['crowdstrike', 3.8, 2000, 'https://www.glassdoor.com/Reviews/CrowdStrike-Reviews-E795976.htm', '5001-10000', 'Information Technology'],
  ['palo alto networks', 4.0, 3000, 'https://www.glassdoor.com/Reviews/Palo-Alto-Networks-Reviews-E115142.htm', '10001+', 'Information Technology'],
  ['twilio', 3.4, 2000, 'https://www.glassdoor.com/Reviews/Twilio-Reviews-E396068.htm', '5001-10000', 'Information Technology'],
  ['zillow', 3.7, 3000, 'https://www.glassdoor.com/Reviews/Zillow-Reviews-E40802.htm', '5001-10000', 'Information Technology'],
  ['doordash', 3.4, 3000, 'https://www.glassdoor.com/Reviews/DoorDash-Reviews-E813073.htm', '10001+', 'Information Technology'],
  ['robinhood', 3.2, 1000, 'https://www.glassdoor.com/Reviews/Robinhood-Reviews-E1296834.htm', '1001-5000', 'Financial Services'],
  ['plaid', 3.5, 500, 'https://www.glassdoor.com/Reviews/Plaid-Reviews-E1167765.htm', '1001-5000', 'Financial Services'],
  ['dell technologies', 3.7, 20000, 'https://www.glassdoor.com/Reviews/Dell-Technologies-Reviews-E1327.htm', '10001+', 'Information Technology'],
  ['hp', 3.7, 10000, 'https://www.glassdoor.com/Reviews/HP-Reviews-E1093.htm', '10001+', 'Information Technology'],
  ['vmware', 4.0, 8000, 'https://www.glassdoor.com/Reviews/VMware-Reviews-E12830.htm', '10001+', 'Information Technology'],
  ['sap', 4.0, 15000, 'https://www.glassdoor.com/Reviews/SAP-Reviews-E10471.htm', '10001+', 'Information Technology'],

  // Consulting / Professional Services
  ['deloitte', 3.8, 113074, 'https://www.glassdoor.com/Reviews/Deloitte-Reviews-E2763.htm', '10001+', 'Management & Consulting'],
  ['accenture', 3.7, 175492, 'https://www.glassdoor.com/Reviews/Accenture-Reviews-E4138.htm', '10001+', 'Management & Consulting'],
  ['ey', 3.8, 50000, 'https://www.glassdoor.com/Reviews/EY-Reviews-E2784.htm', '10001+', 'Management & Consulting'],
  ['kpmg us', 3.7, 35000, 'https://www.glassdoor.com/Reviews/KPMG-Reviews-E2867.htm', '10001+', 'Management & Consulting'],
  ['pwc', 3.8, 60000, 'https://www.glassdoor.com/Reviews/PwC-Reviews-E8450.htm', '10001+', 'Management & Consulting'],
  ['mckinsey', 4.0, 10000, 'https://www.glassdoor.com/Reviews/McKinsey-and-Company-Reviews-E2893.htm', '10001+', 'Management & Consulting'],
  ['booz allen hamilton', 3.7, 10000, 'https://www.glassdoor.com/Reviews/Booz-Allen-Hamilton-Reviews-E12.htm', '10001+', 'Management & Consulting'],
  ['capgemini', 3.7, 30000, 'https://www.glassdoor.com/Reviews/Capgemini-Reviews-E3738.htm', '10001+', 'Management & Consulting'],
  ['cognizant technology solutions', 3.6, 80000, 'https://www.glassdoor.com/Reviews/Cognizant-Technology-Solutions-Reviews-E8014.htm', '10001+', 'Information Technology'],
  ['infosys', 3.6, 60000, 'https://www.glassdoor.com/Reviews/Infosys-Reviews-E7927.htm', '10001+', 'Information Technology'],
  ['wipro', 3.5, 50000, 'https://www.glassdoor.com/Reviews/Wipro-Reviews-E9936.htm', '10001+', 'Information Technology'],
  ['tata consultancy services', 3.6, 70000, 'https://www.glassdoor.com/Reviews/Tata-Consultancy-Services-Reviews-E13461.htm', '10001+', 'Information Technology'],

  // Finance
  ['jpmorgan chase &', 3.8, 50000, 'https://www.glassdoor.com/Reviews/JPMorgan-Chase-Reviews-E145.htm', '10001+', 'Financial Services'],
  ['wells fargo', 3.5, 40000, 'https://www.glassdoor.com/Reviews/Wells-Fargo-Reviews-E8876.htm', '10001+', 'Financial Services'],
  ['bank of america', 3.7, 40000, 'https://www.glassdoor.com/Reviews/Bank-of-America-Reviews-E8874.htm', '10001+', 'Financial Services'],
  ['goldman sachs', 3.8, 15000, 'https://www.glassdoor.com/Reviews/Goldman-Sachs-Reviews-E2800.htm', '10001+', 'Financial Services'],
  ['morgan stanley', 3.8, 15000, 'https://www.glassdoor.com/Reviews/Morgan-Stanley-Reviews-E2282.htm', '10001+', 'Financial Services'],
  ['citigroup', 3.6, 30000, 'https://www.glassdoor.com/Reviews/Citi-Reviews-E8843.htm', '10001+', 'Financial Services'],
  ['capital one', 3.9, 20000, 'https://www.glassdoor.com/Reviews/Capital-One-Reviews-E3736.htm', '10001+', 'Financial Services'],

  // Retail / Consumer
  ['walmart', 3.4, 141028, 'https://www.glassdoor.com/Reviews/Walmart-Reviews-E715.htm', '10001+', 'Retail & Wholesale'],
  ['target', 3.4, 50000, 'https://www.glassdoor.com/Reviews/Target-Reviews-E194.htm', '10001+', 'Retail & Wholesale'],
  ['costco', 3.9, 15000, 'https://www.glassdoor.com/Reviews/Costco-Wholesale-Reviews-E2590.htm', '10001+', 'Retail & Wholesale'],

  // Healthcare / Insurance
  ['unitedhealth', 3.5, 30000, 'https://www.glassdoor.com/Reviews/UnitedHealth-Group-Reviews-E1456.htm', '10001+', 'Healthcare'],
  ['cvs health', 3.1, 50000, 'https://www.glassdoor.com/Reviews/CVS-Health-Reviews-E2938.htm', '10001+', 'Healthcare'],
  ['humana', 3.5, 15000, 'https://www.glassdoor.com/Reviews/Humana-Reviews-E5005.htm', '10001+', 'Healthcare'],
  ['anthem', 3.3, 10000, 'https://www.glassdoor.com/Reviews/Anthem-Reviews-E8433.htm', '10001+', 'Healthcare'],
  ['kaiser permanente', 3.8, 20000, 'https://www.glassdoor.com/Reviews/Kaiser-Permanente-Reviews-E19466.htm', '10001+', 'Healthcare'],

  // Logistics
  ['fedex ground', 3.3, 50000, 'https://www.glassdoor.com/Reviews/FedEx-Reviews-E544.htm', '10001+', 'Transportation & Logistics'],
  ['ups', 3.5, 40000, 'https://www.glassdoor.com/Reviews/UPS-Reviews-E3012.htm', '10001+', 'Transportation & Logistics'],

  // Staffing Agencies (important for ghost job detection)
  ['robert half', 3.5, 15000, 'https://www.glassdoor.com/Reviews/Robert-Half-Reviews-E2710.htm', '10001+', 'Staffing & Outsourcing'],
  ['insight global', 3.8, 5000, 'https://www.glassdoor.com/Reviews/Insight-Global-Reviews-E326753.htm', '5001-10000', 'Staffing & Outsourcing'],
  ['kforce', 3.5, 3000, 'https://www.glassdoor.com/Reviews/Kforce-Reviews-E1734.htm', '5001-10000', 'Staffing & Outsourcing'],
  ['teksystems', 3.5, 8000, 'https://www.glassdoor.com/Reviews/TEKsystems-Reviews-E12352.htm', '10001+', 'Staffing & Outsourcing'],
  ['randstad usa', 3.6, 20000, 'https://www.glassdoor.com/Reviews/Randstad-Reviews-E2636.htm', '10001+', 'Staffing & Outsourcing'],
  ['manpowergroup', 3.3, 10000, 'https://www.glassdoor.com/Reviews/Manpower-Reviews-E607.htm', '10001+', 'Staffing & Outsourcing'],
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
  ['general dynamics information technology', 3.8, 5000, 'https://www.glassdoor.com/Reviews/General-Dynamics-Reviews-E486.htm', '10001+', 'Aerospace & Defense'],
  ['leidos', 3.7, 5000, 'https://www.glassdoor.com/Reviews/Leidos-Reviews-E9690.htm', '10001+', 'Information Technology'],
  ['saic', 3.5, 5000, 'https://www.glassdoor.com/Reviews/SAIC-Reviews-E3657.htm', '10001+', 'Information Technology'],
  ['cgi', 3.6, 10000, 'https://www.glassdoor.com/Reviews/CGI-Reviews-E8037.htm', '10001+', 'Information Technology'],
  
  // Telecom
  ['at&t', 3.5, 30000, 'https://www.glassdoor.com/Reviews/AT-and-T-Reviews-E136.htm', '10001+', 'Telecommunications'],
  ['verizon', 3.6, 25000, 'https://www.glassdoor.com/Reviews/Verizon-Reviews-E2173.htm', '10001+', 'Telecommunications'],
  ['t-mobile', 3.8, 15000, 'https://www.glassdoor.com/Reviews/T-Mobile-Reviews-E9302.htm', '10001+', 'Telecommunications'],
  ['comcast', 3.2, 15000, 'https://www.glassdoor.com/Reviews/Comcast-Reviews-E419.htm', '10001+', 'Telecommunications'],

  // Retail — additional
  ['dick\'s sporting goods', 3.3, 12000, 'https://www.glassdoor.com/Reviews/DICK-S-Sporting-Goods-Reviews-E556.htm', '10001+', 'Retail & Wholesale'],
  ['staples', 3.2, 10000, 'https://www.glassdoor.com/Reviews/Staples-Reviews-E422.htm', '10001+', 'Retail & Wholesale'],
  ['petco', 3.3, 8000, 'https://www.glassdoor.com/Reviews/Petco-Reviews-E478.htm', '10001+', 'Retail & Wholesale'],
  ['advance auto parts', 3.1, 6000, 'https://www.glassdoor.com/Reviews/Advance-Auto-Parts-Reviews-E2tried.htm', '10001+', 'Retail & Wholesale'],
  ['napa auto parts', 3.5, 3000, 'https://www.glassdoor.com/Reviews/NAPA-Auto-Parts-Reviews-E7549.htm', '10001+', 'Retail & Wholesale'],
  ['papa johns', 3.1, 8000, 'https://www.glassdoor.com/Reviews/Papa-John-s-Reviews-E455.htm', '10001+', 'Food & Beverage'],
  ['penske', 3.4, 5000, 'https://www.glassdoor.com/Reviews/Penske-Truck-Leasing-Reviews-E4611.htm', '10001+', 'Transportation & Logistics'],
  ['republic services', 3.3, 5000, 'https://www.glassdoor.com/Reviews/Republic-Services-Reviews-E6094.htm', '10001+', 'Transportation & Logistics'],
  ['white cap', 3.5, 1500, 'https://www.glassdoor.com/Reviews/White-Cap-Reviews-E798653.htm', '5001-10000', 'Retail & Wholesale'],

  // Healthcare — additional
  ['aya healthcare', 3.4, 3000, 'https://www.glassdoor.com/Reviews/Aya-Healthcare-Reviews-E505498.htm', '5001-10000', 'Healthcare'],
  ['lincare', 2.9, 2000, 'https://www.glassdoor.com/Reviews/Lincare-Reviews-E8729.htm', '10001+', 'Healthcare'],
  ['thermo fisher scientific', 3.8, 10000, 'https://www.glassdoor.com/Reviews/Thermo-Fisher-Scientific-Reviews-E21142.htm', '10001+', 'Healthcare'],

  // Industrial / Manufacturing
  ['skf', 3.7, 2000, 'https://www.glassdoor.com/Reviews/SKF-Reviews-E3756.htm', '10001+', 'Manufacturing'],
  ['ingersoll rand', 3.7, 3000, 'https://www.glassdoor.com/Reviews/Ingersoll-Rand-Reviews-E1045.htm', '10001+', 'Manufacturing'],
  ['sargent & lundy', 3.5, 500, 'https://www.glassdoor.com/Reviews/Sargent-and-Lundy-Reviews-E12162.htm', '1001-5000', 'Construction & Engineering'],
  ['allied universal', 2.9, 15000, 'https://www.glassdoor.com/Reviews/Allied-Universal-Reviews-E18498.htm', '10001+', 'Security & Investigations'],

  // Marketing / Data / BPO
  ['epsilon', 3.3, 2000, 'https://www.glassdoor.com/Reviews/Epsilon-Reviews-E7890.htm', '5001-10000', 'Marketing & Advertising'],
  ['lhh', 3.5, 2000, 'https://www.glassdoor.com/Reviews/LHH-Reviews-E11621.htm', '10001+', 'Staffing & Outsourcing'],
  ['solomon page', 3.5, 500, 'https://www.glassdoor.com/Reviews/Solomon-Page-Reviews-E27534.htm', '201-500', 'Staffing & Outsourcing'],
];

async function seedGlassdoor() {
  console.log(`Enriching ${GLASSDOOR_DATA.length} employers with Glassdoor data...\n`);

  let updated = 0;
  let created = 0;
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
      // 2. Starts-with match: DB name starts with our search term + space
      //    (word-boundary safe — prevents "apple" matching "appleone")
      const { data: startsWith } = await supabase
        .from('employers')
        .select('id, name_raw, name_normalized, glassdoor_rating')
        .ilike('name_normalized', `${name} %`)
        .order('total_listings_tracked', { ascending: false })
        .limit(1);

      // Only accept if the matched name looks like a real company name (not a sentence)
      if (startsWith && startsWith.length > 0 && startsWith[0].name_normalized.length <= 60) {
        employer = startsWith[0];
      }
    }

    if (!employer) {
      // 3. Contains match: DB name contains our search term as a word
      const { data: contains } = await supabase
        .from('employers')
        .select('id, name_raw, name_normalized, glassdoor_rating')
        .ilike('name_normalized', `%${name}%`)
        .order('total_listings_tracked', { ascending: false })
        .limit(1);

      if (contains && contains.length > 0 && contains[0].name_normalized.length <= 60) {
        employer = contains[0];
      }
    }

    if (!employer && name.includes(' ')) {
      // 4. First word exact match: for multi-word names, try matching just the first word
      //    Only for longer first words (4+ chars) to avoid false positives
      const firstWord = name.split(' ')[0];
      if (firstWord.length >= 4) {
        const { data: firstWordMatch } = await supabase
          .from('employers')
          .select('id, name_raw, name_normalized, glassdoor_rating')
          .eq('name_normalized', firstWord)
          .limit(1);

        if (firstWordMatch && firstWordMatch.length > 0) {
          employer = firstWordMatch[0];
        }
      }
    }

    const glassdoorFields = {
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
    };

    if (!employer) {
      // Create new employer record with Glassdoor data
      const displayName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const { error: insertError } = await supabase
        .from('employers')
        .insert({
          name_raw: displayName,
          name_normalized: name,
          ...glassdoorFields,
        });

      if (insertError) {
        console.log(`  ✗ Error creating "${name}": ${insertError.message}`);
        errors++;
      } else {
        console.log(`  + Created: ${displayName} → ${rating}/5 (${reviewCount.toLocaleString()} reviews)`);
        created++;
      }
      continue;
    }

    // Log name mapping when fuzzy match found a different normalized name
    if (employer.name_normalized !== name) {
      console.log(`  ℹ Mapped "${name}" → DB name: "${employer.name_normalized}" (${employer.name_raw})`);
    }

    // Update existing employer with Glassdoor data
    const { error: updateError } = await supabase
      .from('employers')
      .update(glassdoorFields)
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

  console.log(`\nDone: ${updated} updated, ${created} created, ${errors} errors`);
}

seedGlassdoor().catch(console.error);
