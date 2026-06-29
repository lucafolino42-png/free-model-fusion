/**
 * Free Model Fusion — Benchmark Runner
 * =====================================
 * Usage: npx tsx scripts/benchmark.ts [--quick]
 */

import { createServer } from '../src/server.js';
import { getEnabledModels, getProviderById } from '../src/providers/registry.js';
import { callModel } from '../src/providers/modelClient.js';
import { handleFusionCommand } from '../src/fusion/commandsHandler.js';
import { estimateCallCost } from '../src/fusion/costEstimate.js';
import fs from 'fs';

const QUICK = process.argv.includes('--quick');
const OUTPUT = process.env.BENCHMARK_OUTPUT || 'BENCHMARK_RESULTS.md';

interface Question { id: string; category: string; difficulty: string; text: string; }
interface JudgeScore { accuracy: number; completeness: number; clarity: number; depth: number; overall: number; feedback: string; }

const QUESTIONS: Question[] = [
  { id: 'f1', category: 'factual', difficulty: 'easy', text: 'What is the boiling point of water at sea level in Celsius and Fahrenheit?' },
  { id: 'f2', category: 'factual', difficulty: 'medium', text: 'Explain the difference between TCP and UDP protocols and when you would use each.' },
  { id: 'c1', category: 'coding', difficulty: 'easy', text: 'Write a JavaScript function that debounces a callback function.' },
  { id: 'c2', category: 'coding', difficulty: 'medium', text: 'Write a Python function that implements binary search on a sorted array with proper error handling.' },
  { id: 'r1', category: 'reasoning', difficulty: 'medium', text: 'If a bat and a ball cost $1.10 total, and the bat costs $1.00 more than the ball, how much does the ball cost? Think step by step.' },
  { id: 'e1', category: 'explanation', difficulty: 'easy', text: 'Explain how HTTPS/TLS works to a non-technical person using analogies.' },
  { id: 'cr1', category: 'creative', difficulty: 'medium', text: 'Write a short poem about the relationship between a developer and their codebase using programming metaphors.' },
  { id: 'a1', category: 'analysis', difficulty: 'hard', text: 'Compare serverless vs Kubernetes for microservices. What factors influence your choice?' },
  { id: 'c3', category: 'coding', difficulty: 'hard', text: 'Design a rate-limited HTTP client in TypeScript with concurrent requests and exponential backoff.' },
  { id: 'e2', category: 'explanation', difficulty: 'hard', text: 'Explain the CAP theorem and implications for choosing a distributed database.' },
];

