/*
 * bench-node.mjs — 在 Node 中复现浏览器内基准（同样的算法模块、同样的固定种子）
 * 用法：node tools/bench-node.mjs [count]   默认 1000
 * Node 22 内置 CompressionStream，与浏览器原生 gzip 对照一致。
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchmark } from '../js/bench.js';

const count = parseInt(process.argv[2] || '1000', 10);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const r = await runBenchmark({ count });
const out = {
  generatedAt: r.generatedAt,
  count: r.count,
  platform: `Node ${process.version}`,
  sizes: Object.fromEntries(Object.entries(r.sizes).filter(([, v]) => v).map(([k, v]) => [k, { mean: +v.mean.toFixed(2), median: v.median, min: v.min, max: v.max }])),
  encMs: Object.fromEntries(Object.entries(r.encMs).filter(([, v]) => v).map(([k, v]) => [k, +v.median.toFixed(5)])),
  decMs: Object.fromEntries(Object.entries(r.decMs).filter(([, v]) => v).map(([k, v]) => [k, +v.median.toFixed(5)])),
  network: {
    cfg: r.network.cfg,
    json: { meanMs: +r.network.mc.json.meanMs.toFixed(0), p50: +r.network.mc.json.p50.toFixed(0), p95: +r.network.mc.json.p95.toFixed(0), successRate: +r.network.mc.json.successRate.toFixed(4) },
    l0: { meanMs: +r.network.mc.layered.l0.meanMs.toFixed(0), p50: +r.network.mc.layered.l0.p50.toFixed(0), p95: +r.network.mc.layered.l0.p95.toFixed(0), successRate: +r.network.mc.layered.l0.successRate.toFixed(4) },
    l1: { meanMs: +r.network.mc.layered.l1.meanMs.toFixed(0), p95: +r.network.mc.layered.l1.p95.toFixed(0) },
    l2: { meanMs: +r.network.mc.layered.l2.meanMs.toFixed(0), p50: +r.network.mc.layered.l2.p50.toFixed(0), p95: +r.network.mc.layered.l2.p95.toFixed(0) },
    analytic: {
      json: +r.network.analytic.json.toFixed(0),
      l0: +r.network.analytic.l0.toFixed(0),
      l2: +r.network.analytic.l2.toFixed(0),
    },
  },
  energy: { json: +r.energy.json.total.toFixed(2), l0: +r.energy.l0.total.toFixed(2), full: +r.energy.full.total.toFixed(2) },
  ratios: {
    jsonVsLayered: +r.ratios.jsonVsLayered.toFixed(2),
    jsonVsL0: +r.ratios.jsonVsL0.toFixed(2),
    ttfa: +r.ratios.ttfa.toFixed(2),
  },
};
writeFileSync(join(root, 'tools', 'bench-results.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
