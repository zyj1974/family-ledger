/* PWA 验收：node tools/pwa.mjs
 * 需要先启动 server.mjs 与带 --remote-debugging-port 的 Edge。
 */
const PORT = process.env.CDP_PORT || '9333';
const SITE = process.env.SITE_URL || 'http://127.0.0.1:8099/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const errors = [];
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
    errors.push(d.text + ' ' + (d.exception && d.exception.description || ''));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
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
await send('Network.enable');

async function evaluate(expression) {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.text + ' ' +
      (out.exceptionDetails.exception && out.exceptionDetails.exception.description || ''));
  }
  return out.result.value;
}

async function waitLoad(timeout = 6000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout);
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
}

async function open(url) {
  const loaded = waitLoad();
  await send('Page.navigate', { url });
  await loaded;
  await sleep(900);
}

const results = [];
function check(name, ok, detail) {
  results.push((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) process.exitCode = 1;
}

console.log('家账本 · PWA 自检\n');

await open(SITE);
await sleep(1500);

const manifestInfo = await send('Page.getAppManifest').catch((err) => ({ error: String(err) }));
check('manifest 可加载', !manifestInfo.error && !!manifestInfo.data, JSON.stringify(manifestInfo.errors || []));

let installability = null;
try {
  installability = await send('Page.getInstallabilityErrors');
} catch (err) {
  installability = { unsupported: String(err) };
}
const installErrors = installability && installability.installabilityErrors || [];
check('满足可安装条件', installErrors.length === 0,
  installErrors.map((e) => e.errorId + (e.errorArguments ? ':' + JSON.stringify(e.errorArguments) : '')).join(', '));

const swInfo = JSON.parse(await evaluate(`navigator.serviceWorker.getRegistration().then(function (r) {
  return JSON.stringify({
    supported: 'serviceWorker' in navigator,
    scope: r && r.scope,
    active: !!(r && r.active),
    waiting: !!(r && r.waiting),
    controller: !!navigator.serviceWorker.controller
  });
})`));
check('Service Worker 已激活', swInfo.supported && swInfo.active, JSON.stringify(swInfo));

const cacheKeys = JSON.parse(await evaluate(`caches.keys().then(function (keys) { return JSON.stringify(keys); })`));
check('应用资源已写入缓存', cacheKeys.some((k) => k.indexOf('family-ledger') === 0), JSON.stringify(cacheKeys));

// 第二次加载让页面处于 SW 控制下
await open(SITE);
const controlled = await evaluate(`!!navigator.serviceWorker.controller`);
check('页面已由 Service Worker 接管', controlled === true);

// 离线重载
await send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
});
await open(SITE);
const offline = JSON.parse(await evaluate(`JSON.stringify({
  title: document.title,
  welcome: !!document.querySelector('.welcome'),
  heroOrWelcome: !!document.querySelector('.hero') || !!document.querySelector('.welcome'),
  styled: getComputedStyle(document.body).backgroundColor,
  controller: !!navigator.serviceWorker.controller
})`));
check('断网后仍可打开并渲染', offline.title.indexOf('家账本') >= 0 && offline.styled === 'rgb(246, 244, 239)',
  JSON.stringify(offline));

await send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
});

check('运行期无 JS 异常', errors.length === 0, errors.join(' | '));

console.log(results.join('\n'));
console.log(process.exitCode ? '\n存在失败用例' : '\n全部通过');
ws.close();