function trunc(s: string, n = 200): string { return s.length <= n ? s : s.slice(0, n) + '...'; }
function fmt(ms: number): string { return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`; }

function judgePrompt(q: string, a: string, b: string): string {
  return 'You are an expert AI evaluator. Compare two responses.\n\n## Question\n' + q + '\n\n## Response A (Single)\n' + a + '\n\n## Response B (Fusion)\n' + b + '\n\nRate each 1-10 on: Accuracy, Completeness, Clarity, Depth, Overall.\nReturn ONLY valid JSON:\n{"accuracyA":N,"completenessA":N,"clarityA":N,"depthA":N,"overallA":N,"accuracyB":N,"completenessB":N,"clarityB":N,"depthB":N,"overallB":N,"feedback":"note"}';
}

function parseScores(raw: string): { sa: JudgeScore; sb: JudgeScore } {
  try {
    const m = raw.match(/\{[\s\S]*"overall[AB]"[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : raw);
    const sa: JudgeScore = { accuracy: p.accuracyA ?? 5, completeness: p.completenessA ?? 5, clarity: p.clarityA ?? 5, depth: p.depthA ?? 5, overall: p.overallA ?? 5, feedback: p.feedback ?? '' };
    const sb: JudgeScore = { accuracy: p.accuracyB ?? 5, completeness: p.completenessB ?? 5, clarity: p.clarityB ?? 5, depth: p.depthB ?? 5, overall: p.overallB ?? 5, feedback: p.feedback ?? '' };
    return { sa, sb };
  } catch {
    const fb: JudgeScore = { accuracy: 5, completeness: 5, clarity: 5, depth: 5, overall: 5, feedback: 'parse fail' };
    return { sa: fb, sb: { ...fb } };
  }
}

function genReport(results: Array<any>, smId: string, jId: string): string {
  const fw = results.filter(r => r.w === 'fusion').length;
  const sw = results.filter(r => r.w === 'single').length;
  const ties = results.filter(r => r.w === 'tie').length;
  const sc = results.filter(r => r.fs);
  const aF = sc.reduce((s: number, r: any) => s + r.fs.overall, 0) / Math.max(1, sc.length);
  const aS = sc.reduce((s: number, r: any) => s + r.ss.overall, 0) / Math.max(1, sc.length);
  const fLat = results.filter(r => r.fu).reduce((s: number, r: any) => s + r.fl, 0) / Math.max(1, results.filter(r => r.fu).length);
  const sLat = results.filter(r => r.sm).reduce((s: number, r: any) => s + r.sl, 0) / Math.max(1, results.filter(r => r.sm).length);

  const L: string[] = [];
  const P = (s: string) => L.push(s);

  P('# Free Model Fusion — Benchmark Results\n');
  P(`> **Date:** ${new Date().toISOString().split('T')[0]} | Single: \`${smId}\` | Judge: \`${jId}\` | Qs: ${results.length}\n`);
  P('## Executive Summary\n| Metric | Single | Fusion | Δ |\n|-|-|-|-|');
  P(`| Avg Score | ${aS.toFixed(1)} | ${aF.toFixed(1)} | ${(aF - aS) > 0 ? '+' : ''}${(aF - aS).toFixed(1)} |`);
  P(`| Wins | ${sw} | ${fw} | ${fw - sw > 0 ? '+' : ''}${fw - sw} |`);
  P(`| Ties | ${ties} | |`);
  P(`| Avg Latency | ${fmt(sLat)} | ${fmt(fLat)} | +${((fLat - sLat) / 1000).toFixed(1)}s |\n`);
  P(`> **Verdict:** Fusion ${fw > sw ? 'outperforms' : fw === sw ? 'is comparable to' : 'underperforms'} single model.\n`);

  P('## Results\n| # | Category | Difficulty | Question | Single | Fusion | Winner |\n|-|-|-|-|-|-|-|');
  results.forEach((r: any, i: number) => {
    const s = r.ss ? `${r.ss.overall}/10` : r.sm ? 'N/A' : '❌';
    const f = r.fs ? `${r.fs.overall}/10` : r.fu ? 'N/A' : '❌';
    const w = r.w === 'fusion' ? '🏆' : r.w === 'single' ? '🏆' : r.w === 'tie' ? '⚖️' : '❌';
    P(`| ${i + 1} | ${r.q.category} | ${r.q.difficulty} | ${trunc(r.q.text, 45).replace(/\|/g, '\\|')} | ${s} | ${f} | ${w} |`);
  });

  P('\n## Methodology\n');
  P(`- Single: \`${smId}\` via direct provider API call`);
  P('- Fusion: Full pipeline (expert panel + judge + synthesis, balanced profile)');
  P(`- Judge: \`${jId}\` scored responses blind on 4 dimensions + overall (1-10)`);
  P('- Winner requires ≥0.5 point difference in overall score\n');
  return L.join('\n');
}

