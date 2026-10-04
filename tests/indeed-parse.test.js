'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mosaicNode } = require('./helpers/indeed-dom.js');

const JK = 'ecad77fde792a357';
const mosaicRow = { jobkey: JK, displayTitle: 'IT Support Specialist', company: 'Acme Corp', formattedRelativeTime: '30+ days ago' };
const otherRow = { jobkey: 'aaaaaaaaaaaaaaaa', displayTitle: 'Barista', company: 'Other Co' };

function serpCard(jk, title, company) {
  return '<li><div class="job_seen_beacon"><h2 class="jobTitle"><a data-jk="' + jk + '"><span title="' + title + '">' + title + '</span></a></h2>' +
    '<span data-testid="company-name">' + company + '</span></div></li>';
}

async function parse(html, url) {
  const dom = load(html, url);
  try {
    return await dom.window.parseIndeedListing();
  } finally {
    dom.window.close();
  }
}

test('SERP inline: h1 is the search heading, detail pane lacks selectors -> falls back to mosaic row by jk', async () => {
  const html = '<html><head><title>it support jobs in San Antonio, TX</title></head><body>' +
    '<h1>it support jobs in San Antonio, TX</h1>' +
    '<ul>' + serpCard('aaaaaaaaaaaaaaaa', 'Barista', 'Other Co') + serpCard(JK, 'IT Support Specialist', 'Acme Corp') + '</ul>' +
    '<div id="jobsearch-ViewjobPaneWrapper"><div id="jobDescriptionText">Support our users.</div></div>' +
    mosaicNode([otherRow, mosaicRow]) + '</body></html>';
  const r = await parse(html, 'https://www.indeed.com/jobs?q=it+support&l=San+Antonio%2C+TX&vjk=' + JK);
  assert.equal(r.title, 'IT Support Specialist');
  assert.equal(r.companyName, 'Acme Corp');
  assert.equal(r.platformJobId, JK);
});

test('SERP inline without mosaic bridge: selected [data-jk] card supplies identity, not first card', async () => {
  const html = '<html><body><h1>it support jobs in San Antonio, TX</h1><ul>' +
    serpCard('aaaaaaaaaaaaaaaa', 'Barista', 'Other Co') + serpCard(JK, 'IT Support Specialist', 'Acme Corp') + '</ul>' +
    '<div id="jobsearch-ViewjobPaneWrapper"><div id="jobDescriptionText">x</div></div></body></html>';
  const r = await parse(html, 'https://www.indeed.com/jobs?q=it&vjk=' + JK);
  assert.equal(r.title, 'IT Support Specialist');
  assert.equal(r.companyName, 'Acme Corp');
});

test('SERP: company-name in result cards must NOT be taken as the detail company', async () => {
  const html = '<html><body><h1>it support jobs in San Antonio, TX</h1><ul>' +
    serpCard('aaaaaaaaaaaaaaaa', 'Barista', 'Mphasis') + '</ul>' +
    '<div id="jobsearch-ViewjobPaneWrapper"><div id="jobDescriptionText">x</div></div></body></html>';
  const r = await parse(html, 'https://www.indeed.com/jobs?q=it&vjk=' + JK);
  assert.notEqual(r.companyName, 'Mphasis');
  assert.equal(r.companyName, null);
});

test('late render: detail pane selectors present only after a delay are picked up on the next parse', async () => {
  const html = '<html><body><h1>it support jobs in San Antonio, TX</h1>' +
    '<div id="jobsearch-ViewjobPaneWrapper"></div></body></html>';
  const dom = load(html, 'https://www.indeed.com/jobs?q=it&vjk=' + JK);
  try {
    const first = await dom.window.parseIndeedListing();
    assert.ok(!first.title || !first.companyName, 'nothing to parse yet');
    const pane = dom.window.document.getElementById('jobsearch-ViewjobPaneWrapper');
    pane.setAttribute('data-jk', JK);
    pane.innerHTML = '<h2 data-testid="jobsearch-JobInfoHeader-title"><span>Network Admin</span><span> - job post</span></h2>' +
      '<div data-testid="inlineHeader-companyName"><a>Globex</a></div><div id="jobDescriptionText">desc</div>';
    const second = await dom.window.parseIndeedListing();
    assert.equal(second.title, 'Network Admin');
    assert.equal(second.companyName, 'Globex');
  } finally {
    dom.window.close();
  }
});

test('new selectors: h1[data-testid=jobTitle] + data-testid=company-name inside the detail pane', async () => {
  const html = '<html><body><div id="jobsearch-ViewjobPaneWrapper" data-jk="' + JK + '">' +
    '<h1 data-testid="jobTitle">Field Technician</h1><div data-testid="company-name">Initech</div>' +
    '<div id="jobDescriptionText">d</div></div></body></html>';
  const r = await parse(html, 'https://www.indeed.com/jobs?q=x&vjk=' + JK);
  assert.equal(r.title, 'Field Technician');
  assert.equal(r.companyName, 'Initech');
});

test('standalone /viewjob: JSON-LD JobPosting supplies title + company when all selectors miss', async () => {
  const ld = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Data Analyst', datePosted: '2026-09-01',
    hiringOrganization: { '@type': 'Organization', name: 'Hooli' } };
  const html = '<html><head><title>Data Analyst - Hooli - Austin, TX | Indeed.com</title>' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script></head><body><div id="jobDescriptionText">d</div></body></html>';
  const r = await parse(html, 'https://www.indeed.com/viewjob?jk=0d671325e0a42f3c');
  assert.equal(r.title, 'Data Analyst');
  assert.equal(r.companyName, 'Hooli');
});

test('standalone /viewjob: document.title "Title - Company - City | Indeed.com" when no JSON-LD', async () => {
  const html = '<html><head><title>Data Analyst - Hooli - Austin, TX | Indeed.com</title></head><body><div id="jobDescriptionText">d</div></body></html>';
  const r = await parse(html, 'https://www.indeed.com/viewjob?jk=0d671325e0a42f3c');
  assert.equal(r.title, 'Data Analyst');
  assert.equal(r.companyName, 'Hooli');
});

test('iframe variant: pane content lives in a child frame -> identity still resolved from mosaic row in the top document', async () => {
  const html = '<html><body><h1>it support jobs in San Antonio, TX</h1>' +
    '<iframe id="vjs-container-iframe"></iframe>' + mosaicNode([mosaicRow]) + '</body></html>';
  const r = await parse(html, 'https://www.indeed.com/jobs?q=it&vjk=' + JK);
  assert.equal(r.title, 'IT Support Specialist');
  assert.equal(r.companyName, 'Acme Corp');
});
