/* 家账本 · 本地数据层
 * 所有数据保存在浏览器 localStorage，不依赖后端。
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'family-ledger-data-v1';
  const listeners = new Set();
  let storageOk = true;
  let state = null;

  const MEMBER_COLORS = [
    '#c9614a', '#e0a458', '#2f9e79', '#5b8def',
    '#8f7bc4', '#5f9ea0', '#b5795a', '#7c8f52'
  ];

  const CATEGORY_COLORS = [
    '#e07a5f', '#e0a458', '#81a995', '#6b8cae', '#9a8c98',
    '#a3b18a', '#c58f9d', '#7fa8a0', '#6c7a9c', '#b5838d',
    '#d98e73', '#5f9ea0', '#d9a441', '#8a9a5b', '#b5795a'
  ];

  const DEFAULT_ACCOUNTS = ['微信', '支付宝', '银行卡', '现金'];

  const DEFAULT_MEMBERS = [
    { id: 'm-dad', name: '爸爸', color: '#5b8def' },
    { id: 'm-mom', name: '妈妈', color: '#c9614a' },
    { id: 'm-kid', name: '孩子', color: '#e0a458' }
  ];

  const DEFAULT_CATEGORIES = [
    { id: 'c-food', type: 'expense', name: '餐饮', icon: '🍚', color: '#e07a5f' },
    { id: 'c-grocery', type: 'expense', name: '买菜', icon: '🥬', color: '#81a995' },
    { id: 'c-transport', type: 'expense', name: '交通', icon: '🚗', color: '#6b8cae' },
    { id: 'c-house', type: 'expense', name: '住房', icon: '🏠', color: '#9a8c98' },
    { id: 'c-utility', type: 'expense', name: '水电燃气', icon: '💡', color: '#e0a458' },
    { id: 'c-daily', type: 'expense', name: '日用', icon: '🧻', color: '#a3b18a' },
    { id: 'c-clothes', type: 'expense', name: '服饰', icon: '👕', color: '#c58f9d' },
    { id: 'c-medical', type: 'expense', name: '医疗', icon: '💊', color: '#7fa8a0' },
    { id: 'c-edu', type: 'expense', name: '教育', icon: '📚', color: '#6c7a9c' },
    { id: 'c-fun', type: 'expense', name: '娱乐', icon: '🎬', color: '#b5838d' },
    { id: 'c-gift', type: 'expense', name: '人情', icon: '🎁', color: '#d98e73' },
    { id: 'c-travel', type: 'expense', name: '旅行', icon: '✈️', color: '#5f9ea0' },
    { id: 'c-other', type: 'expense', name: '其他', icon: '📦', color: '#9aa0a6' },
    { id: 'i-salary', type: 'income', name: '工资', icon: '💼', color: '#2f9e79' },
    { id: 'i-bonus', type: 'income', name: '奖金', icon: '🏆', color: '#d9a441' },
    { id: 'i-invest', type: 'income', name: '理财', icon: '📈', color: '#5b8def' },
    { id: 'i-side', type: 'income', name: '兼职', icon: '💻', color: '#8f7bc4' },
    { id: 'i-red', type: 'income', name: '红包', icon: '🧧', color: '#d95d5d' },
    { id: 'i-other', type: 'income', name: '其他', icon: '💰', color: '#8a9a5b' }
  ];

  /* ---------- 基础工具 ---------- */

  function pad2(n) { return String(n).padStart(2, '0'); }

  function round2(n) {
    const v = Number(n);
    if (!isFinite(v)) return 0;
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function currentMonth() { return todayISO().slice(0, 7); }
  function monthOf(date) { return String(date || '').slice(0, 7); }

  function shiftMonth(month, delta) {
    const p = String(month).split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function monthsBack(endMonth, count) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) out.push(shiftMonth(endMonth, -i));
    return out;
  }

  function daysInMonth(month) {
    const p = String(month).split('-');
    return new Date(Number(p[0]), Number(p[1]), 0).getDate();
  }

  function colorOf(value, fallbackIndex) {
    return /^#[0-9a-f]{3,8}$/i.test(String(value || ''))
      ? String(value)
      : CATEGORY_COLORS[fallbackIndex % CATEGORY_COLORS.length];
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 初始数据 ---------- */

  function emptyState() {
    return {
      version: 1,
      members: DEFAULT_MEMBERS.map(function (m) { return Object.assign({}, m); }),
      categories: DEFAULT_CATEGORIES.map(function (c) { return Object.assign({}, c); }),
      accounts: DEFAULT_ACCOUNTS.slice(),
      transactions: [],
      settings: { monthlyBudget: 0 },
      meta: { demo: false, createdAt: new Date().toISOString() }
    };
  }

  function buildDemoState() {
    const s = emptyState();
    s.meta.demo = true;
    s.settings.monthlyBudget = 10000;

    const now = new Date();
    const today = todayISO();
    const rng = mulberry32(20261021);
    const pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    let seq = 0;

    function push(monthKey, day, type, categoryId, amount, memberId, note, account) {
      const date = monthKey + '-' + pad2(Math.min(day, daysInMonth(monthKey)));
      if (date > today) return;
      seq += 1;
      s.transactions.push({
        id: 'demo-' + seq,
        type: type,
        amount: round2(amount),
        date: date,
        categoryId: categoryId,
        memberId: memberId,
        account: account,
        note: note,
        createdAt: date + 'T' + pad2(8 + (seq % 12)) + ':' + pad2((seq * 17) % 60) + ':00'
      });
    }

    const foodNotes = ['公司食堂午餐', '周末家庭聚餐', '楼下小面馆', '外卖晚餐', '咖啡和甜点', '早餐包子铺', '朋友聚餐', '孩子学校午餐'];
    const groceryNotes = ['超市采购', '菜市场买菜', '水果和牛奶', '周末囤菜', '生鲜到家'];
    const transportNotes = ['地铁通勤', '打车回家', '加油', '停车费', '公交卡充值'];
    const dailyNotes = ['超市日用品', '纸巾和洗衣液', '网购收纳盒', '厨房用品'];
    const funNotes = ['周末电影', '亲子乐园', '健身月卡', '游戏充值'];

    for (let off = 5; off >= 0; off--) {
      const d = new Date(now.getFullYear(), now.getMonth() - off, 1);
      const key = d.getFullYear() + '-' + pad2(d.getMonth() + 1);

      push(key, 10, 'income', 'i-salary', 15000, 'm-dad', '月度工资', '银行卡');
      push(key, 15, 'income', 'i-salary', 9000, 'm-mom', '月度工资', '银行卡');
      if (rng() < 0.75) push(key, 21, 'income', 'i-invest', 160 + Math.round(rng() * 460), 'm-dad', '理财收益', '支付宝');
      if (rng() < 0.3) push(key, 8, 'income', 'i-bonus', 3000, 'm-dad', '季度奖金', '银行卡');
      if (rng() < 0.45) push(key, 3, 'income', 'i-red', 200 + Math.round(rng() * 700), 'm-kid', '长辈给的红包', '微信');

      push(key, 1, 'expense', 'c-house', 5200, 'm-dad', '房贷月供', '银行卡');
      push(key, 5, 'expense', 'c-edu', 1200, 'm-kid', '英语培训班', '银行卡');
      push(key, 12, 'expense', 'c-utility', 220 + Math.round(rng() * 170), 'm-mom', '水电燃气费', '支付宝');

      const foodCount = 9 + Math.floor(rng() * 4);
      for (let i = 0; i < foodCount; i++) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-food',
          18 + Math.round(rng() * 95), rng() < 0.45 ? 'm-dad' : 'm-mom',
          pick(foodNotes), rng() < 0.5 ? '微信' : '支付宝');
      }

      const groceryCount = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < groceryCount; i++) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-grocery',
          35 + Math.round(rng() * 130), 'm-mom', pick(groceryNotes), '微信');
      }

      const transportCount = 5 + Math.floor(rng() * 3);
      for (let i = 0; i < transportCount; i++) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-transport',
          10 + Math.round(rng() * 55), 'm-dad', pick(transportNotes), '支付宝');
      }

      const dailyCount = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < dailyCount; i++) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-daily',
          25 + Math.round(rng() * 150), 'm-mom', pick(dailyNotes), '微信');
      }

      const funCount = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < funCount; i++) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-fun',
          50 + Math.round(rng() * 240), rng() < 0.6 ? 'm-kid' : 'm-dad', pick(funNotes), '微信');
      }

      if (rng() < 0.45) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-clothes',
          120 + Math.round(rng() * 420), 'm-mom', '换季添置衣物', '支付宝');
      }
      if (rng() < 0.35) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-medical',
          60 + Math.round(rng() * 320), 'm-kid', '感冒买药', '微信');
      }
      if (rng() < 0.4) {
        push(key, 1 + Math.floor(rng() * 28), 'expense', 'c-gift',
          200 + Math.round(rng() * 800), 'm-dad', '亲友随礼', '微信');
      }
      if (off === 2) {
        push(key, 18, 'expense', 'c-travel', 2600, 'm-mom', '周边亲子游', '银行卡');
      }
    }

    s.transactions.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    return s;
  }

  /* ---------- 校验 & 规范化 ---------- */

  function normalize(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.transactions)) {
      throw new Error('invalid data');
    }
    const base = emptyState();

    const memberIds = new Set();
    const members = [];
    (Array.isArray(input.members) ? input.members : []).forEach(function (m, i) {
      if (!m || !m.id || !m.name) return;
      const id = String(m.id);
      if (memberIds.has(id)) return;
      memberIds.add(id);
      members.push({
        id: id,
        name: String(m.name).slice(0, 20),
        color: /^#[0-9a-f]{3,8}$/i.test(String(m.color || ''))
          ? m.color
          : MEMBER_COLORS[i % MEMBER_COLORS.length]
      });
    });

    const catIds = new Set();
    const categories = [];
    (Array.isArray(input.categories) ? input.categories : []).forEach(function (c, i) {
      if (!c || !c.id || !c.name) return;
      const id = String(c.id);
      if (catIds.has(id)) return;
      const type = c.type === 'income' ? 'income' : 'expense';
      catIds.add(id);
      categories.push({
        id: id,
        type: type,
        name: String(c.name).slice(0, 12),
        icon: String(c.icon || (type === 'income' ? '💰' : '📦')).slice(0, 4),
        color: colorOf(c.color, i)
      });
    });

    const accounts = Array.isArray(input.accounts)
      ? input.accounts.filter(function (a) { return typeof a === 'string' && a.trim(); }).slice(0, 20)
      : [];

    const settings = Object.assign({}, base.settings, input.settings && typeof input.settings === 'object' ? input.settings : {});
    settings.monthlyBudget = Math.max(0, round2(Number(settings.monthlyBudget) || 0));

    const safeMembers = members.length ? members : base.members;
    const safeCategories = categories.length ? categories : base.categories;
    const safeAccounts = accounts.length ? accounts : base.accounts;

    const transactions = input.transactions.map(function (t) {
      if (!t) return null;
      const type = t.type === 'income' ? 'income' : 'expense';
      let categoryId = String(t.categoryId || '');
      let cat = safeCategories.find(function (c) { return c.id === categoryId && c.type === type; });
      if (!cat) cat = safeCategories.filter(function (c) { return c.type === type; })[0];
      categoryId = cat.id;
      let memberId = String(t.memberId || '');
      if (!safeMembers.some(function (m) { return m.id === memberId; })) memberId = safeMembers[0].id;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) ? String(t.date) : todayISO();
      return {
        id: String(t.id || uid('t')),
        type: type,
        amount: round2(Math.max(0, Number(t.amount) || 0)),
        date: date,
        categoryId: categoryId,
        memberId: memberId,
        account: String(t.account || ''),
        note: String(t.note || '').slice(0, 80),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : date + 'T12:00:00'
      };
    }).filter(Boolean);

    return {
      version: 1,
      members: safeMembers,
      categories: safeCategories,
      accounts: safeAccounts,
      transactions: transactions,
      settings: settings,
      meta: Object.assign({}, base.meta, input.meta && typeof input.meta === 'object' ? input.meta : {})
    };
  }

  /* ---------- 持久化 ---------- */

  function persist() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageOk = true;
    } catch (err) {
      storageOk = false;
    }
  }

  function init() {
    let raw = null;
    try {
      raw = global.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      storageOk = false;
    }

    if (raw) {
      try {
        state = normalize(JSON.parse(raw));
      } catch (err) {
        state = null;
      }
    }

    if (!state) {
      state = emptyState();
      persist();
    }
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (err) { /* 单个订阅者出错不影响其他人 */ }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.add(fn);
    return function () { listeners.delete(fn); };
  }

  /* ---------- 只读访问 ---------- */

  function getState() { return state; }
  function getMembers() { return state.members.slice(); }
  function getCategories() { return state.categories.slice(); }
  function getAccounts() { return state.accounts.slice(); }
  function getSettings() { return Object.assign({}, state.settings); }
  function countAll() { return state.transactions.length; }

  function categoryById(id) {
    return state.categories.find(function (c) { return c.id === id; }) || null;
  }

  function memberById(id) {
    return state.members.find(function (m) { return m.id === id; }) || null;
  }

  function getTransaction(id) {
    return state.transactions.find(function (t) { return t.id === id; }) || null;
  }

  /* ---------- 查询 ---------- */

  function query(filter) {
    filter = filter || {};
    const month = filter.month;
    const months = Array.isArray(filter.months) ? filter.months : null;
    const type = filter.type && filter.type !== 'all' ? filter.type : null;
    const memberId = filter.memberId && filter.memberId !== 'all' ? filter.memberId : null;
    const categoryId = filter.categoryId && filter.categoryId !== 'all' ? filter.categoryId : null;
    const q = String(filter.q || '').trim().toLowerCase();

    return state.transactions.filter(function (t) {
      if (month && monthOf(t.date) !== month) return false;
      if (months && months.length && months.indexOf(monthOf(t.date)) === -1) return false;
      if (type && t.type !== type) return false;
      if (memberId && t.memberId !== memberId) return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (q) {
        const c = categoryById(t.categoryId);
        const m = memberById(t.memberId);
        const hay = [t.note, c ? c.name : '', m ? m.name : '', t.account, String(t.amount)]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function summary(opts) {
    opts = opts || {};
    const rows = opts.list || query({ month: opts.month, months: opts.months });
    let income = 0;
    let expense = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].type === 'income') income += rows[i].amount;
      else expense += rows[i].amount;
    }
    income = round2(income);
    expense = round2(expense);
    return { income: income, expense: expense, balance: round2(income - expense), count: rows.length };
  }

  function trend(months) {
    return (months || []).map(function (m) {
      const s = summary({ month: m });
      return {
        month: m,
        label: Number(m.slice(5, 7)) + '月',
        income: s.income,
        expense: s.expense,
        balance: s.balance
      };
    });
  }

  function categoryTotals(opts) {
    opts = opts || {};
    const type = opts.type === 'income' ? 'income' : 'expense';
    const rows = opts.list || query({ month: opts.month, months: opts.months, type: type });
    const total = round2(rows.reduce(function (a, t) { return a + t.amount; }, 0));
    const map = new Map();
    rows.forEach(function (t) {
      const c = categoryById(t.categoryId) || { id: 'unknown', name: '未分类', icon: '❓', color: '#9aa0a6' };
      const cur = map.get(c.id) || { id: c.id, name: c.name, icon: c.icon, color: c.color, amount: 0, count: 0 };
      cur.amount += t.amount;
      cur.count += 1;
      map.set(c.id, cur);
    });
    return Array.from(map.values()).map(function (c) {
      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        amount: round2(c.amount),
        count: c.count,
        percent: total ? (c.amount / total) * 100 : 0
      };
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  function memberTotals(opts) {
    opts = opts || {};
    const type = opts.type === 'income' ? 'income' : 'expense';
    const rows = query({ month: opts.month, months: opts.months, type: type });
    const total = rows.reduce(function (a, t) { return a + t.amount; }, 0);
    const map = new Map();
    state.members.forEach(function (m) {
      map.set(m.id, { id: m.id, name: m.name, color: m.color, amount: 0, count: 0 });
    });
    rows.forEach(function (t) {
      const cur = map.get(t.memberId);
      if (!cur) return;
      cur.amount += t.amount;
      cur.count += 1;
    });
    return Array.from(map.values()).map(function (m) {
      return {
        id: m.id,
        name: m.name,
        color: m.color,
        amount: round2(m.amount),
        count: m.count,
        percent: total ? (m.amount / total) * 100 : 0
      };
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  function memberComparison(opts) {
    opts = opts || {};
    const rows = query({ months: opts.months });
    const map = new Map();
    state.members.forEach(function (m) {
      map.set(m.id, { id: m.id, name: m.name, color: m.color, income: 0, expense: 0 });
    });
    rows.forEach(function (t) {
      const cur = map.get(t.memberId);
      if (!cur) return;
      if (t.type === 'income') cur.income += t.amount;
      else cur.expense += t.amount;
    });
    return Array.from(map.values()).map(function (m) {
      return {
        id: m.id,
        name: m.name,
        color: m.color,
        income: round2(m.income),
        expense: round2(m.expense),
        balance: round2(m.income - m.expense)
      };
    });
  }

  /* ---------- 写入 ---------- */

  function validateTx(input) {
    const amount = round2(input.amount);
    if (!(amount > 0)) return '请输入大于 0 的金额';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ''))) return '请选择有效日期';
    const cat = categoryById(input.categoryId);
    if (!cat) return '请选择分类';
    if (cat.type !== input.type) return '分类与收支类型不匹配';
    if (!state.members.some(function (m) { return m.id === input.memberId; })) return '请选择家庭成员';
    return null;
  }

  function addTransaction(input) {
    const err = validateTx(input);
    if (err) return { ok: false, error: err };
    const tx = {
      id: uid('t'),
      type: input.type === 'income' ? 'income' : 'expense',
      amount: round2(input.amount),
      date: input.date,
      categoryId: input.categoryId,
      memberId: input.memberId,
      account: input.account || '',
      note: String(input.note || '').trim().slice(0, 80),
      createdAt: new Date().toISOString()
    };
    state.transactions.push(tx);
    persist();
    notify();
    return { ok: true, transaction: tx };
  }

  function updateTransaction(id, patch) {
    const tx = getTransaction(id);
    if (!tx) return { ok: false, error: '记录不存在' };
    const next = Object.assign({}, tx, patch);
    const err = validateTx(next);
    if (err) return { ok: false, error: err };
    tx.type = next.type === 'income' ? 'income' : 'expense';
    tx.amount = round2(next.amount);
    tx.date = next.date;
    tx.categoryId = next.categoryId;
    tx.memberId = next.memberId;
    tx.account = next.account || '';
    tx.note = String(next.note || '').trim().slice(0, 80);
    persist();
    notify();
    return { ok: true, transaction: tx };
  }

  function deleteTransaction(id) {
    const idx = state.transactions.findIndex(function (t) { return t.id === id; });
    if (idx < 0) return { ok: false, error: '记录不存在' };
    state.transactions.splice(idx, 1);
    persist();
    notify();
    return { ok: true };
  }

  function addMember(name, color) {
    const n = String(name || '').trim().slice(0, 12);
    if (!n) return { ok: false, error: '请输入成员称呼' };
    if (state.members.some(function (m) { return m.name === n; })) {
      return { ok: false, error: '这个成员已经存在了' };
    }
    const member = {
      id: uid('m'),
      name: n,
      color: /^#[0-9a-f]{3,8}$/i.test(String(color || ''))
        ? color
        : MEMBER_COLORS[state.members.length % MEMBER_COLORS.length]
    };
    state.members.push(member);
    persist();
    notify();
    return { ok: true, member: member };
  }

  function deleteMember(id) {
    if (state.members.length <= 1) return { ok: false, error: '至少保留一位家庭成员' };
    const idx = state.members.findIndex(function (m) { return m.id === id; });
    if (idx < 0) return { ok: false, error: '成员不存在' };
    const fallback = state.members.find(function (m) { return m.id !== id; });
    let moved = 0;
    state.transactions.forEach(function (t) {
      if (t.memberId === id) {
        t.memberId = fallback.id;
        moved += 1;
      }
    });
    state.members.splice(idx, 1);
    persist();
    notify();
    return { ok: true, moved: moved };
  }

  function addCategory(name, icon, type) {
    const n = String(name || '').trim().slice(0, 10);
    if (!n) return { ok: false, error: '请输入分类名称' };
    const t = type === 'income' ? 'income' : 'expense';
    if (state.categories.some(function (c) { return c.name === n && c.type === t; })) {
      return { ok: false, error: '该分类已经存在了' };
    }
    const category = {
      id: uid('c'),
      type: t,
      name: n,
      icon: String(icon || (t === 'income' ? '💰' : '📦')).slice(0, 4),
      color: CATEGORY_COLORS[state.categories.length % CATEGORY_COLORS.length]
    };
    state.categories.push(category);
    persist();
    notify();
    return { ok: true, category: category };
  }

  function deleteCategory(id) {
    const cat = categoryById(id);
    if (!cat) return { ok: false, error: '分类不存在' };
    const sameType = state.categories.filter(function (c) { return c.type === cat.type && c.id !== id; });
    if (!sameType.length) return { ok: false, error: '该类型至少保留一个分类' };
    const fallback = sameType.find(function (c) { return c.name === '其他'; }) || sameType[0];
    let moved = 0;
    state.transactions.forEach(function (t) {
      if (t.categoryId === id) {
        t.categoryId = fallback.id;
        moved += 1;
      }
    });
    state.categories = state.categories.filter(function (c) { return c.id !== id; });
    persist();
    notify();
    return { ok: true, moved: moved };
  }

  function setBudget(amount) {
    const n = Math.max(0, Math.min(10000000, round2(Number(amount) || 0)));
    state.settings.monthlyBudget = n;
    persist();
    notify();
    return { ok: true, amount: n };
  }

  /* ---------- 数据交换 ---------- */

  function exportData() {
    return {
      app: '家账本',
      version: 1,
      exportedAt: new Date().toISOString(),
      members: state.members.map(function (m) { return Object.assign({}, m); }),
      categories: state.categories.map(function (c) { return Object.assign({}, c); }),
      accounts: state.accounts.slice(),
      transactions: state.transactions.map(function (t) { return Object.assign({}, t); }),
      settings: Object.assign({}, state.settings),
      meta: Object.assign({}, state.meta)
    };
  }

  function importData(input) {
    try {
      const next = normalize(input);
      state = next;
      persist();
      notify();
      return { ok: true, count: next.transactions.length };
    } catch (err) {
      return { ok: false, error: '文件格式不正确，无法导入' };
    }
  }

  function csvCell(value) {
    const s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(list) {
    const rows = (list || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    const lines = ['日期,类型,分类,金额,成员,账户,备注'];
    rows.forEach(function (t) {
      const cat = categoryById(t.categoryId);
      const mem = memberById(t.memberId);
      lines.push([
        t.date,
        t.type === 'income' ? '收入' : '支出',
        cat ? cat.name : '未分类',
        round2(t.amount).toFixed(2),
        mem ? mem.name : '',
        t.account || '',
        t.note || ''
      ].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  function loadDemo() {
    state = buildDemoState();
    persist();
    notify();
    return { ok: true, count: state.transactions.length };
  }

  function clearTransactions() {
    state.transactions = [];
    state.meta.demo = false;
    persist();
    notify();
    return { ok: true };
  }

  function resetAll() {
    state = emptyState();
    persist();
    notify();
    return { ok: true };
  }

  function isStorageOk() { return storageOk; }

  /* ---------- 启动 ---------- */

  init();

  global.LedgerStore = {
    MEMBER_COLORS: MEMBER_COLORS,
    STORAGE_KEY: STORAGE_KEY,
    todayISO: todayISO,
    currentMonth: currentMonth,
    monthOf: monthOf,
    shiftMonth: shiftMonth,
    monthsBack: monthsBack,
    daysInMonth: daysInMonth,
    getState: getState,
    getMembers: getMembers,
    getCategories: getCategories,
    getAccounts: getAccounts,
    getSettings: getSettings,
    countAll: countAll,
    categoryById: categoryById,
    memberById: memberById,
    getTransaction: getTransaction,
    query: query,
    summary: summary,
    trend: trend,
    categoryTotals: categoryTotals,
    memberTotals: memberTotals,
    memberComparison: memberComparison,
    addTransaction: addTransaction,
    updateTransaction: updateTransaction,
    deleteTransaction: deleteTransaction,
    addMember: addMember,
    deleteMember: deleteMember,
    addCategory: addCategory,
    deleteCategory: deleteCategory,
    setBudget: setBudget,
    exportData: exportData,
    importData: importData,
    toCSV: toCSV,
    loadDemo: loadDemo,
    clearTransactions: clearTransactions,
    resetAll: resetAll,
    subscribe: subscribe,
    isStorageOk: isStorageOk
  };
})(window);
