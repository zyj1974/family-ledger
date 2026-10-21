/* 家账本 · 界面与交互 */
(function () {
  'use strict';

  const Store = window.LedgerStore;
  const Charts = window.LedgerCharts;

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  const ui = {
    route: 'overview',
    month: Store.currentMonth(),
    filters: { type: 'all', memberId: 'all', categoryId: 'all', q: '' },
    statsRange: 6,
    statsCatType: 'expense',
    catTab: 'expense',
    editingId: null,
    draft: null,
    confirmResolve: null
  };

  let searchTimer = null;
  let resizeTimer = null;

  /* ---------------- 小工具 ---------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function fmtMoney(n) {
    return Number(n || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function signedMoney(n) {
    const abs = Math.abs(Number(n) || 0);
    return (Number(n) < 0 ? '−' : '') + '¥' + fmtMoney(abs);
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function monthLabel(key) {
    const p = String(key).split('-');
    return p[0] + '年' + Number(p[1]) + '月';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function shiftDate(iso, delta) {
    const p = iso.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2] + delta);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function weekdayOf(iso) {
    const p = iso.split('-').map(Number);
    return '日一二三四五六'[new Date(p[0], p[1] - 1, p[2]).getDay()];
  }

  function dateLabel(iso) {
    const today = Store.todayISO();
    if (iso === today) return '今天';
    if (iso === shiftDate(today, -1)) return '昨天';
    const p = iso.split('-').map(Number);
    return p[1] + '月' + p[2] + '日';
  }

  function dayLabel(iso) {
    const today = Store.todayISO();
    const base = (function () {
      const p = iso.split('-').map(Number);
      return p[1] + '月' + p[2] + '日 周' + weekdayOf(iso);
    })();
    if (iso === today) return '今天 · ' + base;
    if (iso === shiftDate(today, -1)) return '昨天 · ' + base;
    return base;
  }

  function routeFromHash() {
    const hash = String(location.hash || '').replace(/^#\/?/, '');
    return ['overview', 'records', 'stats', 'settings'].indexOf(hash) >= 0 ? hash : 'overview';
  }

  function accountOptions(selected) {
    const accounts = Store.getAccounts();
    if (selected && accounts.indexOf(selected) === -1) accounts.push(selected);
    return accounts.map(function (a) {
      return '<option value="' + esc(a) + '"' + (a === selected ? ' selected' : '') + '>' + esc(a) + '</option>';
    }).join('');
  }

  function categoryFilterOptions(type) {
    const cats = Store.getCategories();
    const selected = ui.filters.categoryId;
    let html = '';
    [['expense', '支出分类'], ['income', '收入分类']].forEach(function (pair) {
      if (type !== 'all' && type !== pair[0]) return;
      const group = cats.filter(function (c) { return c.type === pair[0]; });
      if (!group.length) return;
      html += '<optgroup label="' + pair[1] + '">';
      group.forEach(function (c) {
        html += '<option value="' + c.id + '"' + (selected === c.id ? ' selected' : '') + '>' +
          esc(c.icon + ' ' + c.name) + '</option>';
      });
      html += '</optgroup>';
    });
    return html;
  }

  function sanitizeFilters() {
    if (ui.filters.memberId !== 'all' && !Store.memberById(ui.filters.memberId)) ui.filters.memberId = 'all';
    if (ui.filters.categoryId !== 'all') {
      const cat = Store.categoryById(ui.filters.categoryId);
      if (!cat || (ui.filters.type !== 'all' && cat.type !== ui.filters.type)) ui.filters.categoryId = 'all';
    }
  }

  /* ---------------- 通用片段 ---------------- */

  function txRowHTML(t, compact) {
    const cat = Store.categoryById(t.categoryId);
    const mem = Store.memberById(t.memberId);
    const color = cat ? cat.color : '#9aa0a6';
    const emoji = cat ? cat.icon : '❓';
    const name = cat ? cat.name : '未分类';
    const meta = [];
    if (mem) {
      meta.push('<span class="mini-dot" style="background:' + mem.color + '"></span>' + esc(mem.name));
    }
    if (t.account) meta.push(esc(t.account));
    if (!compact) meta.push(esc(dateLabel(t.date)));
    return '<li class="tx" data-action="edit-tx" data-id="' + esc(t.id) + '" tabindex="0" role="button" ' +
      'aria-label="编辑 ' + esc(name) + ' ' + fmtMoney(t.amount) + ' 元">' +
      '<span class="tx-icon" style="background:' + color + '1f">' + esc(emoji) + '</span>' +
      '<div class="tx-body">' +
        '<div class="tx-title"><span>' + esc(name) + '</span>' +
          (t.note ? '<span class="tx-note">' + esc(t.note) + '</span>' : '') +
        '</div>' +
        '<div class="tx-meta">' + meta.join('<span class="sep">·</span>') + '</div>' +
      '</div>' +
      '<div class="tx-amount ' + t.type + '">' + (t.type === 'income' ? '+' : '−') +
        '<span class="cur">¥</span>' + fmtMoney(t.amount) + '</div>' +
    '</li>';
  }

  function emptyBlock(emoji, title, text, action) {
    return '<div class="empty">' +
      '<div class="empty-icon" aria-hidden="true">' + emoji + '</div>' +
      '<h3>' + esc(title) + '</h3>' +
      '<p>' + esc(text) + '</p>' +
      (action || '') +
    '</div>';
  }

  function kpiCard(cls, label, value, sub) {
    return '<div class="kpi ' + cls + '">' +
      '<span>' + esc(label) + '</span>' +
      '<strong>' + value + '</strong>' +
      '<small>' + esc(sub) + '</small>' +
    '</div>';
  }

  /* ---------------- 概览 ---------------- */

  function welcomeView() {
    return '<section class="welcome">' +
      '<div class="welcome-body">' +
        '<span class="eyebrow">开始记账</span>' +
        '<h2>把每一笔收支，都记在家的账本里</h2>' +
        '<p>记录收入与开销，自动汇总成月度报表。数据只保存在本机浏览器，随时可以导出备份。</p>' +
        '<div class="welcome-actions">' +
          '<button class="btn btn-primary" data-action="new-tx">' + icon('plus') + '<span class="btn-label">记第一笔</span></button>' +
          '<button class="btn btn-ghost" data-action="load-demo">看看示例数据</button>' +
        '</div>' +
      '</div>' +
      '<div class="welcome-art" aria-hidden="true">📒</div>' +
    '</section>' +
    '<div class="features">' +
      '<article class="feature"><span class="feature-icon">📊</span><h3>自动汇总</h3><p>月度收支、分类占比、成员花费，一屏看清。</p></article>' +
      '<article class="feature"><span class="feature-icon">👨‍👩‍👧</span><h3>家庭成员</h3><p>每一笔都能归属到人，谁花的钱一目了然。</p></article>' +
      '<article class="feature"><span class="feature-icon">🔒</span><h3>本地保存</h3><p>数据不上传云端，支持 JSON 备份与 CSV 导出。</p></article>' +
    '</div>';
  }

  function donutItemsFor(month) {
    const cats = Store.categoryTotals({ month: month, type: 'expense' });
    const items = cats.slice(0, 5).map(function (c) {
      return { name: c.name, amount: c.amount, color: c.color };
    });
    if (cats.length > 5) {
      const rest = cats.slice(5).reduce(function (a, c) { return a + c.amount; }, 0);
      items.push({ name: '其他分类', amount: round2(rest), color: '#b9b3a8' });
    }
    return items;
  }

  function overviewView() {
    if (Store.countAll() === 0) return welcomeView();

    const month = ui.month;
    const summary = Store.summary({ month: month });
    const budget = Store.getSettings().monthlyBudget;
    const used = budget > 0 ? (summary.expense / budget) * 100 : 0;
    const over = budget > 0 && summary.expense > budget;
    const recent = Store.query({ month: month }).slice(0, 6);
    const legend = donutItemsFor(month);
    const members = Store.memberTotals({ month: month, type: 'expense' });
    const peak = Math.max.apply(null, [1].concat(members.map(function (m) { return m.amount; })));

    let budgetText;
    if (budget <= 0) {
      budgetText = '还没有设置月度预算，<a href="#/settings">去设置</a>';
    } else if (over) {
      budgetText = '已超支 ¥' + fmtMoney(summary.expense - budget) + ' · 预算 ¥' + fmtMoney(budget);
    } else {
      budgetText = '剩余 ¥' + fmtMoney(budget - summary.expense) + ' · 预算 ¥' + fmtMoney(budget);
    }

    return '<section class="hero' + (over ? ' is-over' : '') + '">' +
      '<div class="hero-main">' +
        '<span class="hero-eyebrow">本月结余</span>' +
        '<p class="hero-amount">' + (summary.balance < 0 ? '<span class="neg-sign">−</span>' : '') +
          '<span class="cur">¥</span>' + fmtMoney(Math.abs(summary.balance)) + '</p>' +
        '<div class="hero-split">' +
          '<div class="hero-stat"><span class="hero-stat-label"><i class="dot income-dot"></i>收入</span>' +
            '<strong>¥' + fmtMoney(summary.income) + '</strong></div>' +
          '<div class="hero-stat"><span class="hero-stat-label"><i class="dot expense-dot"></i>支出</span>' +
            '<strong>¥' + fmtMoney(summary.expense) + '</strong></div>' +
          '<div class="hero-stat"><span class="hero-stat-label">记录</span>' +
            '<strong>' + summary.count + ' 笔</strong></div>' +
        '</div>' +
      '</div>' +
      '<div class="hero-budget">' +
        '<div class="budget-head"><span>月度预算</span><strong>' +
          (budget > 0 ? Math.round(used) + '%' : '未设置') + '</strong></div>' +
        '<div class="budget-track"><span style="width:' + Math.min(100, Math.max(0, used)) + '%"></span></div>' +
        '<p class="budget-hint">' + budgetText + '</p>' +
      '</div>' +
    '</section>' +

    '<div class="grid grid-main">' +
      '<article class="card">' +
        '<header class="card-head"><div><h2>收支趋势</h2><p>近 6 个月</p></div>' +
          '<div class="legend-inline"><span><i class="dot income-dot"></i>收入</span>' +
          '<span><i class="dot expense-dot"></i>支出</span></div></header>' +
        '<div class="chart" id="trend-chart"></div>' +
      '</article>' +
      '<article class="card">' +
        '<header class="card-head"><div><h2>支出构成</h2><p>' + monthLabel(month) + '</p></div></header>' +
        '<div id="donut-chart" class="donut-wrap"></div>' +
        (legend.length
          ? '<ul class="legend">' + legend.map(function (it) {
              const pct = summary.expense > 0 ? Math.round((it.amount / summary.expense) * 100) : 0;
              return '<li><span class="dot" style="background:' + it.color + '"></span>' +
                '<span class="name">' + esc(it.name) + '</span>' +
                '<span class="pct">' + pct + '%</span>' +
                '<span class="val">¥' + fmtMoney(it.amount) + '</span></li>';
            }).join('') + '</ul>'
          : '<p class="empty-note">本月还没有支出记录</p>') +
      '</article>' +
    '</div>' +

    '<div class="grid grid-main">' +
      '<article class="card">' +
        '<header class="card-head"><div><h2>最近记录</h2><p>' + monthLabel(month) + '</p></div>' +
          '<a class="link" href="#/records">全部明细 →</a></header>' +
        (recent.length
          ? '<ul class="tx-list">' + recent.map(function (t) { return txRowHTML(t); }).join('') + '</ul>'
          : emptyBlock('🗒️', '本月还没有记录', '点右上角「记一笔」，开始记录这个月的收支。',
              '<button class="btn btn-soft" data-action="new-tx">记一笔</button>')) +
      '</article>' +
      '<article class="card">' +
        '<header class="card-head"><div><h2>成员支出</h2><p>本月按成员统计</p></div></header>' +
        (summary.expense > 0
          ? '<div class="member-list">' + members.map(function (m) {
              const pct = summary.expense > 0 ? Math.round((m.amount / summary.expense) * 100) : 0;
              return '<div class="member-row">' +
                '<span class="avatar" style="background:' + m.color + '1f;color:' + m.color + '">' +
                  esc(m.name.slice(0, 1)) + '</span>' +
                '<div class="member-body">' +
                  '<div class="member-line"><span>' + esc(m.name) + '</span><strong>¥' + fmtMoney(m.amount) + '</strong></div>' +
                  '<div class="rank-track"><span style="width:' + (m.amount / peak) * 100 + '%;background:' + m.color + '"></span></div>' +
                '</div>' +
                '<span class="member-pct">' + pct + '%</span>' +
              '</div>';
            }).join('') + '</div>'
          : '<p class="empty-note">本月还没有支出记录</p>') +
      '</article>' +
    '</div>';
  }

  /* ---------------- 明细 ---------------- */

  function recordsView() {
    sanitizeFilters();
    const type = ui.filters.type;
    return '<div class="card filters">' +
      '<div class="search">' + icon('search') +
        '<input id="search-input" type="search" placeholder="搜索备注、分类、成员或账户" autocomplete="off" ' +
        'aria-label="搜索记录" value="' + esc(ui.filters.q) + '">' +
      '</div>' +
      '<div class="filter-row">' +
        '<div class="segmented" role="group" aria-label="按收支类型筛选">' +
          [['all', '全部'], ['expense', '支出'], ['income', '收入']].map(function (pair) {
            return '<button data-action="filter-type" data-value="' + pair[0] + '"' +
              (type === pair[0] ? ' class="active"' : '') + '>' + pair[1] + '</button>';
          }).join('') +
        '</div>' +
        '<span class="select-wrap"><select data-change="member" aria-label="按成员筛选">' +
          '<option value="all">全部成员</option>' +
          Store.getMembers().map(function (m) {
            return '<option value="' + m.id + '"' + (ui.filters.memberId === m.id ? ' selected' : '') + '>' +
              esc(m.name) + '</option>';
          }).join('') +
        '</select></span>' +
        '<span class="select-wrap"><select data-change="category" aria-label="按分类筛选">' +
          '<option value="all">全部分类</option>' + categoryFilterOptions(type) +
        '</select></span>' +
        '<button class="btn btn-ghost btn-sm" data-action="reset-filters">重置筛选</button>' +
      '</div>' +
    '</div>' +
    '<div class="list-summary" id="list-summary"></div>' +
    '<div id="records-list"></div>';
  }

  function groupByDay(list) {
    const map = new Map();
    list.forEach(function (t) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date).push(t);
    });
    const html = [];
    map.forEach(function (items, date) {
      let expense = 0;
      let income = 0;
      items.forEach(function (t) {
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
      });
      const tail = [];
      if (expense > 0) tail.push('支出 ¥' + fmtMoney(expense));
      if (income > 0) tail.push('收入 ¥' + fmtMoney(income));
      html.push('<section class="day">' +
        '<div class="day-head"><strong>' + esc(dayLabel(date)) + '</strong>' +
          '<span>' + tail.join(' · ') + '</span></div>' +
        '<ul class="tx-list card">' + items.map(function (t) { return txRowHTML(t, true); }).join('') + '</ul>' +
      '</section>');
    });
    return html.join('');
  }

  function refreshRecords() {
    const listEl = $('#records-list');
    const sumEl = $('#list-summary');
    if (!listEl || !sumEl) return;
    sanitizeFilters();
    const list = Store.query({
      month: ui.month,
      type: ui.filters.type,
      memberId: ui.filters.memberId,
      categoryId: ui.filters.categoryId,
      q: ui.filters.q
    });
    const s = Store.summary({ list: list });
    sumEl.innerHTML =
      '<span class="sum-item">共 <strong>' + list.length + '</strong> 笔</span>' +
      '<span class="sum-item">支出 <strong class="expense-text">¥' + fmtMoney(s.expense) + '</strong></span>' +
      '<span class="sum-item">收入 <strong class="income-text">¥' + fmtMoney(s.income) + '</strong></span>' +
      '<span class="sum-item">结余 <strong>' + signedMoney(s.balance) + '</strong></span>';
    if (!list.length) {
      listEl.innerHTML = emptyBlock('🔍', '没有符合条件的记录', '换一个筛选条件，或者记一笔新的账。',
        '<button class="btn btn-primary" data-action="new-tx">记一笔</button>');
      return;
    }
    listEl.innerHTML = groupByDay(list);
  }

  /* ---------------- 统计 ---------------- */

  function statsMonths() {
    if (ui.statsRange === 'year') {
      const cur = Store.currentMonth();
      return Store.monthsBack(cur, Number(cur.slice(5, 7)));
    }
    return Store.monthsBack(Store.currentMonth(), Number(ui.statsRange) || 6);
  }

  function rangeLabel() {
    if (ui.statsRange === 'year') return '今年';
    if (Number(ui.statsRange) === 1) return '本月';
    return '近 ' + ui.statsRange + ' 个月';
  }

  function countDays(months) {
    const today = Store.todayISO();
    const current = Store.currentMonth();
    let days = 0;
    months.forEach(function (m) {
      if (m === current) days += Number(today.slice(8, 10));
      else days += Store.daysInMonth(m);
    });
    return days;
  }

  function statsView() {
    const months = statsMonths();
    const s = Store.summary({ months: months });
    const list = Store.query({ months: months });
    const days = countDays(months);
    const daily = days ? s.expense / days : 0;
    const incomeCount = list.filter(function (t) { return t.type === 'income'; }).length;
    const expenseCount = list.length - incomeCount;
    const cats = Store.categoryTotals({ months: months, type: ui.statsCatType });
    const catTotal = cats.reduce(function (a, c) { return a + c.amount; }, 0);
    const members = Store.memberComparison({ months: months });
    const peakMember = Math.max.apply(null, [1].concat(members.map(function (m) { return m.expense; })));
    const rows = Store.trend(months).slice().reverse();
    const memberTotal = members.reduce(function (acc, m) {
      acc.income += m.income;
      acc.expense += m.expense;
      return acc;
    }, { income: 0, expense: 0 });

    const ranges = [[1, '本月'], [3, '近 3 个月'], [6, '近 6 个月'], ['year', '今年']];

    return '<div class="view-toolbar">' +
      '<div class="segmented scroll-x" role="group" aria-label="统计区间">' +
        ranges.map(function (pair) {
          return '<button data-action="stats-range" data-value="' + pair[0] + '"' +
            (String(ui.statsRange) === String(pair[0]) ? ' class="active"' : '') + '>' + pair[1] + '</button>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" data-action="export-csv-range">' + icon('download') + '导出区间 CSV</button>' +
    '</div>' +

    '<div class="kpi-grid">' +
      kpiCard('income', '总收入', '¥' + fmtMoney(s.income), incomeCount + ' 笔收入') +
      kpiCard('expense', '总支出', '¥' + fmtMoney(s.expense), expenseCount + ' 笔支出') +
      kpiCard('balance' + (s.balance < 0 ? ' neg' : ''), '结余', signedMoney(s.balance),
        s.income > 0 ? '结余率 ' + Math.round((s.balance / s.income) * 100) + '%' : '暂无收入') +
      kpiCard('', '日均支出', '¥' + fmtMoney(daily), '共 ' + days + ' 天') +
    '</div>' +

    '<article class="card">' +
      '<header class="card-head"><div><h2>月度收支对比</h2><p>' + rangeLabel() + ' · 单位：元</p></div>' +
        '<div class="legend-inline"><span><i class="dot income-dot"></i>收入</span>' +
        '<span><i class="dot expense-dot"></i>支出</span></div></header>' +
      '<div class="chart" id="stats-trend"></div>' +
    '</article>' +

    '<div class="grid grid-main">' +
      '<article class="card">' +
        '<header class="card-head"><div><h2>分类排行</h2><p>' + (ui.statsCatType === 'expense' ? '支出' : '收入') + '构成</p></div>' +
          '<div class="segmented segmented-sm" role="group" aria-label="分类类型">' +
            '<button data-action="stats-cat-type" data-value="expense"' +
              (ui.statsCatType === 'expense' ? ' class="active expense"' : '') + '>支出</button>' +
            '<button data-action="stats-cat-type" data-value="income"' +
              (ui.statsCatType === 'income' ? ' class="active income"' : '') + '>收入</button>' +
          '</div></header>' +
        (cats.length
          ? '<ul class="rank-list">' + cats.slice(0, 9).map(function (c) {
              return '<li class="rank">' +
                '<span class="rank-icon" style="background:' + c.color + '1f">' + esc(c.icon) + '</span>' +
                '<div class="rank-body">' +
                  '<div class="rank-line"><span class="rank-name">' + esc(c.name) + '<em>' + c.count + ' 笔</em></span>' +
                    '<strong>¥' + fmtMoney(c.amount) + '</strong></div>' +
                  '<div class="rank-track"><span style="width:' + (catTotal ? (c.amount / catTotal) * 100 : 0) +
                    '%;background:' + c.color + '"></span></div>' +
                '</div>' +
                '<span class="rank-pct">' + Math.round(c.percent) + '%</span>' +
              '</li>';
            }).join('') + '</ul>'
          : '<p class="empty-note">这个区间还没有' + (ui.statsCatType === 'expense' ? '支出' : '收入') + '记录</p>') +
      '</article>' +

      '<article class="card">' +
        '<header class="card-head"><div><h2>成员对比</h2><p>按成员统计支出与收入</p></div></header>' +
        '<ul class="member-compare">' + members.map(function (m) {
          return '<li>' +
            '<span class="avatar" style="background:' + m.color + '1f;color:' + m.color + '">' +
              esc(m.name.slice(0, 1)) + '</span>' +
            '<div class="mc-body">' +
              '<div class="mc-line"><span>' + esc(m.name) + '</span><strong>支出 ¥' + fmtMoney(m.expense) + '</strong></div>' +
              '<div class="rank-track"><span style="width:' + (m.expense / peakMember) * 100 +
                '%;background:' + m.color + '"></span></div>' +
              '<div class="mc-sub">收入 ¥' + fmtMoney(m.income) + ' · 结余 ' + signedMoney(m.balance) + '</div>' +
            '</div>' +
          '</li>';
        }).join('') + '</ul>' +
        '<div class="member-total">' +
          '<span>全家合计</span>' +
          '<span>支出 <strong>¥' + fmtMoney(memberTotal.expense) + '</strong></span>' +
          '<span>收入 <strong>¥' + fmtMoney(memberTotal.income) + '</strong></span>' +
        '</div>' +
      '</article>' +
    '</div>' +

    '<article class="card table-card">' +
      '<header class="card-head"><div><h2>月度明细</h2><p>' + rangeLabel() + ' · 每月汇总</p></div></header>' +
      '<div class="table-wrap"><table class="table">' +
        '<thead><tr><th>月份</th><th>收入</th><th>支出</th><th>结余</th></tr></thead>' +
        '<tbody>' + rows.map(function (r) {
          return '<tr><td>' + monthLabel(r.month) + '</td>' +
            '<td class="pos">¥' + fmtMoney(r.income) + '</td>' +
            '<td class="neg">¥' + fmtMoney(r.expense) + '</td>' +
            '<td class="' + (r.balance >= 0 ? 'pos' : 'neg') + '">' + signedMoney(r.balance) + '</td></tr>';
        }).join('') + '</tbody>' +
        '<tfoot><tr><td>合计</td><td class="pos">¥' + fmtMoney(s.income) + '</td>' +
          '<td class="neg">¥' + fmtMoney(s.expense) + '</td>' +
          '<td class="' + (s.balance >= 0 ? 'pos' : 'neg') + '">' + signedMoney(s.balance) + '</td></tr></tfoot>' +
      '</table></div>' +
    '</article>';
  }

  /* ---------------- 设置 ---------------- */

  function settingsView() {
    const budget = Store.getSettings().monthlyBudget;
    const members = Store.getMembers();
    const cats = Store.getCategories();
    const demo = !!Store.getState().meta.demo;
    const emojis = ['🍽️', '🥬', '🚗', '🏠', '💡', '🧻', '👕', '💊', '📚', '🎬', '🎁', '✈️',
      '🐶', '🧸', '📱', '💄', '🏋️', '🎓', '🚌', '🧾', '💼', '🏆', '📈', '💻', '🧧', '💰', '🎯', '☕'];

    const budgetCard = '<article class="card">' +
      '<header class="card-head"><div><h2>月度预算</h2><p>用于概览页的预算进度提醒</p></div></header>' +
      '<div class="budget-form">' +
        '<label class="input-prefix"><i>¥</i><input id="budget-input" type="number" min="0" step="100" ' +
          'inputmode="decimal" placeholder="0" aria-label="每月预算" value="' + (budget > 0 ? budget : '') + '"></label>' +
        '<button class="btn btn-primary" data-action="save-budget">保存</button>' +
      '</div>' +
      '<p class="hint">填 0 表示不启用预算提醒。当前：' +
        (budget > 0 ? '¥' + fmtMoney(budget) + ' / 月' : '未设置') + '</p>' +
    '</article>';

    const memberCard = '<article class="card">' +
      '<header class="card-head"><div><h2>家庭成员</h2><p>每一笔收支都可以归属到成员</p></div>' +
        '<span class="pill">' + members.length + ' 人</span></header>' +
      '<ul class="member-manage">' + members.map(function (m) {
        const count = Store.query({ memberId: m.id }).length;
        return '<li>' +
          '<span class="avatar" style="background:' + m.color + '1f;color:' + m.color + '">' +
            esc(m.name.slice(0, 1)) + '</span>' +
          '<span class="name">' + esc(m.name) + '</span>' +
          '<span class="count">' + count + ' 笔</span>' +
          '<button class="mini-btn" data-action="del-member" data-id="' + m.id + '" ' +
            'aria-label="删除成员 ' + esc(m.name) + '" title="删除成员">' + icon('trash') + '</button>' +
        '</li>';
      }).join('') + '</ul>' +
      '<form class="inline-form" data-form="add-member">' +
        '<input name="name" type="text" maxlength="12" placeholder="添加成员，如：爷爷" aria-label="新成员称呼">' +
        '<button class="btn btn-soft" type="submit">添加</button>' +
      '</form>' +
      '<p class="hint">删除成员后，其名下记录会自动转给其他成员。</p>' +
    '</article>';

    const categoryCard = '<article class="card">' +
      '<header class="card-head"><div><h2>分类管理</h2><p>自定义支出与收入的分类</p></div></header>' +
      '<div class="segmented segmented-sm" role="group" aria-label="分类类型">' +
        '<button data-action="cat-tab" data-value="expense"' +
          (ui.catTab === 'expense' ? ' class="active expense"' : '') + '>支出</button>' +
        '<button data-action="cat-tab" data-value="income"' +
          (ui.catTab === 'income' ? ' class="active income"' : '') + '>收入</button>' +
      '</div>' +
      '<ul class="cat-manage">' + cats.filter(function (c) { return c.type === ui.catTab; }).map(function (c) {
        const count = Store.query({ categoryId: c.id }).length;
        return '<li><span class="emoji">' + esc(c.icon) + '</span>' +
          '<span class="cat-label">' + esc(c.name) + '</span>' +
          '<span class="cat-count">' + count + '</span>' +
          '<button data-action="del-category" data-id="' + c.id + '" ' +
            'aria-label="删除分类 ' + esc(c.name) + '" title="删除分类">×</button></li>';
      }).join('') + '</ul>' +
      '<form class="inline-form" data-form="add-category">' +
        '<select name="icon" aria-label="分类图标">' + emojis.map(function (e) {
          return '<option value="' + e + '">' + e + '</option>';
        }).join('') + '</select>' +
        '<input name="name" type="text" maxlength="10" placeholder="分类名称" aria-label="新分类名称">' +
        '<button class="btn btn-soft" type="submit">添加</button>' +
      '</form>' +
      '<p class="hint">删除分类时，相关记录会自动移到同类型的其他分类。</p>' +
    '</article>';

    const dataCard = '<article class="card">' +
      '<header class="card-head"><div><h2>数据与备份</h2><p>数据保存在本机浏览器</p></div>' +
        (demo ? '<span class="pill pill-warn">示例数据</span>' : '') + '</header>' +
      '<div class="data-actions">' +
        '<button class="btn btn-soft" data-action="export-json">' + icon('download') + '导出备份</button>' +
        '<button class="btn btn-soft" data-action="import-json">' + icon('upload') + '导入备份</button>' +
        '<button class="btn btn-soft" data-action="export-csv-all">' + icon('file') + '导出 CSV</button>' +
        '<button class="btn btn-danger-ghost" data-action="clear-transactions">清空所有记录</button>' +
        '<button class="btn btn-danger-ghost" data-action="factory-reset">恢复出厂设置</button>' +
      '</div>' +
      '<input type="file" id="import-file" accept="application/json,.json" hidden>' +
      '<p class="hint">建议定期导出 JSON 备份。清除浏览器数据会同时删除账本，请提前备份。</p>' +
    '</article>';

    return '<div class="settings-grid">' +
      '<div class="settings-col">' + budgetCard + categoryCard + '</div>' +
      '<div class="settings-col">' + memberCard + dataCard + '</div>' +
    '</div>';
  }

  /* ---------------- 渲染 ---------------- */

  function drawOverviewCharts() {
    const trendEl = $('#trend-chart');
    if (trendEl) {
      Charts.trend(trendEl, Store.trend(Store.monthsBack(ui.month, 6)), {
        height: window.innerWidth <= 760 ? 250 : 360
      });
    }
    const donutEl = $('#donut-chart');
    if (donutEl) {
      const summary = Store.summary({ month: ui.month });
      Charts.donut(donutEl, donutItemsFor(ui.month), summary.expense, '支出');
    }
  }

  function drawStatsChart() {
    const el = $('#stats-trend');
    if (el) Charts.trend(el, Store.trend(statsMonths()), { height: 276 });
  }

  function updateChrome() {
    const titles = { overview: '概览', records: '收支明细', stats: '统计分析', settings: '设置' };
    const monthSummary = Store.summary({ month: ui.month });
    let sub;
    if (ui.route === 'overview' || ui.route === 'records') {
      sub = monthLabel(ui.month) + ' · ' + monthSummary.count + ' 笔记录';
    } else if (ui.route === 'stats') {
      sub = rangeLabel() + '收支分析';
    } else {
      sub = '成员、分类、预算与数据备份';
    }
    $('#page-title').textContent = titles[ui.route];
    $('#page-sub').textContent = sub;
    $('#month-label').textContent = monthLabel(ui.month);
    $('#month-nav').hidden = !(ui.route === 'overview' || ui.route === 'records');

    $$('.nav-item, .tab-item').forEach(function (a) {
      const active = a.dataset.route === ui.route;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    const storageOk = Store.isStorageOk();
    const warning = $('#storage-warning');
    if (warning) warning.hidden = storageOk;
    const stateText = $('#storage-text');
    if (stateText) stateText.textContent = storageOk ? '数据保存在本机' : '数据无法保存';
    const stateDot = $('#storage-dot');
    if (stateDot) stateDot.classList.toggle('is-bad', !storageOk);
  }

  function render() {
    ui.route = routeFromHash();
    const view = $('#view');
    if (ui.route === 'overview') view.innerHTML = overviewView();
    else if (ui.route === 'records') view.innerHTML = recordsView();
    else if (ui.route === 'stats') view.innerHTML = statsView();
    else view.innerHTML = settingsView();

    updateChrome();

    if (ui.route === 'overview') drawOverviewCharts();
    else if (ui.route === 'stats') drawStatsChart();
    else if (ui.route === 'records') refreshRecords();
  }

  /* ---------------- 记账弹窗 ---------------- */

  function openTxModal(id) {
    const tx = id ? Store.getTransaction(id) : null;
    if (id && !tx) return;
    const members = Store.getMembers();
    const cats = Store.getCategories();
    const type = tx ? tx.type : 'expense';
    const firstCat = cats.find(function (c) { return c.type === type; });

    ui.editingId = tx ? tx.id : null;
    ui.draft = tx ? {
      type: tx.type,
      amount: String(tx.amount),
      date: tx.date,
      categoryId: Store.categoryById(tx.categoryId) ? tx.categoryId : (firstCat ? firstCat.id : ''),
      memberId: Store.memberById(tx.memberId) ? tx.memberId : members[0].id,
      account: tx.account || '微信',
      note: tx.note || ''
    } : {
      type: 'expense',
      amount: '',
      date: Store.todayISO(),
      categoryId: firstCat ? firstCat.id : '',
      memberId: members[0].id,
      account: '微信',
      note: ''
    };

    renderModal();
    document.body.classList.add('modal-open');
    setTimeout(function () {
      const input = $('#amount-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 40);
  }

  function renderModal() {
    const d = ui.draft;
    const cats = Store.getCategories().filter(function (c) { return c.type === d.type; });
    const members = Store.getMembers();

    const root = $('#modal-root');
    root.innerHTML = '<div class="overlay" data-action="overlay-close">' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
        '<header class="sheet-head">' +
          '<h2 id="sheet-title">' + (ui.editingId ? '编辑记录' : '记一笔') + '</h2>' +
          '<button type="button" class="icon-btn" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
        '</header>' +
        '<form id="tx-form" novalidate>' +
          '<div class="sheet-body">' +
          '<div class="type-switch segmented" role="group" aria-label="收支类型">' +
            '<button type="button" data-action="type-switch" data-type="expense" class="' +
              (d.type === 'expense' ? 'active expense' : '') + '">支出</button>' +
            '<button type="button" data-action="type-switch" data-type="income" class="' +
              (d.type === 'income' ? 'active income' : '') + '">收入</button>' +
          '</div>' +
          '<div class="amount-field ' + d.type + '">' +
            '<span class="amount-cur">¥</span>' +
            '<input id="amount-input" data-field="amount" type="text" inputmode="decimal" autocomplete="off" ' +
              'placeholder="0.00" value="' + esc(d.amount) + '" aria-label="金额">' +
          '</div>' +
          '<div class="field-label">选择分类</div>' +
          '<div class="cat-grid">' + cats.map(function (c) {
            return '<button type="button" class="cat-chip' + (c.id === d.categoryId ? ' selected' : '') +
              '" data-action="pick-category" data-id="' + c.id + '">' +
              '<span class="cat-emoji" style="background:' + c.color + '1f">' + esc(c.icon) + '</span>' +
              '<span class="cat-name">' + esc(c.name) + '</span></button>';
          }).join('') + '</div>' +
          '<div class="form-row">' +
            '<label class="field"><span>日期</span>' +
              '<input type="date" data-field="date" value="' + esc(d.date) + '" min="2000-01-01" max="2100-12-31"></label>' +
            '<label class="field"><span>成员</span><select data-field="memberId">' +
              members.map(function (m) {
                return '<option value="' + m.id + '"' + (m.id === d.memberId ? ' selected' : '') + '>' +
                  esc(m.name) + '</option>';
              }).join('') + '</select></label>' +
            '<label class="field"><span>账户</span><select data-field="account">' +
              accountOptions(d.account) + '</select></label>' +
          '</div>' +
          '<label class="field"><span>备注</span>' +
            '<input type="text" data-field="note" maxlength="60" placeholder="选填，比如：周末超市采购" value="' +
              esc(d.note) + '"></label>' +
          '<p class="form-error" id="form-error" hidden></p>' +
          '</div>' +
          '<footer class="sheet-foot">' +
            (ui.editingId
              ? '<button type="button" class="btn btn-danger-ghost" data-action="delete-tx">' + icon('trash') + '删除</button>'
              : '<span></span>') +
            '<div class="foot-right">' +
              '<button type="button" class="btn btn-ghost" data-action="close-modal">取消</button>' +
              '<button type="submit" class="btn btn-primary">保存</button>' +
            '</div>' +
          '</footer>' +
        '</form>' +
      '</div>' +
    '</div>';
    root.classList.add('is-open');
  }

  function closeModal() {
    const root = $('#modal-root');
    if (!root) return;
    root.innerHTML = '';
    root.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    ui.editingId = null;
    ui.draft = null;
  }

  function syncDraft(form) {
    $$('[data-field]', form).forEach(function (field) {
      ui.draft[field.dataset.field] = field.value;
    });
  }

  function saveTxFromForm() {
    const form = $('#tx-form');
    if (!form || !ui.draft) return;
    syncDraft(form);

    const payload = {
      type: ui.draft.type,
      amount: Number(String(ui.draft.amount || '').replace(/,/g, '').trim()),
      date: ui.draft.date,
      categoryId: ui.draft.categoryId,
      memberId: ui.draft.memberId,
      account: ui.draft.account,
      note: ui.draft.note
    };

    const wasEdit = !!ui.editingId;
    const res = wasEdit
      ? Store.updateTransaction(ui.editingId, payload)
      : Store.addTransaction(payload);

    if (!res.ok) {
      const err = $('#form-error');
      if (err) {
        err.textContent = res.error;
        err.hidden = false;
        err.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    closeModal();
    toast(wasEdit ? '记录已更新' : '已记一笔');
  }

  /* ---------------- 提示 & 确认 ---------------- */

  function toast(message, kind) {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = 'toast' + (kind === 'error' ? ' error' : '');
    node.textContent = message;
    root.appendChild(node);
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () { node.remove(); }, 220);
    }, 2600);
  }

  function confirmAction(options) {
    return new Promise(function (resolve) {
      ui.confirmResolve = resolve;
      const root = $('#confirm-root');
      root.innerHTML = '<div class="overlay">' +
        '<div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">' +
          '<h3 id="confirm-title">' + esc(options.title) + '</h3>' +
          '<p>' + esc(options.message || '') + '</p>' +
          '<div class="confirm-actions">' +
            '<button type="button" class="btn btn-ghost" data-confirm="no">取消</button>' +
            '<button type="button" class="btn ' + (options.danger ? 'btn-danger' : 'btn-primary') +
              '" data-confirm="yes">' + esc(options.confirmText || '确定') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
      root.classList.add('is-open');
      setTimeout(function () {
        const btn = root.querySelector('[data-confirm="no"]');
        if (btn) btn.focus();
      }, 30);
    });
  }

  function closeConfirm(result) {
    const root = $('#confirm-root');
    if (!root) return;
    root.innerHTML = '';
    root.classList.remove('is-open');
    const resolve = ui.confirmResolve;
    ui.confirmResolve = null;
    if (resolve) resolve(result);
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------------- 事件处理 ---------------- */

  function onAction(action, el, event) {
    switch (action) {
      case 'new-tx':
        openTxModal(null);
        break;

      case 'edit-tx':
        openTxModal(el.dataset.id);
        break;

      case 'month-prev':
        ui.month = Store.shiftMonth(ui.month, -1);
        render();
        break;

      case 'month-next':
        ui.month = Store.shiftMonth(ui.month, 1);
        render();
        break;

      case 'month-today':
        ui.month = Store.currentMonth();
        render();
        break;

      case 'filter-type':
        ui.filters.type = el.dataset.value;
        if (ui.filters.categoryId !== 'all') {
          const cat = Store.categoryById(ui.filters.categoryId);
          if (!cat || (ui.filters.type !== 'all' && cat.type !== ui.filters.type)) ui.filters.categoryId = 'all';
        }
        render();
        break;

      case 'reset-filters':
        ui.filters = { type: 'all', memberId: 'all', categoryId: 'all', q: '' };
        render();
        break;

      case 'stats-range':
        ui.statsRange = el.dataset.value === 'year' ? 'year' : Number(el.dataset.value);
        render();
        break;

      case 'stats-cat-type':
        ui.statsCatType = el.dataset.value;
        render();
        break;

      case 'cat-tab':
        ui.catTab = el.dataset.value;
        render();
        break;

      case 'save-budget': {
        const input = $('#budget-input');
        const value = input ? Number(input.value) : 0;
        if (!isFinite(value) || value < 0) {
          toast('请输入有效的预算金额', 'error');
          return;
        }
        Store.setBudget(value);
        toast(value > 0 ? '月度预算已保存' : '已关闭预算提醒');
        break;
      }

      case 'del-member': {
        const member = Store.memberById(el.dataset.id);
        if (!member) return;
        const count = Store.query({ memberId: member.id }).length;
        confirmAction({
          title: '删除成员「' + member.name + '」？',
          message: count > 0 ? '该成员名下的 ' + count + ' 笔记录会转给其他成员。' : '该成员目前没有记录。',
          confirmText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          const res = Store.deleteMember(member.id);
          if (!res.ok) { toast(res.error, 'error'); return; }
          toast(res.moved > 0 ? '已删除，' + res.moved + ' 笔记录已转移' : '已删除成员');
        });
        break;
      }

      case 'del-category': {
        const cat = Store.categoryById(el.dataset.id);
        if (!cat) return;
        const count = Store.query({ categoryId: cat.id }).length;
        confirmAction({
          title: '删除分类「' + cat.name + '」？',
          message: count > 0 ? '该分类下的 ' + count + ' 笔记录会移到同类型的其他分类。' : '该分类目前没有记录。',
          confirmText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          const res = Store.deleteCategory(cat.id);
          if (!res.ok) { toast(res.error, 'error'); return; }
          toast(res.moved > 0 ? '已删除，' + res.moved + ' 笔记录已转移' : '已删除分类');
        });
        break;
      }

      case 'export-json':
        download('家账本备份-' + Store.todayISO() + '.json',
          JSON.stringify(Store.exportData(), null, 2), 'application/json');
        toast('备份已导出');
        break;

      case 'import-json': {
        const input = $('#import-file');
        if (input) input.click();
        break;
      }

      case 'export-csv-all':
        download('家账本明细-' + Store.todayISO() + '.csv',
          Store.toCSV(Store.query({})), 'text/csv;charset=utf-8');
        toast('CSV 已导出');
        break;

      case 'export-csv-range': {
        const months = statsMonths();
        const name = '家账本-' + months[0] + '至' + months[months.length - 1] + '.csv';
        download(name, Store.toCSV(Store.query({ months: months })), 'text/csv;charset=utf-8');
        toast('CSV 已导出');
        break;
      }

      case 'load-demo': {
        const go = function () {
          const res = Store.loadDemo();
          toast('已载入 ' + res.count + ' 笔示例记录');
        };
        if (Store.countAll() > 0) {
          confirmAction({
            title: '载入示例数据？',
            message: '示例数据会覆盖当前全部记录，建议先导出备份。',
            confirmText: '覆盖并载入',
            danger: true
          }).then(function (ok) { if (ok) go(); });
        } else {
          go();
        }
        break;
      }

      case 'clear-transactions':
        confirmAction({
          title: '清空所有记录？',
          message: '所有收支记录将被删除，成员、分类和预算设置会保留。此操作无法撤销。',
          confirmText: '清空记录',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          Store.clearTransactions();
          toast('已清空所有记录');
        });
        break;

      case 'factory-reset':
        confirmAction({
          title: '恢复出厂设置？',
          message: '所有记录、成员、分类和预算都会恢复默认，此操作无法撤销。',
          confirmText: '恢复默认',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          Store.resetAll();
          ui.month = Store.currentMonth();
          ui.filters = { type: 'all', memberId: 'all', categoryId: 'all', q: '' };
          toast('已恢复出厂设置');
        });
        break;

      case 'close-modal':
        closeModal();
        break;

      case 'overlay-close':
        if (event.target === el) closeModal();
        break;

      case 'delete-tx': {
        const id = ui.editingId;
        if (!id) return;
        confirmAction({
          title: '删除这笔记录？',
          message: '删除后无法恢复。',
          confirmText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          closeModal();
          const res = Store.deleteTransaction(id);
          if (!res.ok) { toast(res.error, 'error'); return; }
          toast('记录已删除');
        });
        break;
      }

      case 'type-switch': {
        const type = el.dataset.type;
        if (!ui.draft || ui.draft.type === type) return;
        syncDraft($('#tx-form'));
        ui.draft.type = type;
        const first = Store.getCategories().find(function (c) { return c.type === type; });
        ui.draft.categoryId = first ? first.id : '';
        renderModal();
        break;
      }

      case 'pick-category': {
        if (!ui.draft) return;
        ui.draft.categoryId = el.dataset.id;
        $$('.cat-chip').forEach(function (chip) {
          chip.classList.toggle('selected', chip.dataset.id === el.dataset.id);
        });
        break;
      }

      default:
        break;
    }
  }

  document.addEventListener('click', function (event) {
    const confirmBtn = event.target.closest('[data-confirm]');
    if (confirmBtn) {
      closeConfirm(confirmBtn.dataset.confirm === 'yes');
      return;
    }

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    onAction(actionEl.dataset.action, actionEl, event);
  });

  document.addEventListener('input', function (event) {
    const target = event.target;
    if (target.id === 'search-input') {
      ui.filters.q = target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshRecords, 140);
      return;
    }
    if (target.dataset && target.dataset.field && ui.draft) {
      ui.draft[target.dataset.field] = target.value;
    }
  });

  document.addEventListener('change', function (event) {
    const target = event.target;

    if (target.dataset && target.dataset.field && ui.draft) {
      ui.draft[target.dataset.field] = target.value;
    }

    const filterKey = target.dataset ? target.dataset.change : null;
    if (filterKey === 'member') {
      ui.filters.memberId = target.value;
      refreshRecords();
    } else if (filterKey === 'category') {
      ui.filters.categoryId = target.value;
      refreshRecords();
    }

    if (target.id === 'import-file') {
      const file = target.files && target.files[0];
      target.value = '';
      if (file) importBackup(file);
    }
  });

  document.addEventListener('submit', function (event) {
    const form = event.target;
    if (form.id === 'tx-form') {
      event.preventDefault();
      saveTxFromForm();
      return;
    }
    if (form.dataset.form === 'add-member') {
      event.preventDefault();
      const name = form.elements.name.value;
      const res = Store.addMember(name);
      if (!res.ok) { toast(res.error, 'error'); return; }
      toast('已添加成员「' + res.member.name + '」');
    } else if (form.dataset.form === 'add-category') {
      event.preventDefault();
      const name = form.elements.name.value;
      const iconValue = form.elements.icon.value;
      const res = Store.addCategory(name, iconValue, ui.catTab);
      if (!res.ok) { toast(res.error, 'error'); return; }
      toast('已添加分类「' + res.category.name + '」');
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if ($('#confirm-root').classList.contains('is-open')) {
        closeConfirm(false);
        return;
      }
      if ($('#modal-root').classList.contains('is-open')) closeModal();
      return;
    }

    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (!typing && (event.key === 'n' || event.key === 'N') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!$('#modal-root').classList.contains('is-open')) {
        event.preventDefault();
        openTxModal(null);
      }
    }

    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement &&
        document.activeElement.classList.contains('tx')) {
      event.preventDefault();
      openTxModal(document.activeElement.dataset.id);
    }
  });

  function importBackup(file) {
    file.text().then(function (text) {
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        toast('导入失败：文件不是有效的 JSON', 'error');
        return;
      }
      const count = Array.isArray(data.transactions) ? data.transactions.length : 0;
      return confirmAction({
        title: '导入备份？',
        message: '将用备份中的 ' + count + ' 笔记录替换当前全部数据。',
        confirmText: '导入'
      }).then(function (ok) {
        if (!ok) return;
        const res = Store.importData(data);
        if (!res.ok) { toast(res.error, 'error'); return; }
        toast('已导入 ' + res.count + ' 笔记录');
      });
    }).catch(function () {
      toast('导入失败，请检查文件', 'error');
    });
  }

  window.addEventListener('hashchange', function () {
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });

  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (ui.route === 'overview' || ui.route === 'stats') render();
    }, 180);
  });

  Store.subscribe(render);

  ui.route = routeFromHash();
  render();

  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 离线能力不可用时静默降级 */ });
    });
  }
})();
