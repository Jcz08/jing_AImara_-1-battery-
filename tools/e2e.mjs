/* e2e.mjs — 逐章真实交互测试 + 截图 + 控制台错误收集 */
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchEdge, newPage, sleep } from './cdp-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8123/index.html';
const SHOT = join(root, 'screenshots', 'raw');
rmSync(SHOT, { recursive: true, force: true });

const tmp = join(root, 'tools', '.edge-profile');
rmSync(tmp, { recursive: true, force: true });
const edge = await launchEdge({ port: 9222, height: 950, userDataDir: tmp });
const errors = [];
try {
  const cdp = await newPage(edge, 9222, BASE + '#/boot');

  // 0. 等待自检完成
  for (let i = 0; i < 40; i++) {
    const ready = await cdp.eval(`!!document.querySelector('.boot .btn.primary:not([disabled])')`).catch(() => false);
    if (ready) break;
    await sleep(300);
  }
  await sleep(800);
  await cdp.fullPageScreenshot(join(SHOT, '01-boot.png'));
  console.log('boot done');

  // 1. 序章
  await cdp.navigate(BASE + '#/intro'); await sleep(900);
  // 展开第一个折叠
  await cdp.eval(`document.querySelectorAll('.fold')[0]?.setAttribute('open','')`);
  await cdp.fullPageScreenshot(join(SHOT, '02-intro.png'));
  console.log('intro done');

  // 2. 任务：执行发送动画
  await cdp.navigate(BASE + '#/mission'); await sleep(1200);
  await cdp.eval(`document.querySelector('.btn.primary')?.click()`); // 发送
  console.log('mission animation running, wait 16s...');
  await sleep(16000);
  await cdp.fullPageScreenshot(join(SHOT, '03-mission.png'));
  console.log('mission done');

  // 3. 编码实验室
  await cdp.navigate(BASE + '#/lab'); await sleep(1500);
  await cdp.fullPageScreenshot(join(SHOT, '04-lab.png'));
  // 打开位检视器
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('位级检视'))?.click()`);
  await sleep(900);
  await cdp.eval(`document.querySelector('#modal-root').scrollTop=0`);
  await cdp.fullPageScreenshot(join(SHOT, '05-lab-bits.png'));
  // 关闭，打开 Huffman 树
  await cdp.eval(`document.querySelector('.modal-close')?.click()`);
  await sleep(400);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Huffman 树'))?.click()`);
  await sleep(1200);
  await cdp.fullPageScreenshot(join(SHOT, '06-lab-tree.png'));
  await cdp.eval(`document.querySelector('.modal-close')?.click()`);
  await sleep(300);
  console.log('lab done');

  // 4. 弱网实验室（自动运行一次）
  await cdp.navigate(BASE + '#/network'); await sleep(2500);
  await cdp.fullPageScreenshot(join(SHOT, '07-network.png'));
  console.log('network done');

  // 5. 基准
  await cdp.navigate(BASE + '#/bench'); await sleep(900);
  await cdp.eval(`document.querySelector('.btn.green')?.click()`);
  for (let i = 0; i < 60; i++) {
    const done = await cdp.eval(`!!document.querySelector('.bar-chart')`).catch(() => false);
    if (done) break;
    await sleep(400);
  }
  await sleep(1000);
  await cdp.fullPageScreenshot(join(SHOT, '08-bench.png'));
  console.log('bench done');

  // 6. 离线（renderOffline 内部等待 SW 安装，最多 8 秒）
  await cdp.navigate(BASE + '#/offline'); await sleep(10000);
  await cdp.eval(`document.querySelector('.sim-offline, .btn') && [...document.querySelectorAll('button')].find(b=>b.textContent.includes('模拟断网'))?.click()`);
  await sleep(700);
  await cdp.fullPageScreenshot(join(SHOT, '09-offline.png'));
  console.log('offline done');

  // 7. 终章
  await cdp.navigate(BASE + '#/reflection'); await sleep(900);
  await cdp.fullPageScreenshot(join(SHOT, '10-reflection.png'));
  console.log('reflection done');

  // 汇总错误（只统计页面脚本错误；eval 探针的错误带 url 为空）
  const errorsNow = cdp.exceptions
    .map((e) => ({ where: e.url || '(eval)', line: e.lineNumber, text: e.text, desc: e.exception?.description }))
    .filter((e) => e.where !== '(eval)')
    .map((e) => `${e.where}:${e.line} ${e.text || ''} ${e.desc || ''}`);
  const errLogs = cdp.console.filter((c) => c.type === 'error' && !c.text.includes('SW register')).map((c) => c.text);
  console.log('\n=== EXCEPTIONS ===');
  console.log(errorsNow.length ? errorsNow.join('\n') : '(none)');
  console.log('=== CONSOLE ERRORS ===');
  console.log(errLogs.length ? errLogs.join('\n') : '(none)');

  // 运行核心算法自测（页面内）
  const pageRoundtrip = await cdp.eval(`(async () => {
    const m = { ts: 1760380000, type:0, lat:22.2543, lon:113.5321, people:4, severity:2,
      needs:{medical:1,water:0,food:0,shelter:0,warmth:1,rescue:1}, phrases:[0,8,13],
      text:'队友小腿骨折无法移动，我们在溪谷东侧巨石下，需要担架转移。' };
    const p = await import('./js/protocol.js');
    const rt = p.roundTripOK(m);
    return { monolithic: rt.monolithic, layered: rt.layered };
  })()`, true);
  console.log('=== PAGE ROUNDTRIP ===', JSON.stringify(pageRoundtrip));

  if (errorsNow.length || errLogs.length) process.exitCode = 1;
} catch (e) {
  console.error('E2E FAIL:', e);
  process.exitCode = 1;
} finally {
  edge.proc.kill();
}
