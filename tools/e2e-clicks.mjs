/* e2e-clicks.mjs — 交互修复验证：场景/信道原位切换、发送/换信道/运行按钮 */
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchEdge, newPage, sleep } from './cdp-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8123/index.html';
const tmp = join(root, 'tools', '.edge-profile-clicks');
rmSync(tmp, { recursive: true, force: true });

const edge = await launchEdge({ port: 9223, height: 950, userDataDir: tmp });
let failures = 0;
function assert(cond, msg) {
  console.log((cond ? '  PASS ' : '  FAIL ') + msg);
  if (!cond) failures++;
}

try {
  const cdp = await newPage(edge, 9223, BASE + '#/mission');
  await sleep(1500);

  const counts = () => cdp.eval(`JSON.stringify({
    h1: document.querySelectorAll('#view .chapter h1').length,
    stage: document.querySelectorAll('#mission-stage').length,
    cards: document.querySelectorAll('.scenario-card').length,
    btn: document.querySelectorAll('button').length,
  })`).then(JSON.parse);

  console.log('[mission] 初始渲染');
  let c = await counts();
  assert(c.h1 === 1 && c.stage === 1 && c.cards === 3 && c.btn === 2,
    `初始仅一份页面 (h1=${c.h1}, stage=${c.stage}, cards=${c.cards}, btn=${c.btn})`);

  console.log('[mission] 点击发送');
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('发送')).click()`);
  await sleep(600);
  let pkts = await cdp.eval(`document.querySelectorAll('#mission-stage .pkt').length`);
  assert(pkts > 0, `发送后泳道出现数据包 (${pkts})`);
  await sleep(15000); // 动画结束
  const verdict = await cdp.eval(`!!document.querySelector('#mission-stage .verdict')`);
  assert(verdict, '动画结束出现结论卡');

  console.log('[mission] 切换到第 2 个场景（地震）');
  await cdp.eval(`document.querySelectorAll('.scenario-card')[1].click()`);
  await sleep(2000);
  c = await counts();
  assert(c.h1 === 1 && c.stage === 1 && c.cards === 3 && c.btn === 2,
    `原位替换、无追加 (h1=${c.h1}, stage=${c.stage}, cards=${c.cards})`);
  assert(await cdp.eval(`document.querySelectorAll('.scenario-card')[1].classList.contains('selected')`), '第 2 张卡为选中态');
  pkts = await cdp.eval(`document.querySelectorAll('#mission-stage .pkt').length`);
  assert(pkts > 0, '切换后自动重跑动画');

  console.log('[mission] 切换到第 3 个场景（台风）');
  await cdp.eval(`document.querySelectorAll('.scenario-card')[2].click()`);
  await sleep(1000);
  c = await counts();
  assert(c.h1 === 1 && c.stage === 1 && c.cards === 3,
    `再次切换仍只有一份 (h1=${c.h1}, stage=${c.stage})`);
  assert(await cdp.eval(`document.querySelectorAll('.scenario-card')[2].classList.contains('selected')`), '第 3 张卡为选中态');

  console.log('[mission] 切换信道 profile chip（弱 2G）');
  await cdp.eval(`[...document.querySelectorAll('.chip')].find(x=>x.textContent.includes('GPRS')).click()`);
  await sleep(1500);
  c = await counts();
  assert(c.h1 === 1 && c.stage === 1, `切信道后仍只有一份 (h1=${c.h1}, stage=${c.stage})`);
  assert(await cdp.eval(`[...document.querySelectorAll('.chip')].filter(x=>x.textContent.includes('GPRS')).length===1`),
    'GPRS chip 仅一个');

  console.log('[mission] 点击「换一个随机信道」');
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('换一个随机信道')).click()`);
  await sleep(800);
  c = await counts();
  assert(c.h1 === 1 && c.stage === 1, `换信道后仍只有一份 (h1=${c.h1}, stage=${c.stage})`);
  pkts = await cdp.eval(`document.querySelectorAll('#mission-stage .pkt').length`);
  assert(pkts > 0, '换信道后新动画在当前副本播放');

  console.log('[network] 弱网实验室信道切换与运行');
  await cdp.navigate(BASE + '#/network');
  await sleep(2000);
  const netCounts = () => cdp.eval(`JSON.stringify({
    h1: document.querySelectorAll('#view .chapter h1').length,
    chips: [...document.querySelectorAll('.chip')].filter(x=>x.textContent.includes('bps')||x.textContent.includes('2G')||x.textContent.includes('EDGE')||x.textContent.includes('4G')).length,
    on: [...document.querySelectorAll('.chip.on')].map(x=>x.textContent.trim()),
  })`).then(JSON.parse);
  let n = await netCounts();
  assert(n.h1 === 1 && n.chips === 4, `初始 4 个信道 chip、单份页面 (h1=${n.h1}, chips=${n.chips})`);
  for (const key of ['EDGE', 'GPRS', '4G']) {
    await cdp.eval(`[...document.querySelectorAll('.chip')].find(x=>x.textContent.includes('${key}')).click()`);
    await sleep(100);
    n = await netCounts();
    assert(n.h1 === 1 && n.chips === 4, `点击 ${key} 后仍单份 (h1=${n.h1}, chips=${n.chips})`);
    assert(n.on.some((t) => t.includes(key)), `${key} chip 进入选中态 (${n.on.join(',')})`);
  }
  // 运行按钮
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('蒙特卡洛')).click()`);
  await sleep(1200);
  const cards = await cdp.eval(`document.querySelectorAll('#view .chapter .metric').length`);
  assert(cards >= 4, `运行后结果指标卡刷新 (${cards})`);
  n = await netCounts();
  assert(n.h1 === 1, `运行后仍单份页面 (h1=${n.h1})`);

  console.log('\n=== EXCEPTIONS ===');
  const errs = cdp.exceptions
    .map((e) => (e.url ? `${e.url}:${e.lineNumber} ${e.text}` : ''))
    .filter(Boolean);
  console.log(errs.length ? errs.join('\n') : '(none)');
  const errLogs = cdp.console.filter((x) => x.type === 'error' && !x.text.includes('SW register')).map((x) => x.text);
  console.log('=== CONSOLE ERRORS ===');
  console.log(errLogs.length ? errLogs.join('\n') : '(none)');
  if (errs.length || errLogs.length) failures++;
} catch (e) {
  console.error('E2E FAIL:', e);
  failures++;
} finally {
  edge.proc.kill();
}
console.log(failures ? `\n存在 ${failures} 个失败项` : '\n全部交互断言通过');
process.exit(failures ? 1 : 0);
