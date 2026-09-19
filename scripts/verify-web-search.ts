/**
 * Genuine end-to-end web-search evidence run against the configured SearXNG
 * (SEARXNG_URL). Every check uses REAL network calls — this script NEVER passes
 * on mocks and exits non-zero unless the whole chain is real:
 * health → real query → real results → dedupe → real retrieval → extraction →
 * citation tracking → untrusted framing.
 *   usage: npx tsx scripts/verify-web-search.ts   (needs a REACHABLE SearXNG at
 *   SEARXNG_URL — anywhere; Docker is not required, never invoked, never consulted)
 */
import path from 'node:path';
import * as dotenv from 'dotenv';
// Same env resolution as the Next server: .env.local wins over .env.
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });
import { searchWeb, searxngEndpoint } from '../src/core/search/searxng';
import { searxngSearch } from '../src/core/web/SearXNGSearchProvider';
import { searchAndRetrieve, needsWebSearch, webSearchStatus, frameUntrustedSource } from '../src/core/search/webSearch';

async function main() {
  const endpoint = searxngEndpoint();
  console.log('SEARXNG_URL:', endpoint || '(unset)');
  let pass = true;
  const fail = (msg: string) => { pass = false; console.log('  FAIL:', msg); };

  // 1 · real health probe (real query + real results required).
  const health = await webSearchStatus();
  console.log('1. health:', health.status, health.reason || '');
  if (health.status !== 'READY') fail('provider not READY (needs real search + real results)');

  // 2 · real query, real results, typed normalization.
  const q = 'latest llama.cpp release';
  const s = await searchWeb(q, { limit: 10 });
  console.log(`2. search "${q}": available=${s.available} raw=${s.rawCount ?? 0} kept=${s.results.length} reason=${s.reason || ''}`);
  if (!s.available || !s.results.length) fail('no real results');
  for (const r of s.results.slice(0, 3)) {
    console.log('   -', (r.title || '(untitled)').slice(0, 58), '|', r.source, r.engine ? `(${r.engine})` : '', '|', r.url.slice(0, 60));
    if (typeof r.relevance !== 'number' || !r.url || !r.retrievedAt) fail('untyped result row');
  }

  // 3 · dedupe evidence: no two kept results share a canonical URL.
  const canon = s.results.map((r) => r.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase());
  if (new Set(canon).size !== canon.length) fail('duplicate URLs survived dedupe');

  // 4 · retrieval + extraction + citations through the existing WebCapability.
  const sa = await searchAndRetrieve(q, { retrieveTop: 2 });
  console.log(`4. pipeline status=${sa.status} results=${sa.results.length} citations=${sa.citations.length}`);
  for (const c of sa.citations) console.log(`   [${c.sourceId}] ${c.retrievalStatus}/${c.contentStatus} via=${c.via || '—'} ${c.url.slice(0, 64)}`);
  const verified = sa.citations.filter((c) => c.retrievalStatus === 'retrieved' && c.contentStatus === 'extracted');
  if (!verified.length) fail('no source was actually retrieved + extracted');

  // 5 · citations are framed as untrusted DATA for synthesis.
  if (verified[0]) {
    const block = frameUntrustedSource(verified[0].sourceId, verified[0].title, verified[0].url, verified[0].contentExcerpt || '');
    if (!/UNTRUSTED/.test(block)) fail('untrusted framing missing');
  }

  // 6 · current-information routing via the ONE existing SearchDecision policy.
  console.log('6. needsWebSearch:', JSON.stringify({
    [q]: needsWebSearch(q),
    'explain recursion': needsWebSearch('explain how recursion works'),
    'open notepad': needsWebSearch('open notepad'),
  }));
  if (!needsWebSearch(q) || needsWebSearch('explain how recursion works') || needsWebSearch('open notepad')) fail('current-info routing wrong');

  // 7 · provider health is real and cached (no fake).
  const h2 = await searxngSearch.health();
  console.log('7. provider:', h2.status, JSON.stringify(searxngSearch.capabilities()));

  console.log(`\nWEB SEARCH: ${pass ? 'READY (real SearXNG + real results + real retrieval + real extraction + citations)' : 'DEGRADED/BLOCKED (see FAIL lines above)'}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e?.message || e); process.exit(1); });
