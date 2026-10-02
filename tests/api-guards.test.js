const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

test('ci workflow runs unit tests, tsc, and the web build', () => {
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /npm test/);
  assert.match(ci, /tsc --noEmit/);
  assert.match(ci, /npm run build/);
  assert.match(ci, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.doesNotMatch(ci, /uses:\s*[^#\n]+@v\d/);
});

test('extension deploy waits for tests, checks the tag, and stays publish true', () => {
  const deploy = fs.readFileSync('.github/workflows/deploy-extension.yml', 'utf8');
  assert.match(deploy, /needs:\s*test/);
  assert.match(deploy, /npm test/);
  assert.match(deploy, /jq -r \.version extension\/manifest\.json/);
  assert.match(deploy, /publish:\s*true/);
  assert.doesNotMatch(deploy, /uses:\s*[^#\n]+@v\d/);
  assert.match(deploy, /mnao305\/chrome-extension-upload@[0-9a-f]{40}/);
});

test('docs no longer point at the missing chrome-web-store workflow', () => {
  for (const file of ['CLAUDE.md', 'README.md']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /chrome-web-store\.yml/);
    assert.match(text, /deploy-extension\.yml/);
  }
});

test('supabase module loads without env and fails on use', () => {
  const env = { ...process.env };
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const script = `
    import { getSupabaseAdmin, supabaseAdmin } from './web/lib/supabase.ts';
    if (typeof getSupabaseAdmin !== 'function') throw new Error('missing getter');
    let threw = false;
    try { getSupabaseAdmin(); } catch (e) {
      threw = String(e && e.message || e).includes('not configured');
    }
    if (!threw) throw new Error('getter should throw');
    let proxyThrew = false;
    try { supabaseAdmin.from('employers'); } catch (e) {
      proxyThrew = true;
    }
    if (!proxyThrew) throw new Error('proxy should throw');
  `;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
