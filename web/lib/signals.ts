/**
 * Distinct ghost-score checks, shared by the homepage and /how-it-works.
 *
 * A "check" is one thing a person would recognise. LinkedIn and Indeed
 * copies of that check are one row. Point values and thresholds are taken
 * from the shipped scorer:
 *   extension/content/shared.js          — scoreListingSignals, age, applicants,
 *                                          engagement, description quality,
 *                                          age floors, Easy Apply / crowd tax,
 *                                          labelForScore bands
 *   extension/content/linkedin.js        — scoreLocally() extras
 *   extension/content/indeed.js          — scoreLocally() extras
 *   extension blendGhostScore            — confidence weights (both content scripts)
 *   web/lib/employerScore.ts             — saved employer score
 *   web/app/api/employer/score/route.ts  — live adjustment the extension receives
 *
 * SIGNAL_COUNT is the number of rows. Do not hardcode it in the UI.
 */

export type Direction = 'raises' | 'lowers' | 'either';

export type Point = {
  when: string;
  effect: string;
};

export type SignalCheck = {
  id: string;
  /** Short row label. The arrow comes from `direction`. */
  phrase: string;
  direction: Direction;
  /** Where it runs, in plain language. */
  where: string;
  /** One sentence under the row. */
  summary: string;
  points: Point[];
  /** Extra detail after the point list. */
  note?: string;
  /**
   * Homepage "moves the score most" topic.
   * Checks that share a group render together, in `row` order.
   */
  highlight?: { group: string; order: number; row: number };
};

export type SignalCategory = {
  id: string;
  title: string;
  /** One line on the homepage card. */
  summary: string;
  checks: SignalCheck[];
  footnote?: string;
};

export const DISTINCT_NOTE =
  'The same check on LinkedIn and Indeed counts once. Differences between the two sites are listed on the check.';

export const EMPLOYER_SHORT =
  'The employer record is confidence-weighted. A thin record can raise the score and will not pull it down.';

export const GLASSDOOR_SHORT =
  'Glassdoor ratings are shown beside the score and add no points.';

export const EMPLOYER_PARAGRAPHS = [
  'The employer record is confidence-weighted when it is mixed into the listing you are looking at.',
  'A thin record can raise the score and will not pull it down. Raising uses at least a 30% weight whenever the employer score is higher than the listing. Lowering uses no weight until there is more evidence: 15% with at least eight tracked listings, 25% with at least three reports, 40% with at least ten reports, and 60% when the lookup has fresh activity (at least two reports in the last 90 days, or a saved repost pattern).',
  'The saved employer score starts from the median of up to 50 recent listing scores for that company, or 40 when there are none. The report and repost rules below can only push that saved score up. They never pull it down.',
  'With fresh activity, the score the extension receives is 45% of the saved score and 55% of that adjusted score. If the saved score is missing, the adjustment starts at 40, and the saved side of that mix uses 45. The confidence weights then mix the result into the listing, and the age minimum is applied again afterward.',
];

export const GLASSDOOR_NOTE =
  'A Glassdoor rating is shown beside the score when we have one on file, along with the offer rate when we have it. A rating under 3.0, or an interview-to-offer rate under 20%, can also appear in the signal list. Those lines add no points. Indeed’s own star rating is a separate check and does change the score.';

export const HIGH_TURNOVER_NOTE =
  'Some titles are treated as high-turnover roles, including barista, warehouse associate, cashier, and CNA. On a job page, those titles keep 40% of the age and repost points and 60% of the applicant points, rounded to the nearest whole number. The age minimums are not reduced. Search cards do not apply this scaling. The overlay notes the title. It is not its own check.';

/** Overlay bands from extension/content/shared.js labelForScore. */
export const SCORE_BANDS = [
  { id: 'low', name: 'Worth Applying', range: '0–34' },
  { id: 'moderate', name: 'Proceed with Caution', range: '35–54' },
  { id: 'high', name: 'Likely a Waste of Time', range: '55–74' },
  { id: 'very_high', name: 'Skip This Job', range: '75–100' },
] as const;

