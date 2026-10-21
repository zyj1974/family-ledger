/* 数据层自检脚本：node tools/check.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
const memory = new Map();

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Intl,
  Map,
  Set,
  Promise,
  localStorage: {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const S = sandbox.LedgerStore;
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push('  ✓ ' + name);
  } catch (err) {
    results.push('  ✗ ' + name + ' — ' + err.message);
    process.exitCode = 1;
  }
}

console.log('家账本 · 数据层自检\n');

check('首次启动为空账本', () => {
  assert.equal(S.countAll(), 0);
  assert.equal(S.getMembers().length, 3);
  assert.ok(S.getCategories().length >= 18);
  assert.equal(S.getSettings().monthlyBudget, 0);
  assert.ok(memory.has(S.STORAGE_KEY), '应写入 localStorage');
});

check('日期工具正确', () => {
  assert.equal(S.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(S.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(S.daysInMonth('2024-02'), 29);
  assert.equal(S.daysInMonth('2026-02'), 28);
  assert.deepEqual(Array.from(S.monthsBack('2026-03', 3)), ['2026-01', '2026-02', '2026-03']);
});

const catFood = S.getCategories().find(c => c.id === 'c-food');
const catSalary = S.getCategories().find(c => c.id === 'i-salary');
const dad = S.getMembers()[0];
const mom = S.getMembers()[1];

check('新增记录并自动汇总', () => {
  const a = S.addTransaction({ type: 'expense', amount: 25.5, date: '2026-10-02', categoryId: catFood.id, memberId: mom.id, account: '微信', note: '午餐' });
  assert.equal(a.ok, true);
  const b = S.addTransaction({ type: 'income', amount: 1000, date: '2026-10-10', categoryId: catSalary.id, memberId: dad.id, account: '银行卡', note: '工资' });
  assert.equal(b.ok, true);
  const sum = S.summary({ month: '2026-10' });
  assert.equal(sum.income, 1000);
  assert.equal(sum.expense, 25.5);
  assert.equal(sum.balance, 974.5);
  assert.equal(sum.count, 2);
});

check('更新记录', () => {
  const list = S.query({ month: '2026-10', type: 'expense' });
  const res = S.updateTransaction(list[0].id, { amount: 30, note: '午餐加饮料' });
  assert.equal(res.ok, true);
  assert.equal(S.summary({ month: '2026-10' }).expense, 30);
});

check('非法金额被拦截', () => {
  const res = S.addTransaction({ type: 'expense', amount: 0, date: '2026-10-02', categoryId: catFood.id, memberId: mom.id });
  assert.equal(res.ok, false);
  assert.match(res.error, /金额/);
});

check('分类筛选与搜索', () => {
  assert.equal(S.query({ month: '2026-10', categoryId: catFood.id }).length, 1);
  assert.equal(S.query({ q: '饮料' }).length, 1);
  assert.equal(S.query({ q: '不存在的关键词' }).length, 0);
});

check('分类统计与成员统计', () => {
  const cats = S.categoryTotals({ month: '2026-10', type: 'expense' });
  assert.equal(cats[0].id, catFood.id);
  assert.equal(cats[0].amount, 30);
  assert.ok(Math.abs(cats[0].percent - 100) < 1e-9);
  const members = S.memberTotals({ month: '2026-10', type: 'expense' });
  const momRow = members.find(m => m.id === mom.id);
  assert.equal(momRow.amount, 30);
  assert.equal(members.find(m => m.id === dad.id).amount, 0);
});

check('预算保存', () => {
  S.setBudget(8000);
  assert.equal(S.getSettings().monthlyBudget, 8000);
  S.setBudget(-5);
  assert.equal(S.getSettings().monthlyBudget, 0);
  S.setBudget(8000);
});

check('删除记录', () => {
  const list = S.query({ month: '2026-10', type: 'expense' });
  assert.equal(S.deleteTransaction(list[0].id).ok, true);
  assert.equal(S.summary({ month: '2026-10' }).expense, 0);
});

check('删除成员时转移记录', () => {
  S.addTransaction({ type: 'expense', amount: 12, date: '2026-10-03', categoryId: catFood.id, memberId: mom.id, account: '现金', note: '早餐' });
  const res = S.deleteMember(mom.id);
  assert.equal(res.ok, true);
  assert.equal(res.moved, 1);
  assert.equal(S.getMembers().length, 2);
  const left = S.query({ month: '2026-10', type: 'expense' });
  assert.ok(S.getMembers().some(m => m.id === left[0].memberId));
});

check('删除分类时转移记录', () => {
  S.addCategory('咖啡', '☕', 'expense');
  const coffee = S.getCategories().find(c => c.name === '咖啡');
  S.addTransaction({ type: 'expense', amount: 19, date: '2026-10-04', categoryId: coffee.id, memberId: dad.id, account: '微信', note: '拿铁' });
  const res = S.deleteCategory(coffee.id);
  assert.equal(res.ok, true);
  assert.equal(res.moved, 1);
  const rows = S.query({ month: '2026-10', type: 'expense' });
  assert.ok(S.categoryById(rows[0].categoryId));
});

check('导入导出往返一致', () => {
  const before = S.exportData();
  const restored = S.importData(JSON.parse(JSON.stringify(before)));
  assert.equal(restored.ok, true);
  const after = S.exportData();
  assert.equal(after.transactions.length, before.transactions.length);
  assert.deepEqual(Array.from(after.transactions.map(t => t.amount)), Array.from(before.transactions.map(t => t.amount)));
});

check('拒绝非法导入数据', () => {
  const res = S.importData({ foo: 'bar' });
  assert.equal(res.ok, false);
  assert.ok(S.countAll() >= 1);
});

check('CSV 含 BOM 与表头', () => {
  const csv = S.toCSV(S.query({}));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /日期,类型,分类,金额,成员,账户,备注/);
});

check('示例数据合理', () => {
  S.loadDemo();
  assert.ok(S.countAll() > 50, '示例记录应足够多');
  const months = S.monthsBack(S.currentMonth(), 6);
  const total = S.summary({ months });
  assert.ok(total.income > 100000);
  assert.ok(total.expense > 30000);
  assert.ok(total.income > total.expense);
  const latest = S.summary({ month: S.currentMonth() });
  assert.ok(latest.count > 0);
});

check('清空与恢复出厂', () => {
  S.clearTransactions();
  assert.equal(S.countAll(), 0);
  S.resetAll();
  assert.equal(S.countAll(), 0);
  assert.equal(S.getSettings().monthlyBudget, 0);
});

console.log(results.join('\n'));
console.log(process.exitCode ? '\n存在失败用例' : '\n全部通过');
