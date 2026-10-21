/* 端到端交互自检：node tools/e2e.mjs
 * 需要先启动带 --remote-debugging-port 的 Edge。
 */
import assert from 'node:assert/strict';

const PORT = process.env.CDP_PORT || '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = 'file:///' + process.cwd().replace(/\\/g, '/') + '/';

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
    errors.push(msg.params.exceptionDetails.text + ' ' +
      (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || ''));
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

async function evaluate(expression) {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.text + ' ' +
      (out.exceptionDetails.exception && out.exceptionDetails.exception.description || ''));
  }
  return out.result.value;
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
  await sleep(600);
}

async function reload() {
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
  await send('Page.reload');
  await loaded;
  await sleep(500);
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push('  ✓ ' + name);
  } catch (err) {
    results.push('  ✗ ' + name + ' — ' + err.message);
    process.exitCode = 1;
  }
}

console.log('家账本 · 界面交互自检\n');

await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false
});

await navigate(base + 'index.html?e2e=0');
await evaluate('localStorage.clear()');
await navigate(base + 'index.html?e2e=1');

await check('首次打开显示欢迎页', async () => {
  const data = JSON.parse(await evaluate(`JSON.stringify({
    count: LedgerStore.countAll(),
    welcome: !!document.querySelector('.welcome'),
    title: document.querySelector('#page-title').textContent
  })`));
  assert.equal(data.count, 0);
  assert.equal(data.welcome, true);
  assert.equal(data.title, '概览');
});

await check('通过弹窗记一笔支出', async () => {
  await evaluate(`document.querySelector('.topbar [data-action="new-tx"]').click()`);
  await sleep(250);
  assert.equal(await evaluate(`!!document.querySelector('#tx-form')`), true);
  await evaluate(`(function(){
    function set(sel, val) {
      var el = document.querySelector(sel);
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    set('#amount-input', '88.5');
    document.querySelector('.cat-chip[data-id="c-food"]').click();
    set('[data-field="note"]', '测试午餐');
    document.querySelector('#tx-form').requestSubmit();
  })()`);
  await sleep(400);
  const data = JSON.parse(await evaluate(`JSON.stringify({
    count: LedgerStore.countAll(),
    sum: LedgerStore.summary({ month: LedgerStore.currentMonth() }),
    text: document.querySelector('#view').innerText
  })`));
  assert.equal(data.count, 1);
  assert.equal(data.sum.expense, 88.5);
  assert.ok(data.text.includes('测试午餐'));
  assert.ok(data.text.includes('88.50'));
});

await check('点击记录可编辑金额', async () => {
  await evaluate(`document.querySelector('.tx').click()`);
  await sleep(250);
  assert.equal(await evaluate(`document.querySelector('#sheet-title').textContent`), '编辑记录');
  await evaluate(`(function(){
    var el = document.querySelector('#amount-input');
    el.value = '100';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#tx-form').requestSubmit();
  })()`);
  await sleep(400);
  const amount = await evaluate(`LedgerStore.query({}).map(function(t){ return t.amount; })[0]`);
  assert.equal(amount, 100);
});