async function main() {
  console.log(`\n🧪 Benchmark (${QUICK ? 'quick' : 'full'})`);
  const qs = QUICK ? QUESTIONS.slice(0, 4) : QUESTIONS;

  console.log('📡 Starting server...');
  const server = await createServer();
  const app = server.fastify;
  await app.ready();

  try {
    const models = await getEnabledModels();
    const creds = models.filter(m => m.hasCredential);
    if (!creds.length) { console.error('❌ No credentials'); await app.close(); process.exit(1); }

    const experts = creds.filter(m => m.useAs.includes('expert'));
    const judges = creds.filter(m => m.useAs.includes('judge') || m.useAs.includes('synthesis'));
    const sm = experts[0]; const jm = judges[0] || experts[0];
    if (!sm || !jm) { console.error('❌ No models'); await app.close(); process.exit(1); }

    const prov = await getProviderById(sm.providerId);
    const jprov = await getProviderById(jm.providerId);
    if (!prov?.enabled) { console.error('❌ Provider unavailable'); await app.close(); process.exit(1); }

    console.log(`Model: ${sm.id} | Judge: ${jm.id} | Creds: ${creds.length}\n`);

    const results: any[] = [];

    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      console.log(`[${i + 1}/${qs.length}] ${q.category}/${q.difficulty}: ${trunc(q.text, 65)}`);

      // Single
      const sStart = Date.now();
      let smOk = false, smC = '', smCo = 0;
      try {
        const r = await callModel(prov, sm.model, [
          { role: 'system', content: 'Answer concisely with concrete details.' },
          { role: 'user', content: q.text },
        ], { maxTokens: 22500, temperature: 0.3 });
        smOk = true; smC = r.content; smCo = estimateCallCost(sm.speedClass, sm.qualityClass);
        console.log(`  S: ${r.content.length}c ${fmt(Date.now() - sStart)}`);
      } catch (e) { console.log(`  S: ❌ ${trunc(String(e), 80)}`); }
      const sLat = Date.now() - sStart;

      // Fusion
      const fStart = Date.now();
      let fuOk = false, fuC = '', fuCo = 0;
      try {
        const r = await handleFusionCommand(q.text, { sessionId: `bm-${q.id}`, source: 'api', profile: 'balanced' });
        fuOk = true; fuC = r.answer; fuCo = r.meta?.estimatedCostUsd ?? 0;
        console.log(`  F: ${r.answer.length}c ${fmt(Date.now() - fStart)}`);
      } catch (e) { console.log(`  F: ❌ ${trunc(String(e), 80)}`); }
      const fLat = Date.now() - fStart;

      // Judge
      let ss: JudgeScore | undefined, fs: JudgeScore | undefined;
      let w = 'error';
      if (smOk && fuOk && jprov?.enabled) {
        try {
          const jr = await callModel(jprov, jm.model, [
            { role: 'system', content: 'Return ONLY valid JSON.' },
            { role: 'user', content: judgePrompt(q.text, smC, fuC) },
          ], { maxTokens: 2000, temperature: 0.2 });
          const p = parseScores(jr.content);
          ss = p.sa; fs = p.sb;
        } catch (e) { console.log(`  J: ⚠ ${trunc(String(e), 60)}`); }
      }
      if (ss && fs) w = fs.overall > ss.overall + 0.5 ? 'fusion' : ss.overall > fs.overall + 0.5 ? 'single' : 'tie';
      else if (smOk) w = 'single';
      else if (fuOk) w = 'fusion';

      results.push({ q, sm: smOk, fu: fuOk, ss, fs, w, sl: sLat, fl: fLat, sc: smCo, fc: fuCo });
      console.log(`  → ${w === 'fusion' ? '🏆 Fusion' : w === 'single' ? '🏆 Single' : w === 'tie' ? '⚖️ Tie' : '❌ Error'}\n`);
    }

    const report = genReport(results, sm.id, jm.id);
    fs.writeFileSync(OUTPUT, report, 'utf-8');
    console.log(`✅ Report: ${OUTPUT}\n`);

    const fw = results.filter(r => r.w === 'fusion').length;
    const sw = results.filter(r => r.w === 'single').length;
    console.log(`Fusion: ${fw}/${results.length} | Single: ${sw}/${results.length} | Ties: ${results.filter(r => r.w === 'tie').length}`);
    const sc = results.filter(r => r.fs);
    if (sc.length) console.log(`Avg: Fusion ${(sc.reduce((s: number, r: any) => s + r.fs.overall, 0) / sc.length).toFixed(1)} vs Single ${(sc.reduce((s: number, r: any) => s + r.ss.overall, 0) / sc.length).toFixed(1)}`);
    console.log(`\nnpx tsx scripts/benchmark.ts\n`);
  } finally { await app.close(); }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
