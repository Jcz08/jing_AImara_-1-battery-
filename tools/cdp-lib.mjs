/* 极简 CDP 客户端（Node 内置 WebSocket / fetch），用于无头 Edge 测试与截图 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export async function launchEdge({ port = 9222, width = 1440, height = 2200, userDataDir } = {}) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    `--user-data-dir=${userDataDir}`,
  ];
  const proc = spawn(EDGE, args, { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try {
      const v = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      if (v.webSocketDebuggerUrl) return { proc, port, browserWs: v.webSocketDebuggerUrl };
    } catch { /* 等待启动 */ }
    await sleep(250);
  }
  throw new Error('Edge CDP 启动超时');
}

export class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.console = [];
    this.exceptions = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', reject);
      this.ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pending.has(m.id)) {
          const { resolve: r, reject: rj } = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) rj(new Error(JSON.stringify(m.error)));
          else r(m.result);
        } else if (m.method) {
          this.events.push(m);
          if (m.method === 'Runtime.consoleAPICalled') {
            const args = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
            this.console.push({ type: m.params.type, text: args });
          }
          if (m.method === 'Runtime.exceptionThrown') {
            this.exceptions.push(m.params.exceptionDetails);
          }
        }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    const ws = this.ws;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      this.exceptions.push(r.exceptionDetails);
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    }
    return r.result?.value;
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(1200);
  }
  async fullPageScreenshot(outPath) {
    const h = await this.eval('document.documentElement.scrollHeight');
    const w = await this.eval('document.documentElement.scrollWidth');
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.max(w, 1280), height: h, scale: 1 },
    });
    mkdirSync(outPath.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true });
    writeFileSync(outPath, Buffer.from(data, 'base64'));
  }
}

export async function newPage(browser, port, url) {
  // 通过 HTTP API 创建新页签
  await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).catch(() => {});
  await sleep(600);
  const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page' && t.url.includes('127.0.0.1'));
  if (!page) throw new Error('未找到页面 target: ' + JSON.stringify(list.map((t) => t.url)));
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await sleep(500);
  return cdp;
}

export { sleep };
