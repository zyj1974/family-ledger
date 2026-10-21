/* 截图与运行时检查：node tools/shoot.mjs
 * 需要先启动带 --remote-debugging-port 的 Edge。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.CDP_PORT || '9333';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
fs.mkdirSync(docs, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = 'file:///' + root.replace(/\\/g, '/') + '/';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没有可用的页面目标');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
let errors = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push('异常: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push('log: ' + msg.params.entry.text);
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

async function navigate(url) {
  const loaded = new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Page.loadEventFired') {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve();
      }
    };
    ws.addEventListener('message', handler);
  });
  await send('Page.navigate', { url });
  await loaded;
  await sleep(700);
}

async function shoot(spec) {
  errors = [];
  await send('Emulation.setDeviceMetricsOverride', {
    width: spec.width,
    height: spec.height,
    deviceScaleFactor: spec.dsf || 1,
    mobile: !!spec.mobile,
    screenWidth: spec.width,
    screenHeight: spec.height
  });

  if (spec.clearStorage) {
    await send('Page.navigate', { url: base + 'index.html' });
    await sleep(300);
    await evaluate('localStorage.clear()');
  }

  await navigate(base + spec.url);

  const metrics = JSON.parse(await evaluate(`JSON.stringify({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    mainWidth: Math.round((document.querySelector('.main') || {getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width),
    bodyWidth: Math.round(document.body.getBoundingClientRect().width),
    title: document.title,
    route: location.hash
  })`));

  let shotParams;
  if (spec.fullPage) {
    const layout = await send('Page.getLayoutMetrics');
    const size = layout.cssContentSize;
    shotParams = {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 }
    };
  } else {
    shotParams = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  }

  const shot = await send('Page.captureScreenshot', shotParams);
  fs.writeFileSync(path.join(docs, spec.name + '.png'), Buffer.from(shot.data, 'base64'));
  return { name: spec.name, metrics, errors: errors.slice() };
}

const shots = [
  { name: 'overview', url: '_preview.html', width: 1440, height: 1000, fullPage: true },
  { name: 'records', url: '_preview.html?v=records#/records', width: 1440, height: 1000, fullPage: true },
  { name: 'stats', url: '_preview.html?v=stats#/stats', width: 1440, height: 1000, fullPage: true },
  { name: 'settings', url: '_preview.html?v=settings#/settings', width: 1440, height: 1000, fullPage: true },
  { name: 'modal', url: '_preview_modal.html', width: 1440, height: 1000, fullPage: false },
  { name: 'mobile-overview', url: '_preview.html?v=m1', width: 390, height: 844, dsf: 2, mobile: true, fullPage: false },
  { name: 'mobile-records', url: '_preview.html?v=m2#/records', width: 390, height: 844, dsf: 2, mobile: true, fullPage: false },
  { name: 'mobile-modal', url: '_preview_modal.html?v=m3', width: 390, height: 844, dsf: 2, mobile: true, fullPage: false },
  { name: 'mobile-stats', url: '_preview.html?v=m4#/stats', width: 390, height: 844, dsf: 2, mobile: true, fullPage: false },
  { name: 'mobile-settings', url: '_preview.html?v=m5#/settings', width: 390, height: 844, dsf: 2, mobile: true, fullPage: false },
  { name: 'desktop-1280', url: '_preview.html?v=d1', width: 1280, height: 900, fullPage: false },
  { name: 'empty', url: 'index.html?v=empty', width: 1440, height: 1000, fullPage: false, clearStorage: true },
  { name: 'empty-mobile', url: 'index.html?v=empty2', width: 390, height: 844, dsf: 2, mobile: true, fullPage: false }
];

const report = [];
for (const spec of shots) {
  try {
    const result = await shoot(spec);
    report.push(result);
    console.log('✓ ' + spec.name + ' ' + JSON.stringify(result.metrics) + (result.errors.length ? ' ERRORS: ' + result.errors.join(' | ') : ''));
  } catch (err) {
    report.push({ name: spec.name, error: String(err) });
    console.log('✗ ' + spec.name + ' ' + err);
  }
}

fs.writeFileSync(path.join(docs, 'metrics.json'), JSON.stringify(report, null, 2));
console.log('\n截图完成，报告写入 docs/metrics.json');
ws.close();