export const SIGNAL_CATEGORIES: SignalCategory[] = [
  {
    id: 'listing-age',
    title: 'Listing age & reposts',
    summary: 'How long the post has been up, and whether it was already reposted.',
    footnote: HIGH_TURNOVER_NOTE,
    checks: [
      {
        id: 'posted-recent',
        phrase: 'Posted in last 2 days',
        direction: 'lowers',
        where: 'LinkedIn and Indeed',
        summary:
          'A listing dated today, yesterday, or two days ago gets a credit. The overlay calls this the last 48 hours.',
        points: [
          { when: 'LinkedIn job page', effect: '−10' },
          { when: 'Indeed job page, and any search card', effect: '−8' },
          { when: 'High-turnover title on a job page', effect: '40% of that credit, rounded' },
        ],
        highlight: { group: 'posting-age', order: 1, row: 1 },
      },
      {
        id: 'posted-older',
        phrase: 'Open more than 2 days',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary:
          'After two days the score rises with age, and an old post cannot stay below a minimum.',
        points: [
          { when: '7 days', effect: '+4' },
          { when: '14 days', effect: '+8' },
          { when: '30 days', effect: '+15' },
          { when: '60 days', effect: '+20' },
          { when: '90 days and after', effect: '+25' },
          { when: 'High-turnover title on a job page', effect: '40% of those points, rounded' },
          { when: '60+ days, if the score is still lower', effect: 'Raised to at least 50' },
          { when: '90+ days, if the score is still lower', effect: 'Raised to at least 75' },
          { when: '120+ days, if the score is still lower', effect: 'Raised to at least 88' },
        ],
        note:
          'Between those ages the add steps up by day: days 3–7 use (days − 2) × 0.8; days 8–14 start at 4 and add (days − 7) × 4/7; days 15–30 start at 8 and add (days − 14) × 7/16; days 31–60 start at 15 and add (days − 30) × 5/30; days 61–90 start at 20 and add (days − 60) × 5/30. Each step is rounded to a whole number. The same curve runs on job pages and search cards. Other listing points are added first; the minimum lifts the total only if it is still lower. Easy Apply on an old post, and 100 or more applicants on a post that is 60 days or older, are added after that lift. The minimum is applied again after the employer record is mixed in.',
        highlight: { group: 'posting-age', order: 1, row: 2 },
      },
      {
        id: 'date-missing',
        phrase: 'Posting date missing',
        direction: 'raises',
        where: 'Indeed job page',
        summary:
          'An Indeed job page with no posting date takes a flat add. The age curve does not also run.',
        points: [
          { when: 'Indeed job page, date missing', effect: '+15' },
          { when: 'LinkedIn, and search cards', effect: 'No points for a missing date' },
        ],
      },
      {
        id: 'reposted',
        phrase: 'Reposted',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary: 'A listing the platform marks as reposted takes one of the largest single adds.',
        points: [
          { when: 'Marked as reposted, job page or search card', effect: '+24' },
          { when: 'High-turnover title on a job page', effect: '+10 (40% of 24, rounded)' },
          {
            when: 'LinkedIn job page, and the repost already has 100 or more applicants',
            effect: '+16 more',
          },
        ],
        note:
          'On Indeed, any repost can also be labeled “High Volume Repost.” That label does not add the extra 16.',
        highlight: { group: 'reposted', order: 2, row: 1 },
      },
    ],
  },
  {
    id: 'applicants',
    title: 'Applicants & engagement',
    summary: 'How many people applied, and whether anyone is reviewing them.',
    checks: [
      {
        id: 'applicant-volume',
        phrase: 'Lots of applicants',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary: 'The score steps up at 100, 200, and 500 applicants. Under 100 adds nothing.',
        points: [
          { when: '100 or more applicants', effect: '+8' },
          { when: '200 or more', effect: '+10' },
          { when: '500 or more', effect: '+15' },
          { when: 'High-turnover title on a job page', effect: '60% of those points, rounded' },
        ],
        note: 'Only one of the three steps applies. The same steps run on search cards. A missing applicant count adds nothing.',
        highlight: { group: 'applicants', order: 3, row: 1 },
      },
      {
        id: 'crowded-older',
        phrase: 'Many applicants on an older post',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary:
          'A crowded listing that has also been open for months takes an extra hit on top of the applicant count.',
        points: [
          { when: '100+ applicants and 60+ days', effect: '+8' },
          { when: '100+ applicants and 90+ days', effect: '+10' },
          { when: '100+ applicants and 120+ days', effect: '+12' },
          {
            when: 'LinkedIn job page, 30+ days and 200+ applicants',
            effect: '+16',
          },
        ],
        note:
          'Only one of the 60-, 90-, and 120-day steps applies, and those steps are added after the age minimum, so the minimum does not swallow them. The LinkedIn +16 is added earlier, before the minimum, so a minimum can cover it. It can still stack with a later step when both match.',
      },
      {
        id: 'easy-apply-older',
        phrase: 'Easy Apply on an older post',
        direction: 'raises',
        where: 'LinkedIn',
        summary: 'Easy Apply on a listing that has been open for months raises the score further.',
        points: [
          { when: 'Easy Apply and 60+ days', effect: '+8' },
          { when: 'Easy Apply and 90+ days', effect: '+10' },
          { when: 'Easy Apply and 120+ days', effect: '+12' },
        ],
        note:
          'Only one step applies. It is added after the age minimum, on the LinkedIn job page and on LinkedIn search cards.',
      },
      {
        id: 'actively-reviewing',
        phrase: 'Actively reviewing applicants',
        direction: 'lowers',
        where: 'LinkedIn and Indeed',
        summary:
          'An “actively reviewing” label lowers the score. The credit shrinks as the post gets older, and it is gone at 120 days.',
        points: [
          { when: 'Under 60 days', effect: '−8' },
          { when: '60–89 days', effect: '−3' },
          { when: '90–119 days', effect: '−2' },
          { when: '120 days or older', effect: '−0' },
        ],
        note:
          'Runs on job pages and search cards. While this label is present, the “no review activity” add does not run. At 120 days the label is noted and does not change the number.',
      },
      {
        id: 'no-review',
        phrase: 'No review activity',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary: 'An older listing with no “actively reviewing” label scores higher.',
        points: [
          { when: '14+ days and not actively reviewing', effect: '+10' },
          { when: 'Indeed job page, 30+ days and still not reviewing', effect: '+14 more' },
        ],
        note:
          'The +10 runs on job pages and search cards. The extra 14 is Indeed job pages only, and it stacks on the +10.',
      },
    ],
  },
  {
    id: 'pay-contact',
    title: 'Pay & contact',
    summary: 'Missing pay, no one to contact, a staffing poster, or an application that leaves the site.',
    checks: [
      {
        id: 'salary',
        phrase: 'No salary listed',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary:
          'No salary on the job page raises the score. On a search card, a missing salary raises it a little, and a salary that is shown lowers it a little.',
        points: [
          { when: 'Job page, no salary', effect: '+5' },
          { when: 'Search card, no salary', effect: '+4' },
          { when: 'Search card, salary is shown', effect: '−2' },
          { when: 'Job page, salary is shown', effect: 'No change from this check' },
        ],
        highlight: { group: 'salary', order: 4, row: 1 },
      },
      {
        id: 'staffing',
        phrase: 'Staffing agency or job board',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary:
          'A third-party or staffing post raises the score, whether the page says so or the company name is a known staffing firm or job board.',
        points: [
          { when: 'Job page', effect: '+12' },
          { when: 'Search card', effect: '+10' },
        ],
      },
      {
        id: 'no-contact',
        phrase: 'No hiring contact',
        direction: 'raises',
        where: 'LinkedIn job page',
        summary: 'When the LinkedIn page does not show someone you can follow up with, the score goes up.',
        points: [{ when: 'No hiring contact or hiring team shown', effect: '+10' }],
        highlight: { group: 'no-contact', order: 5, row: 1 },
      },
      {
        id: 'off-linkedin',
        phrase: 'Responses managed off LinkedIn',
        direction: 'raises',
        where: 'LinkedIn job page',
        summary: 'A listing that says responses are managed off LinkedIn is harder to hold anyone to.',
        points: [{ when: 'Page says responses are managed off LinkedIn', effect: '+10' }],
      },
      {
        id: 'response-record',
        phrase: 'Employer response record',
        direction: 'either',
        where: 'LinkedIn and Indeed',
        summary:
          'No sign of how the employer responds raises the score. On Indeed, a line that they often reply lowers it.',
        points: [
          { when: 'LinkedIn job page says “no response insights”', effect: '+8' },
          { when: 'Indeed job page does not say the employer often replies', effect: '+8' },
          { when: 'Indeed job page says the employer often replies', effect: '−5' },
        ],
        note:
          'On an Indeed job page this check always takes one of those two branches. LinkedIn adds points only when the “no response insights” line is present.',
      },
      {
        id: 'apply-offsite',
        phrase: 'Apply button leaves Indeed',
        direction: 'raises',
        where: 'Indeed job page',
        summary: 'An apply button that sends you to the company site raises the score a little.',
        points: [{ when: 'Apply on company site', effect: '+5' }],
      },
      {
        id: 'indeed-rating',
        phrase: 'Indeed employer rating',
        direction: 'either',
        where: 'Indeed job page',
        summary:
          'Indeed’s own star rating can raise or lower the score. This is not the Glassdoor rating.',
        points: [
          { when: 'Under 2.5', effect: '+10' },
          { when: '2.5 up to but not including 3.0', effect: '+5' },
          { when: '3.0 up to but not including 4.0', effect: 'No change' },
          { when: '4.0 or higher', effect: '−3' },
        ],
      },
    ],
  },
  {
    id: 'description',
    title: 'Description quality',
    summary: 'Thin, generic, or contradictory write-ups, and titles that don’t match the experience asked for.',
    checks: [
      {
        id: 'vague-or-short',
        phrase: 'Vague or short description',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary:
          'A missing, very short, or generic description raises the score. Length and vague wording are separate adds, and they stack when both match.',
        points: [
          { when: 'LinkedIn, no description or under 200 characters', effect: '+12' },
          { when: 'LinkedIn, description under 500 characters', effect: '+6' },
          { when: 'Indeed, no description', effect: '+7' },
          { when: 'Indeed, description under 280 characters', effect: '+5' },
          { when: 'Heavily generic wording, LinkedIn', effect: '+12' },
          { when: 'Heavily generic wording, Indeed', effect: '+11' },
          { when: 'Some generic wording, LinkedIn', effect: '+7' },
          { when: 'Some generic wording, Indeed', effect: '+6' },
        ],
        note:
          'Length uses one step per site (under 200 characters on LinkedIn does not also take the under-500 step; a missing Indeed description does not also take the under-280 step). Vague wording is scored only when a description is present. Heavily generic means a vagueness ratio of 0.65 or more; some generic wording means 0.45 or more. Generic phrases (fast-paced, rockstar, wear many hats, and similar lines) push the ratio up. Concrete details — a named tool, a reporting line, a team size, a dollar amount, or years required — push it down. A description under 500 characters, or a list of more than 15 distinct technologies, also pushes it up. Job pages only.',
        highlight: { group: 'vague-or-short', order: 6, row: 1 },
      },
      {
        id: 'specific-description',
        phrase: 'Specific description',
        direction: 'lowers',
        where: 'LinkedIn and Indeed job pages',
        summary:
          'A concrete description lowers the score by a single point. It does not also take the vague-wording adds.',
        points: [{ when: 'Vagueness ratio 0.15 or below', effect: '−1' }],
        note: 'Between 0.15 and 0.45, wording changes nothing.',
      },
      {
        id: 'placeholder',
        phrase: 'Placeholder or broken template',
        direction: 'raises',
        where: 'LinkedIn and Indeed',
        summary:
          'Leftover template text in the title or description — an unfilled company or job-title token — raises the score.',
        points: [{ when: 'Title or description still has template tokens', effect: '+10' }],
        note: 'Also runs on a search card when the title carries the token.',
      },
      {
        id: 'seniority',
        phrase: 'Title and experience don’t match',
        direction: 'raises',
        where: 'LinkedIn and Indeed job pages',
        summary:
          'An entry-level title that asks for many years, or a senior title that asks for almost none, raises the score.',
        points: [
          { when: 'LinkedIn', effect: '+14' },
          { when: 'Indeed', effect: '+13' },
        ],
        note:
          'On both sites: an entry-level, junior, associate, intern, or graduate title plus 10 or more years in the description, or a senior, lead, principal, director, VP, or “head of” title plus 0–2 years. Indeed also flags the page when the title or the first 200 characters look entry-level and the description asks for 5 to 10 years of experience.',
        highlight: { group: 'seniority', order: 7, row: 1 },
      },
      {
        id: 'work-arrangement',
        phrase: 'Work arrangement doesn’t match',
        direction: 'raises',
        where: 'LinkedIn and Indeed job pages',
        summary:
          'The score rises when the on-site, remote, or hybrid tag disagrees with the description.',
        points: [
          {
            when: 'Tag and description conflict, such as on-site with a remote-only description',
            effect: '+8',
          },
        ],
      },
    ],
  },
  {
    id: 'combined',
    title: 'Combined red flags',
    summary: 'Indeed starts a little higher, and several gaps together add still more.',
    checks: [
      {
        id: 'indeed-baseline',
        phrase: 'Indeed job page starts higher',
        direction: 'raises',
        where: 'Indeed job page',
        summary:
          'An Indeed job page starts 10 points higher than a LinkedIn page or a search card, before the other checks.',
        points: [
          { when: 'Indeed job page', effect: '+10' },
          { when: 'LinkedIn, and search cards', effect: 'No starting add' },
        ],
      },
      {
        id: 'stacked-gaps',
        phrase: 'Several gaps at once',
        direction: 'raises',
        where: 'LinkedIn and Indeed job pages',
        summary:
          'An older listing that is also missing the basics takes an extra add on top of the individual checks.',
        points: [
          {
            when: 'LinkedIn, 14+ days, no hiring contact, description missing or under 300 characters, and no salary',
            effect: '+20',
          },
          {
            when: 'Indeed, 14+ days, no salary, not marked as often replying, and not actively reviewing',
            effect: '+24',
          },
          {
            when: 'Indeed, 30+ days, not reviewing, not marked as often replying, and no salary',
            effect: '+12 more',
          },
        ],
        note:
          'The Indeed +12 stacks on the +24 when the post is 30 days or older and still missing those pieces. These adds are applied before the age minimum, so a minimum can cover them.',
      },
    ],
  },
  {
    id: 'employer',
    title: 'Employer record',
    summary: 'Ghost reports and roles that keep getting reposted, weighted by how much evidence we have.',
    checks: [
      {
        id: 'ghost-reports',
        phrase: 'Employer ghost reports',
        direction: 'raises',
        where: 'Employer record',
        summary:
          'With at least three community reports in the last 90 days, a high share of ghost flags or “no response” outcomes lifts the employer score.',
        points: [
          { when: 'Fewer than 3 reports in 90 days', effect: 'No change from this check' },
          { when: '75% or more are ghost flags or no response', effect: 'Employer score at least 68' },
          { when: '55% or more, and under 75%', effect: 'Employer score at least 52' },
        ],
        note:
          'These are floors. They can raise the saved employer score and do not pull it down. A count of reports on this exact listing can show in the signal list and does not add its own points.',
        highlight: { group: 'ghost-reports', order: 8, row: 1 },
      },
      {
        id: 'role-reposts',
        phrase: 'Same role reposted again and again',
        direction: 'raises',
        where: 'Employer record',
        summary: 'Tracking the same role over and over lifts the employer score to a floor.',
        points: [
          { when: 'Same role tracked 6 or more times', effect: 'Employer score at least 75' },
          { when: 'Same role tracked 4 or 5 times', effect: 'Employer score at least 62' },
        ],
        note: 'Floors only. They do not lower the employer score.',
      },
      {
        id: 'identical-description',
        phrase: 'Same description reused on those reposts',
        direction: 'raises',
        where: 'Employer record',
        summary:
          'When a repeated role also reuses one description, the employer score takes a further add.',
        points: [
          {
            when: 'A saved repost pattern reused one description, and the most-repeated role was tracked at least 3 times',
            effect: '+6',
          },
        ],
        note: 'Added after the repost floor, so a role already lifted to 75 can still gain these 6 points.',
      },
    ],
  },
];