await check('明细页搜索筛选生效', async () => {
  await evaluate(`location.hash = '#/records'`);
  await sleep(350);
  assert.equal(await evaluate(`document.querySelectorAll('.tx').length`), 1);
  await evaluate(`(function(){
    var el = document.querySelector('#search-input');
    el.value = '午餐';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(350);
  assert.equal(await evaluate(`document.querySelectorAll('.tx').length`), 1);
  await evaluate(`(function(){
    var el = document.querySelector('#search-input');
    el.value = '不存在的关键词';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(350);
  assert.equal(await evaluate(`document.querySelectorAll('.tx').length`), 0);
  assert.ok((await evaluate(`document.querySelector('#records-list').innerText`)).includes('没有符合条件'));
  await evaluate(`(function(){
    var el = document.querySelector('#search-input');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(350);
});

await check('删除记录需二次确认', async () => {
  await evaluate(`document.querySelector('.tx').click()`);
  await sleep(250);
  await evaluate(`document.querySelector('[data-action="delete-tx"]').click()`);
  await sleep(250);
  assert.equal(await evaluate(`!!document.querySelector('#confirm-root [data-confirm="yes"]')`), true);
  await evaluate(`document.querySelector('#confirm-root [data-confirm="yes"]').click()`);
  await sleep(400);
  assert.equal(await evaluate(`LedgerStore.countAll()`), 0);
  await evaluate(`location.hash = '#/overview'`);
  await sleep(350);
  assert.equal(await evaluate(`!!document.querySelector('.welcome')`), true);
});

await check('记一笔收入并切换分类', async () => {
  await evaluate(`document.querySelector('.topbar [data-action="new-tx"]').click()`);
  await sleep(250);
  await evaluate(`document.querySelector('[data-action="type-switch"][data-type="income"]').click()`);
  await sleep(200);
  assert.equal(await evaluate(`document.querySelector('#amount-input') !== null`), true);
  assert.ok((await evaluate(`document.querySelector('.cat-grid').innerText`)).includes('工资'));
  await evaluate(`(function(){
    var el = document.querySelector('#amount-input');
    el.value = '5000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#tx-form').requestSubmit();
  })()`);
  await sleep(400);
  const sum = JSON.parse(await evaluate(`JSON.stringify(LedgerStore.summary({ month: LedgerStore.currentMonth() }))`));
  assert.equal(sum.income, 5000);
  assert.equal(sum.expense, 0);
});

await check('刷新后数据仍然存在', async () => {
  await reload();
  const data = JSON.parse(await evaluate(`JSON.stringify({
    count: LedgerStore.countAll(),
    sum: LedgerStore.summary({ month: LedgerStore.currentMonth() })
  })`));
  assert.equal(data.count, 1);
  assert.equal(data.sum.income, 5000);
});

await check('设置页保存预算', async () => {
  await evaluate(`location.hash = '#/settings'`);
  await sleep(350);
  await evaluate(`(function(){
    var el = document.querySelector('#budget-input');
    el.value = '3000';
    document.querySelector('[data-action="save-budget"]').click();
  })()`);
  await sleep(300);
  assert.equal(await evaluate(`LedgerStore.getSettings().monthlyBudget`), 3000);
});

await check('设置页新增成员', async () => {
  await evaluate(`(function(){
    var form = document.querySelector('[data-form="add-member"]');
    form.elements.name.value = '爷爷';
    form.requestSubmit();
  })()`);
  await sleep(300);
  const names = JSON.parse(await evaluate(`JSON.stringify(LedgerStore.getMembers().map(function(m){ return m.name; }))`));
  assert.equal(names.length, 4);
  assert.ok(names.includes('爷爷'));
});

await check('设置页新增分类', async () => {
  await evaluate(`(function(){
    var form = document.querySelector('[data-form="add-category"]');
    form.elements.name.value = '咖啡';
    form.elements.icon.value = '☕';
    form.requestSubmit();
  })()`);
  await sleep(300);
  const cats = JSON.parse(await evaluate(`JSON.stringify(LedgerStore.getCategories().filter(function(c){ return c.name === '咖啡'; }))`));
  assert.equal(cats.length, 1);
  assert.equal(cats[0].icon, '☕');
});

await check('月份切换与回到本月', async () => {
  await evaluate(`location.hash = '#/overview'`);
  await sleep(350);
  const current = await evaluate(`document.querySelector('#month-label').textContent`);
  await evaluate(`document.querySelector('[data-action="month-prev"]').click()`);
  await sleep(300);
  const prev = await evaluate(`document.querySelector('#month-label').textContent`);
  assert.notEqual(prev, current);
  await evaluate(`document.querySelector('[data-action="month-today"]').click()`);
  await sleep(300);
  assert.equal(await evaluate(`document.querySelector('#month-label').textContent`), current);
});

await check('页面运行期无 JS 异常', () => {
  assert.deepEqual(errors, []);
});

console.log(results.join('\n'));
console.log(process.exitCode ? '\n存在失败用例' : '\n全部通过');
ws.close();