export const SIGNAL_COUNT = SIGNAL_CATEGORIES.reduce((n, category) => n + category.checks.length, 0);

export type HighlightGroup = {
  id: string;
  order: number;
  checks: SignalCheck[];
};

export function highlightGroups(): HighlightGroup[] {
  const map = new Map<string, HighlightGroup>();
  for (const category of SIGNAL_CATEGORIES) {
    for (const check of category.checks) {
      if (!check.highlight) continue;
      const group = map.get(check.highlight.group);
      if (group) group.checks.push(check);
      else {
        map.set(check.highlight.group, {
          id: check.highlight.group,
          order: check.highlight.order,
          checks: [check],
        });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      ...group,
      checks: [...group.checks].sort((a, b) => (a.highlight?.row ?? 0) - (b.highlight?.row ?? 0)),
    }));
}

function assertSignalCatalog() {
  const ids = new Set<string>();
  for (const category of SIGNAL_CATEGORIES) {
    if (category.checks.length === 0) {
      throw new Error(`Signal category ${category.id} has no checks`);
    }
    for (const check of category.checks) {
      if (ids.has(check.id)) throw new Error(`Duplicate signal id: ${check.id}`);
      ids.add(check.id);
      if (check.points.length === 0) throw new Error(`Signal ${check.id} has no point values`);
    }
  }
  const groups = highlightGroups();
  if (groups.length < 6 || groups.length > 8) {
    throw new Error(`Expected 6–8 homepage highlight topics, found ${groups.length}`);
  }
}

assertSignalCatalog();
